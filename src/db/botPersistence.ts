import { eq, desc } from 'drizzle-orm';
import { db } from './index.ts';
import { portfolios, strategies, tradeExecutions } from './schema.ts';

export async function saveUserPortfolio(
  userId: string,
  portfolio: {
    cash: number;
    startingBalance: number;
    realizedPnl: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalSavingsFromSOR?: number;
  }
) {
  try {
    const cashStr = String(portfolio.cash);
    const startStr = String(portfolio.startingBalance);
    const pnlStr = String(portfolio.realizedPnl);
    const sorStr = String(portfolio.totalSavingsFromSOR || 0);

    const result = await db
      .insert(portfolios)
      .values({
        userId,
        cash: cashStr,
        startingBalance: startStr,
        realizedPnl: pnlStr,
        totalTrades: portfolio.totalTrades,
        winningTrades: portfolio.winningTrades,
        losingTrades: portfolio.losingTrades,
        totalSavingsFromSOR: sorStr,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: portfolios.userId,
        set: {
          cash: cashStr,
          startingBalance: startStr,
          realizedPnl: pnlStr,
          totalTrades: portfolio.totalTrades,
          winningTrades: portfolio.winningTrades,
          losingTrades: portfolio.losingTrades,
          totalSavingsFromSOR: sorStr,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Failed to save portfolio to Cloud SQL:', error);
    throw new Error('Database operation failed.', { cause: error });
  }
}

export async function getUserPortfolio(userId: string) {
  try {
    const rows = await db
      .select()
      .from(portfolios)
      .where(eq(portfolios.userId, userId))
      .limit(1);

    return rows[0] || null;
  } catch (error) {
    console.error('Failed to get portfolio from Cloud SQL:', error);
    throw new Error('Database query failed.', { cause: error });
  }
}

export async function saveUserStrategy(
  userId: string,
  strategy: {
    name: string;
    symbol: string;
    triggerType: string;
    timeframe: string;
    orderSizePercent?: number;
    leverage?: number;
    cooldownSeconds?: number;
    minArbitrageProfitPercent?: number;
    parametersJson?: string;
  }
) {
  try {
    const result = await db
      .insert(strategies)
      .values({
        userId,
        name: strategy.name,
        symbol: strategy.symbol,
        triggerType: strategy.triggerType,
        timeframe: strategy.timeframe,
        orderSizePercent: strategy.orderSizePercent ?? 25,
        leverage: strategy.leverage ?? 1,
        cooldownSeconds: strategy.cooldownSeconds ?? 6,
        minArbitrageProfitPercent: String(strategy.minArbitrageProfitPercent ?? 0.02),
        parametersJson: strategy.parametersJson || JSON.stringify(strategy),
        updatedAt: new Date(),
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Failed to save strategy to Cloud SQL:', error);
    throw new Error('Database operation failed.', { cause: error });
  }
}

export async function getUserStrategies(userId: string) {
  try {
    return await db
      .select()
      .from(strategies)
      .where(eq(strategies.userId, userId))
      .orderBy(desc(strategies.updatedAt));
  } catch (error) {
    console.error('Failed to get strategies from Cloud SQL:', error);
    throw new Error('Database query failed.', { cause: error });
  }
}

export async function recordTradeExecution(trade: {
  userId?: string;
  tradeId: string;
  symbol: string;
  side: string;
  type: string;
  buyExchange?: string;
  sellExchange?: string;
  buyPrice?: number;
  sellPrice?: number;
  grossSpreadPercent?: number;
  netSpreadPercent?: number;
  netProfitUsd?: number;
  notionalUsd?: number;
  route?: string;
  status?: string;
}) {
  try {
    const result = await db
      .insert(tradeExecutions)
      .values({
        userId: trade.userId || null,
        tradeId: trade.tradeId,
        symbol: trade.symbol,
        side: trade.side,
        type: trade.type,
        buyExchange: trade.buyExchange || null,
        sellExchange: trade.sellExchange || null,
        buyPrice: trade.buyPrice ? String(trade.buyPrice) : null,
        sellPrice: trade.sellPrice ? String(trade.sellPrice) : null,
        grossSpreadPercent: trade.grossSpreadPercent ? String(trade.grossSpreadPercent) : null,
        netSpreadPercent: trade.netSpreadPercent ? String(trade.netSpreadPercent) : null,
        netProfitUsd: trade.netProfitUsd !== undefined ? String(trade.netProfitUsd) : null,
        notionalUsd: trade.notionalUsd ? String(trade.notionalUsd) : null,
        route: trade.route || null,
        status: trade.status || 'COMPLETED',
        executedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    return result[0] || null;
  } catch (error) {
    console.error('Failed to record trade execution in Cloud SQL:', error);
    throw new Error('Database operation failed.', { cause: error });
  }
}

export async function getRecentTradeExecutions(userId?: string) {
  try {
    if (userId) {
      return await db
        .select()
        .from(tradeExecutions)
        .where(eq(tradeExecutions.userId, userId))
        .orderBy(desc(tradeExecutions.executedAt))
        .limit(50);
    }
    return await db
      .select()
      .from(tradeExecutions)
      .orderBy(desc(tradeExecutions.executedAt))
      .limit(50);
  } catch (error) {
    console.error('Failed to get trade executions from Cloud SQL:', error);
    throw new Error('Database query failed.', { cause: error });
  }
}
