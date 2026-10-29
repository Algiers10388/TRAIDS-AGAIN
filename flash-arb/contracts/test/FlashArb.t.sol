// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {FlashArb} from "../src/FlashArb.sol";
import {IFlashLoanSimpleReceiver} from "../src/interfaces/IAaveV3Pool.sol";
import {ISwapRouter, ISwapRouter02} from "../src/interfaces/IUniswapV3.sol";
import {ISolidlyRouter} from "../src/interfaces/ISolidlyRouter.sol";

// =============================================================================
// UNIT TEST MOCKS
// These exist only to test FlashArb's own accounting and dispatch in isolation.
// They are test-only and are not deployed anywhere. Market behaviour is covered by
// FlashArbForkTest below, which runs against real Arbitrum state.
// =============================================================================

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Unit-test stand-in for the Aave pool: lends, calls back, then pulls principal + 5 bps premium.
contract MockAavePool {
    uint256 public constant PREMIUM_BPS = 5;

    function flashLoanSimple(address receiver, address asset, uint256 amount, bytes calldata params, uint16) external {
        uint256 premium = (amount * PREMIUM_BPS) / 10_000;
        MockERC20(asset).transfer(receiver, amount);
        bool ok = IFlashLoanSimpleReceiver(receiver).executeOperation(asset, amount, premium, msg.sender, params);
        require(ok, "callback returned false");
        MockERC20(asset).transferFrom(receiver, address(this), amount + premium);
    }

    /// @dev Calls the receiver with an arbitrary initiator to test the initiator check.
    function callExecuteOperation(
        address receiver,
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        return IFlashLoanSimpleReceiver(receiver).executeOperation(asset, amount, premium, initiator, params);
    }
}

contract MockAddressesProvider {
    address public pool;

    constructor(address _pool) {
        pool = _pool;
    }

    function getPool() external view returns (address) {
        return pool;
    }
}

/// @dev Unit-test router implementing the real function signatures of the four router flavours,
///      each paying `rateBps / 10_000` of the input from its own inventory.
contract MockMultiRouter {
    uint256 public rateBps;

    constructor(uint256 _rateBps) {
        rateBps = _rateBps;
    }

    function setRate(uint256 _rateBps) external {
        rateBps = _rateBps;
    }

    function _swap(address tokenIn, address tokenOut, uint256 amountIn, address to) internal returns (uint256 out) {
        MockERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        out = (amountIn * rateBps) / 10_000;
        MockERC20(tokenOut).transfer(to, out);
    }

    // Uniswap V2 / Camelot
    function swapExactTokensForTokens(uint256 amountIn, uint256, address[] calldata path, address to, uint256)
        external
        returns (uint256[] memory amounts)
    {
        uint256 out = _swap(path[0], path[1], amountIn, to);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = out;
    }

    // Aerodrome / Velodrome
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256,
        ISolidlyRouter.Route[] calldata routes,
        address to,
        uint256
    ) external returns (uint256[] memory amounts) {
        require(routes.length == 1, "one route");
        uint256 out = _swap(routes[0].from, routes[0].to, amountIn, to);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = out;
    }

    // Uniswap V3 SwapRouter (with deadline)
    function exactInputSingle(ISwapRouter.ExactInputSingleParams calldata p) external returns (uint256) {
        return _swap(p.tokenIn, p.tokenOut, p.amountIn, p.recipient);
    }

    // Uniswap V3 SwapRouter02 (no deadline)
    function exactInputSingle(ISwapRouter02.ExactInputSingleParams calldata p) external returns (uint256) {
        return _swap(p.tokenIn, p.tokenOut, p.amountIn, p.recipient);
    }
}

/// @dev Unit-test Curve pool with int128 coin indices for two coins.
contract MockCurvePool {
    address[2] public coins;
    uint256 public rateBps;

    constructor(address c0, address c1, uint256 _rateBps) {
        coins[0] = c0;
        coins[1] = c1;
        rateBps = _rateBps;
    }

    function exchange(int128 i, int128 j, uint256 dx, uint256) external returns (uint256 dy) {
        require((i == 0 && j == 1) || (i == 1 && j == 0), "bad index");
        MockERC20(coins[uint256(uint128(i))]).transferFrom(msg.sender, address(this), dx);
        dy = (dx * rateBps) / 10_000;
        MockERC20(coins[uint256(uint128(j))]).transfer(msg.sender, dy);
    }
}

// =============================================================================
// UNIT TESTS
// =============================================================================

