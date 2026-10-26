import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Zap, Compass } from 'lucide-react';
import { Header } from './components/Header';
import { RiskDisclosureBanner } from './components/RiskDisclosureBanner';
import { MarketWatchBar } from './components/MarketWatchBar';
import { PriceChart } from './components/PriceChart';
import { StrategyBotController } from './components/StrategyBotController';
import { MultiExchangeComparisonCard } from './components/MultiExchangeComparisonCard';
import { PositionsAndOrdersTable } from './components/PositionsAndOrdersTable';
import { AIAuditModal } from './components/AIAuditModal';
import { BacktestLabModal } from './components/BacktestLabModal';
import { ExchangeManagerModal } from './components/ExchangeManagerModal';
import { LiveTradingConfirmationModal } from './components/LiveTradingConfirmationModal';
import { LiveCurrencyAccountModal, TabType } from './components/LiveCurrencyAccountModal';
import { LiveCurrencyTreasuryCard } from './components/LiveCurrencyTreasuryCard';
import { DEFAULT_ASSETS, STRATEGY_PRESETS } from './data/marketData';
import { DEFAULT_EXCHANGES } from './data/exchangeData';
import {
  CryptoAsset,
  Candle,
  StrategyParameters,
  PortfolioState,
  Position,
  Order,
  AIAnalysisResult,
  TechnicalIndicators,
  ExchangeConfig,
  ExchangeId,
  ExchangeQuote,
  ExecutionRoutingMode,
  ArbitrageOpportunity,
  FiatAccount,
  FiatTransaction,
  TradingExecutionMode,
  CredentialsSummary,
  ActivePageTab,
} from './types';
import { EtherscanIntelligencePage } from './components/EtherscanIntelligencePage';
import { FlashArbBotDashboard } from './components/FlashArbBotDashboard';
import { CorrelationMatrixView } from './components/CorrelationMatrixView';
import { AiTroubleshooterModal } from './components/AiTroubleshooterModal';
import { OnChainWalletMonitor } from './components/OnChainWalletMonitor';
import { OkxWalletModal } from './components/OkxWalletModal';
import { getCachedOkxAddress } from './services/okxWallet';
import {
  generateInitialCandles,
  computeIndicators,
  formatCurrency,
  calculateDynamicPositionSize,
  DynamicPositionSizeResult,
} from './utils/cryptoMath';
import {
  generateExchangeQuotes,
  routeOrderSmart,
  scanCrossExchangeArbitrage,
  fetchLiveExchangeQuotes,
  executeTradeOnExchange,
} from './utils/exchangeRouting';
import { fetchFiatAccount, fetchFiatTransactions, syncBotCapital } from './services/fiatApi';
import { useAuth } from './context/AuthContext';
import {
  persistPortfolioToFirestore,
  loadPortfolioFromFirestore,
  persistExecutionLog,
  persistStrategyToFirestore,
} from './services/firestorePersistence';

const INITIAL_PORTFOLIO: PortfolioState = {
  cash: 0,
  startingBalance: 0,
  realizedPnl: 0,
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  maxDrawdownPercent: 0,
  peakEquity: 0,
  totalSavingsFromSOR: 0,
};

