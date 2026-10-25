// ==============================================================================
// Autonomous Crypto Trading Agent: Core Orchestrator & Signal Evaluator
// ==============================================================================

import { ExchangeClient, SupportedExchange, TradeOrderResult } from './exchange.js';
import { evaluateSnapshot, IndicatorSnapshot } from './indicators.js';
import { Position, RiskConfig, RiskManager } from './risk.js';

export type StrategyTrigger =
  | 'TRIPLE_CONFLUENCE_PRO'
  | 'BOLLINGER_MACD_SQUEEZE'
  | 'MACD_CROSSOVER'
  | 'RSI_DIVERGENCE';

export interface AgentConfig {
  symbols: string[];
  exchange: SupportedExchange;
  strategy: StrategyTrigger;
  leverage: number;
  initialTreasuryUsd: number;
  pollIntervalMs: number;
  risk: Partial<RiskConfig>;
  isDryRun: boolean;
}

export interface TradeLog {
  id: string;
  timestamp: number;
  symbol: string;
  action: 'BUY' | 'SELL';
  price: number;
  amountUsd: number;
  reason: string;
  realizedPnlUsd?: number;
  confluenceScore?: number;
}

export class CryptoTradingAgent {
  private config: AgentConfig;
  private exchange: ExchangeClient;
  private risk: RiskManager;
  private treasuryUsd: number;
  private openPositions: Map<string, Position> = new Map();
  private tradeHistory: TradeLog[] = [];
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(config: AgentConfig, exchangeClient?: ExchangeClient) {
    this.config = config;
    this.treasuryUsd = config.initialTreasuryUsd;
    this.exchange = exchangeClient || new ExchangeClient(config.exchange);
    this.risk = new RiskManager(config.risk);
  }

