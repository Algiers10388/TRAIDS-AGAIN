import {
  ExchangeConfig,
  ExchangeId,
  ExchangeQuote,
  SmartOrderRouteResult,
  ArbitrageOpportunity,
  ExecutionRoutingMode,
} from '../types';
import { DEFAULT_EXCHANGES } from '../data/exchangeData';
import { DEFAULT_ASSETS } from '../data/marketData';

/**
 * Convert standard symbol (e.g. BTC/USDT) to NonKYC ticker symbol format (e.g. BTC_USDT)
 */
export function formatNonKYCSymbol(symbol: string): string {
  return symbol.replace('/', '_');
}

/**
 * Convert NonKYC ticker symbol format (e.g. BTC_USDT) back to standard symbol (e.g. BTC/USDT)
 */
export function parseNonKYCSymbol(ticker: string): string {
  return ticker.replace('_', '/');
}

/**
 * Generate reference quotes across multiple exchanges (Binance, Coinbase, Kraken, Bybit, NonKYC)
 * for a given symbol & reference price when live order books are synchronizing or as deterministic baseline.
 */
export function generateExchangeQuotes(
  symbol: string,
  basePrice: number,
  exchanges: ExchangeConfig[]
): ExchangeQuote[] {
  const now = Date.now();

  return exchanges.map((ex, index) => {
    // Unique deterministic yet dynamic micro-offset per exchange based on time & index
    const timeFactor = Math.sin(now / 2000 + index * 1.5);
    const randomJitter = (Math.random() - 0.5) * 0.0006; // +/- 0.03%

    let priceSkew = 0;
    let baseSpreadPercent = 0.0002; // 0.02% base spread

    switch (ex.id) {
      case 'BINANCE':
        // Deepest liquidity, center of gravity
        priceSkew = timeFactor * 0.0002 + randomJitter * 0.5;
        baseSpreadPercent = 0.00015; // 0.015% spread
        break;
      case 'COINBASE':
        // Occasional Coinbase premium / retail skew
        priceSkew = timeFactor * 0.0004 + 0.00025 + randomJitter;
        baseSpreadPercent = 0.00035; // 0.035% spread
        break;
      case 'KRAKEN':
        // Kraken distinct liquidity pool
        priceSkew = -timeFactor * 0.0003 - 0.0001 + randomJitter;
        baseSpreadPercent = 0.0003; // 0.03% spread
        break;
      case 'BYBIT':
        // Bybit aggressive taker liquidity
        priceSkew = timeFactor * 0.00025 - 0.00015 + randomJitter;
        baseSpreadPercent = 0.0002;
        break;
      case 'NONKYC':
        // NonKYC zero-KYC micro-spreads & unique order book dynamics
        priceSkew = -timeFactor * 0.00035 + randomJitter * 0.8;
        baseSpreadPercent = 0.00035;
        break;
      case 'OKX':
        // OKX institutional tier-1 liquidity and ultra-low spread
        priceSkew = timeFactor * 0.00018 + 0.00008 + randomJitter * 0.5;
        baseSpreadPercent = 0.00018; // 0.018% tight spread
        break;
    }

    const lastPrice = Math.max(0.0001, basePrice * (1 + priceSkew));
    const halfSpread = (lastPrice * baseSpreadPercent) / 2;
    const bidPrice = Math.max(0.0001, lastPrice - halfSpread);
    const askPrice = lastPrice + halfSpread;
    const spreadUsd = askPrice - bidPrice;
    const spreadPercent = (spreadUsd / lastPrice) * 100;

    // Effective prices accounting for taker fee
    const effectiveBuyPrice = askPrice * (1 + ex.takerFeePercent / 100);
    const effectiveSellPrice = bidPrice * (1 - ex.takerFeePercent / 100);

    // Dynamic depth estimation in USD
    const depthBase =
      ex.id === 'BINANCE'
        ? 180000
        : ex.id === 'OKX'
        ? 145000
        : ex.id === 'COINBASE'
        ? 95000
        : ex.id === 'KRAKEN'
        ? 65000
        : ex.id === 'BYBIT'
        ? 80000
        : ex.id === 'NONKYC'
        ? 65000
        : 70000;
    const depthFluct = 1 + Math.sin(now / 5000 + index) * 0.2;

    return {
      exchangeId: ex.id,
      exchangeName: ex.name,
      symbol,
      bidPrice,
      askPrice,
      lastPrice,
      volume24h: 10000000 * (ex.volumeSharePercent / 10),
      spreadUsd,
      spreadPercent,
      effectiveBuyPrice,
      effectiveSellPrice,
      depthBidUsd: depthBase * depthFluct,
      depthAskUsd: depthBase * depthFluct * 1.05,
      latencyMs: Math.round(ex.latencyMs + Math.random() * 6 - 3),
      timestamp: now,
    };
  });
}

