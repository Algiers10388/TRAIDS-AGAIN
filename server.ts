import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { setupFiatRoutes } from "./server/fiatRoutes";
import { setupExchangeRoutes } from "./server/exchangeRoutes";
import { aiRouter } from "./server/aiRoutes";
import { walletRouter } from "./server/walletRoutes";
import { flashArbRouter } from "./server/flashArbRoutes";
import { requireAuth } from "./server/auth";

dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Prevent Express from returning HTML on invalid JSON bodies
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ success: false, error: 'Malformed JSON payload in request' });
    }
    next(err);
  });

  // Public health check (the only unauthenticated API route)
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // Everything else under /api requires a verified Firebase login that is on the owner allowlist
  app.use("/api", requireAuth);

  // Live Currency Account & Bank/Debit Card Gateway
  setupFiatRoutes(app);

  // Live Exchange API Credentials, Real Market Data & Order Execution Gateway
  setupExchangeRoutes(app);

  // Gemini AI Multi-turn Chat & Search Grounding Service
  app.use('/api/ai', aiRouter);

  // On-Chain Wallet Monitor & Holdings Gateway
  app.use('/api/wallet', walletRouter);

  // Flash Loan Arbitrage Gas Monitor & Searcher Signer Gateway
  app.use('/api/flash-arb', flashArbRouter);

  // Multi-Exchange Gateways Status: real reachability + latency probes, real credential presence
  app.get("/api/exchanges", async (_req, res) => {
    const defs = [
      { id: "BINANCE", name: "Binance Global", shortName: "Binance", tagColor: "#F0B90B", apiEndpoint: "https://api.binance.com/api/v3", probe: "https://api.binance.com/api/v3/ping", keyEnv: "BINANCE_API_KEY", makerFeePercent: 0.1, takerFeePercent: 0.1 },
      { id: "COINBASE", name: "Coinbase Advanced", shortName: "Coinbase", tagColor: "#0052FF", apiEndpoint: "https://api.exchange.coinbase.com", probe: "https://api.exchange.coinbase.com/time", keyEnv: "COINBASE_API_KEY", makerFeePercent: 0.4, takerFeePercent: 0.6 },
      { id: "KRAKEN", name: "Kraken", shortName: "Kraken", tagColor: "#5741D9", apiEndpoint: "https://api.kraken.com/0", probe: "https://api.kraken.com/0/public/Time", keyEnv: "KRAKEN_API_KEY", makerFeePercent: 0.25, takerFeePercent: 0.4 },
      { id: "BYBIT", name: "Bybit", shortName: "Bybit", tagColor: "#F7A600", apiEndpoint: "https://api.bybit.com/v5", probe: "https://api.bybit.com/v5/market/time", keyEnv: "BYBIT_API_KEY", makerFeePercent: 0.1, takerFeePercent: 0.1 },
      { id: "NONKYC", name: "NonKYC Exchange", shortName: "NonKYC", tagColor: "#A855F7", apiEndpoint: "https://api.nonkyc.io/api/v2", probe: "https://api.nonkyc.io/api/v2/info", keyEnv: "NONKYC_API_KEY", makerFeePercent: 0.2, takerFeePercent: 0.2 },
    ];
    const exchanges = await Promise.all(
      defs.map(async (d) => {
        const t0 = Date.now();
        let status: "CONNECTED" | "DISCONNECTED" = "DISCONNECTED";
        let latencyMs: number | null = null;
        try {
          const r = await fetch(d.probe, { signal: AbortSignal.timeout(5000) });
          if (r.ok) {
            status = "CONNECTED";
            latencyMs = Date.now() - t0;
          }
        } catch {
          /* leave DISCONNECTED */
        }
        return {
          id: d.id,
          name: d.name,
          shortName: d.shortName,
          tagColor: d.tagColor,
          status,
          latencyMs,
          // Published base-tier retail fees; actual account tier is not queried.
          makerFeePercent: d.makerFeePercent,
          takerFeePercent: d.takerFeePercent,
          enabled: status === "CONNECTED",
          apiEndpoint: d.apiEndpoint,
          tier: "Base fee schedule (account tier not queried)",
          hasApiKeyConfigured: Boolean(process.env[d.keyEnv]),
          volumeSharePercent: null,
        };
      })
    );
    res.json({ success: true, exchanges, timestamp: Date.now() });
  });

  // Cross-Exchange Quotes Aggregator (Live Real Order Books)
  app.get("/api/exchanges/quotes", async (req, res) => {
    try {
      const symbol = String(req.query.symbol || "BTC/USDT");
      const { fetchLiveExchangeQuotes } = await import("./server/liveMarketData");
      const quotes = await fetchLiveExchangeQuotes(symbol);
      res.json({ success: true, symbol, quotes, timestamp: Date.now() });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Download FlashArb Package Bundle (.zip) - Direct Binary Stream
  app.get("/api/download/flash-arb-zip", (_req, res) => {
    try {
      const publicZipPath = path.resolve(process.cwd(), "public/flash-arb.zip");
      const distZipPath = path.resolve(process.cwd(), "dist/flash-arb.zip");
      const targetPath = fs.existsSync(publicZipPath) ? publicZipPath : distZipPath;

      if (!fs.existsSync(targetPath)) {
        return res.status(404).json({ success: false, error: "flash-arb.zip not found" });
      }

      const fileBuffer = fs.readFileSync(targetPath);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="flash-arb.zip"');
      res.setHeader("Content-Length", fileBuffer.length.toString());
      res.setHeader("Content-Transfer-Encoding", "binary");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.end(fileBuffer);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: "Failed to download flash-arb.zip: " + err.message });
      }
    }
  });

  // Base64 JSON Endpoint - 100% immune to browser iframe sandbox HTML redirects
  app.get("/api/download/flash-arb-base64", (_req, res) => {
    try {
      const publicZipPath = path.resolve(process.cwd(), "public/flash-arb.zip");
      const distZipPath = path.resolve(process.cwd(), "dist/flash-arb.zip");
      const targetPath = fs.existsSync(publicZipPath) ? publicZipPath : distZipPath;

      if (!fs.existsSync(targetPath)) {
        return res.status(404).json({ success: false, error: "flash-arb.zip not found" });
      }

      const fileBuffer = fs.readFileSync(targetPath);
      const base64Data = fileBuffer.toString("base64");
      return res.json({
        success: true,
        filename: "flash-arb.zip",
        contentType: "application/zip",
        size: fileBuffer.length,
        base64: base64Data,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // AI Strategy & Market Intelligence Analysis Endpoint (real Gemini call or an honest error)
  app.post("/api/ai-strategy-audit", async (req, res) => {
    try {
      const { symbol, currentPrice, priceChange24h, rsi, macd, strategyName, parameters, portfolio } = req.body || {};
      const ai = getGenAI();
      if (!ai) {
        return res.status(503).json({ success: false, error: "GEMINI_API_KEY is not configured on the server." });
      }

      const prompt = `You are a quantitative crypto trader and risk auditor.
Analyze the following market state and automated strategy parameters. Use only the data given; do not invent figures.
Asset: ${symbol}
Current Price: $${currentPrice}
24h Change: ${priceChange24h}%
RSI (14): ${rsi}
MACD: ${JSON.stringify(macd || {})}
Strategy: ${strategyName}
Parameters: ${JSON.stringify(parameters, null, 2)}
Portfolio: ${JSON.stringify(portfolio || {})}

Respond with valid JSON with exactly these keys:
{
  "marketTrendSummary": string,
  "strategyCritique": string,
  "riskScore": number 1-100,
  "riskLevel": "Low" | "Moderate" | "High" | "Extreme",
  "recommendedAdjustments": [string, string, string],
  "shortTermProfitOutlook": string
}
Return ONLY JSON.`;

      const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json", temperature: 0.3 },
      });
      const text = (response.text || "").trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      let analysis: any;
      try {
        analysis = JSON.parse(text);
      } catch {
        return res.status(502).json({ success: false, error: "Gemini returned a non-JSON response" });
      }
      if (analysis?.riskScore === undefined) {
        return res.status(502).json({ success: false, error: "Gemini response was missing required fields" });
      }
      return res.json({ success: true, source: model, analysis });
    } catch (err: any) {
      console.error("AI strategy audit error:", err);
      return res.status(502).json({ success: false, error: err.message || "Gemini request failed" });
    }
  });

  // Vite middleware in dev or static files in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