  public async start(onTick?: (snapshotMap: Map<string, IndicatorSnapshot>) => void): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[AGENT START] Initializing Autonomous Crypto Trading Agent on ${this.config.symbols.join(', ')}...`);
    console.log(`[STRATEGY] Mode: ${this.config.strategy} | Mode: ${this.config.isDryRun ? 'DRY-RUN PAPER TRADING' : 'LIVE CAPITAL'}`);

    const runLoop = async () => {
      if (!this.isRunning) return;
      try {
        const snapshots = new Map<string, IndicatorSnapshot>();
        for (const symbol of this.config.symbols) {
          const snap = await this.evaluateSymbol(symbol);
          if (snap) snapshots.set(symbol, snap);
        }
        if (onTick) onTick(snapshots);
      } catch (err: any) {
        console.error('[AGENT LOOP ERROR]', err.message);
      } finally {
        if (this.isRunning) {
          this.timer = setTimeout(runLoop, this.config.pollIntervalMs);
        }
      }
    };

    await runLoop();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) clearTimeout(this.timer);
    console.log('[AGENT STOPPED]');
  }

  public async evaluateSymbol(symbol: string): Promise<IndicatorSnapshot | null> {
    const candles = await this.exchange.fetchCandles(symbol, '1m', 100);
    if (!candles || candles.length < 26) return null;

    const snap = evaluateSnapshot(candles);
    const currentPrice = snap.price;

    // 1. Manage Active Positions for this symbol
    for (const [id, pos] of this.openPositions.entries()) {
      if (pos.symbol !== symbol) continue;

      pos.currentPrice = currentPrice;
      pos.highestPrice = Math.max(pos.highestPrice, currentPrice);

      const rawPnl = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
      pos.unrealizedPnlPercent = rawPnl * pos.leverage;
      pos.unrealizedPnlUsd = (pos.marginUsd * pos.unrealizedPnlPercent) / 100;

      // Check Sell / Exit conditions
      const isSellSignal = snap.confluence.score <= 35 || snap.macd.isBearishCross;
      const sellReason = snap.macd.isBearishCross
        ? 'MACD Death Cross Bearish Reversal'
        : `Confluence Downside (${snap.confluence.score}%)`;

      const exitCheck = this.risk.checkPositionExit(pos, currentPrice, isSellSignal, sellReason);
      if (exitCheck.shouldExit) {
        await this.closePosition(id, exitCheck.exitType || 'TECHNICAL_EXIT', exitCheck.reason || 'Exit Trigger');
      }
    }

    // 2. Check Buy / Entry conditions
    const canOpen = this.risk.canOpenPosition(this.openPositions.size);
    if (canOpen.allowed && !this.hasPositionForSymbol(symbol)) {
      const entryCheck = this.checkEntrySignal(snap);
      if (entryCheck.shouldEnter) {
        await this.openPosition(symbol, snap, entryCheck.reason);
      }
    }

    return snap;
  }

  private checkEntrySignal(snap: IndicatorSnapshot): { shouldEnter: boolean; reason: string } {
    const { macd, rsi, bollinger, confluence } = snap;

    switch (this.config.strategy) {
      case 'TRIPLE_CONFLUENCE_PRO':
        if (confluence.score >= 68 && macd.histogram > 0 && rsi < 58) {
          return {
            shouldEnter: true,
            reason: `Triple Confluence Bullish (${confluence.score}%): MACD Hist +${macd.histogram.toFixed(2)}, RSI ${rsi.toFixed(1)}, BB %B ${bollinger.percentB.toFixed(2)}`,
          };
        }
        break;

      case 'BOLLINGER_MACD_SQUEEZE':
        if ((bollinger.isSqueeze || bollinger.bandwidth < 0.038) && macd.histogram > 0 && macd.isHistogramExpanding) {
          return {
            shouldEnter: true,
            reason: `Bollinger Squeeze + MACD Expansion: BW ${(bollinger.bandwidth * 100).toFixed(2)}%, MACD Hist +${macd.histogram.toFixed(2)} expanding`,
          };
        }
        break;

      case 'MACD_CROSSOVER':
        if (macd.isBullishCross || (macd.histogram > 0 && macd.isHistogramExpanding && rsi < 62)) {
          return {
            shouldEnter: true,
            reason: `MACD Golden Cross: MACD (${macd.macd.toFixed(2)}) crossed Signal (${macd.signal.toFixed(2)})`,
          };
        }
        break;

      case 'RSI_DIVERGENCE':
        if (rsi <= 32 || confluence.factors.some((f) => f.includes('Bullish Divergence'))) {
          return {
            shouldEnter: true,
            reason: `RSI Mean Reversion: RSI ${rsi.toFixed(1)} oversold + positive MACD curve`,
          };
        }
        break;
    }

    return { shouldEnter: false, reason: '' };
  }

  private async openPosition(symbol: string, snap: IndicatorSnapshot, reason: string): Promise<void> {
    const sizing = this.risk.calculateDynamicPositionSize(
      this.treasuryUsd,
      snap.price,
      snap.atr,
      this.config.leverage,
      snap.confluence.score
    );
    const marginUsd = sizing.margin;
    if (this.treasuryUsd < marginUsd) return;

    const orderRes: TradeOrderResult = await this.exchange.executeOrder({
      symbol,
      side: 'BUY',
      orderType: 'MARKET',
      amountUsd: marginUsd,
      leverage: this.config.leverage,
    });

    if (!orderRes.success) {
      console.warn(`[ORDER FAILED] ${symbol} BUY error: ${orderRes.error}`);
      return;
    }

    const posId = 'POS_' + Date.now().toString(36);
    const newPos: Position = {
      id: posId,
      symbol,
      side: 'LONG',
      entryPrice: orderRes.executedPrice,
      currentPrice: orderRes.executedPrice,
      highestPrice: orderRes.executedPrice,
      marginUsd,
      leverage: this.config.leverage,
      unrealizedPnlUsd: 0,
      unrealizedPnlPercent: 0,
      entryTimestamp: Date.now(),
      orderId: orderRes.orderId,
      stopLossPrice: sizing.stopLossPrice,
      takeProfitPrice: sizing.takeProfitPrice,
      atrAtEntry: snap.atr,
      isDynamicSized: true,
      riskRewardRatio: this.risk.getConfig().riskRewardRatio,
      stopLossDistanceUsd: sizing.stopDistanceUsd,
      targetProfitUsd: (sizing.takeProfitPrice - orderRes.executedPrice) * (sizing.notional / orderRes.executedPrice),
    };

    this.openPositions.set(posId, newPos);
    this.treasuryUsd -= marginUsd;

    const log: TradeLog = {
      id: posId,
      timestamp: Date.now(),
      symbol,
      action: 'BUY',
      price: orderRes.executedPrice,
      amountUsd: marginUsd * this.config.leverage,
      reason: `${reason} [Regime: ${sizing.volatilityRegime} | ATR: $${snap.atr.toFixed(2)} | SL: $${sizing.stopLossPrice.toFixed(2)} | TP: $${sizing.takeProfitPrice.toFixed(2)}]`,
      confluenceScore: snap.confluence.score,
    };
    this.tradeHistory.unshift(log);

    console.log(
      `[ENTRY EXECUTED] ${symbol} LONG @ $${orderRes.executedPrice.toFixed(2)} | ` +
      `Margin: $${marginUsd} (${this.config.leverage}x) | ` +
      `Volatility Regime: ${sizing.volatilityRegime} (ATR $${snap.atr.toFixed(2)}) | ` +
      `Targets: SL $${sizing.stopLossPrice.toFixed(2)} / TP $${sizing.takeProfitPrice.toFixed(2)} | ${reason}`
    );
  }

  private async closePosition(posId: string, exitType: string, reason: string): Promise<void> {
    const pos = this.openPositions.get(posId);
    if (!pos) return;

    const orderRes = await this.exchange.executeOrder({
      symbol: pos.symbol,
      side: 'SELL',
      orderType: 'MARKET',
      amountUsd: pos.marginUsd,
      leverage: pos.leverage,
    });

    const exitPrice = orderRes.executedPrice || pos.currentPrice;
    const rawPercent = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
    const finalPnlPercent = rawPercent * pos.leverage;
    const realizedPnlUsd = (pos.marginUsd * finalPnlPercent) / 100;

    this.treasuryUsd += pos.marginUsd + realizedPnlUsd;
    this.risk.recordTradeClosed(realizedPnlUsd);
    this.openPositions.delete(posId);

    const log: TradeLog = {
      id: 'EXIT_' + Date.now().toString(36),
      timestamp: Date.now(),
      symbol: pos.symbol,
      action: 'SELL',
      price: exitPrice,
      amountUsd: pos.marginUsd * pos.leverage,
      reason: `[${exitType}] ${reason}`,
      realizedPnlUsd,
    };
    this.tradeHistory.unshift(log);

    const pnlPrefix = realizedPnlUsd >= 0 ? '+' : '';
    console.log(`[EXIT EXECUTED] ${pos.symbol} CLOSED @ $${exitPrice.toFixed(2)} | Realized PnL: ${pnlPrefix}$${realizedPnlUsd.toFixed(2)} (${pnlPrefix}${finalPnlPercent.toFixed(2)}%) | ${reason}`);
  }

  private hasPositionForSymbol(symbol: string): boolean {
    for (const pos of this.openPositions.values()) {
      if (pos.symbol === symbol) return true;
    }
    return false;
  }

  public resetCircuitBreaker(): void {
    this.risk.resetCircuitBreaker();
    console.log('[RISK ENGINE] Circuit Breaker has been reset.');
  }

  public getState() {
    return {
      treasuryUsd: this.treasuryUsd,
      openPositions: Array.from(this.openPositions.values()),
      tradeHistory: this.tradeHistory.slice(0, 30),
      riskStatus: this.risk.getStatus(),
    };
  }
}
