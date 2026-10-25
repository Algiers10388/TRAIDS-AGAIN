# FlashArb: Production Multi-Chain DeFi Flash Loan Arbitrage Engine

High-performance, zero-capital quantitative arbitrage engine operating across **Arbitrum**, **Base**, and **Optimism**. 

Combines a low-latency **Rust searcher** (running one independent Tokio worker per chain) with an atomic **Solidity FlashArb contract** integrating **Aave V3**, **Uniswap V3**, **Uniswap V2 / Camelot / Aerodrome**, and **Curve**.

---

## Architecture Overview

```text
OFF-CHAIN (Rust searcher, one worker per chain)
│
├─ Config, risk limits, kill switch  (feeds every stage)
│
├─ 1. Price monitor    pool reserves via node WebSocket (V2 & V3 tick math)
│        ↓
├─ 2. Route finder     spreads across DEXes, best loan size
│        ↓
├─ 3. Simulator        revm fork of latest state (pre-execution verification)
│        ↓
├─ 4. Tx builder       size, gas, sequencer priority tip
│        ↓
└─ 5. Private relay    bypasses public mempool (no sandwiching)
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
│   │       ├── IUniswapV3.sol  # Uniswap V3 swap router & pool tick queries
│   │       ├── IUniswapV2.sol  # Uniswap V2 / Camelot router & pair
│   │       └── ICurvePool.sol  # Curve multi-asset exchange interface
│   └── test/
│       └── FlashArb.t.sol      # Fork tests pinned to block + fuzz tests
├── searcher/                   # High-Performance Rust Searcher
│   ├── Cargo.toml              # Dependencies (revm, tokio, ethers, uniswap-v3-math)
│   ├── config/
│   │   ├── arbitrum.toml       # Arbitrum One (Chain 42161) parameters
│   │   ├── base.toml           # Base L2 (Chain 8453) parameters
│   │   └── optimism.toml       # Optimism (Chain 10) parameters
│   └── src/
│       ├── main.rs             # Multi-chain orchestrator (Tokio tasks)
│       ├── config.rs           # TOML configuration loader
│       ├── monitor.rs          # WebSocket pool reserve & tick tracker
│       ├── routes.rs           # Closed-form V2 & ternary V3 loan sizing
│       ├── sim.rs              # Local state revm simulation engine
│       ├── executor.rs         # EIP-1559 builder & sequencer tip bidder
│       └── risk.rs             # Circuit breaker, daily gas cap & token allowlist
└── README.md
```

---

## 1. Smart Contract: `FlashArb.sol`

- **Aave V3 Integration**: Uses `IPool.flashLoanSimple` with a 0.05% protocol premium.
- **Multi-DEX Execution**: Native support for **Uniswap V3** (`exactInputSingle`), **Uniswap V2 / Camelot / Aerodrome** (`swapExactTokensForTokens`), and **Curve** (`exchange`).
- **Minimum Profit Revert Check**: Strict mathematical guarantee:
  ```solidity
  if (finalBalance < amountToRepay) revert InsufficientProfit(0, arb.minProfit);
  uint256 grossProfit = finalBalance - amountToRepay;
  if (grossProfit < arb.minProfit) revert InsufficientProfit(grossProfit, arb.minProfit);
  ```
- **Zero Balance Invariant**: Holds zero funds in storage; all net profit is swept to the owner or designated treasury in the same atomic block.

### Running Foundry Fork Tests

#### Option A: Termux on Android (`aarch64-linux-android`)
> **Why `version not found in artifacts for this platform` occurs on Termux**:
> Ethereum upstream does not distribute pre-compiled `solc` binaries for Android's bionic libc (`aarch64-linux-android`). Foundry's `svm-rs` therefore cannot download remote artifacts for any version.
> **The Fix**: Install Termux's native `solidity` package (which provides the `solc` binary) and tell Foundry to use the local binary via `--use $(which solc)`:

