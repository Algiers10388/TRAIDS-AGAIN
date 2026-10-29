import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";

/**
 * Firebase ID-token authentication for every /api route that is not explicitly public.
 *
 * No extra dependency: tokens are verified against Google's published x509 certs with node:crypto.
 *
 * Access is DENY BY DEFAULT. A valid Firebase login is not enough on its own, because this server
 * holds exchange keys and a signer key. The signed-in account must also be listed in one of:
 *   ALLOWED_EMAILS  comma separated list of verified Google emails
 *   ALLOWED_UIDS    comma separated list of Firebase UIDs
 * If neither is set, every protected route answers 503 and tells the operator what to configure.
 */

const CERT_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let certCache: { certs: Record<string, string>; expiresAt: number } | null = null;

function getProjectId(): string {
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), "firebase-applet-config.json"), "utf8");
    const id = JSON.parse(raw).projectId;
    if (id) return String(id);
  } catch {
    /* fall through */
  }
  throw new Error("FIREBASE_PROJECT_ID is not set and firebase-applet-config.json is unreadable");
}

async function getCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (certCache && certCache.expiresAt > now) return certCache.certs;
  const res = await fetch(CERT_URL);
  if (!res.ok) throw new Error(`Unable to fetch Firebase signing certs (HTTP ${res.status})`);
  const certs = (await res.json()) as Record<string, string>;
  const maxAgeMatch = /max-age=(\d+)/.exec(res.headers.get("cache-control") || "");
  const maxAgeMs = (maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600) * 1000;
  certCache = { certs, expiresAt: now + Math.min(maxAgeMs, 6 * 3600 * 1000) };
  return certs;
}

export interface AuthedUser {
  uid: string;
  email: string;
}

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export async function verifyFirebaseIdToken(token: string): Promise<AuthedUser> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [h, p, s] = parts;

  const header = JSON.parse(b64urlToBuffer(h).toString("utf8"));
  const payload = JSON.parse(b64urlToBuffer(p).toString("utf8"));
  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported token header");

  const certs = await getCerts();
  const cert = certs[header.kid];
  if (!cert) throw new Error("Unknown signing key");

  const ok = crypto
    .createVerify("RSA-SHA256")
    .update(`${h}.${p}`)
    .verify(cert, b64urlToBuffer(s));
  if (!ok) throw new Error("Bad signature");

  const projectId = getProjectId();
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error("Wrong audience");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("Wrong issuer");
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) throw new Error("Token expired");
  if (typeof payload.iat !== "number" || payload.iat > nowSec + 300) throw new Error("Token issued in the future");
  if (!payload.sub || typeof payload.sub !== "string") throw new Error("Missing subject");

  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (email && payload.email_verified !== true) throw new Error("Email is not verified");

  return { uid: payload.sub, email };
}

function parseList(v: string | undefined): string[] {
  return (v || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(user: AuthedUser): boolean {
  const emails = parseList(process.env.ALLOWED_EMAILS);
  const uids = parseList(process.env.ALLOWED_UIDS);
  if (emails.length === 0 && uids.length === 0) return false;
  return (user.email && emails.includes(user.email)) || uids.includes(user.uid.toLowerCase());
}

export function allowlistConfigured(): boolean {
  return parseList(process.env.ALLOWED_EMAILS).length > 0 || parseList(process.env.ALLOWED_UIDS).length > 0;
}

declare module "express-serve-static-core" {
  interface Request {
    authUser?: AuthedUser;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!allowlistConfigured()) {
    return res.status(503).json({
      success: false,
      error: "Server access list is not configured. Set ALLOWED_EMAILS (or ALLOWED_UIDS) to enable the API.",
    });
  }
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return res.status(401).json({ success: false, error: "Authentication required" });
  }
  try {
    const user = await verifyFirebaseIdToken(match[1]);
    if (!isAllowed(user)) {
      return res.status(403).json({ success: false, error: "This account is not authorised for this server" });
    }
    req.authUser = user;
    return next();
  } catch (err: any) {
    return res.status(401).json({ success: false, error: `Invalid credentials: ${err.message}` });
  }
}
