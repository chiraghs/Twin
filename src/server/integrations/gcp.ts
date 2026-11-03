import "server-only";
import { setting } from "@/server/settings";

/** Thin authenticated REST client for Google Cloud APIs using Application Default Credentials. */
let authPromise: Promise<import("google-auth-library").GoogleAuth> | null = null;

async function getAuth() {
  authPromise ??= import("google-auth-library").then(({ GoogleAuth }) => new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }));
  return authPromise;
}

export async function gcpFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const auth = await getAuth();
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("No access token from Application Default Credentials");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    const text = await res.text();
    let body: { error?: { message?: string } } & Record<string, unknown> = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      // Some errors (e.g. Cloud Storage "No such object") come back as plain text.
      if (res.ok) throw new Error(`Unexpected non-JSON response from ${new URL(url).host}`);
      body = { error: { message: text.slice(0, 200) } };
    }
    if (!res.ok) throw new Error(`${res.status} ${body?.error?.message ?? res.statusText}`);
    return body as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  } finally {
    clearTimeout(timer);
  }
}

export const gcpProject = () => setting("GOOGLE_CLOUD_PROJECT") || "";
