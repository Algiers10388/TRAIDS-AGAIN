# FlashArb: Multi-Chain DeFi Flash Loan Arbitrage Engine

High-performance, zero-capital quantitative arbitrage engine operating across **Arbitrum**, **Base**, and **Optimism**. 

Combines a low-latency **Rust searcher** (running one independent Tokio worker per chain) with an atomic **Solidity FlashArb contract** integrating **Aave V3**, **Uniswap V3** (SwapRouter and SwapRouter02), **Uniswap V2 style routers (Camelot, Sushi)**, **Aerodrome / Velodrome (Solidly routers)**, and **Curve**.

---

## Architecture Overview

```text
OFF-CHAIN (Rust searcher, one worker per chain)
│
├─ Config, risk limits, kill switch  (feeds every stage)
│
├─ 1. Venue monitor    discovers pools via DEX factories; ETH/USD from on-chain quotes
│        ↓
├─ 2. Route finder     exact quoter/router eth_call quotes, best loan size
│        ↓
├─ 3. Simulator        eth_call + estimateGas of the exact calldata on live state
│        ↓
├─ 4. Tx builder       EIP-1559 fees, optional priority tip (Base/Optimism)
│        ↓
└─ 5. Broadcast        rpc_http, or relay_endpoint if configured
         ↓
ON-CHAIN (one atomic transaction)
│
└─ FlashArb contract   reverts unless profit ≥ minimum
      │
      ├─ 1. Aave V3 pool   borrow asset (0.05% fee)
      ├─ 2. DEX A          buy token X
      ├─ 3. DEX B          sell token X
      └─ 4. Repay loan     keep profit (zero residual balance invariant)
```

---

## Directory Structure

```text
flash-arb/
├── contracts/                  # Foundry Smart Contracts & Fork Tests
│   ├── foundry.toml            # Optimizer, RPC endpoints & fuzz test profile
│   ├── src/
│   │   ├── FlashArb.sol        # Atomic flash loan executor (Solidity 0.8.20)
│   │   └── interfaces/
│   │       ├── IAaveV3Pool.sol # Aave V3 FlashLoanSimple interface
│   │       ├── IUniswapV3.sol  # Uniswap V3 SwapRouter, SwapRouter02 & pool tick queries
│   │       ├── ISolidlyRouter.sol # Aerodrome / Velodrome router (Route[] swaps)
│   │       ├── IUniswapV2.sol  # Uniswap V2 / Camelot router & pair
│   │       └── ICurvePool.sol  # Curve multi-asset exchange interface
│   └── test/
│       └── FlashArb.t.sol      # Fork tests pinned to block + fuzz tests
├── searcher/                   # High-Performance Rust Searcher
│   ├── Cargo.toml              # Dependencies (tokio, ethers, clap)
│   ├── config/
│   │   ├── arbitrum.toml       # Arbitrum One (Chain 42161) parameters
│   │   ├── base.toml           # Base L2 (Chain 8453) parameters
│   │   └── optimism.toml       # Optimism (Chain 10) parameters
│   └── src/
│       ├── main.rs             # Multi-chain orchestrator (Tokio tasks)
│       ├── config.rs           # TOML configuration loader
│       ├── monitor.rs          # Venue discovery + on-chain ETH/USD oracle
│       ├── routes.rs           # Quoter-based opportunity search & loan sizing
│       ├── sim.rs              # eth_call / estimateGas pre-flight
│       ├── executor.rs         # Startup checks, EIP-1559 signing & broadcast
│       └── risk.rs             # Circuit breaker, daily gas cap & token allowlist
└── README.md
```

---

## 1. Smart Contract: `FlashArb.sol`

- **Aave V3 integration**: `IPool.flashLoanSimple`. The premium is read from what Aave passes to the callback (currently 0.05% on these markets; verify on each chain before relying on it).
- **Two-leg swaps** through any of these venues (the `DexProtocol` enum order is part of the ABI the searcher encodes against):

  | # | `DexProtocol`          | Router / pool                                   | Used on |
  |---|------------------------|--------------------------------------------------|---------|
  | 0 | `UNISWAP_V2`           | Uniswap V2 style router (`address[] path`): Camelot, SushiSwap | Arbitrum |
  | 1 | `UNISWAP_V3`           | Original `SwapRouter` (has `deadline`)           | Arbitrum (`0xE592...1564`) |
  | 2 | `CURVE`                | Curve pool, `exchange(int128,int128,uint256,uint256)` | any |
  | 3 | `UNISWAP_V3_ROUTER02`  | `SwapRouter02` (no `deadline`)                   | Base, Optimism |
  | 4 | `SOLIDLY`              | Aerodrome / Velodrome V2 router (`Route[]`, needs `factory` and `stable`) | Base, Optimism |

  Aerodrome and Velodrome do **not** work through the V2 interface; use `SOLIDLY`.