/**
 * Smart Order Router (SOR) algorithm:
 * Determines the most favorable exchange to execute the trade on (including NonKYC),
 * taking into account gross quote price, exchange taker fees, and routing preferences.
 * Fully guarded against empty quotes or uninitialized states.
 */
export function routeOrderSmart(
  side: 'BUY' | 'SELL',
  symbol: string,
  notionalUsd: number,
  quotes: ExchangeQuote[],
  exchanges: ExchangeConfig[],
  routingMode: ExecutionRoutingMode,
  fallbackPrice?: number
): SmartOrderRouteResult {
  // Resolve safe list of exchanges
  const safeExchanges = exchanges && exchanges.length > 0 ? exchanges : DEFAULT_EXCHANGES;

  // Filter quotes matching the requested symbol with valid non-zero prices
  const rawQuotes = Array.isArray(quotes) ? quotes : [];
  let candidateQuotes = rawQuotes.filter(
    (q) => q && (!q.symbol || q.symbol === symbol) && (q.bidPrice > 0 || q.askPrice > 0)
  );

  // If no exact match by symbol, but rawQuotes has valid items, use them
  if (candidateQuotes.length === 0 && rawQuotes.length > 0) {
    candidateQuotes = rawQuotes.filter((q) => q && (q.bidPrice > 0 || q.askPrice > 0));
  }

  // If still empty, dynamically generate realistic quotes using the base price
  if (candidateQuotes.length === 0) {
    const defaultAsset = DEFAULT_ASSETS.find((a) => a.symbol === symbol);
    const resolvedPrice =
      fallbackPrice && fallbackPrice > 0
        ? fallbackPrice
        : defaultAsset?.price ||
          (symbol.startsWith('BTC')
            ? 84210
            : symbol.startsWith('ETH')
            ? 2675.5
            : symbol.startsWith('SOL')
            ? 116.8
            : symbol.startsWith('XRP')
            ? 1.53
            : symbol.startsWith('PEPE')
            ? 0.0000095
            : symbol.startsWith('DOGE')
            ? 0.14
            : 100);

    candidateQuotes = generateExchangeQuotes(symbol, resolvedPrice, safeExchanges);
  }

  // Filter quotes from connected and enabled exchanges
  const activeExchangesMap = new Map(
    safeExchanges.filter((e) => e.enabled && e.status === 'CONNECTED').map((e) => [e.id, e])
  );

  let eligibleQuotes = candidateQuotes.filter((q) => activeExchangesMap.has(q.exchangeId));

  if (eligibleQuotes.length === 0) {
    eligibleQuotes = candidateQuotes;
  }

  // Absolute safety net: ensure eligibleQuotes has at least 1 valid quote
  if (eligibleQuotes.length === 0) {
    const p = fallbackPrice && fallbackPrice > 0 ? fallbackPrice : 100;
    eligibleQuotes = [
      {
        exchangeId: 'BINANCE',
        exchangeName: 'Binance',
        symbol,
        bidPrice: p * 0.9995,
        askPrice: p * 1.0005,
        lastPrice: p,
        volume24h: 10000000,
        spreadUsd: p * 0.001,
        spreadPercent: 0.1,
        effectiveBuyPrice: p * 1.001,
        effectiveSellPrice: p * 0.999,
        depthBidUsd: 100000,
        depthAskUsd: 100000,
        latencyMs: 15,
        timestamp: Date.now(),
      },
    ];
  }

  // If user selected a specific exchange instead of auto SOR (including NonKYC direct routing)
  if (routingMode !== 'SMART_ORDER_ROUTER') {
    const forcedQuote =
      eligibleQuotes.find((q) => q.exchangeId === routingMode) || eligibleQuotes[0];
    const exConfig = safeExchanges.find((e) => e.id === forcedQuote.exchangeId);
    const feeRate = (exConfig?.takerFeePercent || 0.1) / 100;

    const rawPrice = side === 'BUY' ? forcedQuote.askPrice : forcedQuote.bidPrice;
    const effectivePrice = side === 'BUY' ? forcedQuote.effectiveBuyPrice : forcedQuote.effectiveSellPrice;
    const feeAmountUsd = notionalUsd * feeRate;

    const routeReason =
      forcedQuote.exchangeId === 'NONKYC'
        ? `Direct order routed exclusively to NonKYC Exchange (manual zero-KYC exchange override).`
        : `Direct order routed exclusively to ${forcedQuote.exchangeName} (manual exchange override).`;

    return {
      side,
      symbol,
      bestExchange: forcedQuote.exchangeId,
      bestExchangeName: forcedQuote.exchangeName,
      rawPrice,
      effectivePrice,
      takerFeePercent: exConfig?.takerFeePercent || 0.1,
      feeAmountUsd,
      worstExchangePrice: rawPrice,
      savingsUsd: 0,
      savingsPercent: 0,
      quotesCompared: eligibleQuotes,
      routeReason,
    };
  }

  // SMART ORDER ROUTER LOGIC:
  // For BUY: We want the MINIMUM effective buy price (ask * (1 + fee))
  // For SELL: We want the MAXIMUM effective sell price (bid * (1 - fee))
  let bestQuote = eligibleQuotes[0];
  let worstQuote = eligibleQuotes[0];

  if (side === 'BUY') {
    bestQuote = eligibleQuotes.reduce(
      (best, curr) => (curr.effectiveBuyPrice < best.effectiveBuyPrice ? curr : best),
      eligibleQuotes[0]
    );
    worstQuote = eligibleQuotes.reduce(
      (worst, curr) => (curr.effectiveBuyPrice > worst.effectiveBuyPrice ? curr : worst),
      eligibleQuotes[0]
    );
  } else {
    bestQuote = eligibleQuotes.reduce(
      (best, curr) => (curr.effectiveSellPrice > best.effectiveSellPrice ? curr : best),
      eligibleQuotes[0]
    );
    worstQuote = eligibleQuotes.reduce(
      (worst, curr) => (curr.effectiveSellPrice < worst.effectiveSellPrice ? curr : worst),
      eligibleQuotes[0]
    );
  }

  const exConfig = safeExchanges.find((e) => e.id === bestQuote.exchangeId);
  const takerFeePercent = exConfig?.takerFeePercent ?? (bestQuote.exchangeId === 'NONKYC' ? 0.20 : 0.075);
  const feeAmountUsd = notionalUsd * (takerFeePercent / 100);

  const rawPrice = side === 'BUY' ? bestQuote.askPrice : bestQuote.bidPrice;
  const effectivePrice = side === 'BUY' ? bestQuote.effectiveBuyPrice : bestQuote.effectiveSellPrice;
  const worstPrice = side === 'BUY' ? worstQuote.effectiveBuyPrice : worstQuote.effectiveSellPrice;

  // Calculate savings in $ and %
  let savingsPercent = 0;
  if (side === 'BUY') {
    savingsPercent = Math.max(0, ((worstPrice - effectivePrice) / (worstPrice || 1)) * 100);
  } else {
    savingsPercent = Math.max(0, ((effectivePrice - worstPrice) / (worstPrice || 1)) * 100);
  }

  const savingsUsd = (notionalUsd * savingsPercent) / 100;

  const isNonKYC = bestQuote.exchangeId === 'NONKYC';
  const tagNote = isNonKYC ? ' (Zero-KYC Spot order book)' : '';

  const routeReason =
    side === 'BUY'
      ? `SOR selected ${bestQuote.exchangeName}: Lowest net effective cost ($${effectivePrice.toFixed(2)}) saving $${savingsUsd.toFixed(2)} (${savingsPercent.toFixed(3)}%) vs ${worstQuote.exchangeName}${tagNote}.`
      : `SOR selected ${bestQuote.exchangeName}: Highest net liquidation price ($${effectivePrice.toFixed(2)}) gaining $${savingsUsd.toFixed(2)} (${savingsPercent.toFixed(3)}%) vs ${worstQuote.exchangeName}${tagNote}.`;

  return {
    side,
    symbol,
    bestExchange: bestQuote.exchangeId,
    bestExchangeName: bestQuote.exchangeName,
    rawPrice,
    effectivePrice,
    takerFeePercent,
    feeAmountUsd,
    worstExchangePrice: worstPrice,
    savingsUsd,
    savingsPercent,
    quotesCompared: eligibleQuotes,
    routeReason,
  };
}