contract FlashArbUnitTest is Test {
    event FlashArbExecuted(
        address indexed asset,
        uint256 loanAmount,
        uint256 premium,
        uint256 netProfit,
        address indexed recipient
    );

    address internal constant OWNER = address(0xA11CE);
    address internal constant RECIPIENT = address(0xBEEF);
    address internal constant STRANGER = address(0x9999);

    uint256 internal constant LOAN = 1000 ether;
    uint256 internal constant PREMIUM = 0.5 ether; // 5 bps of LOAN

    MockERC20 internal tokenA; // borrowed asset
    MockERC20 internal tokenB; // intermediate
    MockAavePool internal pool;
    MockAddressesProvider internal provider;
    MockMultiRouter internal router1; // A -> B at 1:1
    MockMultiRouter internal router2; // B -> A at configurable rate
    FlashArb internal arb;

    function setUp() public {
        tokenA = new MockERC20();
        tokenB = new MockERC20();
        pool = new MockAavePool();
        provider = new MockAddressesProvider(address(pool));
        router1 = new MockMultiRouter(10_000);
        router2 = new MockMultiRouter(10_100);

        vm.prank(OWNER);
        arb = new FlashArb(address(provider));

        tokenA.mint(address(pool), 1_000_000 ether);
        tokenA.mint(address(router2), 1_000_000 ether);
        tokenB.mint(address(router1), 1_000_000 ether);
        tokenB.mint(address(router2), 1_000_000 ether);
    }

    // --- helpers ---

    function _leg(FlashArb.DexProtocol p, address router, address tin, address tout)
        internal
        pure
        returns (FlashArb.SwapLeg memory l)
    {
        l.protocol = p;
        l.routerOrPool = router;
        l.tokenIn = tin;
        l.tokenOut = tout;
        l.v3Fee = 500;
        l.factory = address(0xFAC);
    }

    function _params(uint256 minProfit, FlashArb.SwapLeg memory l1, FlashArb.SwapLeg memory l2)
        internal
        pure
        returns (FlashArb.ArbParams memory p)
    {
        p.minProfit = minProfit;
        p.leg1 = l1;
        p.leg2 = l2;
        p.profitRecipient = RECIPIENT;
    }

    function _defaultParams(uint256 minProfit) internal view returns (FlashArb.ArbParams memory) {
        return _params(
            minProfit,
            _leg(FlashArb.DexProtocol.UNISWAP_V2, address(router1), address(tokenA), address(tokenB)),
            _leg(FlashArb.DexProtocol.UNISWAP_V2, address(router2), address(tokenB), address(tokenA))
        );
    }

    function _run(FlashArb.ArbParams memory p) internal {
        vm.prank(OWNER);
        arb.executeFlashArb(address(tokenA), LOAN, p);
    }

    // --- wiring / access control ---

    function test_ConstructorSetsPoolAndProvider() public view {
        assertEq(address(arb.POOL()), address(pool));
        assertEq(address(arb.ADDRESSES_PROVIDER()), address(provider));
        assertEq(arb.owner(), OWNER);
    }

    function test_ConstructorRevertsOnZeroProvider() public {
        vm.expectRevert(FlashArb.ZeroAddress.selector);
        new FlashArb(address(0));
    }

    function test_ExecuteFlashArb_RevertsForNonOwner() public {
        FlashArb.ArbParams memory p = _defaultParams(1);
        vm.expectRevert(FlashArb.Unauthorized.selector);
        vm.prank(STRANGER);
        arb.executeFlashArb(address(tokenA), LOAN, p);
    }

    function test_ExecuteOperation_RevertsWhenCallerIsNotPool() public {
        bytes memory encoded = abi.encode(_defaultParams(1));
        vm.expectRevert(FlashArb.InvalidCaller.selector);
        arb.executeOperation(address(tokenA), LOAN, PREMIUM, address(arb), encoded);
    }

    function test_ExecuteOperation_RevertsWhenInitiatorIsNotContract() public {
        bytes memory encoded = abi.encode(_defaultParams(1));
        vm.expectRevert(FlashArb.Unauthorized.selector);
        pool.callExecuteOperation(address(arb), address(tokenA), LOAN, PREMIUM, STRANGER, encoded);
    }

    function test_RecoverERC20_OnlyOwnerAndSweepsToOwner() public {
        tokenB.mint(address(arb), 7 ether);

        vm.expectRevert(FlashArb.Unauthorized.selector);
        vm.prank(STRANGER);
        arb.recoverERC20(address(tokenB));

        vm.prank(OWNER);
        arb.recoverERC20(address(tokenB));
        assertEq(tokenB.balanceOf(OWNER), 7 ether);
        assertEq(tokenB.balanceOf(address(arb)), 0);
    }

    // --- leg validation ---

    function test_RevertsWhenFirstLegDoesNotStartWithBorrowedAsset() public {
        FlashArb.ArbParams memory p = _defaultParams(1);
        p.leg1.tokenIn = address(tokenB);
        vm.expectRevert(FlashArb.LegAssetMismatch.selector);
        _run(p);
    }

    function test_RevertsWhenLastLegDoesNotEndWithBorrowedAsset() public {
        FlashArb.ArbParams memory p = _defaultParams(1);
        p.leg2.tokenOut = address(tokenB);
        vm.expectRevert(FlashArb.LegAssetMismatch.selector);
        _run(p);
    }

    function test_RevertsWhenLegsAreNotChained() public {
        FlashArb.ArbParams memory p = _defaultParams(1);
        p.leg2.tokenIn = address(0xDEAD);
        vm.expectRevert(FlashArb.LegsNotChained.selector);
        _run(p);
    }

    function test_RevertsOnZeroRouter() public {
        FlashArb.ArbParams memory p = _defaultParams(1);
        p.leg1.routerOrPool = address(0);
        vm.expectRevert(FlashArb.InvalidRouter.selector);
        _run(p);
    }

    // --- profit accounting (exact values) ---

    // rates: leg1 1:1, leg2 +1% => 1000 -> 1010; repay 1000.5; gross profit 9.5
    function test_ProfitableRun_SweepsExactProfitAndEmitsEvent() public {
        uint256 expectedProfit = 9.5 ether;

        vm.expectEmit(true, true, false, true, address(arb));
        emit FlashArbExecuted(address(tokenA), LOAN, PREMIUM, expectedProfit, RECIPIENT);
        _run(_defaultParams(expectedProfit));

        assertEq(tokenA.balanceOf(RECIPIENT), expectedProfit);
        assertEq(tokenA.balanceOf(address(arb)), 0, "no residual asset");
        assertEq(tokenB.balanceOf(address(arb)), 0, "no residual intermediate");
        assertEq(tokenA.allowance(address(arb), address(pool)), 0, "allowance fully consumed");
    }

    function test_ProfitBelowMinimumRevertsWithExactValues() public {
        vm.expectRevert(abi.encodeWithSelector(FlashArb.InsufficientProfit.selector, 9.5 ether, 10 ether));
        _run(_defaultParams(10 ether));
        assertEq(tokenA.balanceOf(RECIPIENT), 0);
    }

    function test_InsolventRunRevertsWithZeroProfit() public {
        router2.setRate(10_000); // 1000 -> 1000, cannot repay 1000.5
        vm.expectRevert(abi.encodeWithSelector(FlashArb.InsufficientProfit.selector, 0, 1 ether));
        _run(_defaultParams(1 ether));
    }

    function test_ZeroRecipientSendsProfitToOwner() public {
        FlashArb.ArbParams memory p = _defaultParams(1);
        p.profitRecipient = address(0);
        _run(p);
        assertEq(tokenA.balanceOf(OWNER), 9.5 ether);
    }

    function testFuzz_ProfitAccounting(uint256 seed) public {
        uint256 rate2 = bound(seed, 9_000, 11_000);
        router2.setRate(rate2);
        uint256 minProfit = 1 ether;

        uint256 finalBalance = (LOAN * rate2) / 10_000;
        uint256 repay = LOAN + PREMIUM;
        FlashArb.ArbParams memory p = _defaultParams(minProfit);

        if (finalBalance < repay) {
            vm.expectRevert(abi.encodeWithSelector(FlashArb.InsufficientProfit.selector, 0, minProfit));
            _run(p);
            assertEq(tokenA.balanceOf(RECIPIENT), 0);
        } else if (finalBalance - repay < minProfit) {
            vm.expectRevert(
                abi.encodeWithSelector(FlashArb.InsufficientProfit.selector, finalBalance - repay, minProfit)
            );
            _run(p);
            assertEq(tokenA.balanceOf(RECIPIENT), 0);
        } else {
            _run(p);
            assertEq(tokenA.balanceOf(RECIPIENT), finalBalance - repay);
            assertEq(tokenA.balanceOf(address(arb)), 0);
        }
    }

    // --- dispatch for every protocol (leg 1), leg 2 always Uniswap V2 style ---

    function test_AllRouterProtocolsDispatchCorrectly() public {
        FlashArb.DexProtocol[4] memory protocols = [
            FlashArb.DexProtocol.UNISWAP_V2,
            FlashArb.DexProtocol.UNISWAP_V3,
            FlashArb.DexProtocol.UNISWAP_V3_ROUTER02,
            FlashArb.DexProtocol.SOLIDLY
        ];

        uint256 expectedTotal;
        for (uint256 k = 0; k < protocols.length; k++) {
            FlashArb.ArbParams memory p = _params(
                9.5 ether,
                _leg(protocols[k], address(router1), address(tokenA), address(tokenB)),
                _leg(FlashArb.DexProtocol.UNISWAP_V2, address(router2), address(tokenB), address(tokenA))
            );
            _run(p);
            expectedTotal += 9.5 ether;
            assertEq(tokenA.balanceOf(RECIPIENT), expectedTotal, "profit after protocol");
            assertEq(tokenA.balanceOf(address(arb)), 0);
            assertEq(tokenB.balanceOf(address(arb)), 0);
        }
    }

    function test_CurveLegDispatch() public {
        MockCurvePool curve = new MockCurvePool(address(tokenA), address(tokenB), 10_000);
        tokenB.mint(address(curve), 1_000_000 ether);
        tokenA.mint(address(curve), 1_000_000 ether);

        FlashArb.SwapLeg memory l1 =
            _leg(FlashArb.DexProtocol.CURVE, address(curve), address(tokenA), address(tokenB));
        l1.curveIndexIn = 0;
        l1.curveIndexOut = 1;

        FlashArb.ArbParams memory p = _params(
            9.5 ether,
            l1,
            _leg(FlashArb.DexProtocol.UNISWAP_V2, address(router2), address(tokenB), address(tokenA))
        );
        _run(p);
        assertEq(tokenA.balanceOf(RECIPIENT), 9.5 ether);
    }
}

