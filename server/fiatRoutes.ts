import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import {
  FiatAccount,
  FiatTransaction,
  BotSecuritySettings,
  SecurityAuditReport,
  CheckDepositRecord,
} from "../src/types";
import { allowlistConfigured } from "./auth";

/**
 * Trading guardrails + honest account/security status.
 *
 * This server does NOT run a custodial fiat ledger. There are no simulated bank links, cards, balances,
 * deposits, withdrawals, 2FA codes or compliance claims here. Money moves only at the exchanges you connect.
 * Every fiat money-movement route answers 501 until a real provider integration (Stripe / Plaid) is built.
 */

const SETTINGS_FILE = path.resolve(process.cwd(), "data", "risk-settings.json");

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

let botSecuritySettings: BotSecuritySettings = {
  emergencyFreezeActive: process.env.TRADING_FROZEN === "true",
  twoFactorEnforced: false,
  maxSingleOrderUsd: envNumber("MAX_SINGLE_ORDER_USD", 500),
  maxDailyLossUsd: envNumber("MAX_DAILY_LOSS_USD", 250),
  slippageTolerancePercent: 0.5,
  ipWhitelistEnabled: false,
  withdrawalAddressWhitelistOnly: false,
  lastSecurityAuditTimestamp: Date.now(),
  securityGrade: "GUARDED",
  activeThreatLevel: "NOMINAL",
};

let maxDailyNotionalUsd = envNumber("MAX_DAILY_NOTIONAL_USD", 5000);
let dailyNotional = { day: new Date().toISOString().slice(0, 10), usd: 0 };

function loadPersisted() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    if (typeof raw.emergencyFreezeActive === "boolean") {
      // A persisted freeze can only tighten, never loosen, what the environment demands.
      botSecuritySettings.emergencyFreezeActive =
        botSecuritySettings.emergencyFreezeActive || raw.emergencyFreezeActive;
    }
    for (const k of ["maxSingleOrderUsd", "maxDailyLossUsd", "slippageTolerancePercent"] as const) {
      if (Number.isFinite(raw[k]) && raw[k] > 0) botSecuritySettings[k] = raw[k];
    }
    if (Number.isFinite(raw.maxDailyNotionalUsd) && raw.maxDailyNotionalUsd > 0) {
      maxDailyNotionalUsd = raw.maxDailyNotionalUsd;
    }
  } catch {
    /* no persisted settings yet */
  }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(
      SETTINGS_FILE,
      JSON.stringify({ ...botSecuritySettings, maxDailyNotionalUsd }, null, 2)
    );
  } catch (err) {
    console.warn("Unable to persist risk settings:", (err as Error).message);
  }
}
loadPersisted();

export function isBotEmergencyFrozen(): boolean {
  return botSecuritySettings.emergencyFreezeActive;
}

export function getBotMaxSingleOrderUsd(): number {
  return botSecuritySettings.maxSingleOrderUsd;
}

export function getBotSecuritySettings(): BotSecuritySettings {
  return { ...botSecuritySettings };
}

/** Server-side gate every live order must pass. Returns an error string, or null when allowed. */
export function checkOrderAllowed(notionalUsd: number): string | null {
  if (botSecuritySettings.emergencyFreezeActive) {
    return "Trading is frozen (emergency kill-switch active).";
  }
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
    return "Order notional could not be determined.";
  }
  if (notionalUsd > botSecuritySettings.maxSingleOrderUsd) {
    return `Order notional $${notionalUsd.toFixed(2)} exceeds the single-order cap of $${botSecuritySettings.maxSingleOrderUsd}.`;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (dailyNotional.day !== today) dailyNotional = { day: today, usd: 0 };
  if (dailyNotional.usd + notionalUsd > maxDailyNotionalUsd) {
    return `Order would exceed the daily notional cap of $${maxDailyNotionalUsd} ($${dailyNotional.usd.toFixed(2)} used today).`;
  }
  return null;
}