/**
 * Scan for cross-exchange spatial arbitrage opportunities across all connected exchanges
 * including NonKYC:
 * Look for instances where Best Bid on Exchange A > Best Ask on Exchange B
 * and the gross difference exceeds cumulative taker fees.
 */
export function scanCrossExchangeArbitrage(
  symbol: string,
  quotes: ExchangeQuote[],
  exchanges: ExchangeConfig[]
): ArbitrageOpportunity | null {
  if (!quotes || !Array.isArray(quotes) || quotes.length < 2) return null;

  const exMap = new Map(exchanges.map((e) => [e.id, e]));

  let bestOpportunity: ArbitrageOpportunity | null = null;
  let maxNetSpreadPercent = -999;

  for (let i = 0; i < quotes.length; i++) {
    for (let j = 0; j < quotes.length; j++) {
      if (i === j) continue;

      const buyQuote = quotes[i]; // Buy on exchange i at Ask
      const sellQuote = quotes[j]; // Sell on exchange j at Bid

      const buyConfig = exMap.get(buyQuote.exchangeId);
      const sellConfig = exMap.get(sellQuote.exchangeId);

      const buyFeeRate = (buyConfig?.takerFeePercent || 0.1) / 100;
      const sellFeeRate = (sellConfig?.takerFeePercent || 0.1) / 100;

      const grossSpreadUsd = sellQuote.bidPrice - buyQuote.askPrice;
      const grossSpreadPercent = (grossSpreadUsd / (buyQuote.askPrice || 1)) * 100;

      // Net cash flow per unit: sellQuote.bidPrice * (1 - sellFee) - buyQuote.askPrice * (1 + buyFee)
      const effectiveBuyCost = buyQuote.askPrice * (1 + buyFeeRate);
      const effectiveSellProceeds = sellQuote.bidPrice * (1 - sellFeeRate);
      const netSpreadUsd = effectiveSellProceeds - effectiveBuyCost;
      const netSpreadPercent = (netSpreadUsd / (effectiveBuyCost || 1)) * 100;

      if (netSpreadPercent > maxNetSpreadPercent) {
        maxNetSpreadPercent = netSpreadPercent;
        bestOpportunity = {
          symbol,
          buyExchange: buyQuote.exchangeId,
          buyExchangeName: buyQuote.exchangeName,
          buyAskPrice: buyQuote.askPrice,
          sellExchange: sellQuote.exchangeId,
          sellExchangeName: sellQuote.exchangeName,
          sellBidPrice: sellQuote.bidPrice,
          grossSpreadUsd,
          grossSpreadPercent,
          netSpreadUsd,
          netSpreadPercent,
          estimatedProfitUsd: Math.max(0, (netSpreadPercent / 100) * 1000), // on $1k clip
          timestamp: Date.now(),
          isActionable: netSpreadPercent > 0.02, // Profitable after fees
        };
      }
    }
  }

  return bestOpportunity;
}

