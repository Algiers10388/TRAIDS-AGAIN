// ==============================================================================
// Autonomous Crypto Trading Agent: Advanced Risk Management & Sizing Engine
// Enforces: ATR Dynamic Position Sizing, TP/SL Price Targets, Trailing Stops,
//           Risk-Reward Expectancy Ratios, and Daily Loss Circuit Breakers
// ==============================================================================

export interface RiskConfig {
  maxPositionSizeUsd: number;
  maxLeverage: number;
  dailyLossLimitUsd: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopPercent: number;
  trailingStopEnabled: boolean;
  maxOpenPositions: number;
  dynamicPositionSizing: boolean;
  riskPerTradePercent: number;
  atrMultiplier: number;
  takeProfitType: 'FIXED_PERCENT' | 'RISK_REWARD_RATIO';
  riskRewardRatio: number;
}

export interface Position {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  currentPrice: number;
  highestPrice: number;
  marginUsd: number;
  leverage: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPercent: number;
  entryTimestamp: number;
  orderId: string;
  stopLossPrice: number;
  takeProfitPrice: number;
  atrAtEntry?: number;
  isDynamicSized?: boolean;
  riskRewardRatio?: number;
  stopLossDistanceUsd?: number;
  targetProfitUsd?: number;
}

export interface PositionSizingResult {
  margin: number;
  notional: number;
  riskAmountUsd: number;
  stopDistanceUsd: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  effectiveStopPct: number;
  effectiveTpPct: number;
  volatilityRegime: 'LOW' | 'NORMAL' | 'ELEVATED' | 'EXTREME';
}

export class RiskManager {
  private config: RiskConfig;
  private dailyRealizedLossUsd = 0;
  private consecutiveLosses = 0;
  private isCircuitBreakerTripped = false;

  constructor(config?: Partial<RiskConfig>) {
    this.config = {
      maxPositionSizeUsd: 1000,
      maxLeverage: 5,
      dailyLossLimitUsd: 250,
      stopLossPercent: 2.5,
      takeProfitPercent: 6.0,
      trailingStopPercent: 1.8,
      trailingStopEnabled: true,
      maxOpenPositions: 3,
      dynamicPositionSizing: true,
      riskPerTradePercent: 2.0,
      atrMultiplier: 2.0,
      takeProfitType: 'RISK_REWARD_RATIO',
      riskRewardRatio: 2.5,
      ...config,
    };
  }

  public canOpenPosition(currentPositionsCount: number): { allowed: boolean; reason?: string } {
    if (this.isCircuitBreakerTripped) {
      return { allowed: false, reason: 'Circuit Breaker Active (Daily Loss Cap or Failure Limit hit)' };
    }
    if (this.dailyRealizedLossUsd >= this.config.dailyLossLimitUsd) {
      this.isCircuitBreakerTripped = true;
      return { allowed: false, reason: `Daily Loss Limit ($${this.config.dailyLossLimitUsd}) reached` };
    }
    if (currentPositionsCount >= this.config.maxOpenPositions) {
      return { allowed: false, reason: `Max Open Positions limit (${this.config.maxOpenPositions}) reached` };
    }
    return { allowed: true };
  }

