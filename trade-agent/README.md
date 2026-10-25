# Autonomous Crypto Trading Agent

High-frequency, precision quantitative trading agent powered by **MACD (12, 26, 9)**, **Relative Strength Index (RSI 14)**, **Bollinger Bands (20, 2)**, **Regular Divergence Detection**, and **Multi-Factor Confluence Scoring (0–100%)**.

Supports:
- **Paper Trading / Dry-Run Mode**: Full simulation with realistic slippage, fee deductions, and live market prices without risking capital.
- **Live Authenticated Execution**: Real HMAC-SHA256 signed order routing to **Binance**, **OKX**, **Coinbase**, **Bybit**, and **Kraken**.
- **Dynamic Risk Management**: Dynamic fractional Kelly sizing, daily loss circuit breakers, stop-loss, take-profit targets, and peak-tracking trailing stops.

---

## Quick Start

### 1. Termux on Android (`aarch64-linux-android`)
```bash
cd trade-agent
chmod +x run_termux.sh
./run_termux.sh
```

### 2. WSL or Linux
```bash
cd trade-agent
chmod +x run_wsl.sh
./run_wsl.sh
```

### 3. Windows PowerShell
```powershell
Set-Location trade-agent
.\run_powershell.ps1
```

---

## Strategy Options
- `--strategy=TRIPLE_CONFLUENCE_PRO`: Demands multi-indicator confluence score $\ge 68\%$, positive/expanding MACD histogram, and RSI discipline.
- `--strategy=BOLLINGER_MACD_SQUEEZE`: Enters when Bollinger Bandwidth pinches below 3.5% and MACD histogram surges upward.
- `--strategy=MACD_CROSSOVER`: Pure momentum trend following on fast/slow EMA cross above signal.
- `--strategy=RSI_DIVERGENCE`: Mean reversion on confirmed regular bullish divergence (Price Lower Low with RSI Higher Low).

## CLI Arguments
```bash
# Run in Dry-Run paper mode on BTC and ETH
npx tsx src/cli.ts --symbols=BTC/USDT,ETH/USDT,SOL/USDT --strategy=TRIPLE_CONFLUENCE_PRO --leverage=5

# Run in Live mode with Binance API keys (set in .env)
npx tsx src/cli.ts --live --exchange=BINANCE --symbols=BTC/USDT
```