- **`SwapLeg` fields (in order)**: `protocol, routerOrPool, tokenIn, tokenOut, v3Fee, curveIndexIn, curveIndexOut, factory, stable`.
- **`ArbParams` fields (in order)**: `minProfit, leg1, leg2, profitRecipient`.
- **Leg validation**: before swapping, the contract requires non-zero routers, `leg1.tokenIn == asset`, `leg2.tokenOut == asset` and `leg1.tokenOut == leg2.tokenIn` (`InvalidRouter`, `LegAssetMismatch`, `LegsNotChained`).
- **Profit check**: the transaction reverts with `InsufficientProfit(netProfit, minProfit)` unless the final balance covers principal + premium **and** the surplus is at least `minProfit`. If the loan cannot be repaid at all, `netProfit` is reported as 0.
- **No funds held**: profit is swept to `profitRecipient` (or the owner if it is the zero address) in the same transaction. `recoverERC20` sweeps dust to the owner. The contract has no `receive()`; it cannot accept ETH.
- **Ownership**: `owner` is the deployer and is immutable. **The owner must be the same wallet that the searcher signs with** (`FLASH_ARB_SIGNER_KEY`); otherwise every `executeFlashArb` call reverts with `Unauthorized`. To change owner, deploy a new contract.
- **Slippage**: swaps use `amountOutMinimum = 0` because the whole transaction is atomic and the final `minProfit` check decides success.

### Testing

Dependencies and RPC setup:

```bash
cd contracts
forge install foundry-rs/forge-std      # add --no-git if this is not a git repo
export ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc   # public endpoints are rate limited; use a paid RPC for repeated runs
export BASE_RPC_URL=https://mainnet.base.org
export OPTIMISM_RPC_URL=https://mainnet.optimism.io
```

There are two test contracts in `test/FlashArb.t.sol`:

- `FlashArbUnitTest` runs offline. It uses small test-only mocks of the Aave pool and the routers to check access control, leg validation, exact profit accounting (including a fuzz test) and that every `DexProtocol` dispatches to the right function signature. Mocks cannot prove anything about real markets.
- `FlashArbForkTest` runs against real Arbitrum state pinned at block 225,000,000. It only runs when `FORK_URL` is set; otherwise its tests are reported as **skipped**. It checks the Aave pool wiring and that a spread-less 100k USDC.e round trip Camelot -> Uniswap V3 reverts with `InsufficientProfit`.

```bash
forge test -vvv                                                     # unit tests (fork tests skipped)
FORK_URL=$ARBITRUM_RPC_URL forge test --match-contract FlashArbForkTest -vvv   # fork tests
```

The fork test relies on a Camelot WETH / USDC.e pair and a Uniswap V3 0.05% pool existing at that block; if it fails with a different revert, check those addresses first.

#### Option A: Termux on Android (`aarch64-linux-android`)
Ethereum upstream does not publish `solc` binaries for Android, so Foundry cannot download one. Install Termux's own compiler and point Foundry at it:

```bash
pkg update && pkg install -y solidity
forge test --use $(which solc) -vvv
# or run the included script:
./run_termux.sh
```

#### Option B: WSL / Linux (recommended on PC)
```bash
cd contracts
./run_wsl.sh
```

#### Option C: Windows PowerShell
```powershell
Set-Location contracts
.\run_powershell.ps1
# if solc is installed (npm install -g solc, or winget install Ethereum.Solidity):
forge test --use (Get-Command solc).Source -vvv
```

---

## 2. Rust Searcher Pipeline

1. **Venue Monitor (`monitor.rs`)**:
   - For each `[[pairs]]` entry, discovers pools through the configured DEX factories (V2 `getPair`, V3 `getPool` per fee tier with non-zero liquidity, Solidly `getPool` stable/volatile).
   - Derives ETH/USD from live on-chain WETH→stablecoin quotes (median across venues). Nothing is hardcoded or simulated.
