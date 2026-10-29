// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPool, IPoolAddressesProvider, IFlashLoanSimpleReceiver} from "./interfaces/IAaveV3Pool.sol";
import {ISwapRouter, ISwapRouter02} from "./interfaces/IUniswapV3.sol";
import {IUniswapV2Router02} from "./interfaces/IUniswapV2.sol";
import {ICurvePool} from "./interfaces/ICurvePool.sol";
import {ISolidlyRouter} from "./interfaces/ISolidlyRouter.sol";

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

/**
 * @title FlashArb
 * @notice Atomic two-leg flash loan arbitrage executor on top of Aave V3 `flashLoanSimple`.
 * @dev Supported venues (DexProtocol):
 *      0 UNISWAP_V2          Uniswap V2 style routers (Camelot, Sushi) - address[] path
 *      1 UNISWAP_V3          original SwapRouter (with deadline) - Arbitrum 0xE592...1564
 *      2 CURVE               Curve pools with int128 indices
 *      3 UNISWAP_V3_ROUTER02 SwapRouter02 (no deadline) - Base, Optimism
 *      4 SOLIDLY             Aerodrome / Velodrome V2 routers - Route[]
 *
 *      Ownership: `owner` is the deployer and is immutable. It must be the same wallet the
 *      off-chain searcher signs with. To change owner, deploy a new contract and call
 *      recoverERC20 on the old one. The contract is meant to hold no funds between transactions.
 */
