import { clientId } from "@/server/client-id";
import { listPrefs } from "@/server/db/prefs";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** All preferences and drafts saved for this browser. */
export const GET = route(async () => json({ prefs: listPrefs(await clientId()) }));
