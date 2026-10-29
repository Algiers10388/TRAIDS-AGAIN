import crypto from "crypto";

/**
 * Real signed REST clients for the supported exchanges. Nothing here fabricates data:
 * every function either returns what the exchange returned or throws ExchangeError.
 */

export type ExchangeId = "KRAKEN" | "BINANCE" | "COINBASE" | "BYBIT" | "NONKYC";
export const EXCHANGE_IDS: ExchangeId[] = ["KRAKEN", "BINANCE", "COINBASE", "BYBIT", "NONKYC"];

export interface Creds {
  apiKey: string;
  apiSecret: string;
}

export class ExchangeError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------
// Credential store: environment first, optionally overridden at runtime (memory only, never logged)
// ---------------------------------------------------------------------------------------------
const runtime: Partial<Record<ExchangeId, Creds>> = {};

export function getCreds(ex: ExchangeId): Creds | null {
  const r = runtime[ex];
  if (r && r.apiKey && r.apiSecret) return r;
  const apiKey = process.env[`${ex}_API_KEY`] || "";
  const apiSecret = process.env[`${ex}_API_SECRET`] || "";
  return apiKey && apiSecret ? { apiKey, apiSecret } : null;
}

export function setRuntimeCreds(ex: ExchangeId, creds: Creds) {
  runtime[ex] = creds;
}

export function clearRuntimeCreds(ex: ExchangeId) {
  delete runtime[ex];
}

export function maskKey(val?: string | null): string | null {
  if (!val) return null;
  if (val.length <= 8) return "••••" + val.slice(-2);
  return val.slice(0, 4) + "••••••••" + val.slice(-4);
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------
async function http(url: string, init: RequestInit, label: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  } catch (e: any) {
    throw new ExchangeError(`${label}: network error (${e.message})`, 502);
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok && json === null) {
    throw new ExchangeError(`${label}: HTTP ${res.status} ${text.slice(0, 200)}`, res.status === 401 || res.status === 403 ? 401 : 502);
  }
  return { status: res.status, ok: res.ok, json, text };
}

/** Format a quantity with at most 8 decimals, rounded down, no exponent. */
export function fmtQty(n: number): string {
  const floored = Math.floor(n * 1e8) / 1e8;
  return floored.toFixed(8).replace(/\.?0+$/, "") || "0";
}

let lastNonce = 0;
function nextNonce(): string {
  lastNonce = Math.max(lastNonce + 1, Date.now() * 1000);
  return String(lastNonce);
}

export interface OrderRequest {
  exchange: ExchangeId;
  /** Exchange-specific pair identifiers resolved by the caller from the asset definition */
  pairs: { binance: string; kraken: string; coinbase: string; nonkyc: string };
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  /** base-asset quantity */
  quantity: number;
  /** required for LIMIT */
  price?: number;
  clientOrderId: string;
}

export interface OrderResult {
  exchangeOrderId: string;
  raw: unknown;
}

export type Balances = Record<string, string>;

// ---------------------------------------------------------------------------------------------
// Kraken
// ---------------------------------------------------------------------------------------------
async function krakenPrivate(creds: Creds, path: string, params: Record<string, string>) {
  const nonce = nextNonce();
  const body = new URLSearchParams({ nonce, ...params }).toString();
  const hash = crypto.createHash("sha256").update(nonce + body).digest();
  const sig = crypto
    .createHmac("sha512", Buffer.from(creds.apiSecret, "base64"))
    .update(Buffer.concat([Buffer.from(path), hash]))
    .digest("base64");
  const r = await http(
    "https://api.kraken.com" + path,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "API-Key": creds.apiKey, "API-Sign": sig },
      body,
    },
    "Kraken"
  );
  const errs: string[] = r.json?.error || [];
  if (errs.length) {
    throw new ExchangeError(`Kraken: ${errs.join("; ")}`, errs.some((e) => e.includes("Invalid key") || e.includes("Permission")) ? 401 : 400);
  }
  return r.json.result;
}

