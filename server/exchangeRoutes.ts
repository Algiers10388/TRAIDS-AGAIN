import express, { Request, Response } from 'express';
import crypto from 'crypto';
import {
  fetchLiveTickers,
  fetchLiveCandles,
  fetchLiveExchangeQuotes,
  getAssetDefinition,
  SUPPORTED_ASSETS,
} from './liveMarketData';
import { etherscanService } from './etherscanService';
import {
  EXCHANGE_IDS,
  ExchangeError,
  ExchangeId,
  clearRuntimeCreds,
  fetchBalances,
  getCreds,
  maskKey,
  placeOrder,
  setRuntimeCreds,
} from './exchangeClients';
import { checkOrderAllowed, recordOrderNotional } from './fiatRoutes';

/** Orders actually accepted by an exchange during this process lifetime (newest first). */
interface PlacedOrder {
  id: string;
  timestamp: number;
  exchange: ExchangeId;
  type: 'BUY_ORDER' | 'SELL_ORDER';
  symbolOrAsset: string;
  amount: number;
  price?: number;
  totalUsd?: number;
  status: 'TRANSMITTED';
  txHash: string;
  executionNote?: string;
}
let placedOrders: PlacedOrder[] = [];

const WALLET_META: Record<ExchangeId, { name: string; capabilities: string[] }> = {
  KRAKEN: { name: 'Kraken', capabilities: ['Spot orders (REST)', 'Account balances'] },
  BINANCE: { name: 'Binance', capabilities: ['Spot orders (REST v3)', 'Account balances'] },
  COINBASE: { name: 'Coinbase Advanced Trade', capabilities: ['Spot orders (CDP key)', 'Account balances'] },
  BYBIT: { name: 'Bybit', capabilities: ['Spot orders (V5)', 'Unified account balances'] },
  NONKYC: { name: 'NonKYC', capabilities: ['Spot orders', 'Account balances'] },
};

function isExchangeId(v: unknown): v is ExchangeId {
  return typeof v === 'string' && (EXCHANGE_IDS as string[]).includes(v);
}

function sendErr(res: Response, err: unknown) {
  if (err instanceof ExchangeError) {
    return res.status(err.status).json({ success: false, error: err.message });
  }
  return res.status((err as any)?.status || 500).json({ success: false, error: (err as Error)?.message || 'Unexpected error' });
}