// =============================================================================
// FORK TEST (real Arbitrum state)
// Runs only when FORK_URL is set, e.g.
//   FORK_URL=https://arb1.arbitrum.io/rpc forge test --match-contract FlashArbForkTest -vvv
// Without FORK_URL every test here is reported as skipped (not passed).
// =============================================================================

contract FlashArbForkTest is Test {
    address internal constant OWNER = address(0xA11CE);
    address internal constant AAVE_PROVIDER = 0xa97684ead0e402dC232d5A977953DF7ECBAB3CDb;
    address internal constant AAVE_POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    address internal constant WETH = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;
    address internal constant UNI_V3_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address internal constant CAMELOT_ROUTER = 0xc873fEcbd354f5A56E00E710B90EF4201db2448d;
    uint256 internal constant FORK_BLOCK = 225_000_000;

    bool internal forkEnabled;
    address internal usdce;
    FlashArb internal arb;

    function setUp() public {
        string memory url = vm.envOr("FORK_URL", string(""));
        if (bytes(url).length == 0) return;

        vm.createSelectFork(url, FORK_BLOCK);
        forkEnabled = true;

        // Bridged USDC.e on Arbitrum One. Parsed at runtime so a casing typo cannot break compilation.
        usdce = vm.parseAddress("0xff970a61a04b1ca14834a43f5de4533ebddb5cc8");

        vm.prank(OWNER);
        arb = new FlashArb(AAVE_PROVIDER);
    }

    function test_Fork_PoolWiring() public {
        if (!forkEnabled) vm.skip(true);
        assertEq(address(arb.POOL()), AAVE_POOL);
    }

    /// A 100k USDC.e round trip Camelot -> Uniswap V3 pays three swap fees plus the Aave premium
    /// with no engineered spread, so it must revert with InsufficientProfit(0, minProfit).
    function test_Fork_SpreadlessRoundTripRevertsInsufficientProfit() public {
        if (!forkEnabled) vm.skip(true);

        FlashArb.SwapLeg memory l1;
        l1.protocol = FlashArb.DexProtocol.UNISWAP_V2;
        l1.routerOrPool = CAMELOT_ROUTER;
        l1.tokenIn = usdce;
        l1.tokenOut = WETH;

        FlashArb.SwapLeg memory l2;
        l2.protocol = FlashArb.DexProtocol.UNISWAP_V3;
        l2.routerOrPool = UNI_V3_ROUTER;
        l2.tokenIn = WETH;
        l2.tokenOut = usdce;
        l2.v3Fee = 500;

        FlashArb.ArbParams memory p;
        p.minProfit = 1;
        p.leg1 = l1;
        p.leg2 = l2;
        p.profitRecipient = OWNER;

        vm.expectRevert(abi.encodeWithSelector(FlashArb.InsufficientProfit.selector, 0, 1));
        vm.prank(OWNER);
        arb.executeFlashArb(usdce, 100_000 * 1e6, p);
    }
}