const KRAKEN_ASSET: Record<string, string> = { XXBT: "BTC", XBT: "BTC", XETH: "ETH", XLTC: "LTC", XXRP: "XRP", XXLM: "XLM", XXDG: "DOGE", ZUSD: "USD", ZEUR: "EUR", ZGBP: "GBP", ZCAD: "CAD" };

async function krakenBalances(c: Creds): Promise<Balances> {
  const result = await krakenPrivate(c, "/0/private/Balance", {});
  const out: Balances = {};
  for (const [k, v] of Object.entries<string>(result || {})) {
    if (parseFloat(v) > 0) out[KRAKEN_ASSET[k] || k] = v;
  }
  return out;
}

async function krakenOrder(c: Creds, o: OrderRequest): Promise<OrderResult> {
  const params: Record<string, string> = {
    ordertype: o.type === "MARKET" ? "market" : "limit",
    type: o.side.toLowerCase(),
    volume: fmtQty(o.quantity),
    pair: o.pairs.kraken,
  };
  if (o.type === "LIMIT") params.price = String(o.price);
  const result = await krakenPrivate(c, "/0/private/AddOrder", params);
  const id = result?.txid?.[0];
  if (!id) throw new ExchangeError("Kraken accepted the request but returned no order id", 502);
  return { exchangeOrderId: id, raw: result };
}

// ---------------------------------------------------------------------------------------------
// Binance
// ---------------------------------------------------------------------------------------------
const BINANCE_BASE = process.env.BINANCE_API_BASE || "https://api.binance.com";

async function binanceSigned(c: Creds, method: "GET" | "POST", path: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ ...params, recvWindow: "5000", timestamp: String(Date.now()) }).toString();
  const sig = crypto.createHmac("sha256", c.apiSecret).update(qs).digest("hex");
  const r = await http(`${BINANCE_BASE}${path}?${qs}&signature=${sig}`, { method, headers: { "X-MBX-APIKEY": c.apiKey } }, "Binance");
  if (!r.ok) {
    throw new ExchangeError(`Binance: ${r.json?.msg || r.text.slice(0, 200)} (code ${r.json?.code ?? r.status})`, r.status === 401 || r.status === 403 ? 401 : 400);
  }
  return r.json;
}

async function binanceBalances(c: Creds): Promise<Balances> {
  const acct = await binanceSigned(c, "GET", "/api/v3/account", {});
  const out: Balances = {};
  for (const b of acct.balances || []) {
    const total = parseFloat(b.free) + parseFloat(b.locked);
    if (total > 0) out[b.asset] = String(b.free);
  }
  return out;
}

async function binanceOrder(c: Creds, o: OrderRequest): Promise<OrderResult> {
  const params: Record<string, string> = {
    symbol: o.pairs.binance,
    side: o.side,
    type: o.type,
    quantity: fmtQty(o.quantity),
    newOrderRespType: "ACK",
    newClientOrderId: o.clientOrderId,
  };
  if (o.type === "LIMIT") {
    params.price = String(o.price);
    params.timeInForce = "GTC";
  }
  const r = await binanceSigned(c, "POST", "/api/v3/order", params);
  if (!r.orderId) throw new ExchangeError("Binance returned no orderId", 502);
  return { exchangeOrderId: String(r.orderId), raw: r };
}

// ---------------------------------------------------------------------------------------------
// Coinbase Advanced Trade (CDP API keys: key name + EC private key PEM, ES256 JWT)
// ---------------------------------------------------------------------------------------------
function coinbaseJwt(c: Creds, method: string, path: string): string {
  const pem = c.apiSecret.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${b64({ alg: "ES256", kid: c.apiKey, nonce: crypto.randomBytes(16).toString("hex"), typ: "JWT" })}.${b64({
    sub: c.apiKey,
    iss: "cdp",
    nbf: now,
    exp: now + 120,
    uri: `${method} api.coinbase.com${path}`,
  })}`;
  const sig = crypto.sign("sha256", Buffer.from(data), { key: pem, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${data}.${sig}`;
}

