/**
 * Real Live Market Data Service
 * Connects directly to Binance US, Kraken, Coinbase Pro, and NonKYC public endpoints.
 * Provides real-time tickers, live candlestick data, and multi-exchange order book quotes.
 * NO simulated data. Real live exchange prices.
 */

export interface LiveTicker {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  sparkline: number[];
  decimals: number;
  volatility: 'Low' | 'Medium' | 'High' | 'Extreme';
  lastUpdated: number;
  category?: string;
  supportedExchanges?: ('BINANCE' | 'COINBASE' | 'KRAKEN' | 'BYBIT' | 'NONKYC')[];
}

export interface LiveCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ExchangeQuoteResult {
  exchangeId: 'BINANCE' | 'COINBASE' | 'KRAKEN' | 'BYBIT' | 'NONKYC';
  exchangeName: string;
  symbol: string;
  bidPrice: number;
  askPrice: number;
  lastPrice: number;
  volume24h: number;
  spreadUsd: number;
  spreadPercent: number;
  effectiveBuyPrice: number;
  effectiveSellPrice: number;
  depthBidUsd: number;
  depthAskUsd: number;
  latencyMs: number;
  timestamp: number;
  isRealData: boolean;
}

export interface AssetDef {
  symbol: string;
  name: string;
  binanceSymbol: string;
  krakenPair: string;
  krakenKey: string;
  coinbasePair: string;
  nonkycPair: string;
  decimals: number;
  volatility: 'Low' | 'Medium' | 'High' | 'Extreme';
  category: 'Major' | 'DeFi' | 'Meme' | 'Layer 1' | 'Zero-KYC';
  supportedExchanges: ('BINANCE' | 'COINBASE' | 'KRAKEN' | 'BYBIT' | 'NONKYC')[];
}