export function setupExchangeRoutes(app: express.Application) {
  // 1. Live Real Market Tickers Endpoint
  app.get('/api/market/live-tickers', async (_req: Request, res: Response) => {
    try {
      const data = await fetchLiveTickers();
      res.json({
        success: true,
        ...data,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Live OHLC Candlestick History Endpoint
  app.get('/api/market/live-candles', async (req: Request, res: Response) => {
    try {
      const symbol = String(req.query.symbol || 'BTC/USDT');
      const candles = await fetchLiveCandles(symbol);
      res.json({
        success: true,
        symbol,
        candles,
        count: candles.length,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. Live Multi-Exchange Quotes & Real Spreads Endpoint
  app.get('/api/market/live-quotes', async (req: Request, res: Response) => {
    try {
      const symbol = String(req.query.symbol || 'BTC/USDT');
      const quotes = await fetchLiveExchangeQuotes(symbol);
      res.json({
        success: true,
        symbol,
        quotes,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3.5. Supported Coins & Cross-Market Assets Catalog
  app.get('/api/market/supported-assets', async (_req: Request, res: Response) => {
    try {
      res.json({
        success: true,
        assets: SUPPORTED_ASSETS,
        total: SUPPORTED_ASSETS.length,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3.6. Etherscan & On-Chain Intelligence Swarm Endpoints
  // Live Feed: Block number, gas metrics, recent whale/DEX txs, and active trade patterns
  app.get('/api/etherscan/live-feed', (_req: Request, res: Response) => {
    try {
      const state = etherscanService.getState();
      res.json({
        success: true,
        ...state,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Force immediate on-chain sync
  app.post('/api/etherscan/sync-now', async (_req: Request, res: Response) => {
    try {
      await etherscanService.syncLiveBlockAndTxs();
      const state = etherscanService.getState();
      res.json({
        success: true,
        message: 'Ethereum Mainnet sync complete',
        ...state,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Toggle automated execution of on-chain trade patterns
  app.post('/api/etherscan/toggle-auto-execution', (req: Request, res: Response) => {
    try {
      const { enabled, minProfitThresholdPercent } = req.body;
      const updated = etherscanService.setAutoExecution(Boolean(enabled), Number(minProfitThresholdPercent) || 0.20);
      res.json({
        success: true,
        message: 'Automated on-chain execution is disabled on this server (no verified signal engine exists).',
        ...updated,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Execute a specific detected on-chain pattern trade
  app.post('/api/etherscan/execute-pattern-trade', async (req: Request, res: Response) => {
    try {
      const { signalId } = req.body;
      if (!signalId) {
        return res.status(400).json({ success: false, error: 'Missing signalId' });
      }
      const result = await etherscanService.executePatternTrade(signalId);
      res.status(501).json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Deep AI Multi-Agent analysis powered by Gemini 3.8 Flash
  app.post('/api/etherscan/run-agent-analysis', async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;
      const analysis = await etherscanService.runDeepGeminiAnalysis(prompt);
      res.json({
        success: true,
        analysis,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Deep search across Etherscan transactions and contract logs
  app.post('/api/etherscan/deep-search', async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      const analysis = await etherscanService.runDeepGeminiAnalysis(`User Query: ${query || 'Analyze latest whale accumulation and MEV opportunities.'}`);
      const state = etherscanService.getState();
      
      // Filter matching transactions if a symbol/token is mentioned
      let matchingTxs = state.liveTransactions;
      if (query) {
        const qUpper = query.toUpperCase();
        matchingTxs = state.liveTransactions.filter(
          (t) =>
            t.hash.includes(query) ||
            t.from.includes(query) ||
            t.to.includes(query) ||
            (t.fromLabel && t.fromLabel.toUpperCase().includes(qUpper)) ||
            (t.toLabel && t.toLabel.toUpperCase().includes(qUpper)) ||
            (t.tokenSymbol && t.tokenSymbol.includes(qUpper)) ||
            t.description.toUpperCase().includes(qUpper)
        );
        if (matchingTxs.length === 0) matchingTxs = state.liveTransactions.slice(0, 10);
      }

      res.json({
        success: true,
        query,
        analysis,
        matchingTransactions: matchingTxs,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. Credential status (safe: never returns secrets)
  app.get('/api/exchange/credentials-status', (_req: Request, res: Response) => {
    const credentials: Record<string, any> = {};
    for (const ex of EXCHANGE_IDS) {
      const c = getCreds(ex);
      credentials[ex] = {
        configured: Boolean(c),
        keyMasked: maskKey(c?.apiKey),
        hasSecret: Boolean(c?.apiSecret),
        status: c ? 'READY_FOR_LIVE_TRADING' : 'NOT_CONFIGURED',
        supportedTrading: WALLET_META[ex].capabilities.join(' / '),
      };
    }
    credentials.OKX = { configured: false, keyMasked: null, hasSecret: false, status: 'NOT_CONFIGURED', supportedTrading: 'Not supported by this server' };
    credentials.PLAID = { configured: false, clientIdMasked: null, status: 'NOT_CONFIGURED', supportedServices: 'Not implemented' };
    res.json({ success: true, timestamp: Date.now(), credentials });
  });

  // 5. Linked exchange accounts with REAL balances queried from each exchange
  app.get('/api/exchange/wallets', async (_req: Request, res: Response) => {
    const entries = await Promise.all(
      EXCHANGE_IDS.map(async (ex) => {
        const c = getCreds(ex);
        const base = {
          exchange: ex,
          exchangeName: WALLET_META[ex].name,
          apiKeyMasked: maskKey(c?.apiKey),
          hasSecret: Boolean(c?.apiSecret),
          capabilities: WALLET_META[ex].capabilities,
          lastSynced: Date.now(),
        };
        if (!c) {
          return [ex, { ...base, isLinked: false, status: 'AWAITING_KEYS', balances: {}, isVaultVerified: false, verificationSource: 'UNLINKED' }] as const;
        }
        try {
          const balances = await fetchBalances(ex);
          return [ex, { ...base, isLinked: true, status: 'CONNECTED', balances, isVaultVerified: true, verificationSource: 'EXCHANGE_API', verifiedAt: Date.now() }] as const;
        } catch (e: any) {
          return [ex, { ...base, isLinked: false, status: 'INVALID_CREDENTIALS', balances: {}, isVaultVerified: false, verificationSource: 'AUTH_ERROR', authError: e.message }] as const;
        }
      })
    );
    res.json({ success: true, wallets: Object.fromEntries(entries), timestamp: Date.now() });
  });

  // 6. Link exchange API credentials (held in server memory only) after verifying them against the exchange
  app.post('/api/exchange/link-wallet', async (req: Request, res: Response) => {
    try {
      const { exchange, apiKey, apiSecret } = req.body || {};
      if (!isExchangeId(exchange)) {
        return res.status(400).json({ success: false, error: `exchange must be one of ${EXCHANGE_IDS.join(', ')}` });
      }
      if (typeof apiKey !== 'string' || typeof apiSecret !== 'string' || !apiKey.trim() || !apiSecret.trim()) {
        return res.status(400).json({ success: false, error: 'apiKey and apiSecret are required' });
      }
      const previous = getCreds(exchange);
      setRuntimeCreds(exchange, { apiKey: apiKey.trim(), apiSecret: apiSecret.trim() });
      try {
        await fetchBalances(exchange);
      } catch (e: any) {
        // Roll back so a bad key never stays active
        if (previous) setRuntimeCreds(exchange, previous);
        else clearRuntimeCreds(exchange);
        return res.status(e instanceof ExchangeError ? e.status : 400).json({
          success: false,
          exchange,
          isLinked: false,
          connectionVerified: false,
          error: `Credentials were rejected by ${exchange}: ${e.message}`,
        });
      }
      return res.json({
        success: true,
        exchange,
        isLinked: true,
        status: 'CONNECTED',
        connectionVerified: true,
        verificationMessage: `${exchange} credentials verified against the live exchange API. Held in server memory only; set them as environment variables to persist across restarts.`,
        apiKeyMasked: maskKey(apiKey.trim()),
        timestamp: Date.now(),
      });
    } catch (err) {
      return sendErr(res, err);
    }
  });

  // 7. Unlink runtime credentials (environment-provided credentials cannot be removed from here)
  app.post('/api/exchange/unlink-wallet', (req: Request, res: Response) => {
    const { exchange } = req.body || {};
    if (!isExchangeId(exchange)) return res.status(400).json({ success: false, error: 'Invalid exchange' });
    clearRuntimeCreds(exchange);
    const stillConfigured = Boolean(getCreds(exchange));
    return res.json({
      success: true,
      exchange,
      isLinked: stillConfigured,
      status: stillConfigured ? 'CONNECTED' : 'AWAITING_KEYS',
      note: stillConfigured ? 'Credentials from the server environment remain active.' : undefined,
    });
  });

  // 8. Legacy wallet-transaction endpoint. Buys/sells are routed to the real order path; withdrawals are not supported.
  app.post('/api/exchange/wallet-transaction', async (req: Request, res: Response) => {
    const { exchange, type, symbolOrAsset, amount, price } = req.body || {};
    if (type === 'BUY_ORDER' || type === 'SELL_ORDER') {
      req.body = { exchange, symbol: symbolOrAsset, side: type === 'BUY_ORDER' ? 'BUY' : 'SELL', amount, price, type: price ? 'LIMIT' : 'MARKET' };
      return handleExecuteOrder(req, res, true);
    }
    return res.status(501).json({
      success: false,
      error: 'Crypto withdrawals and transfers are not supported by this server. Withdraw directly at the exchange.',
    });
  });

  // 9. Orders accepted by exchanges since this process started
  app.get('/api/exchange/wallet-transactions', (_req: Request, res: Response) => {
    res.json({ success: true, transactions: placedOrders, count: placedOrders.length, timestamp: Date.now() });
  });

  // 10. Live order execution: real exchange call or an error. Never a fabricated receipt.
  app.post('/api/exchange/execute-order', (req: Request, res: Response) => handleExecuteOrder(req, res, false));

  async function handleExecuteOrder(req: Request, res: Response, legacyShape: boolean) {
    try {
      const { exchange, symbol, side, amount, notional, price, type = 'MARKET', clientOrderId } = req.body || {};

      if (!isExchangeId(exchange)) {
        return res.status(400).json({ success: false, error: `exchange must be one of ${EXCHANGE_IDS.join(', ')}` });
      }
      const sideU = String(side || '').toUpperCase();
      if (sideU !== 'BUY' && sideU !== 'SELL') {
        return res.status(400).json({ success: false, error: "side must be 'BUY' or 'SELL'" });
      }
      const typeU = String(type || 'MARKET').toUpperCase();
      if (typeU !== 'MARKET' && typeU !== 'LIMIT') {
        return res.status(400).json({ success: false, error: "type must be 'MARKET' or 'LIMIT'" });
      }
      if (typeof symbol !== 'string' || !symbol.trim()) {
        return res.status(400).json({ success: false, error: 'symbol is required' });
      }
      if (!getCreds(exchange)) {
        return res.status(503).json({ success: false, error: `${exchange} API credentials are not configured on the server.` });
      }

      const def = getAssetDefinition(symbol);
      if (!def.supportedExchanges.includes(exchange)) {
        return res.status(400).json({ success: false, error: `${def.symbol} is not supported on ${exchange}.` });
      }

      // Reference price: the caller's limit price, else the live book of the target exchange.
      let refPrice = typeU === 'LIMIT' ? Number(price) : 0;
      if (typeU === 'LIMIT' && !(refPrice > 0)) {
        return res.status(400).json({ success: false, error: 'price is required for LIMIT orders' });
      }
      if (!(refPrice > 0)) {
        const quotes = await fetchLiveExchangeQuotes(def.symbol);
        const q = quotes.find((x) => x.exchangeId === exchange);
        refPrice = sideU === 'BUY' ? q?.askPrice || 0 : q?.bidPrice || 0;
        if (!(refPrice > 0)) {
          return res.status(502).json({ success: false, error: `No live ${exchange} quote available for ${def.symbol}; refusing to size the order blind.` });
        }
      }

      let quantity = Number(amount);
      if (!(quantity > 0)) {
        const n = Number(notional);
        if (!(n > 0)) {
          return res.status(400).json({ success: false, error: 'Provide a positive amount (base quantity) or notional (USD)' });
        }
        quantity = n / refPrice;
      }
      const notionalUsd = quantity * refPrice;

      const blocked = checkOrderAllowed(notionalUsd);
      if (blocked) {
        return res.status(403).json({ success: false, error: blocked });
      }

      const coid = typeof clientOrderId === 'string' && /^[A-Za-z0-9_-]{8,36}$/.test(clientOrderId)
        ? clientOrderId
        : 'ca' + crypto.randomBytes(12).toString('hex');

      const result = await placeOrder({
        exchange,
        pairs: { binance: def.binanceSymbol, kraken: def.krakenPair, coinbase: def.coinbasePair, nonkyc: def.nonkycPair },
        side: sideU as 'BUY' | 'SELL',
        type: typeU as 'MARKET' | 'LIMIT',
        quantity,
        price: typeU === 'LIMIT' ? refPrice : undefined,
        clientOrderId: coid,
      });

      recordOrderNotional(notionalUsd);
      const now = Date.now();
      const record: PlacedOrder = {
        id: result.exchangeOrderId,
        timestamp: now,
        exchange,
        type: sideU === 'BUY' ? 'BUY_ORDER' : 'SELL_ORDER',
        symbolOrAsset: def.symbol,
        amount: quantity,
        price: refPrice,
        totalUsd: notionalUsd,
        status: 'TRANSMITTED',
        txHash: result.exchangeOrderId,
        executionNote: `${typeU} ${sideU} accepted by ${exchange} (order ${result.exchangeOrderId}). Fill status is not tracked here; check the exchange.`,
      };
      placedOrders = [record, ...placedOrders].slice(0, 100);

      const body = {
        success: true,
        isRealMoney: true,
        mode: 'LIVE_REAL_TRADING',
        exchange,
        exchangeOrderId: result.exchangeOrderId,
        clientOrderId: coid,
        symbol: def.symbol,
        side: sideU,
        amount: quantity,
        referencePrice: refPrice,
        notionalUsd,
        status: 'ACCEPTED_BY_EXCHANGE',
        timestamp: now,
        executionNote: record.executionNote,
      };
      return res.json(legacyShape ? { ...body, transaction: record } : body);
    } catch (err) {
      return sendErr(res, err);
    }
  }
}