async function coinbaseCall(c: Creds, method: "GET" | "POST", path: string, query = "", body?: unknown) {
  let jwt: string;
  try {
    jwt = coinbaseJwt(c, method, path);
  } catch (e: any) {
    throw new ExchangeError(
      `Coinbase: could not sign request. COINBASE_API_KEY must be the CDP key name (organizations/.../apiKeys/...) and COINBASE_API_SECRET the EC private key PEM (${e.message})`,
      400
    );
  }
  const r = await http(
    `https://api.coinbase.com${path}${query ? "?" + query : ""}`,
    {
      method,
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
    "Coinbase"
  );
  if (!r.ok) {
    throw new ExchangeError(`Coinbase: ${r.json?.message || r.json?.error || r.text.slice(0, 200)}`, r.status === 401 || r.status === 403 ? 401 : 400);
  }
  return r.json;
}

async function coinbaseBalances(c: Creds): Promise<Balances> {
  const out: Balances = {};
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const j = await coinbaseCall(c, "GET", "/api/v3/brokerage/accounts", `limit=250${cursor ? "&cursor=" + cursor : ""}`);
    for (const a of j.accounts || []) {
      const v = parseFloat(a.available_balance?.value || "0");
      if (v > 0) out[a.currency] = String(a.available_balance.value);
    }
    if (!j.has_next || !j.cursor) break;
    cursor = j.cursor;
  }
  return out;
}

async function coinbaseOrder(c: Creds, o: OrderRequest): Promise<OrderResult> {
  const order_configuration =
    o.type === "MARKET"
      ? { market_market_ioc: { base_size: fmtQty(o.quantity) } }
      : { limit_limit_gtc: { base_size: fmtQty(o.quantity), limit_price: String(o.price), post_only: false } };
  const j = await coinbaseCall(c, "POST", "/api/v3/brokerage/orders", "", {
    client_order_id: o.clientOrderId,
    product_id: o.pairs.coinbase,
    side: o.side,
    order_configuration,
  });
  if (!j.success) {
    throw new ExchangeError(`Coinbase rejected order: ${j.error_response?.message || j.error_response?.error || "unknown"}`, 400);
  }
  return { exchangeOrderId: j.success_response?.order_id || j.order_id, raw: j };
}

// ---------------------------------------------------------------------------------------------
// Bybit V5
// ---------------------------------------------------------------------------------------------
async function bybitCall(c: Creds, method: "GET" | "POST", path: string, params: Record<string, string> = {}, body?: Record<string, unknown>) {
  const ts = String(Date.now());
  const recv = "5000";
  const query = new URLSearchParams(params).toString();
  const payload = method === "GET" ? query : JSON.stringify(body || {});
  const sig = crypto.createHmac("sha256", c.apiSecret).update(ts + c.apiKey + recv + payload).digest("hex");
  const r = await http(
    `https://api.bybit.com${path}${query ? "?" + query : ""}`,
    {
      method,
      headers: {
        "X-BAPI-API-KEY": c.apiKey,
        "X-BAPI-TIMESTAMP": ts,
        "X-BAPI-RECV-WINDOW": recv,
        "X-BAPI-SIGN": sig,
        "Content-Type": "application/json",
      },
      body: method === "POST" ? payload : undefined,
    },
    "Bybit"
  );
  if (r.json?.retCode !== 0) {
    throw new ExchangeError(`Bybit: ${r.json?.retMsg || r.text.slice(0, 200)} (retCode ${r.json?.retCode})`, r.json?.retCode === 10003 || r.json?.retCode === 10004 ? 401 : 400);
  }
  return r.json.result;
}

async function bybitBalances(c: Creds): Promise<Balances> {
  const result = await bybitCall(c, "GET", "/v5/account/wallet-balance", { accountType: "UNIFIED" });
  const out: Balances = {};
  for (const coin of result?.list?.[0]?.coin || []) {
    if (parseFloat(coin.walletBalance) > 0) out[coin.coin] = String(coin.walletBalance);
  }
  return out;
}

