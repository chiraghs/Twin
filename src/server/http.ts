import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type output } from "zod";
import { DomainError } from "@/domain/errors";

export const nowISO = () => new Date().toISOString();

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorResponse(e: unknown) {
  if (e instanceof DomainError) return json({ error: e.message }, e.status);
  if (e instanceof ZodError) {
    return json({ error: "Invalid request", issues: e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`) }, 400);
  }
  if (e instanceof SyntaxError) return json({ error: "Malformed JSON body" }, 400);
  console.error("[api] unexpected error", e);
  return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
}

export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<output<S>> {
  const text = await req.text();
  const raw = text.trim() ? JSON.parse(text) : {};
  return schema.parse(raw);
}

/** Wrap a route handler with uniform error handling. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response> | Response) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

const NDJSON_HEADERS = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" };

/**
 * Stream events as NDJSON, one JSON object per line. Every event is still computed if the client
 * goes away (so side effects such as commits happen); a thrown error ends the stream with an
 * `{ type: "error", message }` event. Pass a function to create the source inside the stream, so a
 * failure while setting it up is reported the same way.
 */
export function ndjsonResponse<E>(source: AsyncIterable<E> | (() => AsyncIterable<E>)): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: E | { type: "error"; message: string }) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client went away — keep computing */
        }
      };
      try {
        for await (const e of typeof source === "function" ? source() : source) send(e);
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, { headers: NDJSON_HEADERS });
}
