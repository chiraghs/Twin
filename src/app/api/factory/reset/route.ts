import { json, route } from "@/server/http";
import { resetDemo } from "@/server/store";

export const POST = route(() => json(resetDemo()));