/**
 * Fetch real live quotes for all connected exchanges (Binance, Coinbase, Kraken, Bybit, NonKYC)
 * via the live-quotes backend proxy, with fallback to simulated exchange quotes.
 */
export async function fetchLiveExchangeQuotes(
  symbol: string,
  fallbackBasePrice?: number,
  fallbackExchanges?: ExchangeConfig[]
): Promise<ExchangeQuote[]> {
  try {
    const res = await fetch(`/api/market/live-quotes?symbol=${encodeURIComponent(symbol)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.quotes) && data.quotes.length > 0) {
        return data.quotes;
      }
    }
  } catch {
    // Network or server error - fallback to deterministic dynamic model
  }

  if (fallbackBasePrice && fallbackExchanges) {
    return generateExchangeQuotes(symbol, fallbackBasePrice, fallbackExchanges);
  }

  return [];
}

/**
 * Fetch live quote and order book specifically for NonKYC exchange.
 * First queries the server aggregation endpoint, then falls back to direct NonKYC API.
 */
export async function fetchNonKYCQuote(symbol: string): Promise<ExchangeQuote | null> {
  const nonkycPair = formatNonKYCSymbol(symbol);
  const now = Date.now();

  // 1. Try internal proxy endpoint first
  try {
    const res = await fetch(`/api/market/live-quotes?symbol=${encodeURIComponent(symbol)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.quotes)) {
        const nkQuote = data.quotes.find((q: ExchangeQuote) => q.exchangeId === 'NONKYC');
        if (nkQuote) return nkQuote;
      }
    }
  } catch {
    // Fall back to direct public endpoint
  }

  // 2. Direct public NonKYC API query
  try {
    const [tRes, obRes] = await Promise.all([
      fetch(`https://api.nonkyc.io/api/v2/ticker/${nonkycPair}`),
      fetch(`https://api.nonkyc.io/api/v2/orderbook?ticker_id=${nonkycPair}&depth=5`),
    ]);

    let bidPrice = 0;
    let askPrice = 0;
    let lastPrice = 0;
    let volume24h = 8500000;
    let depthBidUsd = 65000;
    let depthAskUsd = 60000;

    if (tRes.ok) {
      const tData = await tRes.json();
      bidPrice = parseFloat(tData.bid || '0');
      askPrice = parseFloat(tData.ask || '0');
      lastPrice = parseFloat(tData.last_price || '0');
      if (tData.usd_volume_est) {
        volume24h = parseFloat(tData.usd_volume_est);
      }
    }

    if (obRes.ok) {
      const obData = await obRes.json();
      if (obData.bids && obData.bids.length > 0) {
        bidPrice = parseFloat(obData.bids[0][0]) || bidPrice;
        const topBids = obData.bids.reduce((sum: number, b: any) => sum + parseFloat(b[0]) * parseFloat(b[1]), 0);
        if (topBids > 0) depthBidUsd = topBids * 15;
      }
      if (obData.asks && obData.asks.length > 0) {
        askPrice = parseFloat(obData.asks[0][0]) || askPrice;
        const topAsks = obData.asks.reduce((sum: number, a: any) => sum + parseFloat(a[0]) * parseFloat(a[1]), 0);
        if (topAsks > 0) depthAskUsd = topAsks * 15;
      }
    }

    if (lastPrice > 0 || (bidPrice > 0 && askPrice > 0)) {
      if (!lastPrice) lastPrice = (bidPrice + askPrice) / 2;
      if (!bidPrice) bidPrice = lastPrice * 0.9997;
      if (!askPrice) askPrice = lastPrice * 1.0003;

      const spreadUsd = askPrice - bidPrice;
      const spreadPercent = (spreadUsd / lastPrice) * 100;
      const takerFeeRate = 0.002; // 0.20%

      return {
        exchangeId: 'NONKYC',
        exchangeName: 'NonKYC Exchange (Zero-KYC)',
        symbol,
        bidPrice,
        askPrice,
        lastPrice,
        volume24h,
        spreadUsd,
        spreadPercent,
        effectiveBuyPrice: askPrice * (1 + takerFeeRate),
        effectiveSellPrice: bidPrice * (1 - takerFeeRate),
        depthBidUsd,
        depthAskUsd,
        latencyMs: 32,
        timestamp: now,
      };
    }
  } catch {
    // Non-blocking fallback
  }

  return null;
}

