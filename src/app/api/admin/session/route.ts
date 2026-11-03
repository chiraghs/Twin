import { z } from "zod";
import { adminMode, isAdmin, signIn, signOutCookie } from "@/server/admin";
import { json, parseBody, route } from "@/server/http";

export const dynamic = "force-dynamic";

const SignInSchema = z.object({ passcode: z.string().max(200).default("") });

/** Admin session: GET status, POST {passcode} to unlock, DELETE to lock again. */
export const GET = route((req: Request) => json({ admin: isAdmin(req), mode: adminMode() }));

export const POST = route(async (req: Request) => {
  const { passcode } = await parseBody(req, SignInSchema);
  const cookie = signIn(req, passcode);
  const res = json({ admin: true, mode: adminMode() });
  res.headers.append("Set-Cookie", cookie);
  return res;
});

export const DELETE = route((req: Request) => {
  const res = json({ admin: adminMode() === "open-local", mode: adminMode() });
  res.headers.append("Set-Cookie", signOutCookie(req));
  return res;
});