```bash
# 1. Install Termux native compiler (package is named 'solidity')
pkg update && pkg install -y solidity

# 2. Compile and test using the local binary (bypasses svm remote download entirely)
forge test --use $(which solc) --fork-url https://arb1.arbitrum.io/rpc --fork-block-number 225000000 -vvv

# Or run the included automated script:
./run_termux.sh
```

#### Option B: WSL (Windows Subsystem for Linux - Recommended for PC)
WSL runs native Ubuntu/Debian x86_64 where Foundry and Linux artifacts work seamlessly out of the box:
```bash
cd contracts
./run_wsl.sh
# or manually:
forge test --fork-url https://arb1.arbitrum.io/rpc --fork-block-number 225000000 -vvv
```

#### Option C: Windows PowerShell Native
```powershell
Set-Location contracts
.\run_powershell.ps1

# Or if solc is installed via npm (`npm install -g solc`) or winget (`winget install Ethereum.Solidity`):
forge test --use (Get-Command solc).Source --fork-url https://arb1.arbitrum.io/rpc --fork-block-number 225000000 -vvv
```

---

## 2. Rust Searcher Pipeline

1. **Price Monitor (`monitor.rs`)**:
   - Subscribes to low-latency node WebSocket (`newHeads`, `Sync`, `Swap`).
   - Tracks 20–50 high-liquidity pools in memory.
   - Computes tick math via `uniswap-v3-math` (`sqrtPriceX96` to spot price).
2. **Route Finder (`routes.rs`)**:
   - Computes real-time cross-DEX spreads.
   - Calculates optimal loan size in closed form for V2 pairs:
     $$\Delta x^* = \frac{\sqrt{r_1 r_2 (1-f_1)(1-f_2) P_{\text{ratio}}} - r_1}{1 - f_1}$$
   - Calculates numerical optimal depth for V3 tick concentrated liquidity.
   - Checks: $\text{Output} - \text{Loan} - \text{AaveFee} - \text{Gas} \ge \text{MinProfit}$.
3. **Simulator (`sim.rs`)**:
   - Replays candidate transactions on a local fork of the latest state (`revm`) before dispatch.
   - Verifies gas consumption and guarantees non-reverting execution.
4. **Tx Builder & Relay (`executor.rs`)**:
   - Dispatches via **Private Relays** (Flashbots Protect, Builder endpoints, direct sequencer gateways) to avoid the public mempool and prevent frontrunning/sandwich attacks.
   - On L2s, sequencers order by arrival time and priority fee: bids a dynamic percentage (`tip_share_percent`, e.g. 60%) of the expected profit as miner tip.
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
```

### Stage 2: 7-Day Dry-Run Mode
Run the Rust searcher with `--dry-run`. It logs every opportunity (`[DRY-RUN LOG] Would have executed FlashArb...`) with theoretical profit, gas, and spread without sending transactions.
```bash
cd searcher
cargo run --release -- --dry-run --chains arbitrum,base,optimism
```
This logs the true empirical opportunity rate on your specific node latency.

### Stage 3: Live Execution with Small Gas Float
Once dry-run confirms consistent net profitability after gas and sequencer tips:
1. Deploy `FlashArb.sol` on target chains:
   ```bash
   forge create src/FlashArb.sol:FlashArb \
     --rpc-url https://arb1.arbitrum.io/rpc \
     --constructor-args 0xa97684ead0e402dC232d5A977953DF7ECBAB3CDb \
     --private-key $DEPLOYER_KEY
   ```
2. Update `flash_arb_contract` address in `arbitrum.toml`.
3. Fund your deployer with a small gas float ($50–$100 ETH).
4. Run without `--dry-run`:
   ```bash
   cargo run --release -- --chains arbitrum
   ```

---

## 4. Cost & Expectations
- **Node Infrastructure**: Low latency requires a dedicated node or paid RPC (Blast, Alchemy, QuickNode, or local geth/reth node): ~$50–$300/month.
- **Profitability Reality**: L2 arbitrage is highly competitive. Success depends on WebSocket latency to the sequencer and optimal loan sizing. The dry-run phase determines whether your location and latency provide an edge.