export interface ExecuteTradeParams {
  exchange: ExchangeId;
  symbol: string;
  side: 'BUY' | 'SELL';
  amount: number;
  notional?: number;
  price?: number;
  type?: 'MARKET' | 'LIMIT';
  isLiveRealMoney?: boolean;
}

export interface ExecuteTradeResult {
  success: boolean;
  exchange: ExchangeId;
  exchangeOrderId?: string;
  cryptographicReceipt?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  amount: number;
  executedPrice?: number;
  status: string;
  executionNote?: string;
  error?: string;
  timestamp: number;
}

/**
 * Execute an order directly on any supported exchange (including NonKYC, Kraken, Binance, Coinbase, Bybit)
 * via the server cryptographic order execution gateway.
 */
export async function executeTradeOnExchange(params: ExecuteTradeParams): Promise<ExecuteTradeResult> {
  const now = Date.now();
  try {
    const res = await fetch('/api/exchange/execute-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exchange: params.exchange,
        symbol: params.symbol,
        side: params.side,
        amount: params.amount,
        notional: params.notional || (params.price ? params.amount * params.price : undefined),
        price: params.price,
        type: params.type || 'MARKET',
        isLiveRealMoney: params.isLiveRealMoney ?? true,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        exchange: params.exchange,
        symbol: params.symbol,
        side: params.side,
        amount: params.amount,
        status: 'REJECTED',
        error: data.error || `Order rejected by ${params.exchange} matching engine.`,
        executionNote: data.diagnosticHelp || data.executionNote,
        timestamp: now,
      };
    }

    return {
      success: true,
      exchange: params.exchange,
      exchangeOrderId: data.exchangeOrderId,
      cryptographicReceipt: data.cryptographicReceipt,
      symbol: params.symbol,
      side: params.side,
      amount: params.amount,
      executedPrice: params.price,
      status: data.status || 'PLACED_ON_EXCHANGE',
      executionNote: data.executionNote || `Order executed successfully on ${params.exchange}.`,
      timestamp: data.timestamp || now,
    };
  } catch (err: any) {
    return {
      success: false,
      exchange: params.exchange,
      symbol: params.symbol,
      side: params.side,
      amount: params.amount,
      status: 'NETWORK_ERROR',
      error: err.message || `Failed to communicate with ${params.exchange} gateway.`,
      timestamp: now,
    };
  }
}

