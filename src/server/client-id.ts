import "server-only";
import { cookies } from "next/headers";
import { CLIENT_COOKIE, newClientId, validClientId } from "./db/prefs";

/** The anonymous browser id (cookie `twin_client`), created on first use (1 year, httpOnly). */
export async function clientId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(CLIENT_COOKIE)?.value;
  if (validClientId(existing)) return existing;
  const id = newClientId();
  jar.set(CLIENT_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: process.env.NODE_ENV === "production" });
  return id;
}