2. **Route Finder (`routes.rs`)**:
   - Quotes through each venue's own quoter/router (`getAmountsOut`, `quoteExactInputSingle`, Solidly `getAmountsOut`), so fees, ticks and curve shape are exact.
   - Screens venue pairs with a small probe, then sizes the loan with a geometric grid plus local refinement, up to `max_loan_usd`.
   - Profit = amount out − loan − Aave premium (rounded up), converted to USD, minus gas and `extra_cost_usd`; must be ≥ `min_net_profit_usd`.
3. **Simulator (`sim.rs`)**:
   - Runs the exact `executeFlashArb` calldata through `eth_call` from the owner address, then `estimateGas`. A revert or gas above `max_gas_per_tx` drops the trade.
4. **Executor (`executor.rs`)**:
   - Only used with `--live` and `risk.dry_run = false`. At startup it verifies chain id, that the key matches `signer.gas_wallet_address`, that the contract `owner()` is that address and that `POOL()` equals `aave_v3_pool`.
   - Signs an EIP-1559 transaction and waits for the receipt. Where `priority_fee_bidding = true` (Base, Optimism) it offers `tip_share_percent` of expected net profit as priority fee. Arbitrum's sequencer is first-come-first-served, so bidding is off there.
   - Curve is executable by the contract but is not scanned by the searcher.
5. **Risk Controls & Circuit Breakers (`risk.rs`)**:
   - `max_gas_per_tx`: Discards transactions requiring excessive gas.
   - `daily_revert_loss_cap_usd`: Automatic kill switch if daily gas lost to reverts exceeds $75.
   - `consecutive_failure_limit`: Halts execution if 3 consecutive transactions revert.
   - `excluded_tokens`: Filters out rebasing tokens and fee-on-transfer tokens.

---

## 3. Rollout Plan & Execution

### Stage 1: Pinned Block Fork Tests
Ensure smart contract tests pass across various market liquidity conditions.
```bash
cd contracts && forge test -vv
FORK_URL=$ARBITRUM_RPC_URL forge test --match-contract FlashArbForkTest -vv
```

### Stage 2: 7-Day Dry-Run Mode
Run the Rust searcher without `--live` (the default). It quotes and simulates every opportunity and logs gross profit, gas and net profit without sending transactions. All configs ship with `dry_run = true`. Set `RPC_HTTP_<CHAIN>` to a dedicated endpoint.
```bash
cd searcher
cargo run --release -- --chains arbitrum,base,optimism
```
This logs the true empirical opportunity rate on your specific node latency.

### Stage 3: Live Execution with Small Gas Float
Once dry-run confirms consistent net profitability after gas and sequencer tips:
1. Deploy `FlashArb.sol` on each target chain **with the same wallet that the searcher will sign with** (it becomes the immutable owner). Pass that chain's Aave `PoolAddressesProvider`:
   ```bash
   forge create src/FlashArb.sol:FlashArb \
     --rpc-url $ARBITRUM_RPC_URL \
     --constructor-args 0xa97684ead0e402dC232d5A977953DF7ECBAB3CDb \
     --private-key $DEPLOYER_KEY \
     --broadcast
   ```
   Provider addresses used in `searcher/config/*.toml`: Arbitrum and Optimism `0xa97684ead0e402dC232d5A977953DF7ECBAB3CDb`, Base `0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D`. Verify them against Aave's address book before deploying. Older Foundry versions do not have `--broadcast` on `forge create`; newer ones need it or the deployment is only simulated.
2. Update `flash_arb_contract` in the chain's toml and set `dry_run = false`. Export the signer key as `FLASH_ARB_SIGNER_KEY`.
3. Fund your deployer with a small gas float ($50–$100 ETH).
4. Run with `--live`:
   ```bash
   cargo run --release -- --live --chains arbitrum
   ```

---

## 4. Cost & Expectations
- **Node Infrastructure**: Low latency requires a dedicated node or paid RPC (Blast, Alchemy, QuickNode, or local geth/reth node): ~$50–$300/month.
- **Profitability Reality**: L2 arbitrage is highly competitive. Success depends on RPC latency to the sequencer and optimal loan sizing. The dry-run phase determines whether your location and latency provide an edge.