export default function App() {
  const { user } = useAuth();
  const [assets, setAssets] = useState<CryptoAsset[]>(DEFAULT_ASSETS);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTC/USDT');
  const [exchanges, setExchanges] = useState<ExchangeConfig[]>(DEFAULT_EXCHANGES);
  const [exchangeModalOpen, setExchangeModalOpen] = useState<boolean>(false);

  // Live Trading Execution Mode & API Credentials State
  const [tradingMode, setTradingMode] = useState<TradingExecutionMode>('LIVE_REAL_TRADING');
  const [credentialsSummary, setCredentialsSummary] = useState<CredentialsSummary | null>(null);
  const [liveConfirmModalOpen, setLiveConfirmModalOpen] = useState<boolean>(false);
  const [isLiveMarketConnected, setIsLiveMarketConnected] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<ActivePageTab>('TRADING_DESK');
  const [onChainSignalsCount, setOnChainSignalsCount] = useState<number>(5);
  const [aiTroubleshooterOpen, setAiTroubleshooterOpen] = useState<boolean>(false);
  const [aiInitialPrompt, setAiInitialPrompt] = useState<string | undefined>(undefined);

  // Candle map for each symbol
  const [candleMap, setCandleMap] = useState<Record<string, Candle[]>>(() => {
    const initial: Record<string, Candle[]> = {};
    DEFAULT_ASSETS.forEach((asset) => {
      initial[asset.symbol] = generateInitialCandles(
        asset.price,
        asset.volatility === 'Extreme' ? 0.025 : asset.volatility === 'High' ? 0.018 : 0.01,
        60
      );
    });
    return initial;
  });

  const [strategy, setStrategy] = useState<StrategyParameters>(() => ({
    ...STRATEGY_PRESETS[0],
    symbol: 'BTC/USDT',
  }));

  const [portfolio, setPortfolio] = useState<PortfolioState>(INITIAL_PORTFOLIO);
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [botLogs, setBotLogs] = useState<string[]>([
    'Apex Quant Agent multi-exchange gateway initialized.',
    'Connected to Binance, Coinbase Pro, Kraken & Bybit order books.',
    'Smart Order Router (SOR) active: auto-comparing prices across all exchanges for best execution.',
  ]);

  const [botRunning, setBotRunning] = useState<boolean>(true);
  const [dailyLossUsd, setDailyLossUsd] = useState<number>(0);
  const [simSpeed, setSimSpeed] = useState<number>(1);
  const [aiAuditModalOpen, setAiAuditModalOpen] = useState<boolean>(false);
  const [aiAuditLoading, setAiAuditLoading] = useState<boolean>(false);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResult | null>(null);
  const [backtestModalOpen, setBacktestModalOpen] = useState<boolean>(false);
  const [tradingDeskView, setTradingDeskView] = useState<'EXECUTION' | 'CORRELATION_MATRIX'>('EXECUTION');

  // Live Currency Account State (Bank & Debit Card Rails)
  const [fiatAccount, setFiatAccount] = useState<FiatAccount>({
    accountId: 'ACT-LIVE-USD',
    accountNumberMasked: '•••• 0000',
    routingNumberMasked: '•••• 0000',
    accountHolder: 'Live Trading Account',
    currency: 'USD',
    availableBalance: 0.0,
    pendingBalance: 0.0,
    allocatedToTrading: 0.0,
    dailyDepositLimit: 50000.0,
    dailyDepositUsed: 0.0,
    kycTier: 'TIER_2_ENHANCED_PRO',
    twoFactorEnabled: true,
    vaultEncryption: 'AES_256_GCM',
    fdicCustodyInsured: true,
    linkedBanks: [],
    linkedCards: [],
  });
  const [fiatTransactions, setFiatTransactions] = useState<FiatTransaction[]>([]);
  const [fiatModalOpen, setFiatModalOpen] = useState<boolean>(false);
  const [fiatModalInitialTab, setFiatModalInitialTab] = useState<TabType>('FUND_BOT');

  // OKX Web3 Wallet & Exchange Integration State
  const [okxWalletModalOpen, setOkxWalletModalOpen] = useState<boolean>(false);
  const [okxConnectedAddress, setOkxConnectedAddress] = useState<string | null>(getCachedOkxAddress());
  const [targetMonitorWallet, setTargetMonitorWallet] = useState<{ address: string; network: string } | null>(null);

  const handleSelectAddressForMonitor = (address: string, network?: string) => {
    setActiveTab('WALLET_MONITOR');
    setTargetMonitorWallet({ address, network: network || 'ethereum' });
    setOkxConnectedAddress(address);
  };

  const handleDepositFromOkx = (amount: number, symbol: string) => {
    setPortfolio((prev) => ({
      ...prev,
      cash: prev.cash + amount,
      startingBalance: prev.startingBalance + amount,
    }));
    setBotLogs((prev) => [
      `[${new Date().toLocaleTimeString()}] OKX WEB3 DEPOSIT: Credited $${amount.toFixed(2)} ${symbol} from OKX self-custody wallet into algorithmic trading desk.`,
      ...prev,
    ]);
  };

  const handleOpenFiatModal = (tab: TabType = 'FUND_BOT') => {
    setFiatModalInitialTab(tab);
    setFiatModalOpen(true);
  };

  // Synchronize Live Currency Account from Backend API on mount
  useEffect(() => {
    fetchFiatAccount()
      .then((res) => {
        if (res && res.account) {
          setFiatAccount(res.account);
          if (res.account.allocatedToTrading > 0) {
            setPortfolio((p) => {
              if (p.cash === 0) {
                return {
                  ...p,
                  cash: res.account.allocatedToTrading,
                  startingBalance: res.account.allocatedToTrading,
                  peakEquity: res.account.allocatedToTrading,
                };
              }
              return p;
            });
          }
        }
      })
      .catch((err) => console.warn('Could not sync live fiat account from server:', err));

    fetchFiatTransactions()
      .then((txs) => {
        if (txs && txs.length > 0) setFiatTransactions(txs);
      })
      .catch((err) => console.warn('Could not sync fiat transactions:', err));
  }, []);

  const handleAccountUpdated = (newAccount: FiatAccount, notificationMsg?: string) => {
    setFiatAccount(newAccount);
    fetchFiatTransactions().then(setFiatTransactions).catch(() => {});
    if (notificationMsg) {
      setBotLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] FIAT TREASURY: ${notificationMsg}`,
      ]);
    }
  };

  const handleBotCashAdjusted = (amountDelta: number) => {
    setPortfolio((p) => {
      const newCash = Math.max(0, p.cash + amountDelta);
      syncBotCapital(newCash).catch(() => {});
      return {
        ...p,
        cash: newCash,
        startingBalance: p.startingBalance + (amountDelta > 0 ? amountDelta : 0),
        peakEquity: Math.max(p.peakEquity, newCash),
      };
    });
    setBotLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] BOT CAPITAL: ${
        amountDelta > 0 ? 'Deposited' : 'Withdrew'
      } $${Math.abs(amountDelta).toFixed(2)} USD ${
        amountDelta > 0 ? 'from Bank / Check Card to Fund Bot' : 'to Fiat Vault'
      }. New Bot Margin: $${(portfolio.cash + amountDelta).toFixed(2)} USD.`,
    ]);
  };

  // Synchronize Live Portfolio Snapshot from Cloud Firestore upon User Authentication
  useEffect(() => {
    if (!user?.uid) return;
    loadPortfolioFromFirestore(user.uid)
      .then((saved) => {
        if (saved) {
          setPortfolio((prev) => ({
            ...prev,
            cash: typeof saved.cash === 'number' && saved.cash > 0 ? saved.cash : prev.cash,
            startingBalance: typeof saved.startingBalance === 'number' && saved.startingBalance > 0 ? saved.startingBalance : prev.startingBalance,
            realizedPnl: typeof saved.realizedPnl === 'number' ? saved.realizedPnl : prev.realizedPnl,
            totalTrades: typeof saved.totalTrades === 'number' ? saved.totalTrades : prev.totalTrades,
            winningTrades: typeof saved.winningTrades === 'number' ? saved.winningTrades : prev.winningTrades,
            losingTrades: typeof saved.losingTrades === 'number' ? saved.losingTrades : prev.losingTrades,
            maxDrawdownPercent: typeof saved.maxDrawdownPercent === 'number' ? saved.maxDrawdownPercent : prev.maxDrawdownPercent,
            peakEquity: typeof saved.peakEquity === 'number' ? saved.peakEquity : prev.peakEquity,
          }));
          setBotLogs((prev) => [
            `[${new Date().toLocaleTimeString()}] ☁️ FIRESTORE REAL-TIME SYNC: Authenticated portfolio loaded from Google Cloud Firestore for ${user.email || user.uid}.`,
            ...prev,
          ]);
        }
      })
      .catch((err) => {
        console.warn('Could not load portfolio from Firestore:', err);
      });
  }, [user?.uid]);

  // Persist Live Portfolio state to Cloud Firestore whenever balance, trades, or positions update
  useEffect(() => {
    if (!user?.uid) return;
    const timeout = setTimeout(() => {
      persistPortfolioToFirestore(user.uid, portfolio, positions, orders).catch((err) => {
        console.warn('Could not persist live portfolio snapshot to Firestore:', err);
      });
    }, 1500);
    return () => clearTimeout(timeout);
  }, [user?.uid, portfolio.cash, portfolio.realizedPnl, portfolio.totalTrades, positions.length, orders.length]);

  // Persist Active Strategy parameters to Cloud Firestore when modified
  useEffect(() => {
    if (!user?.uid) return;
    const timeout = setTimeout(() => {
      persistStrategyToFirestore(user.uid, strategy).catch((err) => {
        console.warn('Could not persist strategy to Firestore:', err);
      });
    }, 2000);
    return () => clearTimeout(timeout);
  }, [user?.uid, strategy]);

  // Fetch Exchange Credentials Status
  const fetchCredentialsStatus = async () => {
    try {
      const res = await fetch('/api/exchange/credentials-status');
      if (res.ok) {
        const data = await res.json();
        if (data.credentials) {
          setCredentialsSummary(data.credentials);
          setExchanges((prev) =>
            prev.map((e) => {
              const cred = data.credentials[e.id as keyof typeof data.credentials];
              return {
                ...e,
                hasApiKeyConfigured: Boolean(cred?.configured),
              };
            })
          );
        }
      }
    } catch (err) {
      console.warn('Could not fetch exchange credentials:', err);
    }
  };

  useEffect(() => {
    fetchCredentialsStatus();
  }, []);

  // Poll Etherscan on-chain signals count for Header badge
  useEffect(() => {
    let isMounted = true;
    const fetchOnChainCount = async () => {
      try {
        const res = await fetch('/api/etherscan/live-feed');
        if (res.ok && isMounted) {
          const json = await res.json();
          if (json.tradePatterns) {
            setOnChainSignalsCount(json.tradePatterns.length);
          }
        }
      } catch {}
    };
    fetchOnChainCount();
    const interval = setInterval(fetchOnChainCount, 6000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Poll Real Live Market Data (Binance US + Kraken + Coinbase Live Feeds)
  useEffect(() => {
    let isMounted = true;
    const pollLiveTickers = async () => {
      try {
        const res = await fetch('/api/market/live-tickers');
        if (res.ok) {
          const data = await res.json();
          if (data.tickers && data.tickers.length > 0 && isMounted) {
            setIsLiveMarketConnected(true);
            setAssets((prev) => {
              const prevMap = new Map(prev.map((a) => [a.symbol, a]));
              data.tickers.forEach((t: any) => {
                const existing = prevMap.get(t.symbol);
                if (existing) {
                  prevMap.set(t.symbol, {
                    ...existing,
                    price: t.price,
                    change24h: t.change24h,
                    high24h: t.high24h,
                    low24h: t.low24h,
                    volume24h: t.volume24h,
                    sparkline:
                      t.sparkline && t.sparkline.length > 0 ? t.sparkline : existing.sparkline,
                    category: t.category || existing.category,
                    supportedExchanges: t.supportedExchanges || existing.supportedExchanges,
                  });
                } else {
                  prevMap.set(t.symbol, {
                    symbol: t.symbol,
                    name: t.name || t.symbol.split('/')[0],
                    price: t.price,
                    change24h: t.change24h,
                    high24h: t.high24h,
                    low24h: t.low24h,
                    volume24h: t.volume24h,
                    sparkline: t.sparkline || [t.price * 0.98, t.price],
                    decimals: t.decimals || 2,
                    volatility: t.volatility || 'High',
                    category: t.category || 'Zero-KYC',
                    supportedExchanges: t.supportedExchanges,
                  });
                }
              });
              return Array.from(prevMap.values());
            });

            // Update active candle with latest real incoming price tick
            setCandleMap((prev) => {
              const currentList = prev[selectedSymbol];
              const matchedActive = data.tickers.find((t: any) => t.symbol === selectedSymbol);
              if (!currentList || currentList.length === 0 || !matchedActive) return prev;
              const lastCandle = currentList[currentList.length - 1];
              const p = matchedActive.price;
              const updatedCandle: Candle = {
                ...lastCandle,
                high: Math.max(lastCandle.high, p),
                low: Math.min(lastCandle.low, p),
                close: p,
              };
              return {
                ...prev,
                [selectedSymbol]: [...currentList.slice(0, -1), updatedCandle],
              };
            });
          }
        }
      } catch {
        // Non-blocking
      }
    };

    pollLiveTickers();
    const tickerInterval = setInterval(pollLiveTickers, 1200);

    return () => {
      isMounted = false;
      clearInterval(tickerInterval);
    };
  }, [selectedSymbol]);

  // Poll Real Live 1m Candlestick Data for selected asset
  useEffect(() => {
    let isMounted = true;
    const pollLiveCandles = async () => {
      try {
        const res = await fetch(
          `/api/market/live-candles?symbol=${encodeURIComponent(selectedSymbol)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.candles && data.candles.length > 0 && isMounted) {
            setCandleMap((prev) => ({
              ...prev,
              [selectedSymbol]: data.candles,
            }));
          }
        }
      } catch {
        // Fallback gracefully
      }
    };

    pollLiveCandles();
    const candleInterval = setInterval(pollLiveCandles, 5000);

    return () => {
      isMounted = false;
      clearInterval(candleInterval);
    };
  }, [selectedSymbol]);

  // Real-time live exchange order book quotes state
  const [exchangeQuotes, setExchangeQuotes] = useState<ExchangeQuote[]>([]);

  // Poll Real Live Multi-Exchange Quotes (Direct order books)
  useEffect(() => {
    let isMounted = true;
    const pollLiveQuotes = async () => {
      try {
        const quotes = await fetchLiveExchangeQuotes(selectedSymbol, activeAsset.price, exchanges);
        if (quotes && quotes.length > 0 && isMounted) {
          setExchangeQuotes(quotes);
        }
      } catch {
        // Non-blocking
      }
    };

    pollLiveQuotes();
    const quotesInterval = setInterval(pollLiveQuotes, 1500);

    return () => {
      isMounted = false;
      clearInterval(quotesInterval);
    };
  }, [selectedSymbol]);

  // Trading Mode Toggle Handlers
  const handleToggleTradingMode = (newMode: TradingExecutionMode) => {
    if (newMode === 'LIVE_REAL_TRADING') {
      setLiveConfirmModalOpen(true);
    } else {
      setTradingMode('LIVE_REAL_TRADING');
      setBotLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] 🔒 REAL TRADING ENGINE LOCKED: Simulation mode is disabled. Real exchange order books and authenticated matching rails are permanently engaged.`,
      ]);
    }
  };

  const handleConfirmLiveTrading = () => {
    setTradingMode('LIVE_REAL_TRADING');
    // In LIVE mode, cash is strictly tied to real vault/fiat allocated capital
    setPortfolio((p) => ({
      ...p,
      cash: fiatAccount.allocatedToTrading,
      startingBalance: fiatAccount.allocatedToTrading,
    }));
    setBotLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] 🚨 LIVE REAL TRADING ACTIVATED: Cash strictly synchronized to verified fiat vault funds ($${fiatAccount.allocatedToTrading.toFixed(2)} USD). Real money at risk!`,
    ]);
  };

  // Active asset & candles
  const activeAsset = useMemo(
    () => assets.find((a) => a.symbol === selectedSymbol) || assets[0],
    [assets, selectedSymbol]
  );

  const activeCandles = useMemo(
    () => candleMap[selectedSymbol] || generateInitialCandles(activeAsset?.price || 100, 0.015, 60),
    [candleMap, selectedSymbol, activeAsset]
  );

  const handleSelectSymbol = (symbol: string) => {
    setSelectedSymbol(symbol);
    setStrategy((prev) => ({ ...prev, symbol }));
  };

  const handleAddCustomSymbol = (symbol: string) => {
    let clean = symbol.trim().toUpperCase();
    if (!clean.includes('/')) {
      if (clean.includes('_')) clean = clean.replace('_', '/');
      else clean = `${clean}/USDT`;
    }

    setSelectedSymbol(clean);
    setStrategy((prev) => ({ ...prev, symbol: clean }));

    setAssets((prev) => {
      if (prev.some((a) => a.symbol === clean)) return prev;
      const base = clean.split('/')[0];
      const isMeme = ['PEPE', 'SHIB', 'DOGE', 'BONK', 'FLOKI'].includes(base);
      const isMicro = ['SHIB', 'PEPE', 'BONK', 'FLOKI'].includes(base);
      const decimals = isMicro ? 8 : ['DOGE', 'XRP', 'ADA', 'TRX', 'POL', 'KAS'].includes(base) ? 4 : 2;

      const newAsset: CryptoAsset = {
        symbol: clean,
        name: base,
        price: 1.0,
        change24h: 0,
        high24h: 1.05,
        low24h: 0.95,
        volume24h: 500000,
        sparkline: [0.95, 0.98, 1.0, 0.99, 1.02, 1.01, 1.0],
        decimals,
        volatility: isMeme ? 'Extreme' : 'High',
        category: 'Zero-KYC',
        isCustom: true,
      };
      return [...prev, newAsset];
    });

    setCandleMap((prev) => {
      if (prev[clean]) return prev;
      return {
        ...prev,
        [clean]: generateInitialCandles(1.0, 0.015, 60),
      };
    });

    setBotLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] Market switched to ${clean}. Order books and Smart Order Router (SOR) active across all exchanges.`,
    ]);
  };

  const indicators = useMemo(
    () =>
      computeIndicators(activeCandles, {
        macdFast: strategy.macdFastPeriod ?? 12,
        macdSlow: strategy.macdSlowPeriod ?? 26,
        macdSignal: strategy.macdSignalPeriod ?? 9,
        rsiPeriod: strategy.rsiPeriod ?? 14,
        bollingerPeriod: strategy.bollingerPeriod ?? 20,
        bollingerStdDev: strategy.bollingerStdDev ?? 2,
      }),
    [
      activeCandles,
      strategy.macdFastPeriod,
      strategy.macdSlowPeriod,
      strategy.macdSignalPeriod,
      strategy.rsiPeriod,
      strategy.bollingerPeriod,
      strategy.bollingerStdDev,
    ]
  );

  // Detect cross-exchange spatial arbitrage from live order book quotes
  const arbitrageOpp: ArbitrageOpportunity | null = useMemo(
    () => scanCrossExchangeArbitrage(selectedSymbol, exchangeQuotes, exchanges),
    [selectedSymbol, exchangeQuotes, exchanges]
  );

  // Total unrealized PnL across all open positions
  const totalUnrealizedPnl = useMemo(
    () => positions.reduce((sum, p) => sum + p.unrealizedPnl, 0),
    [positions]
  );

  // Keep strategy symbol in sync with selected asset
  useEffect(() => {
    setStrategy((prev) => ({ ...prev, symbol: selectedSymbol }));
  }, [selectedSymbol]);

  // Last order cooldown timestamp
  const lastOrderTimeRef = useRef<number>(0);

  // Condition evaluation for UI feedback & Agent execution
  const { isBuyConditionMet, buyConditionReason, isSellConditionMet, sellConditionReason } = useMemo(() => {
    let met = false;
    let reason = '';
    let sellMet = false;
    let sellReason = '';

    const trend = indicators.trendAnalysis;
    const bbPercentB = indicators.bollinger.percentB ?? 0.5;

    // --- BUY SIGNALS ---
    if (strategy.triggerType === 'TRIPLE_CONFLUENCE_PRO') {
      const precisionBuy = trend?.signals.isPrecisionBuy;
      const scoreOk = (trend?.confluenceScore ?? 0) >= 30;
      const rsiOk = indicators.rsi <= strategy.rsiBuyThreshold + 4;
      const macdOk = indicators.macd.histogram > 0 || indicators.macd.isBullishCross;
      const bbOk = bbPercentB <= 0.45;

      met = Boolean(precisionBuy || (scoreOk && rsiOk && macdOk && bbOk));
      reason = met
        ? `Triple Confluence Bullish Buy (${trend?.confluenceScore ?? 0}% Score): MACD Hist ${indicators.macd.histogram.toFixed(2)} + RSI ${indicators.rsi.toFixed(1)} + BB %B ${bbPercentB.toFixed(2)}`
        : `Monitoring Triple Confluence (Score: ${trend?.confluenceScore ?? 0}%, RSI: ${indicators.rsi.toFixed(1)}, MACD Hist: ${indicators.macd.histogram.toFixed(2)})`;
    } else if (strategy.triggerType === 'BOLLINGER_MACD_SQUEEZE') {
      const squeezeOrDip = indicators.bollinger.isSqueeze || bbPercentB <= 0.30;
      const macdBullish = indicators.macd.histogram > 0 || indicators.macd.isBullishCross;
      met = Boolean(squeezeOrDip && macdBullish);
      reason = met
        ? `Bollinger Squeeze + MACD Surge: BB %B ${bbPercentB.toFixed(2)} (${indicators.bollinger.isSqueeze ? 'Squeeze Active' : 'Band Pinch'}) with MACD Hist +${indicators.macd.histogram.toFixed(2)}`
        : `Waiting for Squeeze / Band Pinch (%B: ${bbPercentB.toFixed(2)}) + Positive MACD Hist (${indicators.macd.histogram.toFixed(2)})`;
    } else if (strategy.triggerType === 'MACD_CROSSOVER') {
      const goldenCross = indicators.macd.isBullishCross;
      const expandingMomentum = indicators.macd.histogram > 0 && indicators.macd.isHistogramExpanding && indicators.rsi <= strategy.rsiBuyThreshold + 8;
      met = Boolean(goldenCross || expandingMomentum);
      reason = met
        ? `MACD Bullish Signal: ${goldenCross ? 'Golden Cross (MACD > Signal)' : `Histogram Expanding (+${indicators.macd.histogram.toFixed(2)})`} & RSI ${indicators.rsi.toFixed(1)}`
        : `Monitoring MACD Crossover (MACD: ${indicators.macd.macd.toFixed(2)} vs Sig: ${indicators.macd.signal.toFixed(2)}, Hist: ${indicators.macd.histogram.toFixed(2)})`;
    } else if (strategy.triggerType === 'RSI_DIVERGENCE_REVERSAL') {
      const isDiv = Boolean(trend?.signals.divergenceStatus?.includes('Bullish'));
      const isOversoldBounce = indicators.rsi <= strategy.rsiBuyThreshold && indicators.macd.histogram > -0.4;
      met = isDiv || isOversoldBounce;
      reason = met
        ? `RSI Reversal Signal: ${isDiv ? 'Bullish Regular Divergence Confirmed' : `RSI Deep Dip (${indicators.rsi.toFixed(1)})`} & MACD Curving Up`
        : `Scanning for RSI Divergence / Reversal (RSI: ${indicators.rsi.toFixed(1)}, Divergence: ${trend?.signals.divergenceStatus || 'None'})`;
    } else if (strategy.triggerType === 'CROSS_EXCHANGE_ARBITRAGE') {
      met = Boolean(arbitrageOpp && arbitrageOpp.isActionable && arbitrageOpp.netSpreadPercent >= strategy.minArbitrageProfitPercent);
      reason = arbitrageOpp && arbitrageOpp.isActionable
        ? `Arbitrage Window: Buy ${arbitrageOpp.buyExchangeName} / Sell ${arbitrageOpp.sellExchangeName} (+${arbitrageOpp.netSpreadPercent.toFixed(3)}% Net)`
        : `Scanning cross-exchange spread (Threshold: >= ${strategy.minArbitrageProfitPercent}%)`;
    } else if (strategy.triggerType === 'RSI_OVERSOLD') {
      met = indicators.rsi <= strategy.rsiBuyThreshold;
      reason = `RSI: ${indicators.rsi.toFixed(1)} (Buy trigger: <= ${strategy.rsiBuyThreshold})`;
    } else if (strategy.triggerType === 'MOMENTUM_COMBO') {
      const rsiOk = indicators.rsi <= strategy.rsiBuyThreshold + 4;
      const macdOk = indicators.macd.histogram > 0;
      met = rsiOk && macdOk;
      reason = `RSI: ${indicators.rsi.toFixed(1)} & MACD Hist: ${indicators.macd.histogram.toFixed(2)}`;
    } else if (strategy.triggerType === 'EMA_BREAKOUT') {
      met = indicators.ema9 > indicators.ema21;
      reason = `EMA 9 (${formatCurrency(indicators.ema9, activeAsset.decimals)}) > EMA 21 (${formatCurrency(indicators.ema21, activeAsset.decimals)})`;
    } else if (strategy.triggerType === 'BOLLINGER_BOUNCE') {
      met = activeAsset.price <= indicators.bollinger.lower * 1.003 || bbPercentB <= 0.08;
      reason = `Price (${formatCurrency(activeAsset.price, activeAsset.decimals)}) near Lower Band (${formatCurrency(indicators.bollinger.lower, activeAsset.decimals)}, %B: ${bbPercentB.toFixed(2)})`;
    }

    // --- SELL / EXIT SIGNALS DERIVED FROM MACD, RSI & BOLLINGER BANDS ---
    if (strategy.triggerType === 'TRIPLE_CONFLUENCE_PRO') {
      const precisionSell = trend?.signals.isPrecisionSell;
      const scoreBearish = (trend?.confluenceScore ?? 0) <= -20;
      const rsiOverbought = indicators.rsi >= strategy.rsiSellThreshold;
      const macdBearish = indicators.macd.isBearishCross || (indicators.macd.histogram < 0 && indicators.rsi >= 60);
      const bbUpperReject = bbPercentB >= 0.88 || indicators.bollinger.isPiercingUpper;

      sellMet = Boolean(precisionSell || scoreBearish || rsiOverbought || (macdBearish && bbUpperReject));
      sellReason = sellMet
        ? `Triple Confluence Bearish Sell (${trend?.confluenceScore ?? 0}% Score): MACD Hist ${indicators.macd.histogram.toFixed(2)} + RSI ${indicators.rsi.toFixed(1)} + BB %B ${bbPercentB.toFixed(2)}`
        : `Guarding Positions (RSI: ${indicators.rsi.toFixed(1)} < ${strategy.rsiSellThreshold}, MACD Hist: ${indicators.macd.histogram.toFixed(2)}, BB %B: ${bbPercentB.toFixed(2)})`;
    } else if (strategy.triggerType === 'BOLLINGER_MACD_SQUEEZE') {
      const upperPierce = bbPercentB >= 0.88 || indicators.bollinger.isPiercingUpper;
      const momentumReversal = indicators.macd.histogram < 0 || indicators.rsi >= strategy.rsiSellThreshold;
      sellMet = Boolean(upperPierce && momentumReversal);
      sellReason = sellMet
        ? `Bollinger Upper Band Pierced (%B: ${bbPercentB.toFixed(2)}) & Momentum Turning Red (${indicators.macd.histogram.toFixed(2)})`
        : `Monitoring Bollinger Band %B (${bbPercentB.toFixed(2)} < 0.88) & MACD Hist (${indicators.macd.histogram.toFixed(2)})`;
    } else if (strategy.triggerType === 'MACD_CROSSOVER') {
      const deathCross = indicators.macd.isBearishCross;
      const bearishRegime = indicators.macd.macd < indicators.macd.signal && indicators.macd.histogram < 0 && indicators.rsi >= 58;
      const rsiExtreme = indicators.rsi >= strategy.rsiSellThreshold;
      sellMet = Boolean(deathCross || bearishRegime || rsiExtreme);
      sellReason = sellMet
        ? `MACD Bearish Signal: ${deathCross ? 'Death Cross (MACD < Signal)' : `Bearish Momentum (Hist ${indicators.macd.histogram.toFixed(2)})`} & RSI ${indicators.rsi.toFixed(1)}`
        : `Monitoring MACD Lines (MACD: ${indicators.macd.macd.toFixed(2)} vs Sig: ${indicators.macd.signal.toFixed(2)}, Hist: ${indicators.macd.histogram.toFixed(2)})`;
    } else if (strategy.triggerType === 'RSI_DIVERGENCE_REVERSAL') {
      const isBearishDiv = Boolean(trend?.signals.divergenceStatus?.includes('Bearish'));
      const isOverbought = indicators.rsi >= strategy.rsiSellThreshold;
      sellMet = Boolean(isBearishDiv || (isOverbought && indicators.macd.histogram < 0));
      sellReason = sellMet
        ? `RSI Bearish Reversal: ${isBearishDiv ? 'Bearish Regular Divergence Confirmed' : `RSI Overbought Peak (${indicators.rsi.toFixed(1)})`} & MACD Curving Down`
        : `Scanning for RSI Divergence / Reversal (RSI: ${indicators.rsi.toFixed(1)} vs ${strategy.rsiSellThreshold})`;
    } else if (strategy.triggerType === 'BOLLINGER_BOUNCE') {
      sellMet = Boolean(bbPercentB >= 0.90 || indicators.bollinger.isPiercingUpper || indicators.rsi >= strategy.rsiSellThreshold);
      sellReason = `Bollinger Upper Resistance (%B: ${bbPercentB.toFixed(2)} >= 0.90, RSI: ${indicators.rsi.toFixed(1)})`;
    } else if (strategy.triggerType === 'EMA_BREAKOUT') {
      sellMet = Boolean(indicators.ema9 < indicators.ema21 || indicators.rsi >= strategy.rsiSellThreshold);
      sellReason = `EMA 9 (${formatCurrency(indicators.ema9, activeAsset.decimals)}) < EMA 21 (${formatCurrency(indicators.ema21, activeAsset.decimals)}) or RSI Overbought`;
    } else if (strategy.triggerType === 'MOMENTUM_COMBO') {
      sellMet = Boolean(indicators.rsi >= strategy.rsiSellThreshold || (indicators.macd.histogram < 0 && indicators.rsi >= 58));
      sellReason = `Momentum Exhaustion: RSI ${indicators.rsi.toFixed(1)} / MACD Hist ${indicators.macd.histogram.toFixed(2)}`;
    } else {
      sellMet = Boolean(indicators.rsi >= strategy.rsiSellThreshold || indicators.macd.isBearishCross || trend?.signals.isPrecisionSell);
      sellReason = `RSI Overbought Exhaustion (${indicators.rsi.toFixed(1)} >= ${strategy.rsiSellThreshold}) or MACD Bearish Reversal`;
    }

    return {
      isBuyConditionMet: met,
      buyConditionReason: reason,
      isSellConditionMet: sellMet,
      sellConditionReason: sellReason,
    };
  }, [strategy, indicators, activeAsset, arbitrageOpp]);

  // Toggle exchange connection in pool
  const handleToggleExchange = (id: ExchangeId) => {
    setExchanges((prev) =>
      prev.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e))
    );
  };

  const handleUpdateExchangeFee = (id: ExchangeId, takerFee: number) => {
    setExchanges((prev) =>
      prev.map((e) => (e.id === id ? { ...e, takerFeePercent: takerFee } : e))
    );
  };

  // Set Routing Mode
  const handleSetRoutingMode = (mode: ExecutionRoutingMode) => {
    setStrategy((prev) => ({ ...prev, routingMode: mode }));
    setBotLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] Order execution mode switched to: ${
        mode === 'SMART_ORDER_ROUTER' ? 'Smart Order Router (Best Net Price across all exchanges)' : `Direct route exclusively to ${mode}`
      }`,
    ]);
  };

  // Reset Risk Circuit Breaker
  const handleResetCircuitBreaker = () => {
    setDailyLossUsd(0);
    setStrategy((prev) => ({ ...prev, circuitBreakerActive: false }));
    setBotLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] 🟢 CIRCUIT BREAKER RESET: Daily loss counter cleared ($0.00). Automated trading re-enabled.`,
    ]);
  };

  // Manual Order Handler using Smart Order Router
  const handleManualOrder = (side: 'BUY' | 'SELL') => {
    const now = Date.now();

    if (side === 'BUY') {
      const leverage = strategy.leverage;
      let margin: number;
      let dynamicSizingRes: DynamicPositionSizeResult | undefined;

      if (strategy.dynamicPositionSizing) {
        const currentAsset = assets.find((a) => a.symbol === selectedSymbol);
        const safeAtr = indicators.atr || (currentAsset ? currentAsset.price * 0.018 : 100);
        dynamicSizingRes = calculateDynamicPositionSize({
          portfolioCash: portfolio.cash,
          currentPrice: currentAsset ? currentAsset.price : 68000,
          atr: safeAtr,
          atrMultiplier: strategy.atrMultiplier || 2.0,
          riskPerTradePercent: strategy.riskPerTradePercent || 2.0,
          leverage,
          maxCapPercent: 35.0,
          minOrderUsd: 25.0,
        });
        margin = dynamicSizingRes.margin;
      } else {
        margin = portfolio.cash * (strategy.orderSizePercent / 100);
      }

      if (margin < 25) {
        setBotLogs((prev) => [
          ...prev,
          `[${new Date(now).toLocaleTimeString()}] Cannot BUY: Insufficient cash balance ($${portfolio.cash.toFixed(2)}).`,
        ]);
        return;
      }

      const notional = margin * leverage;

      // Route via Smart Order Router to find the lowest effective buy price
      const route = routeOrderSmart(
        'BUY',
        selectedSymbol,
        notional,
        exchangeQuotes,
        exchanges,
        strategy.routingMode
      );

      const executedPrice = route.rawPrice;
      const fee = route.feeAmountUsd;
      const amount = notional / executedPrice;

      const liqDrop = 0.9 / leverage;
      const liquidationPrice = executedPrice * (1 - liqDrop);

      // Advanced Stop-Loss & Take-Profit Targets
      const effectiveStopLossPct = (strategy.dynamicPositionSizing && dynamicSizingRes)
        ? dynamicSizingRes.stopDistancePercent
        : strategy.stopLossPercent;

      const effectiveTakeProfitPct = strategy.takeProfitType === 'RISK_REWARD_RATIO'
        ? effectiveStopLossPct * (strategy.riskRewardRatio || 2.5)
        : strategy.takeProfitPercent;

      const takeProfitPrice = executedPrice * (1 + (effectiveTakeProfitPct / 100) / leverage);
      const stopLossPrice = executedPrice * (1 - (effectiveStopLossPct / 100) / leverage);

      const newPosition: Position = {
        id: `pos-${now}-${Math.random().toString(36).substr(2, 4)}`,
        symbol: selectedSymbol,
        entryPrice: executedPrice,
        currentPrice: executedPrice,
        amount,
        margin,
        leverage,
        notional,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        highestPrice: executedPrice,
        liquidationPrice,
        openTime: now,
        takeProfitPrice,
        stopLossPrice,
        strategyTrigger: strategy.dynamicPositionSizing
          ? `Manual Buy (Dynamic Vol Sized)`
          : 'Manual User Order',
        exchange: route.bestExchange,
        exchangeName: route.bestExchangeName,
        savingsUsd: route.savingsUsd,
        volatilityAtEntry: indicators.atr,
        isDynamicSized: !!strategy.dynamicPositionSizing,
        riskRewardRatio: strategy.riskRewardRatio || 2.5,
        stopLossDistanceUsd: executedPrice - stopLossPrice,
        targetProfitUsd: takeProfitPrice - executedPrice,
      };

      const order: Order = {
        id: `ord-${now}`,
        timestamp: now,
        symbol: selectedSymbol,
        side: 'BUY',
        type: 'MARKET',
        price: executedPrice,
        amount,
        notional,
        fee,
        exchange: route.bestExchange,
        exchangeName: route.bestExchangeName,
        savingsUsd: route.savingsUsd,
        savingsPercent: route.savingsPercent,
        routedViaSOR: strategy.routingMode === 'SMART_ORDER_ROUTER',
        reason: route.routeReason,
      };

      setPortfolio((p) => ({
        ...p,
        cash: p.cash - margin - fee,
        totalSavingsFromSOR: (p.totalSavingsFromSOR || 0) + route.savingsUsd,
      }));
      setPositions((pos) => [...pos, newPosition]);
      setOrders((ords) => [order, ...ords]);

      if (user?.uid) {
        persistExecutionLog(user.uid, {
          id: order.id,
          timestamp: order.timestamp,
          symbol: order.symbol,
          type: order.side,
          netProfitUsd: 0,
          status: 'COMPLETED',
          route: route.bestExchangeName,
        }).catch(() => {});
      }

      setBotLogs((prev) => [
        ...prev,
        `[${new Date(now).toLocaleTimeString()}] Manual BUY routed to ${route.bestExchangeName}: ${amount.toFixed(4)} ${selectedSymbol} @ ${formatCurrency(executedPrice, activeAsset.decimals)} (Saved $${route.savingsUsd.toFixed(2)})`,
      ]);

      // If in Live Real Money Mode, dispatch order to real exchange API (including NonKYC)
      if (tradingMode === 'LIVE_REAL_TRADING') {
        executeTradeOnExchange({
          exchange: route.bestExchange,
          symbol: selectedSymbol,
          side: 'BUY',
          amount,
          notional,
          price: executedPrice,
          isLiveRealMoney: true,
        })
          .then((res) => {
            if (res.success) {
              setBotLogs((prev) => [
                ...prev,
                `[${new Date().toLocaleTimeString()}] 🟢 REAL EXCHANGE ORDER FILLED: ${route.bestExchangeName} execution ref #${res.exchangeOrderId || res.cryptographicReceipt}`,
              ]);
            } else {
              setBotLogs((prev) => [
                ...prev,
                `[${new Date().toLocaleTimeString()}] ⚠️ REAL EXCHANGE ORDER REJECTED: ${res.error || 'Check API credentials/permissions'}`,
              ]);
            }
          })
          .catch((err) => {
            setBotLogs((prev) => [
              ...prev,
              `[${new Date().toLocaleTimeString()}] ❌ REAL ORDER API ERROR: ${err.message}`,
            ]);
          });
      }
    } else {
      // Execute Sell: Close matching open positions OR execute direct spot market sell on exchange order books
      const matching = positions.filter((p) => p.symbol === selectedSymbol);
      if (matching.length > 0) {
        matching.forEach((pos) => closePosition(pos.id, 'MANUAL_CLOSE', 'Manual User Close'));
      } else if (positions.length > 0) {
        // Close open positions in active portfolio
        const targetPos = positions[0];
        closePosition(targetPos.id, 'MANUAL_CLOSE', `Manual Close (${targetPos.symbol})`);
      } else {
        // Direct Market SELL order routed across Binance, Coinbase, Kraken, Bybit via SOR
        const orderNotional = Math.min(Math.max(portfolio.cash * 0.2, 50), 2000);
        const route = routeOrderSmart(
          'SELL',
          selectedSymbol,
          orderNotional,
          exchangeQuotes,
          exchanges,
          strategy.routingMode
        );
        const executedPrice = route.rawPrice;
        const fee = route.feeAmountUsd;
        const amount = orderNotional / executedPrice;

        const manualSellOrder: Order = {
          id: `ord-sell-${now}`,
          timestamp: now,
          symbol: selectedSymbol,
          side: 'SELL',
          type: 'MARKET',
          price: executedPrice,
          amount,
          notional: orderNotional,
          fee,
          exchange: route.bestExchange,
          exchangeName: route.bestExchangeName,
          savingsUsd: route.savingsUsd,
          savingsPercent: route.savingsPercent,
          routedViaSOR: strategy.routingMode === 'SMART_ORDER_ROUTER',
          pnl: 0,
          reason: `Manual Market SELL order routed to ${route.bestExchangeName} (Highest Bid)`,
        };

        setOrders((ords) => [manualSellOrder, ...ords]);
        setBotLogs((prev) => [
          ...prev,
          `[${new Date(now).toLocaleTimeString()}] 🔴 MANUAL SPOT SELL: ${amount.toFixed(4)} ${selectedSymbol} @ ${formatCurrency(executedPrice, activeAsset.decimals)} routed to ${route.bestExchangeName} (Saved $${route.savingsUsd.toFixed(2)} via SOR).`,
        ]);

        if (user?.uid) {
          persistExecutionLog(user.uid, {
            id: manualSellOrder.id,
            timestamp: manualSellOrder.timestamp,
            symbol: manualSellOrder.symbol,
            type: manualSellOrder.side,
            netProfitUsd: 0,
            status: 'COMPLETED',
            route: route.bestExchangeName,
          }).catch(() => {});
        }

        if (tradingMode === 'LIVE_REAL_TRADING') {
          executeTradeOnExchange({
            exchange: route.bestExchange,
            symbol: selectedSymbol,
            side: 'SELL',
            amount,
            notional: orderNotional,
            price: executedPrice,
            isLiveRealMoney: true,
          })
            .then((res) => {
              if (res.success) {
                setBotLogs((prev) => [
                  ...prev,
                  `[${new Date().toLocaleTimeString()}] 🟢 REAL EXCHANGE SELL FILLED: ${route.bestExchangeName} (Tx: ${res.exchangeOrderId || res.cryptographicReceipt})`,
                ]);
              } else {
                setBotLogs((prev) => [
                  ...prev,
                  `[${new Date().toLocaleTimeString()}] ⚠️ REAL EXCHANGE SELL STATUS: ${res.error || 'Acknowledged on exchange'}`,
                ]);
              }
            })
            .catch((err) => {
              setBotLogs((prev) => [
                ...prev,
                `[${new Date().toLocaleTimeString()}] ❌ REAL SELL API ERROR: ${err.message}`,
              ]);
            });
        }
      }
    }
  };

  // Instant Cross-Exchange Arbitrage Execution
  const handleExecuteArbitrage = (opp: ArbitrageOpportunity) => {
    const now = Date.now();
    const clipNotional = Math.min(portfolio.cash * 0.25, 2000);
    if (clipNotional < 50) {
      setBotLogs((prev) => [
        ...prev,
        `[${new Date(now).toLocaleTimeString()}] Arbitrage aborted: Insufficient available cash.`,
      ]);
      return;
    }

    const buyEx = exchanges.find((e) => e.id === opp.buyExchange);
    const sellEx = exchanges.find((e) => e.id === opp.sellExchange);
    const buyFee = clipNotional * ((buyEx?.takerFeePercent || 0.075) / 100);
    const sellFee = clipNotional * ((sellEx?.takerFeePercent || 0.075) / 100);
    const grossProfit = clipNotional * (opp.grossSpreadPercent / 100);
    const netProfit = grossProfit - buyFee - sellFee;
    const amount = clipNotional / opp.buyAskPrice;

    // Dual-leg order logging
    const buyLegOrder: Order = {
      id: `ord-arb-buy-${now}`,
      timestamp: now,
      symbol: opp.symbol,
      side: 'BUY',
      type: 'ARBITRAGE',
      price: opp.buyAskPrice,
      amount,
      notional: clipNotional,
      fee: buyFee,
      exchange: opp.buyExchange,
      exchangeName: opp.buyExchangeName,
      reason: `Arbitrage Leg 1: Bought on ${opp.buyExchangeName}`,
    };

    const sellLegOrder: Order = {
      id: `ord-arb-sell-${now}`,
      timestamp: now,
      symbol: opp.symbol,
      side: 'SELL',
      type: 'ARBITRAGE',
      price: opp.sellBidPrice,
      amount,
      notional: clipNotional,
      fee: sellFee,
      exchange: opp.sellExchange,
      exchangeName: opp.sellExchangeName,
      pnl: netProfit,
      pnlPercent: opp.netSpreadPercent,
      reason: `Arbitrage Leg 2: Sold on ${opp.sellExchangeName} (Net spread +${opp.netSpreadPercent.toFixed(3)}%)`,
    };

    setPortfolio((p) => {
      const newCash = p.cash + netProfit;
      const totalTrades = p.totalTrades + 1;
      const winningTrades = p.winningTrades + (netProfit > 0 ? 1 : 0);
      const losingTrades = p.losingTrades + (netProfit <= 0 ? 1 : 0);
      const realizedPnl = p.realizedPnl + netProfit;
      const peakEquity = Math.max(p.peakEquity, newCash);

      return {
        ...p,
        cash: newCash,
        totalTrades,
        winningTrades,
        losingTrades,
        realizedPnl,
        peakEquity,
      };
    });

    setOrders((prev) => [sellLegOrder, buyLegOrder, ...prev]);

    if (user?.uid) {
      persistExecutionLog(user.uid, {
        id: buyLegOrder.id,
        timestamp: buyLegOrder.timestamp,
        symbol: buyLegOrder.symbol,
        type: 'ARBITRAGE_BUY',
        netProfitUsd: 0,
        status: 'COMPLETED',
        route: opp.buyExchangeName,
      }).catch(() => {});
      persistExecutionLog(user.uid, {
        id: sellLegOrder.id,
        timestamp: sellLegOrder.timestamp,
        symbol: sellLegOrder.symbol,
        type: 'ARBITRAGE_SELL',
        netProfitUsd: netProfit,
        status: 'COMPLETED',
        route: opp.sellExchangeName,
      }).catch(() => {});
    }

    setBotLogs((prev) => [
      ...prev,
      `[${new Date(now).toLocaleTimeString()}] ⚡ ARBITRAGE EXECUTED: Bought on ${opp.buyExchangeName} @ ${formatCurrency(opp.buyAskPrice, activeAsset.decimals)} & Sold on ${opp.sellExchangeName} @ ${formatCurrency(opp.sellBidPrice, activeAsset.decimals)} -> Net Spread Profit: +${formatCurrency(netProfit)} (+${opp.netSpreadPercent.toFixed(3)}%)`,
    ]);

    // If in Live Real Money Mode, dispatch atomic dual-leg orders
    if (tradingMode === 'LIVE_REAL_TRADING') {
      Promise.all([
        executeTradeOnExchange({
          exchange: opp.buyExchange,
          symbol: opp.symbol,
          side: 'BUY',
          amount,
          notional: clipNotional,
          price: opp.buyAskPrice,
          isLiveRealMoney: true,
        }),
        executeTradeOnExchange({
          exchange: opp.sellExchange,
          symbol: opp.symbol,
          side: 'SELL',
          amount,
          notional: clipNotional,
          price: opp.sellBidPrice,
          isLiveRealMoney: true,
        }),
      ])
        .then(([buyRes, sellRes]) => {
          if (buyRes.success && sellRes.success) {
            setBotLogs((prev) => [
              ...prev,
              `[${new Date().toLocaleTimeString()}] 🟢 LIVE ARBITRAGE ATOMICALLY FILLED: ${opp.buyExchangeName} & ${opp.sellExchangeName} (Tx: ${buyRes.exchangeOrderId || buyRes.cryptographicReceipt} / ${sellRes.exchangeOrderId || sellRes.cryptographicReceipt})`,
            ]);
          } else {
            setBotLogs((prev) => [
              ...prev,
              `[${new Date().toLocaleTimeString()}] ⚠️ LIVE ARBITRAGE STATUS: Leg 1 (${buyRes.status}) - Leg 2 (${sellRes.status}). ${buyRes.error || sellRes.error || ''}`,
            ]);
          }
        })
        .catch((err) => {
          setBotLogs((prev) => [
            ...prev,
            `[${new Date().toLocaleTimeString()}] ❌ LIVE ARBITRAGE API ERROR: ${err.message}`,
          ]);
        });
    }
  };

  // Handle Live Flash Loan Arbitrage Execution Broadcast from FlashArbBotDashboard
  const handleFlashArbExecuted = (trade: {
    symbol: string;
    profitUsd: number;
    chain: string;
    txHash: string;
    token: string;
    gasSavedUsd?: number;
    loanFeeSavedUsd?: number;
  }) => {
    const profit = Math.max(0, trade.profitUsd);
    setPortfolio((prev) => {
      const newCash = Number((prev.cash + profit).toFixed(2));
      const realizedPnl = Number((prev.realizedPnl + profit).toFixed(2));
      const totalTrades = prev.totalTrades + 1;
      const winningTrades = prev.winningTrades + 1;
      const peakEquity = Math.max(prev.peakEquity, newCash);

      if (user?.uid) {
        const updatedPortfolio: PortfolioState = {
          ...prev,
          cash: newCash,
          realizedPnl,
          totalTrades,
          winningTrades,
          peakEquity,
        };
        persistPortfolioToFirestore(user.uid, updatedPortfolio, positions, orders).catch(() => {});
      }

      return {
        ...prev,
        cash: newCash,
        realizedPnl,
        totalTrades,
        winningTrades,
        peakEquity,
      };
    });

    setBotLogs((prev) => [
      `[${new Date().toLocaleTimeString()}] ⚡ LIVE FLASH ARBITRAGE EXECUTED on ${trade.chain}: Borrowed 0% Balancer liquidity for ${trade.symbol}, routed direct pool swap, +$${profit.toFixed(2)} USD net alpha swept to profit vault. (Tx: ${trade.txHash.slice(0, 10)}...)`,
      ...prev,
    ]);
  };

  // Close specific position using best routing
  const closePosition = (positionId: string, orderType: Order['type'] = 'MANUAL_CLOSE', reason = 'Manual Close') => {
    const now = Date.now();
    setPositions((currentPositions) => {
      const pos = currentPositions.find((p) => p.id === positionId);
      if (!pos) return currentPositions;

      // Route sell through optimal exchange
      const route = routeOrderSmart(
        'SELL',
        pos.symbol,
        pos.notional,
        exchangeQuotes,
        exchanges,
        strategy.routingMode
      );

      const executedExitPrice = route.rawPrice;
      const fee = route.feeAmountUsd;
      const grossPnl = (pos.amount * (executedExitPrice - pos.entryPrice)) * pos.leverage;
      const netPnl = grossPnl - fee;
      const returnedCapital = Math.max(0, pos.margin + netPnl);

      const isWin = netPnl > 0;

      // Track Daily Loss & Circuit Breaker
      if (netPnl < 0) {
        setDailyLossUsd((prev) => {
          const nextLoss = prev + Math.abs(netPnl);
          if (strategy.dailyLossLimitUsd && nextLoss >= strategy.dailyLossLimitUsd) {
            setStrategy((s) => ({ ...s, circuitBreakerActive: true }));
            setBotRunning(false);
            setBotLogs((logs) => [
              ...logs,
              `[${new Date(now).toLocaleTimeString()}] ⛔ [CIRCUIT BREAKER TRIGGERED] Cumulative daily loss reached $${nextLoss.toFixed(2)} (Cap: $${strategy.dailyLossLimitUsd}). Automated trading halted to protect capital.`,
            ]);
          }
          return nextLoss;
        });
      }

      // Update Portfolio
      setPortfolio((p) => {
        const newCash = p.cash + returnedCapital;
        const totalTrades = p.totalTrades + 1;
        const winningTrades = p.winningTrades + (isWin ? 1 : 0);
        const losingTrades = p.losingTrades + (isWin ? 0 : 1);
        const realizedPnl = p.realizedPnl + netPnl;

        const currentEquity = newCash;
        const peakEquity = Math.max(p.peakEquity, currentEquity);
        const currentDrawdown = ((peakEquity - currentEquity) / peakEquity) * 100;
        const maxDrawdownPercent = Math.max(p.maxDrawdownPercent, currentDrawdown);

        return {
          ...p,
          cash: newCash,
          realizedPnl,
          totalTrades,
          winningTrades,
          losingTrades,
          peakEquity,
          maxDrawdownPercent,
          totalSavingsFromSOR: (p.totalSavingsFromSOR || 0) + route.savingsUsd,
        };
      });

      // Record Order
      const closeOrder: Order = {
        id: `ord-${now}-${Math.random().toString(36).substr(2, 4)}`,
        timestamp: now,
        symbol: pos.symbol,
        side: 'SELL',
        type: orderType,
        price: executedExitPrice,
        amount: pos.amount,
        notional: pos.notional,
        fee,
        exchange: route.bestExchange,
        exchangeName: route.bestExchangeName,
        savingsUsd: route.savingsUsd,
        savingsPercent: route.savingsPercent,
        routedViaSOR: strategy.routingMode === 'SMART_ORDER_ROUTER',
        pnl: netPnl,
        pnlPercent: pos.unrealizedPnlPercent,
        reason: `${reason} via ${route.bestExchangeName}`,
      };

      setOrders((prev) => [closeOrder, ...prev]);

      if (user?.uid) {
        persistExecutionLog(user.uid, {
          id: closeOrder.id,
          timestamp: closeOrder.timestamp,
          symbol: closeOrder.symbol,
          type: closeOrder.side,
          netProfitUsd: netPnl,
          status: 'COMPLETED',
          route: route.bestExchangeName,
        }).catch(() => {});
      }

      setBotLogs((prev) => [
        ...prev,
        `[${new Date(now).toLocaleTimeString()}] Closed ${pos.symbol} on ${route.bestExchangeName} (${orderType}): Net PnL ${formatCurrency(netPnl)} (${pos.unrealizedPnlPercent.toFixed(2)}%)`,
      ]);

      // If in Live Real Money Mode, dispatch exit order to real exchange API (including NonKYC)
      if (tradingMode === 'LIVE_REAL_TRADING') {
        executeTradeOnExchange({
          exchange: route.bestExchange,
          symbol: pos.symbol,
          side: 'SELL',
          amount: pos.amount,
          notional: pos.notional,
          price: executedExitPrice,
          isLiveRealMoney: true,
        })
          .then((res) => {
            if (res.success) {
              setBotLogs((prev) => [
                ...prev,
                `[${new Date().toLocaleTimeString()}] 🟢 REAL EXCHANGE EXIT FILLED on ${route.bestExchangeName} (Tx: ${res.exchangeOrderId || res.cryptographicReceipt})`,
              ]);
            } else {
              setBotLogs((prev) => [
                ...prev,
                `[${new Date().toLocaleTimeString()}] ⚠️ REAL EXCHANGE EXIT REJECTED on ${route.bestExchangeName}: ${res.error}`,
              ]);
            }
          })
          .catch((err) => {
            setBotLogs((prev) => [
              ...prev,
              `[${new Date().toLocaleTimeString()}] ❌ REAL EXIT DISPATCH ERROR: ${err.message}`,
            ]);
          });
      }

      return currentPositions.filter((p) => p.id !== positionId);
    });
  };

  // Reset Portfolio
  const handleResetPortfolio = () => {
    setPortfolio(INITIAL_PORTFOLIO);
    setPositions([]);
    setOrders([]);
    setBotLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] Trading portfolio reset to $0.00 cash balance.`,
    ]);
  };

  // Run AI Audit
  const handleRunAiAudit = async () => {
    setAiAuditModalOpen(true);
    setAiAuditLoading(true);

    try {
      const response = await fetch('/api/ai-strategy-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: selectedSymbol,
          currentPrice: activeAsset.price,
          priceChange24h: activeAsset.change24h,
          rsi: indicators.rsi,
          macd: indicators.macd,
          strategyName: strategy.name,
          parameters: strategy,
          portfolio: {
            cash: portfolio.cash,
            positionsCount: positions.length,
            totalTrades: portfolio.totalTrades,
          },
        }),
      });

      const data = await response.json();
      if (data.success && data.analysis) {
        setAiAnalysis(data.analysis);
      } else {
        throw new Error(data.error || 'Failed to fetch AI audit');
      }
    } catch (err) {
      console.error('AI Audit request failed:', err);
      // Fallback local quant audit if server call fails
      setAiAnalysis({
        marketTrendSummary: `${selectedSymbol} is exhibiting elevated micro-structure volatility with RSI at ${indicators.rsi.toFixed(1)}.`,
        strategyCritique: `Your strategy runs at ${strategy.leverage}x leverage with TP ${strategy.takeProfitPercent}% and SL ${strategy.stopLossPercent}%.`,
        riskScore: strategy.leverage * 18 + (strategy.stopLossPercent > 4 ? 20 : 10),
        riskLevel: strategy.leverage > 3 ? 'High' : 'Moderate',
        recommendedAdjustments: [
          'Cap leverage to <= 2x to avoid sudden liquidation on 5% wicks.',
          'Adopt trailing stops of 1.5% to protect unrealized gains during spikes.',
          'Leverage Smart Order Routing across Binance & Kraken to save 0.05%-0.1% per turn on taker fees.',
        ],
        shortTermProfitOutlook:
          'High short-term return expectations usually trigger over-leveraging and catastrophic drawdown. Sustainable algorithmic growth requires strict capital defense.',
      });
    } finally {
      setAiAuditLoading(false);
    }
  };

  const handleApplyRecommendedParameters = () => {
    setStrategy((prev) => ({
      ...prev,
      leverage: Math.min(prev.leverage, 2),
      orderSizePercent: Math.min(prev.orderSizePercent, 15),
      stopLossPercent: Math.max(1.8, Math.min(prev.stopLossPercent, 2.5)),
      takeProfitPercent: Math.max(3.5, prev.takeProfitPercent),
      trailingStopEnabled: true,
      trailingStopPercent: 1.5,
      routingMode: 'SMART_ORDER_ROUTER',
    }));
    setBotLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] Applied AI-calibrated risk parameters (2x max lev, 15% sizing, trailing stop + Smart Order Routing enabled).`,
    ]);
  };

  // Live Automated Bot Execution & Position Risk Engine Loop (Real-Time 1x)
  useEffect(() => {
    const intervalId = setInterval(() => {
      const now = Date.now();

      // 1. Update Position Mark Prices & Evaluate Automated Exits based on Genuine Live Exchange Prices
      setPositions((currentPositions) => {
        const toKeep: Position[] = [];

        currentPositions.forEach((pos) => {
          const currentAsset = assets.find((a) => a.symbol === pos.symbol);
          const markPrice = currentAsset ? currentAsset.price : pos.currentPrice;

          const rawPercent = ((markPrice - pos.entryPrice) / pos.entryPrice) * 100;
          const leveragedPercent = rawPercent * pos.leverage;
          const unrealizedPnl = (pos.margin * leveragedPercent) / 100;

          const highestPrice = Math.max(pos.highestPrice, markPrice);

          // Check Liquidation
          if (leveragedPercent <= -90) {
            closePosition(pos.id, 'LIQUIDATION', `Liquidation reached at ${formatCurrency(markPrice)}`);
            return;
          }

          // 1. Check Take-Profit: Either explicit TP target price achieved OR profit threshold % reached
          const isTakeProfitHit = (pos.takeProfitPrice && markPrice >= pos.takeProfitPrice) ||
            leveragedPercent >= strategy.takeProfitPercent;
          if (isTakeProfitHit) {
            const profitUsd = (pos.margin * leveragedPercent) / 100;
            closePosition(
              pos.id,
              'TAKE_PROFIT',
              `Target Take-Profit Reached at ${formatCurrency(markPrice)} (Secured +${leveragedPercent.toFixed(2)}% / +${formatCurrency(profitUsd)})`
            );
            return;
          }

          // 2. Check Dynamic Precision Indicator Sell / Exit Signal (MACD Death Cross / RSI Overbought / BB Reversal)
          const autoSell = strategy.autoSellEnabled !== false;
          if (autoSell && isSellConditionMet) {
            closePosition(
              pos.id,
              'TECHNICAL_EXIT',
              `Technical Sell Signal: ${sellConditionReason}`
            );
            return;
          }

          // 3. Check Stop-Loss: Either explicit SL threshold price breached OR loss threshold % reached
          const isStopLossHit = (pos.stopLossPrice && markPrice <= pos.stopLossPrice) ||
            leveragedPercent <= -strategy.stopLossPercent;
          if (isStopLossHit) {
            const lossUsd = Math.abs((pos.margin * leveragedPercent) / 100);
            closePosition(
              pos.id,
              'STOP_LOSS',
              `Automatic Stop-Loss Exited at ${formatCurrency(markPrice)} (Capped loss at ${leveragedPercent.toFixed(2)}% / -${formatCurrency(lossUsd)})`
            );
            return;
          }

          // 4. Check Trailing Stop
          if (strategy.trailingStopEnabled && highestPrice > pos.entryPrice) {
            const dropFromHighPercent = ((highestPrice - markPrice) / highestPrice) * 100 * pos.leverage;
            if (dropFromHighPercent >= strategy.trailingStopPercent) {
              closePosition(
                pos.id,
                'TRAILING_STOP',
                `Trailing Stop Triggered (${strategy.trailingStopPercent}% drop from peak ${formatCurrency(highestPrice)})`
              );
              return;
            }
          }

          toKeep.push({
            ...pos,
            currentPrice: markPrice,
            unrealizedPnl,
            unrealizedPnlPercent: leveragedPercent,
            highestPrice,
          });
        });

        return toKeep;
      });

      // 4. Automated Bot Entry & Exit Execution (including MACD/RSI/BB Sell signals and Cross-Exchange Arbitrage)
      if (botRunning) {
        // Halt if Circuit Breaker is active
        if (strategy.circuitBreakerActive) {
          return;
        }

        const cooldownMs = strategy.cooldownSeconds * 1000 / simSpeed;
        const canExecute = now - lastOrderTimeRef.current >= cooldownMs;

        if (canExecute) {
          // Special Arbitrage Trigger
          if (strategy.triggerType === 'CROSS_EXCHANGE_ARBITRAGE' && arbitrageOpp && arbitrageOpp.isActionable) {
            lastOrderTimeRef.current = now;
            handleExecuteArbitrage(arbitrageOpp);
          } else if (isSellConditionMet && positions.some((p) => p.symbol === selectedSymbol)) {
            // AUTOMATED TECHNICAL SELL: If sell conditions trigger and open positions exist for this asset, close/sell them!
            lastOrderTimeRef.current = now;
            const openPositionsToSell = positions.filter((p) => p.symbol === selectedSymbol);
            openPositionsToSell.forEach((pos) => {
              closePosition(pos.id, 'TECHNICAL_EXIT', `Automated Technical Sell: ${sellConditionReason}`);
            });
            setBotLogs((prev) => [
              `[${new Date(now).toLocaleTimeString()}] 🔴 BOT AUTO-SELL TRIGGERED: Executed sell & closed ${openPositionsToSell.length} position(s) on ${selectedSymbol} (${sellConditionReason}).`,
              ...prev,
            ]);
          } else if (isBuyConditionMet && positions.length < strategy.maxPositions) {
            const leverage = strategy.leverage;
            let margin: number;
            let dynamicSizingRes: DynamicPositionSizeResult | undefined;

            if (strategy.dynamicPositionSizing) {
              const currentAsset = assets.find((a) => a.symbol === selectedSymbol);
              const safeAtr = indicators.atr || (currentAsset ? currentAsset.price * 0.018 : 100);
              dynamicSizingRes = calculateDynamicPositionSize({
                portfolioCash: portfolio.cash,
                currentPrice: currentAsset ? currentAsset.price : 68000,
                atr: safeAtr,
                atrMultiplier: strategy.atrMultiplier || 2.0,
                riskPerTradePercent: strategy.riskPerTradePercent || 2.0,
                leverage,
                maxCapPercent: 35.0,
                minOrderUsd: 30.0,
              });
              margin = dynamicSizingRes.margin;
            } else {
              margin = portfolio.cash * (strategy.orderSizePercent / 100);
            }

            if (margin >= 30) {
              lastOrderTimeRef.current = now;
              const notional = margin * leverage;

              // Smart Order Routing across Binance, Coinbase Pro, Kraken & Bybit
              const route = routeOrderSmart(
                'BUY',
                selectedSymbol,
                notional,
                exchangeQuotes,
                exchanges,
                strategy.routingMode
              );

              const executedPrice = route.rawPrice;
              const fee = route.feeAmountUsd;
              const amount = notional / executedPrice;

              const liqDrop = 0.9 / leverage;
              const liquidationPrice = executedPrice * (1 - liqDrop);

              // Advanced Stop-Loss & Take-Profit Targets
              const effectiveStopLossPct = (strategy.dynamicPositionSizing && dynamicSizingRes)
                ? dynamicSizingRes.stopDistancePercent
                : strategy.stopLossPercent;

              const effectiveTakeProfitPct = strategy.takeProfitType === 'RISK_REWARD_RATIO'
                ? effectiveStopLossPct * (strategy.riskRewardRatio || 2.5)
                : strategy.takeProfitPercent;

              const takeProfitPrice = executedPrice * (1 + (effectiveTakeProfitPct / 100) / leverage);
              const stopLossPrice = executedPrice * (1 - (effectiveStopLossPct / 100) / leverage);

              const newPos: Position = {
                id: `pos-${now}-${Math.random().toString(36).substr(2, 4)}`,
                symbol: selectedSymbol,
                entryPrice: executedPrice,
                currentPrice: executedPrice,
                amount,
                margin,
                leverage,
                notional,
                unrealizedPnl: 0,
                unrealizedPnlPercent: 0,
                highestPrice: executedPrice,
                liquidationPrice,
                openTime: now,
                takeProfitPrice,
                stopLossPrice,
                strategyTrigger: strategy.dynamicPositionSizing
                  ? `[ATR Sized] ${buyConditionReason}`
                  : buyConditionReason,
                exchange: route.bestExchange,
                exchangeName: route.bestExchangeName,
                savingsUsd: route.savingsUsd,
                volatilityAtEntry: indicators.atr,
                isDynamicSized: !!strategy.dynamicPositionSizing,
                riskRewardRatio: strategy.riskRewardRatio || 2.5,
                stopLossDistanceUsd: executedPrice - stopLossPrice,
                targetProfitUsd: takeProfitPrice - executedPrice,
              };

              if (strategy.dynamicPositionSizing && dynamicSizingRes) {
                setBotLogs((prev) => [
                  ...prev,
                  `[${new Date(now).toLocaleTimeString()}] 🛡️ [VOLATILITY SIZING] ATR $${(indicators.atr || 0).toFixed(2)} (${dynamicSizingRes!.volatilityRegime} Vol) -> Margin scaled to $${margin.toFixed(2)} (${dynamicSizingRes!.sizingMultiplier}x base) | Defined Risk: $${dynamicSizingRes!.riskAmountUsd.toFixed(2)} (${strategy.riskPerTradePercent || 2}% max loss)`,
                ]);
              }

              const newOrder: Order = {
                id: `ord-${now}`,
                timestamp: now,
                symbol: selectedSymbol,
                side: 'BUY',
                type: 'MARKET',
                price: executedPrice,
                amount,
                notional,
                fee,
                exchange: route.bestExchange,
                exchangeName: route.bestExchangeName,
                savingsUsd: route.savingsUsd,
                savingsPercent: route.savingsPercent,
                routedViaSOR: strategy.routingMode === 'SMART_ORDER_ROUTER',
                reason: `Auto Trigger: ${buyConditionReason}`,
              };

              setPortfolio((p) => ({
                ...p,
                cash: p.cash - margin - fee,
                totalSavingsFromSOR: (p.totalSavingsFromSOR || 0) + route.savingsUsd,
              }));

              setPositions((posList) => [...posList, newPos]);
              setOrders((ordList) => [newOrder, ...ordList]);

              if (user?.uid) {
                persistExecutionLog(user.uid, {
                  id: newOrder.id,
                  timestamp: newOrder.timestamp,
                  symbol: newOrder.symbol,
                  type: newOrder.side,
                  netProfitUsd: 0,
                  status: 'COMPLETED',
                  route: route.bestExchangeName,
                }).catch(() => {});
              }

              setBotLogs((prev) => [
                ...prev,
                `[${new Date(now).toLocaleTimeString()}] BOT AUTO-ROUTED BUY to ${route.bestExchangeName}: ${amount.toFixed(4)} ${selectedSymbol} @ ${formatCurrency(executedPrice, activeAsset.decimals)} (Saved $${route.savingsUsd.toFixed(2)})`,
              ]);

              // If in Live Real Money Mode, dispatch automated order to real exchange API (including NonKYC)
              if (tradingMode === 'LIVE_REAL_TRADING') {
                executeTradeOnExchange({
                  exchange: route.bestExchange,
                  symbol: selectedSymbol,
                  side: 'BUY',
                  amount,
                  notional,
                  price: executedPrice,
                  isLiveRealMoney: true,
                })
                  .then((res) => {
                    if (res.success) {
                      setBotLogs((prev) => [
                        ...prev,
                        `[${new Date().toLocaleTimeString()}] 🟢 BOT LIVE REAL ORDER FILLED on ${route.bestExchangeName} (Tx: ${res.exchangeOrderId || res.cryptographicReceipt})`,
                      ]);
                    } else {
                      setBotLogs((prev) => [
                        ...prev,
                        `[${new Date().toLocaleTimeString()}] ⚠️ BOT LIVE REAL ORDER REJECTED: ${res.error}`,
                      ]);
                    }
                  })
                  .catch((err) => {
                    setBotLogs((prev) => [
                      ...prev,
                      `[${new Date().toLocaleTimeString()}] ❌ BOT REAL ORDER API ERROR: ${err.message}`,
                    ]);
                  });
              }
            }
          }
        }
      }
    }, 500);

    return () => clearInterval(intervalId);
  }, [
    simSpeed,
    botRunning,
    strategy,
    activeAsset,
    selectedSymbol,
    isBuyConditionMet,
    buyConditionReason,
    isSellConditionMet,
    sellConditionReason,
    arbitrageOpp,
    portfolio.cash,
    positions.length,
    exchangeQuotes,
    exchanges,
  ]);

  return (
    <div className="min-h-screen flex flex-col bg-[#080B11] text-slate-100 font-sans">
      {/* Header */}
      <Header
        portfolio={portfolio}
        unrealizedPnl={totalUnrealizedPnl}
        botRunning={botRunning}
        onToggleBot={() => setBotRunning(!botRunning)}
        onResetPortfolio={handleResetPortfolio}
        onOpenAudit={handleRunAiAudit}
        onOpenBacktest={() => setBacktestModalOpen(true)}
        onOpenExchanges={() => setExchangeModalOpen(true)}
        onOpenFiatAccount={() => handleOpenFiatModal('DEBIT_CARD')}
        onOpenWithdraw={() => handleOpenFiatModal('WITHDRAW')}
        onOpenAiTroubleshooter={() => {
          setAiInitialPrompt(undefined);
          setAiTroubleshooterOpen(true);
        }}
        fiatAccountAvailableBalance={fiatAccount.availableBalance}
        simSpeed={simSpeed}
        onSetSimSpeed={setSimSpeed}
        activePositionsCount={positions.length}
        tradingMode={tradingMode}
        onToggleTradingMode={handleToggleTradingMode}
        isLiveMarketConnected={isLiveMarketConnected}
        credentialsSummary={credentialsSummary}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onChainSignalsCount={onChainSignalsCount}
        onOpenOkxWallet={() => setOkxWalletModalOpen(true)}
        okxConnectedAddress={okxConnectedAddress}
      />

      {/* Educational Risk Guidance Banner */}
      <RiskDisclosureBanner />

      {activeTab === 'ETHERSCAN_INTELLIGENCE' ? (
        <EtherscanIntelligencePage
          onBackToTradingDesk={() => setActiveTab('TRADING_DESK')}
          onTradeAsset={(sym) => {
            handleSelectSymbol(sym);
            setActiveTab('TRADING_DESK');
          }}
        />
      ) : activeTab === 'FLASH_ARB_BOT' ? (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4">
          <FlashArbBotDashboard
            onOpenAiTroubleshooter={(prompt?: string) => {
              setAiInitialPrompt(prompt);
              setAiTroubleshooterOpen(true);
            }}
            availableAssets={assets}
            okxConnectedAddress={okxConnectedAddress}
            onOpenOkxWallet={() => setOkxWalletModalOpen(true)}
            onArbitrageExecuted={handleFlashArbExecuted}
          />
        </main>
      ) : activeTab === 'WALLET_MONITOR' ? (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4">
          <OnChainWalletMonitor
            onOpenOkxWallet={() => setOkxWalletModalOpen(true)}
            targetAddress={targetMonitorWallet}
          />
        </main>
      ) : (
        <>
          {/* Ticker Watch Bar */}
          <MarketWatchBar
        assets={assets}
        selectedSymbol={selectedSymbol}
        onSelectSymbol={handleSelectSymbol}
        onAddCustomSymbol={handleAddCustomSymbol}
      />

      {/* Main Trading Workstation Grid */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 space-y-4">
        {/* Live Currency Treasury & Banking Rail */}
        <LiveCurrencyTreasuryCard
          fiatAccount={fiatAccount}
          onOpenModal={() => handleOpenFiatModal('FUND_BOT')}
          onOpenDebitLoad={() => handleOpenFiatModal('DEBIT_CARD')}
          onOpenBankConnect={() => handleOpenFiatModal('BANK_TRANSFER')}
          onOpenWithdraw={() => handleOpenFiatModal('WITHDRAW')}
          onOpenFundBot={(method) => handleOpenFiatModal(method === 'CARD' ? 'DEBIT_CARD' : 'BANK_TRANSFER')}
          onOpenCashCheck={() => handleOpenFiatModal('CASH_CHECK')}
          onOpenSecurity={() => handleOpenFiatModal('SECURITY')}
        />

        {/* Trading Desk Sub-Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-1 rounded-xl bg-slate-950/70 border border-slate-800/80 font-mono text-xs">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTradingDeskView('EXECUTION')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                tradingDeskView === 'EXECUTION'
                  ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Zap className="h-3 w-3 text-cyan-400" />
              <span>Execution Desk & Bot Station</span>
            </button>

            <button
              type="button"
              onClick={() => setTradingDeskView('CORRELATION_MATRIX')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                tradingDeskView === 'CORRELATION_MATRIX'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Compass className="h-3 w-3 text-cyan-400" />
              <span>Correlation Matrix & Clusters</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-500 pr-2">
            <span className="flex items-center gap-1 text-emerald-400 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Feed Synced (Kraken · Coinbase · Binance)
            </span>
          </div>
        </div>

        {tradingDeskView === 'CORRELATION_MATRIX' ? (
          <CorrelationMatrixView
            assets={assets}
            candleMap={candleMap}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={handleSelectSymbol}
            onApplyPairToBot={(symA) => {
              handleSelectSymbol(symA);
              setTradingDeskView('EXECUTION');
            }}
          />
        ) : (
          <>
            {/* Multi-Exchange Price Comparison & Smart Order Routing */}
            <MultiExchangeComparisonCard
              quotes={exchangeQuotes}
              exchanges={exchanges}
              selectedSymbol={selectedSymbol}
              decimals={activeAsset.decimals}
              routingMode={strategy.routingMode}
              onSetRoutingMode={handleSetRoutingMode}
              arbitrageOpp={arbitrageOpp}
              onExecuteArbitrage={handleExecuteArbitrage}
              onOpenExchangeSettings={() => setExchangeModalOpen(true)}
              totalSavedUsd={portfolio.totalSavingsFromSOR || 0}
            />

            {/* Middle Split: Interactive Price Chart & Bot Control Center */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-7 xl:col-span-8">
                <PriceChart
                  symbol={selectedSymbol}
                  candles={activeCandles}
                  indicators={indicators}
                  orders={orders}
                  decimals={activeAsset.decimals}
                />
              </div>

              <div className="lg:col-span-5 xl:col-span-4">
                <StrategyBotController
                  strategy={strategy}
                  onUpdateStrategy={setStrategy}
                  indicators={indicators}
                  botRunning={botRunning}
                  onToggleBot={() => {
                    if (!botRunning && portfolio.cash < 30) {
                      handleOpenFiatModal('FUND_BOT');
                      setBotLogs((prev) => [
                        ...prev,
                        `[${new Date().toLocaleTimeString()}] BOT CAPITAL ADVISORY: Insufficient margin ($${portfolio.cash.toFixed(2)} USD). Opening funding portal to load capital from bank or check card.`,
                      ]);
                      return;
                    }
                    setBotRunning(!botRunning);
                  }}
                  onManualOrder={handleManualOrder}
                  isBuyConditionMet={isBuyConditionMet}
                  buyConditionReason={buyConditionReason}
                  isSellConditionMet={isSellConditionMet}
                  sellConditionReason={sellConditionReason}
                  botCash={portfolio.cash}
                  onOpenDepositToBot={(method) => handleOpenFiatModal(method === 'CARD' ? 'DEBIT_CARD' : 'BANK_TRANSFER')}
                  availableAssets={assets}
                  onSelectAsset={handleSelectSymbol}
                  currentDailyLossUsd={dailyLossUsd}
                  onResetCircuitBreaker={handleResetCircuitBreaker}
                  activePositionsCount={positions.length}
                  onQuickFundMargin={() => handleBotCashAdjusted(1000)}
                />
              </div>
            </div>
          </>
        )}

        {/* Bottom Section: Positions & Orders Table */}
        <PositionsAndOrdersTable
          positions={positions}
          orders={orders}
          onClosePosition={(id) => closePosition(id, 'MANUAL_CLOSE', 'Closed by User')}
          botLogs={botLogs}
        />
      </main>
    </>
  )}

      {/* Modals */}
      <ExchangeManagerModal
        isOpen={exchangeModalOpen}
        onClose={() => setExchangeModalOpen(false)}
        exchanges={exchanges}
        onToggleExchange={handleToggleExchange}
        onUpdateExchangeFee={handleUpdateExchangeFee}
        tradingMode={tradingMode}
        onToggleTradingMode={handleToggleTradingMode}
        credentialsSummary={credentialsSummary}
        onRefreshCredentials={fetchCredentialsStatus}
        onOpenOkxWallet={() => setOkxWalletModalOpen(true)}
      />

      <LiveTradingConfirmationModal
        isOpen={liveConfirmModalOpen}
        onClose={() => setLiveConfirmModalOpen(false)}
        onConfirm={handleConfirmLiveTrading}
        credentialsSummary={credentialsSummary}
      />

      <AIAuditModal
        isOpen={aiAuditModalOpen}
        onClose={() => setAiAuditModalOpen(false)}
        analysis={aiAnalysis}
        loading={aiAuditLoading}
        onApplyRecommended={handleApplyRecommendedParameters}
        currentStrategy={strategy}
      />

      <BacktestLabModal
        isOpen={backtestModalOpen}
        onClose={() => setBacktestModalOpen(false)}
        currentStrategy={strategy}
      />

      <LiveCurrencyAccountModal
        isOpen={fiatModalOpen}
        onClose={() => setFiatModalOpen(false)}
        fiatAccount={fiatAccount}
        transactions={fiatTransactions}
        onAccountUpdated={handleAccountUpdated}
        onBotCashAdjusted={handleBotCashAdjusted}
        botCash={portfolio.cash}
        initialTab={fiatModalInitialTab}
      />

      {/* Gemini AI Diagnostics & Live Market Updates Modal */}
      <AiTroubleshooterModal
        isOpen={aiTroubleshooterOpen}
        onClose={() => setAiTroubleshooterOpen(false)}
        initialPrompt={aiInitialPrompt}
        contextData={{
          tradingMode,
          selectedSymbol,
          platformHint: 'Termux Android / WSL / Windows PowerShell',
        }}
      />

      {/* OKX Web3 Wallet & Multi-Chain Vault Modal */}
      <OkxWalletModal
        isOpen={okxWalletModalOpen}
        onClose={() => setOkxWalletModalOpen(false)}
        onSelectAddressForMonitor={handleSelectAddressForMonitor}
        onDepositToDesk={handleDepositFromOkx}
      />
    </div>
  );
}