export const SUPPORTED_ASSETS: AssetDef[] = [
  {
    symbol: 'BTC/USDT',
    name: 'Bitcoin',
    binanceSymbol: 'BTCUSDT',
    krakenPair: 'XBTUSD',
    krakenKey: 'XXBTZUSD',
    coinbasePair: 'BTC-USD',
    nonkycPair: 'BTC_USDT',
    decimals: 2,
    volatility: 'Medium',
    category: 'Major',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'ETH/USDT',
    name: 'Ethereum',
    binanceSymbol: 'ETHUSDT',
    krakenPair: 'ETHUSD',
    krakenKey: 'XETHZUSD',
    coinbasePair: 'ETH-USD',
    nonkycPair: 'ETH_USDT',
    decimals: 2,
    volatility: 'High',
    category: 'Major',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'SOL/USDT',
    name: 'Solana',
    binanceSymbol: 'SOLUSDT',
    krakenPair: 'SOLUSD',
    krakenKey: 'SOLUSD',
    coinbasePair: 'SOL-USD',
    nonkycPair: 'SOL_USDT',
    decimals: 2,
    volatility: 'Extreme',
    category: 'Layer 1',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'XRP/USDT',
    name: 'XRP',
    binanceSymbol: 'XRPUSDT',
    krakenPair: 'XRPUSD',
    krakenKey: 'XXRPZUSD',
    coinbasePair: 'XRP-USD',
    nonkycPair: 'XRP_USDT',
    decimals: 4,
    volatility: 'High',
    category: 'Layer 1',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'BNB/USDT',
    name: 'BNB',
    binanceSymbol: 'BNBUSDT',
    krakenPair: 'BNBUSD',
    krakenKey: 'BNBUSD',
    coinbasePair: 'BNB-USD',
    nonkycPair: 'BNB_USDT',
    decimals: 2,
    volatility: 'Low',
    category: 'Layer 1',
    supportedExchanges: ['BINANCE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'DOGE/USDT',
    name: 'Dogecoin',
    binanceSymbol: 'DOGEUSDT',
    krakenPair: 'DOGEUSD',
    krakenKey: 'XDGUSD',
    coinbasePair: 'DOGE-USD',
    nonkycPair: 'DOGE_USDT',
    decimals: 4,
    volatility: 'Extreme',
    category: 'Meme',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'KAS/USDT',
    name: 'Kaspa',
    binanceSymbol: 'KASUSDT',
    krakenPair: 'KASUSD',
    krakenKey: 'KASUSD',
    coinbasePair: 'KAS-USD',
    nonkycPair: 'KAS_USDT',
    decimals: 4,
    volatility: 'Extreme',
    category: 'Zero-KYC',
    supportedExchanges: ['NONKYC', 'BYBIT'],
  },
  {
    symbol: 'ADA/USDT',
    name: 'Cardano',
    binanceSymbol: 'ADAUSDT',
    krakenPair: 'ADAUSD',
    krakenKey: 'ADAUSD',
    coinbasePair: 'ADA-USD',
    nonkycPair: 'ADA_USDT',
    decimals: 4,
    volatility: 'Medium',
    category: 'Layer 1',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'LINK/USDT',
    name: 'Chainlink',
    binanceSymbol: 'LINKUSDT',
    krakenPair: 'LINKUSD',
    krakenKey: 'LINKUSD',
    coinbasePair: 'LINK-USD',
    nonkycPair: 'LINK_USDT',
    decimals: 2,
    volatility: 'High',
    category: 'DeFi',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'AVAX/USDT',
    name: 'Avalanche',
    binanceSymbol: 'AVAXUSDT',
    krakenPair: 'AVAXUSD',
    krakenKey: 'AVAXUSD',
    coinbasePair: 'AVAX-USD',
    nonkycPair: 'AVAX_USDT',
    decimals: 2,
    volatility: 'High',
    category: 'Layer 1',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'LTC/USDT',
    name: 'Litecoin',
    binanceSymbol: 'LTCUSDT',
    krakenPair: 'LTCUSD',
    krakenKey: 'XLTCZUSD',
    coinbasePair: 'LTC-USD',
    nonkycPair: 'LTC_USDT',
    decimals: 2,
    volatility: 'Medium',
    category: 'Layer 1',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'PEPE/USDT',
    name: 'Pepe',
    binanceSymbol: 'PEPEUSDT',
    krakenPair: 'PEPEUSD',
    krakenKey: 'PEPEUSD',
    coinbasePair: 'PEPE-USD',
    nonkycPair: 'PEPE_USDT',
    decimals: 8,
    volatility: 'Extreme',
    category: 'Meme',
    supportedExchanges: ['BINANCE', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'SHIB/USDT',
    name: 'Shiba Inu',
    binanceSymbol: 'SHIBUSDT',
    krakenPair: 'SHIBUSD',
    krakenKey: 'SHIBUSD',
    coinbasePair: 'SHIB-USD',
    nonkycPair: 'SHIB_USDT',
    decimals: 8,
    volatility: 'High',
    category: 'Meme',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'BCH/USDT',
    name: 'Bitcoin Cash',
    binanceSymbol: 'BCHUSDT',
    krakenPair: 'BCHUSD',
    krakenKey: 'BCHUSD',
    coinbasePair: 'BCH-USD',
    nonkycPair: 'BCH_USDT',
    decimals: 2,
    volatility: 'High',
    category: 'Layer 1',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'UNI/USDT',
    name: 'Uniswap',
    binanceSymbol: 'UNIUSDT',
    krakenPair: 'UNIUSD',
    krakenKey: 'UNIUSD',
    coinbasePair: 'UNI-USD',
    nonkycPair: 'UNI_USDT',
    decimals: 2,
    volatility: 'High',
    category: 'DeFi',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'POL/USDT',
    name: 'Polygon (POL)',
    binanceSymbol: 'POLUSDT',
    krakenPair: 'POLUSD',
    krakenKey: 'POLUSD',
    coinbasePair: 'POL-USD',
    nonkycPair: 'POL_USDT',
    decimals: 4,
    volatility: 'High',
    category: 'Layer 1',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'TRX/USDT',
    name: 'TRON',
    binanceSymbol: 'TRXUSDT',
    krakenPair: 'TRXUSD',
    krakenKey: 'TRXUSD',
    coinbasePair: 'TRX-USD',
    nonkycPair: 'TRX_USDT',
    decimals: 4,
    volatility: 'Low',
    category: 'Layer 1',
    supportedExchanges: ['BINANCE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'NEAR/USDT',
    name: 'NEAR Protocol',
    binanceSymbol: 'NEARUSDT',
    krakenPair: 'NEARUSD',
    krakenKey: 'NEARUSD',
    coinbasePair: 'NEAR-USD',
    nonkycPair: 'NEAR_USDT',
    decimals: 2,
    volatility: 'High',
    category: 'Layer 1',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT'],
  },
  {
    symbol: 'SUI/USDT',
    name: 'Sui',
    binanceSymbol: 'SUIUSDT',
    krakenPair: 'SUIUSD',
    krakenKey: 'SUIUSD',
    coinbasePair: 'SUI-USD',
    nonkycPair: 'SUI_USDT',
    decimals: 2,
    volatility: 'Extreme',
    category: 'Layer 1',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT'],
  },
  {
    symbol: 'IMX/USDT',
    name: 'ImmutableX',
    binanceSymbol: 'IMXUSDT',
    krakenPair: 'IMXUSD',
    krakenKey: 'IMXUSD',
    coinbasePair: 'IMX-USD',
    nonkycPair: 'IMX_USDT',
    decimals: 4,
    volatility: 'High',
    category: 'DeFi',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'ARB/USDT',
    name: 'Arbitrum',
    binanceSymbol: 'ARBUSDT',
    krakenPair: 'ARBUSD',
    krakenKey: 'ARBUSD',
    coinbasePair: 'ARB-USD',
    nonkycPair: 'ARB_USDT',
    decimals: 4,
    volatility: 'High',
    category: 'DeFi',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
  {
    symbol: 'XMR/USDT',
    name: 'Monero',
    binanceSymbol: 'XMRUSDT',
    krakenPair: 'XMRUSD',
    krakenKey: 'XXMRZUSD',
    coinbasePair: 'XMR-USD',
    nonkycPair: 'XMR_USDT',
    decimals: 2,
    volatility: 'High',
    category: 'Zero-KYC',
    supportedExchanges: ['NONKYC', 'KRAKEN', 'BYBIT'],
  },
  {
    symbol: 'DASH/USDT',
    name: 'Dash',
    binanceSymbol: 'DASHUSDT',
    krakenPair: 'DASHUSD',
    krakenKey: 'DASHUSD',
    coinbasePair: 'DASH-USD',
    nonkycPair: 'DASH_USDT',
    decimals: 2,
    volatility: 'High',
    category: 'Zero-KYC',
    supportedExchanges: ['BINANCE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  },
];

/**
 * Dynamically resolves any asset definition for any coin on any market
 * (Binance, Coinbase, Kraken, Bybit, NonKYC).
 */
export function getAssetDefinition(symbol: string): AssetDef {
  const norm = symbol.trim().toUpperCase();
  const found = SUPPORTED_ASSETS.find(
    (a) =>
      a.symbol.toUpperCase() === norm ||
      a.symbol.replace('/', '_').toUpperCase() === norm ||
      a.symbol.replace('/', '').toUpperCase() === norm ||
      a.name.toUpperCase() === norm
  );
  if (found) return found;

  // Dynamically resolve any other coin on any market!
  let base = 'BTC';
  let quote = 'USDT';
  if (norm.includes('/')) {
    const parts = norm.split('/');
    base = parts[0];
    quote = parts[1] || 'USDT';
  } else if (norm.includes('_')) {
    const parts = norm.split('_');
    base = parts[0];
    quote = parts[1] || 'USDT';
  } else if (norm.includes('-')) {
    const parts = norm.split('-');
    base = parts[0];
    quote = parts[1] || 'USDT';
  } else if (norm.endsWith('USDT')) {
    base = norm.slice(0, -4);
    quote = 'USDT';
  } else if (norm.endsWith('USD')) {
    base = norm.slice(0, -3);
    quote = 'USD';
  } else {
    base = norm;
    quote = 'USDT';
  }

  const isMeme = ['PEPE', 'SHIB', 'BONK', 'FLOKI', 'WIF', 'DOGE', 'MOODENG', 'POPCAT'].includes(base);
  const isMicro = ['SHIB', 'PEPE', 'BONK', 'FLOKI'].includes(base);
  const decimals = isMicro ? 8 : ['DOGE', 'XRP', 'ADA', 'TRX', 'POL', 'KAS', 'ARB', 'IMX'].includes(base) ? 4 : 2;

  return {
    symbol: `${base}/${quote}`,
    name: base,
    binanceSymbol: `${base}${quote === 'USD' ? 'USDT' : quote}`,
    krakenPair: `${base}USD`,
    krakenKey: `${base}USD`,
    coinbasePair: `${base}-USD`,
    nonkycPair: `${base}_${quote}`,
    decimals,
    volatility: isMeme ? 'Extreme' : 'High',
    category: isMeme ? 'Meme' : 'Zero-KYC',
    supportedExchanges: ['BINANCE', 'COINBASE', 'KRAKEN', 'BYBIT', 'NONKYC'],
  };
}

// In-memory ticker cache with fast TTL for low latency
let cachedTickers: LiveTicker[] = [];
let lastTickerFetchTime = 0;
const TICKER_CACHE_TTL_MS = 1500; // 1.5 seconds

// In-memory candle cache per symbol
const candleCache = new Map<string, { candles: LiveCandle[]; lastFetched: number }>();
const CANDLE_CACHE_TTL_MS = 5000; // 5 seconds

// Helper to fetch with timeout
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 3500): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

/**
 * 1. Fetch live real tickers directly from Binance US, Kraken, & NonKYC public APIs.
 * NO simulated data. Real live exchange prices across all markets.
 */
export async function fetchLiveTickers(): Promise<{ tickers: LiveTicker[]; source: string; timestamp: number }> {
  const now = Date.now();
  if (cachedTickers.length > 0 && now - lastTickerFetchTime < TICKER_CACHE_TTL_MS) {
    return { tickers: cachedTickers, source: 'live-cache', timestamp: lastTickerFetchTime };
  }

  const newTickers: LiveTicker[] = [];

  // Parallel fetch: Binance US 24hr, Kraken public tickers, and NonKYC 24hr tickers
  let binanceData: any[] | null = null;
  let krakenResult: Record<string, any> = {};
  let nonkycData: any[] | null = null;

  const krakenPairsStr = SUPPORTED_ASSETS.map((a) => a.krakenPair).join(',');

  await Promise.allSettled([
    // Binance US
    fetchWithTimeout('https://api.binance.us/api/v3/ticker/24hr', {}, 3000)
      .then(async (r) => {
        if (r.ok) {
          const d = await r.json();
          if (Array.isArray(d)) binanceData = d;
        }
      })
      .catch(() => {}),

    // Kraken
    fetchWithTimeout(`https://api.kraken.com/0/public/Ticker?pair=${krakenPairsStr}`, {}, 3000)
      .then(async (r) => {
        if (r.ok) {
          const d = await r.json();
          if (d.result) krakenResult = d.result;
        }
      })
      .catch(() => {}),

    // NonKYC 24hr tickers
    fetchWithTimeout('https://api.nonkyc.io/api/v2/tickers', { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3000)
      .then(async (r) => {
        if (r.ok) {
          const d = await r.json();
          if (Array.isArray(d)) nonkycData = d;
        }
      })
      .catch(() => {}),
  ]);

  // Map each supported asset from real live exchange data
  const binanceList: any[] = Array.isArray(binanceData) ? binanceData : [];
  const nonkycList: any[] = Array.isArray(nonkycData) ? nonkycData : [];

  for (const def of SUPPORTED_ASSETS) {
    const bMatch = binanceList.find((t: any) => t.symbol === def.binanceSymbol);
    const kKey = Object.keys(krakenResult).find(
      (k) => k === def.krakenKey || k.includes(def.krakenPair.replace('USD', ''))
    );
    const kMatch = kKey ? krakenResult[kKey] : null;
    const nkMatch = nonkycList.find(
      (t: any) =>
        t.ticker_id === def.nonkycPair ||
        t.base_currency === def.name ||
        t.base_currency === def.symbol.split('/')[0]
    );

    let price = 0;
    let change24h = 0;
    let high24h = 0;
    let low24h = 0;
    let volume24h = 0;

    if (bMatch) {
      price = parseFloat(bMatch.lastPrice);
      change24h = parseFloat(bMatch.priceChangePercent);
      high24h = parseFloat(bMatch.highPrice);
      low24h = parseFloat(bMatch.lowPrice);
      volume24h = parseFloat(bMatch.quoteVolume);
    } else if (kMatch) {
      price = parseFloat(kMatch.c[0]);
      const openPrice = parseFloat(kMatch.o);
      change24h = openPrice > 0 ? ((price - openPrice) / openPrice) * 100 : 0;
      high24h = parseFloat(kMatch.h[1]);
      low24h = parseFloat(kMatch.l[1]);
      volume24h = parseFloat(kMatch.v[1]) * price;
    } else if (nkMatch) {
      price = parseFloat(nkMatch.last_price || nkMatch.bid || nkMatch.ask || '0');
      change24h = parseFloat(nkMatch.change_percent || '0');
      high24h = parseFloat(nkMatch.high || '0');
      low24h = parseFloat(nkMatch.low || '0');
      volume24h = parseFloat(nkMatch.usd_volume_est || '0');
    }

    if (price > 0) {
      // Build sparkline from existing cached sparkline or real high/low/open/close points
      const existing = cachedTickers.find((t) => t.symbol === def.symbol);
      let sparkline: number[] = [];
      if (existing && existing.sparkline && existing.sparkline.length > 0) {
        sparkline = [...existing.sparkline.slice(-14), price];
      } else {
        // Only real observed prices go in the sparkline; it fills as the feed is polled.
        sparkline = [price];
      }

      newTickers.push({
        symbol: def.symbol,
        name: def.name,
        price,
        change24h: Number(change24h.toFixed(2)),
        high24h: Number(high24h.toFixed(def.decimals)),
        low24h: Number(low24h.toFixed(def.decimals)),
        volume24h: Math.round(volume24h),
        sparkline,
        decimals: def.decimals,
        volatility: def.volatility,
        category: def.category,
        supportedExchanges: def.supportedExchanges,
        lastUpdated: now,
      });
    }
  }

  if (newTickers.length > 0) {
    cachedTickers = newTickers;
    lastTickerFetchTime = now;
    return { tickers: cachedTickers, source: 'live-exchange-feed', timestamp: now };
  }

  // Graceful fallback to existing cache or populated baseline
  if (cachedTickers.length > 0 && now - lastTickerFetchTime < 60_000) {
    return { tickers: cachedTickers, source: 'stale-cache', timestamp: lastTickerFetchTime };
  }

  return { tickers: [], source: 'empty', timestamp: now };
}

/**
 * 2. Fetch live real 1m candlestick data for any selected cryptocurrency.
 * Queries Binance US, Kraken, Coinbase, or builds continuous candles from live anchor.
 */
export async function fetchLiveCandles(symbol: string): Promise<LiveCandle[]> {
  const now = Date.now();
  const cached = candleCache.get(symbol);
  if (cached && now - cached.lastFetched < CANDLE_CACHE_TTL_MS) {
    return cached.candles;
  }

  const def = getAssetDefinition(symbol);

  // Primary: Query Binance US 1m klines (high reliability)
  try {
    const binanceUrl = `https://api.binance.us/api/v3/klines?symbol=${def.binanceSymbol}&interval=1m&limit=60`;
    const res = await fetchWithTimeout(binanceUrl, {}, 3000);
    if (res.ok) {
      const rawKlines = await res.json();
      if (Array.isArray(rawKlines) && rawKlines.length > 0) {
        const parsed: LiveCandle[] = rawKlines.map((k: any) => ({
          time: Number(k[0]),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));

        candleCache.set(symbol, { candles: parsed, lastFetched: now });
        return parsed;
      }
    }
  } catch (err: any) {}

  // Secondary: Query Kraken 1m OHLC
  try {
    const krakenUrl = `https://api.kraken.com/0/public/OHLC?pair=${def.krakenPair}&interval=1`;
    const res = await fetchWithTimeout(krakenUrl, {}, 3500);
    if (res.ok) {
      const data = await res.json();
      const resultKey = Object.keys(data.result || {}).find((k) => k !== 'last');
      if (resultKey && Array.isArray(data.result[resultKey])) {
        const slice = data.result[resultKey].slice(-60);
        const parsed: LiveCandle[] = slice.map((c: any) => ({
          time: Number(c[0]) * 1000,
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
          volume: parseFloat(c[6]),
        }));

        candleCache.set(symbol, { candles: parsed, lastFetched: now });
        return parsed;
      }
    }
  } catch (err: any) {}

  // Tertiary: Query Coinbase Exchange Candles
  try {
    const cbUrl = `https://api.exchange.coinbase.com/products/${def.coinbasePair}/candles?granularity=60`;
    const res = await fetchWithTimeout(cbUrl, { headers: { 'User-Agent': 'CryptoAgent/1.0' } }, 3500);
    if (res.ok) {
      const raw = await res.json();
      if (Array.isArray(raw) && raw.length > 0) {
        const slice = raw.slice(0, 60).reverse();
        const parsed: LiveCandle[] = slice.map((c: any) => ({
          time: Number(c[0]) * 1000,
          low: parseFloat(c[1]),
          high: parseFloat(c[2]),
          open: parseFloat(c[3]),
          close: parseFloat(c[4]),
          volume: parseFloat(c[5]),
        }));

        candleCache.set(symbol, { candles: parsed, lastFetched: now });
        return parsed;
      }
    }
  } catch (err: any) {}

  if (cached && cached.candles.length > 0) {
    return cached.candles;
  }

  // No synthetic fallback: if no exchange returned candles, report that honestly.
  throw new Error(`No live candle data available for ${symbol} from any exchange`);
}

/**
 * 3. Fetch real live order book quotes across all 5 connected exchanges
 * (Binance US, Kraken, Coinbase Pro, NonKYC, Bybit) for ANY cryptocurrency on each market.
 */
export async function fetchLiveExchangeQuotes(symbol: string): Promise<ExchangeQuoteResult[]> {
  const def = getAssetDefinition(symbol);
  const now = Date.now();
  const num = (v: any) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  // Published base-tier taker fees, used only for the "effective price" columns.
  const TAKER = { BINANCE: 0.001, COINBASE: 0.006, KRAKEN: 0.004, BYBIT: 0.001, NONKYC: 0.002 } as const;

  const build = (
    exchangeId: ExchangeQuoteResult['exchangeId'],
    exchangeName: string,
    bid: number,
    ask: number,
    last: number,
    volume24hUsd: number,
    bidQty: number,
    askQty: number,
    latencyMs: number
  ): ExchangeQuoteResult | null => {
    if (!(bid > 0) || !(ask > 0) || ask < bid) return null;
    const px = last > 0 ? last : (bid + ask) / 2;
    const fee = TAKER[exchangeId];
    return {
      exchangeId,
      exchangeName,
      symbol,
      bidPrice: bid,
      askPrice: ask,
      lastPrice: px,
      volume24h: Math.round(volume24hUsd),
      spreadUsd: Number((ask - bid).toFixed(def.decimals)),
      spreadPercent: Number((((ask - bid) / px) * 100).toFixed(4)),
      effectiveBuyPrice: ask * (1 + fee),
      effectiveSellPrice: bid * (1 - fee),
      // Top-of-book notional only (what the quote endpoints actually return)
      depthBidUsd: Math.round(bid * bidQty),
      depthAskUsd: Math.round(ask * askQty),
      latencyMs,
      timestamp: now,
      isRealData: true,
    };
  };

  const timed = async <T>(fn: () => Promise<T>): Promise<{ v: T | null; ms: number }> => {
    const t0 = Date.now();
    try {
      return { v: await fn(), ms: Date.now() - t0 };
    } catch {
      return { v: null, ms: Date.now() - t0 };
    }
  };
  const getJson = async (url: string, headers: Record<string, string> = {}) => {
    const r = await fetchWithTimeout(url, { headers }, 3000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };

  const [bin, kra, cb, bb, nk] = await Promise.all([
    timed(async () => {
      const [book, t24] = await Promise.all([
        getJson(`https://api.binance.us/api/v3/ticker/bookTicker?symbol=${def.binanceSymbol}`),
        getJson(`https://api.binance.us/api/v3/ticker/24hr?symbol=${def.binanceSymbol}`).catch(() => null),
      ]);
      return build(
        'BINANCE',
        'Binance.US',
        num(book.bidPrice),
        num(book.askPrice),
        num(t24?.lastPrice),
        num(t24?.quoteVolume),
        num(book.bidQty),
        num(book.askQty),
        0
      );
    }),
    timed(async () => {
      const d = await getJson(`https://api.kraken.com/0/public/Ticker?pair=${def.krakenPair}`);
      const key =
        Object.keys(d.result || {}).find((k) => k === def.krakenKey) || Object.keys(d.result || {})[0];
      const row = key && d.result[key];
      if (!row) return null;
      const last = num(row.c?.[0]);
      return build('KRAKEN', 'Kraken', num(row.b?.[0]), num(row.a?.[0]), last, num(row.v?.[1]) * last, num(row.b?.[2]), num(row.a?.[2]), 0);
    }),
    timed(async () => {
      const d = await getJson(`https://api.exchange.coinbase.com/products/${def.coinbasePair}/ticker`, {
        'User-Agent': 'CryptoAgent/1.0',
      });
      const last = num(d.price);
      return build('COINBASE', 'Coinbase Exchange', num(d.bid), num(d.ask), last, num(d.volume) * last, num(d.size), num(d.size), 0);
    }),
    timed(async () => {
      const d = await getJson(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${def.binanceSymbol}`);
      const row = d?.result?.list?.[0];
      if (!row) return null;
      return build('BYBIT', 'Bybit Spot', num(row.bid1Price), num(row.ask1Price), num(row.lastPrice), num(row.turnover24h), num(row.bid1Size), num(row.ask1Size), 0);
    }),
    timed(async () => {
      const h = { 'User-Agent': 'Mozilla/5.0' };
      const [t, ob] = await Promise.all([
        getJson(`https://api.nonkyc.io/api/v2/ticker/${def.nonkycPair}`, h),
        getJson(`https://api.nonkyc.io/api/v2/orderbook?ticker_id=${def.nonkycPair}&depth=1`, h).catch(() => null),
      ]);
      const bid = num(ob?.bids?.[0]?.[0]) || num(t?.bid);
      const ask = num(ob?.asks?.[0]?.[0]) || num(t?.ask);
      return build('NONKYC', 'NonKYC', bid, ask, num(t?.last_price), num(t?.usd_volume_est), num(ob?.bids?.[0]?.[1]), num(ob?.asks?.[0]?.[1]), 0);
    }),
  ]);

  const out: ExchangeQuoteResult[] = [];
  for (const r of [bin, kra, cb, bb, nk]) {
    if (r.v) out.push({ ...r.v, latencyMs: r.ms });
  }
  return out;
}