contract FlashArb is IFlashLoanSimpleReceiver {
    // --- Errors ---
    error Unauthorized();
    error InvalidCaller();
    error InsufficientProfit(uint256 netProfit, uint256 minProfit);
    error UnsupportedDexProtocol(uint8 protocol);
    error ZeroAddress();
    error InvalidRouter();
    error LegAssetMismatch();
    error LegsNotChained();

    // --- Enums (order is part of the ABI used by the searcher) ---
    enum DexProtocol {
        UNISWAP_V2,           // 0
        UNISWAP_V3,           // 1
        CURVE,                // 2
        UNISWAP_V3_ROUTER02,  // 3
        SOLIDLY               // 4
    }

    // --- Structs (field order is part of the ABI used by the searcher) ---
    struct SwapLeg {
        DexProtocol protocol;
        address routerOrPool; // Router for V2/V3/Solidly, or direct pool for Curve
        address tokenIn;
        address tokenOut;
        uint24 v3Fee;         // Uniswap V3 pool fee, e.g. 500, 3000, 10000
        int128 curveIndexIn;  // Curve coin index
        int128 curveIndexOut; // Curve coin index
        address factory;      // Solidly pool factory (Aerodrome/Velodrome); unused otherwise
        bool stable;          // Solidly stable pool flag; unused otherwise
    }

    struct ArbParams {
        uint256 minProfit;
        SwapLeg leg1;
        SwapLeg leg2;
        address profitRecipient;
    }

    // --- State ---
    address public immutable owner;
    IPoolAddressesProvider public immutable override ADDRESSES_PROVIDER;
    IPool public immutable override POOL;

    // --- Events ---
    event FlashArbExecuted(
        address indexed asset,
        uint256 loanAmount,
        uint256 premium,
        uint256 netProfit,
        address indexed recipient
    );
    event FundsRecovered(address indexed token, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyPool() {
        if (msg.sender != address(POOL)) revert InvalidCaller();
        _;
    }

    constructor(address _addressProvider) {
        if (_addressProvider == address(0)) revert ZeroAddress();
        owner = msg.sender;
        ADDRESSES_PROVIDER = IPoolAddressesProvider(_addressProvider);
        POOL = IPool(IPoolAddressesProvider(_addressProvider).getPool());
    }

    /// @notice Starts a flash loan of `asset` and runs the two swap legs in the callback.
    function executeFlashArb(address asset, uint256 amount, ArbParams calldata params) external onlyOwner {
        POOL.flashLoanSimple(address(this), asset, amount, abi.encode(params), 0);
    }

    /// @notice Aave V3 callback. Only the Pool may call it, and only for loans this contract initiated.
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override onlyPool returns (bool) {
        if (initiator != address(this)) revert Unauthorized();

        ArbParams memory arb = abi.decode(params, (ArbParams));
        _validateLegs(asset, arb.leg1, arb.leg2);

        uint256 finalBalance = _executeSwap(arb.leg2, _executeSwap(arb.leg1, amount));
        _settle(asset, amount, premium, finalBalance, arb.minProfit, arb.profitRecipient);
        return true;
    }

    // --- Internals ---

    /// @dev Enforces solvency and the minimum profit, approves Aave for repayment, sweeps the profit.
    function _settle(
        address asset,
        uint256 amount,
        uint256 premium,
        uint256 finalBalance,
        uint256 minProfit,
        address profitRecipient
    ) internal {
        uint256 amountToRepay = amount + premium;
        if (finalBalance < amountToRepay) {
            revert InsufficientProfit(0, minProfit);
        }
        uint256 grossProfit = finalBalance - amountToRepay;
        if (grossProfit < minProfit) {
            revert InsufficientProfit(grossProfit, minProfit);
        }

        // Let Aave pull principal + premium, then sweep the profit.
        _safeApprove(asset, address(POOL), amountToRepay);

        address recipient = profitRecipient == address(0) ? owner : profitRecipient;
        if (grossProfit > 0) {
            _safeTransfer(asset, recipient, grossProfit);
        }

        emit FlashArbExecuted(asset, amount, premium, grossProfit, recipient);
    }

    function _validateLegs(address asset, SwapLeg memory leg1, SwapLeg memory leg2) internal pure {
        if (leg1.routerOrPool == address(0) || leg2.routerOrPool == address(0)) revert InvalidRouter();
        if (leg1.tokenIn != asset || leg2.tokenOut != asset) revert LegAssetMismatch();
        if (leg1.tokenOut != leg2.tokenIn) revert LegsNotChained();
    }

    function _executeSwap(SwapLeg memory leg, uint256 amountIn) internal returns (uint256 amountOut) {
        if (leg.protocol == DexProtocol.UNISWAP_V2) {
            amountOut = _swapUniswapV2(leg.routerOrPool, leg.tokenIn, leg.tokenOut, amountIn);
        } else if (leg.protocol == DexProtocol.UNISWAP_V3) {
            amountOut = _swapUniswapV3(leg.routerOrPool, leg.tokenIn, leg.tokenOut, leg.v3Fee, amountIn);
        } else if (leg.protocol == DexProtocol.CURVE) {
            amountOut = _swapCurve(leg.routerOrPool, leg.tokenIn, leg.curveIndexIn, leg.curveIndexOut, amountIn);
        } else if (leg.protocol == DexProtocol.UNISWAP_V3_ROUTER02) {
            amountOut = _swapUniswapV3Router02(leg.routerOrPool, leg.tokenIn, leg.tokenOut, leg.v3Fee, amountIn);
        } else if (leg.protocol == DexProtocol.SOLIDLY) {
            amountOut = _swapSolidly(leg.routerOrPool, leg.tokenIn, leg.tokenOut, leg.stable, leg.factory, amountIn);
        } else {
            revert UnsupportedDexProtocol(uint8(leg.protocol));
        }
    }

    function _swapUniswapV2(address router, address tokenIn, address tokenOut, uint256 amountIn)
        internal
        returns (uint256)
    {
        _safeApprove(tokenIn, router, amountIn);

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));
        IUniswapV2Router02(router).swapExactTokensForTokens(amountIn, 0, path, address(this), block.timestamp);
        return IERC20(tokenOut).balanceOf(address(this)) - balanceBefore;
    }

    function _swapUniswapV3(address router, address tokenIn, address tokenOut, uint24 fee, uint256 amountIn)
        internal
        returns (uint256)
    {
        _safeApprove(tokenIn, router, amountIn);

        return ISwapRouter(router).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function _swapUniswapV3Router02(address router, address tokenIn, address tokenOut, uint24 fee, uint256 amountIn)
        internal
        returns (uint256)
    {
        _safeApprove(tokenIn, router, amountIn);

        return ISwapRouter02(router).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function _swapSolidly(
        address router,
        address tokenIn,
        address tokenOut,
        bool stable,
        address factory,
        uint256 amountIn
    ) internal returns (uint256) {
        _safeApprove(tokenIn, router, amountIn);

        ISolidlyRouter.Route[] memory routes = new ISolidlyRouter.Route[](1);
        routes[0] = ISolidlyRouter.Route({from: tokenIn, to: tokenOut, stable: stable, factory: factory});

        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));
        ISolidlyRouter(router).swapExactTokensForTokens(amountIn, 0, routes, address(this), block.timestamp);
        return IERC20(tokenOut).balanceOf(address(this)) - balanceBefore;
    }

    function _swapCurve(address pool, address tokenIn, int128 i, int128 j, uint256 dx) internal returns (uint256) {
        _safeApprove(tokenIn, pool, dx);
        return ICurvePool(pool).exchange(i, j, dx, 0);
    }

    // --- Token helpers ---

    function _safeApprove(address token, address spender, uint256 amount) internal {
        // USDT-style tokens require the allowance to be zero before it is changed.
        uint256 currentAllowance = IERC20(token).allowance(address(this), spender);
        if (currentAllowance > 0) {
            (bool success0,) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, 0));
            require(success0, "Approve reset failed");
        }
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeApprove failed");
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeTransfer failed");
    }

    /// @notice Sweeps any token balance (e.g. dust) to the owner. The contract should hold nothing between runs.
    function recoverERC20(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            _safeTransfer(token, owner, balance);
            emit FundsRecovered(token, balance);
        }
    }
}