  /**
   * Dynamic Position Sizing adjusting trade volume based on ATR volatility:
   * StopLossDistance = ATR * atrMultiplier
   * RiskAmount = PortfolioCash * (RiskPerTradePercent / 100)
   * NotionalVolume = RiskAmount / (StopLossDistance / CurrentPrice)
   * Margin = NotionalVolume / Leverage
   */
  public calculateDynamicPositionSize(
    treasuryBalanceUsd: number,
    currentPrice: number,
    atr: number,
    leverage: number,
    confidenceScore = 70
  ): PositionSizingResult {
    const safePrice = Math.max(0.0001, currentPrice);
    const safeAtr = atr > 0 ? atr : safePrice * 0.02;
    const atrMult = this.config.atrMultiplier || 2.0;
    const stopDistanceUsd = safeAtr * atrMult;

    // Volatility regime
    const atrPct = (safeAtr / safePrice) * 100;
    let volatilityRegime: 'LOW' | 'NORMAL' | 'ELEVATED' | 'EXTREME' = 'NORMAL';
    if (atrPct < 0.9) volatilityRegime = 'LOW';
    else if (atrPct <= 2.2) volatilityRegime = 'NORMAL';
    else if (atrPct <= 4.0) volatilityRegime = 'ELEVATED';
    else volatilityRegime = 'EXTREME';

    // Risk calculation
    const riskPct = this.config.riskPerTradePercent || 2.0;
    // Scale slightly with confidence score (0.7x to 1.25x)
    const confidenceScale = Math.min(1.25, Math.max(0.7, confidenceScore / 70));
    const riskAmountUsd = Math.max(10, treasuryBalanceUsd * (riskPct / 100) * confidenceScale);

    let boundedMargin: number;
    let effectiveStopPct: number;
    let effectiveTpPct: number;
    let stopLossPrice: number;
    let takeProfitPrice: number;

    if (this.config.dynamicPositionSizing) {
      const stopLossFraction = Math.max(0.005, stopDistanceUsd / safePrice);
      const rawNotional = riskAmountUsd / stopLossFraction;
      const rawMargin = rawNotional / Math.max(1, leverage);

      // Boundaries: min $25, max 35% of treasury or configured maxPositionSizeUsd
      const maxAllowedMargin = Math.min(
        this.config.maxPositionSizeUsd,
        Math.max(25, treasuryBalanceUsd * 0.35)
      );
      boundedMargin = Math.max(25, Math.min(maxAllowedMargin, Math.round(rawMargin * 100) / 100));

      effectiveStopPct = (stopDistanceUsd / safePrice) * 100 * leverage;

      if (this.config.takeProfitType === 'RISK_REWARD_RATIO') {
        const rr = this.config.riskRewardRatio || 2.5;
        effectiveTpPct = effectiveStopPct * rr;
        stopLossPrice = safePrice - stopDistanceUsd;
        takeProfitPrice = safePrice + stopDistanceUsd * rr;
      } else {
        effectiveTpPct = this.config.takeProfitPercent;
        stopLossPrice = safePrice - stopDistanceUsd;
        takeProfitPrice = safePrice * (1 + (this.config.takeProfitPercent / (100 * leverage)));
      }
    } else {
      // Static sizing fallback
      const fixedRisk = treasuryBalanceUsd * 0.05;
      boundedMargin = Math.min(this.config.maxPositionSizeUsd, Math.max(25, Math.round(fixedRisk)));
      effectiveStopPct = this.config.stopLossPercent;
      effectiveTpPct = this.config.takeProfitPercent;
      stopLossPrice = safePrice * (1 - effectiveStopPct / (100 * leverage));
      takeProfitPrice = safePrice * (1 + effectiveTpPct / (100 * leverage));
    }

    return {
      margin: boundedMargin,
      notional: boundedMargin * leverage,
      riskAmountUsd,
      stopDistanceUsd,
      stopLossPrice,
      takeProfitPrice,
      effectiveStopPct,
      effectiveTpPct,
      volatilityRegime,
    };
  }

  public calculatePositionSize(treasuryBalanceUsd: number, confidenceScore: number): number {
    const scoreFactor = Math.max(0.5, confidenceScore / 70);
    const targetRisk = treasuryBalanceUsd * 0.03 * scoreFactor;
    return Math.min(this.config.maxPositionSizeUsd, Math.max(25, Math.round(targetRisk)));
  }

  public recordTradeClosed(realizedPnlUsd: number): void {
    if (realizedPnlUsd < 0) {
      this.dailyRealizedLossUsd += Math.abs(realizedPnlUsd);
      this.consecutiveLosses++;
      if (this.consecutiveLosses >= 4 || this.dailyRealizedLossUsd >= this.config.dailyLossLimitUsd) {
        this.isCircuitBreakerTripped = true;
      }
    } else {
      this.consecutiveLosses = 0;
    }
  }