/** Call only after an exchange accepted the order. */
export function recordOrderNotional(notionalUsd: number) {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyNotional.day !== today) dailyNotional = { day: today, usd: 0 };
  dailyNotional.usd += notionalUsd;
}

const NOT_ENABLED =
  "Fiat rails are not enabled. This server has no custodial ledger, so it cannot take deposits, link cards/banks or send withdrawals. " +
  "Fund and withdraw directly at your exchanges.";

function emptyAccount(email?: string): FiatAccount {
  return {
    accountId: "NONE",
    accountNumberMasked: "—",
    routingNumberMasked: "—",
    accountHolder: email || "Signed-in user",
    currency: "USD",
    availableBalance: 0,
    pendingBalance: 0,
    allocatedToTrading: 0,
    dailyDepositLimit: 0,
    dailyDepositUsed: 0,
    kycTier: "NONE",
    twoFactorEnabled: false,
    vaultEncryption: "NONE",
    fdicCustodyInsured: false,
    linkedBanks: [],
    linkedCards: [],
  };
}

export function setupFiatRoutes(app: express.Application) {
  app.get("/api/fiat/account", (req: Request, res: Response) => {
    res.json({
      success: true,
      account: emptyAccount(req.authUser?.email),
      botSecurity: botSecuritySettings,
      timestamp: Date.now(),
      security: {
        vault: "NONE",
        pciDssCompliant: false,
        fdicInsured: false,
        twoFactorActive: false,
        emergencyFreezeActive: botSecuritySettings.emergencyFreezeActive,
        botOrderCapUsd: botSecuritySettings.maxSingleOrderUsd,
        stripeConfigured: false,
        plaidConfigured: false,
        fiatRails: "DISABLED",
        note: NOT_ENABLED,
      },
    });
  });

  // Security report computed from real configuration only
  app.get("/api/fiat/security/audit", (_req: Request, res: Response) => {
    const exchangeKeys = ["KRAKEN", "BINANCE", "COINBASE", "BYBIT", "NONKYC"].filter(
      (x) => process.env[`${x}_API_KEY`] && process.env[`${x}_API_SECRET`]
    );
    const checks: SecurityAuditReport["verifiedChecks"] = [
      {
        title: "API access list",
        description: allowlistConfigured()
          ? "Only accounts in ALLOWED_EMAILS / ALLOWED_UIDS can call the API, with a verified Firebase ID token."
          : "ALLOWED_EMAILS / ALLOWED_UIDS is not set; the API rejects every request until it is.",
        status: allowlistConfigured() ? "PASSED" : "CRITICAL",
        category: "ACCESS_CONTROL",
      },
      {
        title: "Emergency kill-switch",
        description: botSecuritySettings.emergencyFreezeActive
          ? "Trading is currently FROZEN; no orders will be sent."
          : "Kill-switch is armed and enforced server-side on every live order.",
        status: botSecuritySettings.emergencyFreezeActive ? "WARNING" : "PASSED",
        category: "BOT_TREASURY",
      },
      {
        title: "Single-order cap",
        description: `Orders above $${botSecuritySettings.maxSingleOrderUsd} are rejected by the server.`,
        status: "PASSED",
        category: "BOT_TREASURY",
      },
      {
        title: "Daily notional cap",
        description: `Total live notional is capped at $${maxDailyNotionalUsd} per UTC day.`,
        status: "PASSED",
        category: "BOT_TREASURY",
      },
      {
        title: "Exchange credentials",
        description: exchangeKeys.length
          ? `Server-side API key + secret present for: ${exchangeKeys.join(", ")}. Use trade-only keys with withdrawals disabled and IP allow-listing at the exchange.`
          : "No exchange API credentials configured; live trading is unavailable.",
        status: exchangeKeys.length ? "PASSED" : "WARNING",
        category: "ACCESS_CONTROL",
      },
      {
        title: "Fiat rails",
        description: "Disabled. No simulated banks, cards, balances or 2FA exist in this server.",
        status: "PASSED",
        category: "BANKING_RAILS",
      },
    ];
    const passed = checks.filter((c) => c.status === "PASSED").length;
    const critical = checks.some((c) => c.status === "CRITICAL");
    const report: SecurityAuditReport = {
      overallScore: Math.round((passed / checks.length) * 100),
      securityGrade: critical ? "CRITICAL" : "GUARDED",
      vaultEncryption: "NONE (no custodial vault; secrets live in server environment variables)",
      twoFactorActive: false,
      emergencyFreezeActive: botSecuritySettings.emergencyFreezeActive,
      totalLinkedBanks: 0,
      allBanksChecksumVerified: true,
      zeroPlaintextGuarantee: false,
      pciDssLevel1Compliant: false,
      fdicCustodyInsured: false,
      botOrderCapUsd: botSecuritySettings.maxSingleOrderUsd,
      dailyLossLimitUsd: botSecuritySettings.maxDailyLossUsd,
      circuitBreakerActive: botSecuritySettings.emergencyFreezeActive,
      lastAuditTimestamp: Date.now(),
      verifiedChecks: checks,
    };
    res.json({ success: true, report, timestamp: Date.now() });
  });

  // Update guardrails / toggle kill-switch (persisted; env TRADING_FROZEN=true can only be lifted by changing env)
  app.post("/api/fiat/security/update-bot-protection", (req: Request, res: Response) => {
    try {
      const { emergencyFreezeActive, maxSingleOrderUsd, maxDailyLossUsd, slippageTolerancePercent, maxDailyNotionalUsd: dn } =
        req.body || {};

      if (emergencyFreezeActive !== undefined) {
        const want = Boolean(emergencyFreezeActive);
        if (!want && process.env.TRADING_FROZEN === "true") {
          return res.status(409).json({
            success: false,
            error: "TRADING_FROZEN=true is set in the server environment; unset it there to unfreeze.",
          });
        }
        botSecuritySettings.emergencyFreezeActive = want;
      }
      if (maxSingleOrderUsd !== undefined && Number(maxSingleOrderUsd) > 0) {
        botSecuritySettings.maxSingleOrderUsd = Number(maxSingleOrderUsd);
      }
      if (maxDailyLossUsd !== undefined && Number(maxDailyLossUsd) > 0) {
        botSecuritySettings.maxDailyLossUsd = Number(maxDailyLossUsd);
      }
      if (slippageTolerancePercent !== undefined && Number(slippageTolerancePercent) > 0) {
        botSecuritySettings.slippageTolerancePercent = Number(slippageTolerancePercent);
      }
      if (dn !== undefined && Number(dn) > 0) {
        maxDailyNotionalUsd = Number(dn);
      }
      botSecuritySettings.lastSecurityAuditTimestamp = Date.now();
      persist();

      return res.json({
        success: true,
        message: botSecuritySettings.emergencyFreezeActive
          ? "Trading is FROZEN: the server will reject every live order."
          : "Guardrails updated.",
        botSecurity: botSecuritySettings,
        account: emptyAccount(req.authUser?.email),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || "Failed to update settings" });
    }
  });

  const empty: { tx: FiatTransaction[]; checks: CheckDepositRecord[] } = { tx: [], checks: [] };
  app.get("/api/fiat/transactions", (_req: Request, res: Response) => {
    res.json({ success: true, transactions: empty.tx, timestamp: Date.now() });
  });
  app.get("/api/fiat/check-deposits", (_req: Request, res: Response) => {
    res.json({ success: true, checks: empty.checks, timestamp: Date.now() });
  });

  // Everything that would move or fabricate money: refuse explicitly.
  const disabled = (_req: Request, res: Response) =>
    res.status(501).json({ success: false, error: NOT_ENABLED });
  for (const p of [
    "/api/fiat/security/verify-2fa",
    "/api/fiat/deposit/card",
    "/api/fiat/deposit/bank",
    "/api/fiat/deposit/check",
    "/api/fiat/sync-bot-capital",
    "/api/fiat/link-bank",
    "/api/fiat/link-card",
    "/api/fiat/transfer-bot",
    "/api/fiat/withdraw",
  ]) {
    app.post(p, disabled);
  }
}