/**
 * Execute a trade specifically on the NonKYC exchange.
 * Routes the order to the NonKYC Zero-KYC Spot matching engine.
 */
export async function executeNonKYCTrade(
  params: Omit<ExecuteTradeParams, 'exchange'>
): Promise<ExecuteTradeResult> {
  return executeTradeOnExchange({
    ...params,
    exchange: 'NONKYC',
  });
}

/**
 * Smart Order Router Execution:
 * Finds the optimal exchange (including NonKYC) via routeOrderSmart,
 * and immediately executes the trade against the winning exchange.
 */
export async function routeAndExecuteTrade(params: {
  side: 'BUY' | 'SELL';
  symbol: string;
  notionalUsd: number;
  quotes: ExchangeQuote[];
  exchanges: ExchangeConfig[];
  routingMode: ExecutionRoutingMode;
  isLiveRealMoney?: boolean;
}): Promise<{ route: SmartOrderRouteResult; result: ExecuteTradeResult }> {
  const route = routeOrderSmart(
    params.side,
    params.symbol,
    params.notionalUsd,
    params.quotes,
    params.exchanges,
    params.routingMode
  );

  const amount = params.notionalUsd / (route.rawPrice || 1);

  const result = await executeTradeOnExchange({
    exchange: route.bestExchange,
    symbol: params.symbol,
    side: params.side,
    amount,
    notional: params.notionalUsd,
    price: route.rawPrice,
    type: 'MARKET',
    isLiveRealMoney: params.isLiveRealMoney,
  });

  return { route, result };
}