async function bybitOrder(c: Creds, o: OrderRequest): Promise<OrderResult> {
  const body: Record<string, unknown> = {
    category: "spot",
    symbol: o.pairs.binance,
    side: o.side === "BUY" ? "Buy" : "Sell",
    orderType: o.type === "MARKET" ? "Market" : "Limit",
    qty: fmtQty(o.quantity),
    orderLinkId: o.clientOrderId,
  };
  if (o.type === "MARKET") body.marketUnit = "baseCoin";
  else {
    body.price = String(o.price);
    body.timeInForce = "GTC";
  }
  const result = await bybitCall(c, "POST", "/v5/order/create", {}, body);
  if (!result?.orderId) throw new ExchangeError("Bybit returned no orderId", 502);
  return { exchangeOrderId: result.orderId, raw: result };
}

// ---------------------------------------------------------------------------------------------
// NonKYC
// ---------------------------------------------------------------------------------------------
async function nonkycCall(c: Creds, method: "GET" | "POST", path: string, body?: Record<string, unknown>) {
  const url = `https://api.nonkyc.io/api/v2${path}`;
  const nonce = String(Date.now());
  const bodyStr = body ? JSON.stringify(body) : "";
  const sign = crypto.createHmac("sha256", c.apiSecret).update(c.apiKey + url + bodyStr + nonce).digest("hex");
  const r = await http(
    url,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": c.apiKey,
        "X-API-NONCE": nonce,
        "X-API-SIGN": sign,
        "User-Agent": "Mozilla/5.0",
      },
      body: method === "POST" ? bodyStr : undefined,
    },
    "NonKYC"
  );
  if (!r.ok || r.json?.error) {
    const e = r.json?.error;
    throw new ExchangeError(`NonKYC: ${typeof e === "object" ? e?.message || JSON.stringify(e) : e || r.text.slice(0, 200)}`, r.status === 401 || r.status === 403 ? 401 : 400);
  }
  return r.json;
}

async function nonkycBalances(c: Creds): Promise<Balances> {
  const j = await nonkycCall(c, "GET", "/balances");
  const out: Balances = {};
  for (const b of Array.isArray(j) ? j : []) {
    if (parseFloat(b.available) > 0) out[b.asset] = String(b.available);
  }
  return out;
}

async function nonkycOrder(c: Creds, o: OrderRequest): Promise<OrderResult> {
  const body: Record<string, unknown> = {
    userProvidedId: o.clientOrderId,
    symbol: o.pairs.nonkyc.replace("_", "/"),
    side: o.side.toLowerCase(),
    type: o.type.toLowerCase(),
    quantity: fmtQty(o.quantity),
  };
  if (o.type === "LIMIT") body.price = String(o.price);
  const j = await nonkycCall(c, "POST", "/createorder", body);
  const id = j?.id || j?.orderId;
  if (!id) throw new ExchangeError("NonKYC returned no order id", 502);
  return { exchangeOrderId: String(id), raw: j };
}

// ---------------------------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------------------------
export async function fetchBalances(ex: ExchangeId): Promise<Balances> {
  const c = getCreds(ex);
  if (!c) throw new ExchangeError(`${ex} API credentials are not configured`, 503);
  switch (ex) {
    case "KRAKEN": return krakenBalances(c);
    case "BINANCE": return binanceBalances(c);
    case "COINBASE": return coinbaseBalances(c);
    case "BYBIT": return bybitBalances(c);
    case "NONKYC": return nonkycBalances(c);
  }
}

export async function placeOrder(o: OrderRequest): Promise<OrderResult> {
  const c = getCreds(o.exchange);
  if (!c) throw new ExchangeError(`${o.exchange} API credentials are not configured`, 503);
  switch (o.exchange) {
    case "KRAKEN": return krakenOrder(c, o);
    case "BINANCE": return binanceOrder(c, o);
    case "COINBASE": return coinbaseOrder(c, o);
    case "BYBIT": return bybitOrder(c, o);
    case "NONKYC": return nonkycOrder(c, o);
  }
}
