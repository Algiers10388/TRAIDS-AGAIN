// ==============================================================================
// Autonomous Crypto Trading Agent: High-Performance CLI Dashboard & Risk Engine
// ==============================================================================

import { CryptoTradingAgent, AgentConfig, StrategyTrigger } from './agent.js';
import { ExchangeClient, SupportedExchange } from './exchange.js';
import { IndicatorSnapshot } from './indicators.js';

// Parse command line arguments
const args = process.argv.slice(2);
const isLive = args.includes('--live');
const isBacktest = args.includes('--backtest');
const strategyArg = args.find((a: string) => a.startsWith('--strategy='))?.split('=')[1] as StrategyTrigger || 'TRIPLE_CONFLUENCE_PRO';
const exchangeArg = (args.find((a: string) => a.startsWith('--exchange='))?.split('=')[1]?.toUpperCase() || 'PAPER_TRADING') as SupportedExchange;
const symbolsArg = args.find((a: string) => a.startsWith('--symbols='))?.split('=')[1]?.split(',') || ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
const leverageArg = parseInt(args.find((a: string) => a.startsWith('--leverage='))?.split('=')[1] || '5', 10);

console.clear();
console.log('='.repeat(80));
console.log('   QUANTITATIVE CRYPTO TRADING AGENT - ADVANCED RISK & VOLATILITY ENGINE');
console.log('='.repeat(80));
console.log(` Mode:        ${isLive ? '\x1b[31m[LIVE REAL CAPITAL]\x1b[0m' : '\x1b[32m[DRY-RUN PAPER TRADING]\x1b[0m'}`);
console.log(` Exchange:    ${exchangeArg}`);
console.log(` Strategy:    ${strategyArg}`);
console.log(` Pairs:       ${symbolsArg.join(', ')}`);
console.log(` Leverage:    ${leverageArg}x`);
console.log(` Risk Engine: Dynamic ATR Volatility Sizing (2.0x ATR buffer | 2.0% Risk Parity)`);
console.log(` Target R:R:  2.5:1 Risk-Reward Ratio | Trailing Stop: 1.8% Peak Tracking`);
console.log(` Protection:  Daily Max Loss Circuit Breaker ($250 Cap)`);
console.log(` Indicators:  MACD (12,26,9) | RSI (14) | Bollinger Bands (20,2) | ATR (14) | Confluence`);
console.log('='.repeat(80));
console.log(' Press Ctrl+C to safely halt agent and close open positions.\n');

const agentConfig: AgentConfig = {
  symbols: symbolsArg,
  exchange: isLive ? exchangeArg : 'PAPER_TRADING',
  strategy: strategyArg,
  leverage: leverageArg,
  initialTreasuryUsd: 10000,
  pollIntervalMs: 5000, // 5 second tick
  risk: {
    maxPositionSizeUsd: 1200,
    dailyLossLimitUsd: 250,
    stopLossPercent: 2.5,
    takeProfitPercent: 6.25,
    trailingStopPercent: 1.8,
    trailingStopEnabled: true,
    dynamicPositionSizing: true,
    riskPerTradePercent: 2.0,
    atrMultiplier: 2.0,
    takeProfitType: 'RISK_REWARD_RATIO',
    riskRewardRatio: 2.5,
  },
  isDryRun: !isLive,
};

const exchangeClient = new ExchangeClient(agentConfig.exchange, {
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
  passphrase: process.env.API_PASSPHRASE,
});

const agent = new CryptoTradingAgent(agentConfig, exchangeClient);

let tickCount = 0;

agent.start((snapshots: Map<string, IndicatorSnapshot>) => {
  tickCount++;
  const state = agent.getState();
  const timeStr = new Date().toLocaleTimeString();

  const cbStatus = state.riskStatus.isCircuitBreakerTripped
    ? '\x1b[41m\x1b[37m[CIRCUIT BREAKER: TRIPPED]\x1b[0m'
    : '\x1b[32m[CIRCUIT BREAKER: ARMED]\x1b[0m';

  console.log(
    `\n--- [TICK #${tickCount} @ ${timeStr}] ` +
    `Treasury: $${state.treasuryUsd.toFixed(2)} | ` +
    `Positions: ${state.openPositions.length} | ` +
    `Daily Loss: $${state.riskStatus.dailyRealizedLossUsd.toFixed(2)} / $${state.riskStatus.dailyLossLimitUsd} | ` +
    `${cbStatus} ---`
  );

  for (const [symbol, snap] of snapshots.entries()) {
    const { price, rsi, macd, bollinger, confluence, atr, atrPercent } = snap;
    const scoreColor =
      confluence.score >= 70 ? '\x1b[32m' : confluence.score <= 35 ? '\x1b[31m' : '\x1b[33m';

    const atrDisplay = atr ? `ATR: $${atr.toFixed(2)} (${(atrPercent || 0).toFixed(1)}%)` : 'ATR: N/A';

    console.log(
      ` ${symbol.padEnd(9)} | $${price.toFixed(2).padStart(8)} | ` +
      `RSI: ${rsi.toFixed(1).padStart(4)} | ` +
      `MACD Hist: ${(macd.histogram >= 0 ? '+' : '') + macd.histogram.toFixed(2).padStart(6)} | ` +
      `${atrDisplay.padEnd(20)} | ` +
      `Confluence: ${scoreColor}${confluence.score}% [${confluence.verdict}]\x1b[0m`
    );

    if (confluence.factors.length > 0 && (confluence.score >= 65 || confluence.score <= 35)) {
      console.log(`   └─ Drivers: ${confluence.factors.slice(0, 2).join(' | ')}`);
    }
  }

  if (state.openPositions.length > 0) {
    console.log('\n Active Positions & Risk Controls:');
    for (const p of state.openPositions) {
      const pnlColor = p.unrealizedPnlPercent >= 0 ? '\x1b[32m' : '\x1b[31m';
      const pnlStr = `${p.unrealizedPnlPercent >= 0 ? '+' : ''}${p.unrealizedPnlPercent.toFixed(2)}% ($${p.unrealizedPnlUsd.toFixed(2)})`;
      const tpStr = p.takeProfitPrice ? `TP: $${p.takeProfitPrice.toFixed(2)}` : 'TP: N/A';
      const slStr = p.stopLossPrice ? `SL: $${p.stopLossPrice.toFixed(2)}` : 'SL: N/A';
      const dynamicBadge = p.isDynamicSized ? '[ATR Dynamic]' : '[Static]';

      console.log(
        `   • [${p.symbol}] ${dynamicBadge} Entry: $${p.entryPrice.toFixed(2)} | ` +
        `Current: $${p.currentPrice.toFixed(2)} | Peak: $${p.highestPrice.toFixed(2)} | ` +
        `PnL: ${pnlColor}${pnlStr}\x1b[0m | ` +
        `${tpStr} | ${slStr}`
      );
    }
  }
});

process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN] Terminating agent gracefully...');
  agent.stop();
  process.exit(0);
});
