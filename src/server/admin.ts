import "server-only";
import crypto from "node:crypto";
import { DomainError } from "@/domain/errors";
import { isPublicDeployment } from "./runtime";

/**
 * Admin access for configuration changes (integration settings, camera sources).
 *
 * A single admin passcode (TWIN_ADMIN_KEY, a Docker secret / environment variable) unlocks an
 * HMAC-signed, httpOnly session cookie. Without a passcode, admin is open during local development
 * and locked when TWIN_DEPLOYMENT=public, so a public deployment is never left editable by accident.
 * Production would replace this with an OIDC identity provider (e.g. Keycloak) and per-user roles.
 */

const COOKIE = "tf_admin";
const TTL_SEC = 8 * 3600;
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60_000;

export type AdminMode = "passcode" | "open-local" | "locked";

export function adminMode(): AdminMode {
  if (process.env.TWIN_ADMIN_KEY) return "passcode";
  return isPublicDeployment() ? "locked" : "open-local";
}

const keyBytes = () => crypto.createHash("sha256").update(`twin-admin:${process.env.TWIN_ADMIN_KEY ?? ""}`).digest();
const sign = (exp: number) => crypto.createHmac("sha256", keyBytes()).update(`admin.${exp}`).digest("base64url");

function readCookie(req: Request, name: string) {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Constant-time string comparison for secrets (passcodes, signatures, bearer tokens). */
export function safeEqual(a: string, b: string) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}

export function isAdmin(req: Request, now = Date.now()): boolean {
  const mode = adminMode();
  if (mode === "open-local") return true;
  if (mode === "locked") return false;
  const raw = readCookie(req, COOKIE);
  if (!raw) return false;
  const [expStr, sig] = raw.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < now || !sig) return false;
  return safeEqual(sig, sign(exp));
}

export function requireAdmin(req: Request) {
  if (isAdmin(req)) return;
  throw new DomainError(
    adminMode() === "locked" ? "Admin changes are disabled on this server until an admin passcode (TWIN_ADMIN_KEY) is configured." : "Admin sign-in required. Unlock admin with the passcode first.",
    401,
  );
}

const g = globalThis as unknown as { __twinAdminAttempts?: Map<string, { n: number; until: number }> };
const attempts = (g.__twinAdminAttempts ??= new Map());

const clientKey = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
const secure = (req: Request) => req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:";

/** Check a passcode and return the Set-Cookie value for a new session. */
export function signIn(req: Request, passcode: string, now = Date.now()): string {
  const mode = adminMode();
  if (mode === "locked") throw new DomainError("No admin passcode is configured on this server (TWIN_ADMIN_KEY).", 403);
  const who = clientKey(req);
  const a = attempts.get(who);
  if (a && a.until > now && a.n >= MAX_ATTEMPTS) throw new DomainError("Too many attempts. Try again in a few minutes.", 429);
  if (mode === "passcode" && !safeEqual(passcode, process.env.TWIN_ADMIN_KEY!)) {
    attempts.set(who, { n: (a && a.until > now ? a.n : 0) + 1, until: now + WINDOW_MS });
    throw new DomainError("Incorrect passcode.", 401);
  }
  attempts.delete(who);
  const exp = Math.floor(now / 1000) + TTL_SEC;
  return `${COOKIE}=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL_SEC}${secure(req) ? "; Secure" : ""}`;
}

export function signOutCookie(req: Request) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure(req) ? "; Secure" : ""}`;
}

/** Who to name in the audit trail for admin actions. */
export const adminActor = (by?: string | null) => (by && by !== "Operator" ? `${by} (admin)` : "Admin");