  public resetCircuitBreaker(): void {
    this.isCircuitBreakerTripped = false;
    this.dailyRealizedLossUsd = 0;
    this.consecutiveLosses = 0;
  }

  public checkPositionExit(
    pos: Position,
    currentPrice: number,
    isSellSignal: boolean,
    sellReason: string
  ): { shouldExit: boolean; exitType?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'TECHNICAL_EXIT'; reason?: string } {
    const rawPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    const leveragedPercent = rawPercent * pos.leverage;

    // 1. Precise Target Stop-Loss Execution (Price Level or Percentage Breach)
    const isStopLossPriceBreached = pos.stopLossPrice > 0 && currentPrice <= pos.stopLossPrice;
    const isStopLossPercentBreached = leveragedPercent <= -this.config.stopLossPercent;

    if (isStopLossPriceBreached || isStopLossPercentBreached) {
      const exitReason = isStopLossPriceBreached
        ? `Stop-Loss Price Level ($${pos.stopLossPrice.toFixed(2)}) breached @ $${currentPrice.toFixed(2)} (${leveragedPercent.toFixed(2)}%)`
        : `Stop-Loss Limit (-${this.config.stopLossPercent}%) hit @ $${currentPrice.toFixed(2)}`;
      return {
        shouldExit: true,
        exitType: 'STOP_LOSS',
        reason: exitReason,
      };
    }

    // 2. Precise Target Take-Profit Execution (Price Level or Target Achieved)
    const isTakeProfitPriceReached = pos.takeProfitPrice > 0 && currentPrice >= pos.takeProfitPrice;
    const isTakeProfitPercentReached = leveragedPercent >= this.config.takeProfitPercent;

    if (isTakeProfitPriceReached || isTakeProfitPercentReached) {
      const exitReason = isTakeProfitPriceReached
        ? `Take-Profit Target ($${pos.takeProfitPrice.toFixed(2)}) reached @ $${currentPrice.toFixed(2)} (+${leveragedPercent.toFixed(2)}%)`
        : `Take-Profit Target (+${this.config.takeProfitPercent}%) achieved @ $${currentPrice.toFixed(2)}`;
      return {
        shouldExit: true,
        exitType: 'TAKE_PROFIT',
        reason: exitReason,
      };
    }

    // 3. Peak-Tracking Trailing Stop
    if (this.config.trailingStopEnabled && pos.highestPrice > pos.entryPrice) {
      const dropFromPeak = ((pos.highestPrice - currentPrice) / pos.highestPrice) * 100 * pos.leverage;
      if (dropFromPeak >= this.config.trailingStopPercent && leveragedPercent > 0.5) {
        return {
          shouldExit: true,
          exitType: 'TRAILING_STOP',
          reason: `Trailing Stop triggered (${this.config.trailingStopPercent}% drop from peak $${pos.highestPrice.toFixed(2)})`,
        };
      }
    }

    // 4. Indicator Technical Exit (MACD Bearish Crossover / Severe Divergence)
    if (isSellSignal && leveragedPercent >= 0.6) {
      return {
        shouldExit: true,
        exitType: 'TECHNICAL_EXIT',
        reason: `Technical Trend Exit: ${sellReason}`,
      };
    }

    return { shouldExit: false };
  }

  public getConfig(): RiskConfig {
    return this.config;
  }

  public getStatus() {
    return {
      dailyRealizedLossUsd: this.dailyRealizedLossUsd,
      dailyLossLimitUsd: this.config.dailyLossLimitUsd,
      isCircuitBreakerTripped: this.isCircuitBreakerTripped,
      consecutiveLosses: this.consecutiveLosses,
      config: this.config,
    };
  }
}
