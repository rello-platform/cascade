import type { MirrorUpsert, SafeParseSchema } from "./types.js";
/**
 * Build a generic spoke-side receiver for cascading writes from Rello.
 * Extracted from the Bearer-auth + JSON-parse + schema-validate + upsert
 * shape used by every spoke's `/api/provisioning/agent/route.ts` (e.g.
 * `~/Harvest-Home/src/app/api/provisioning/agent/route.ts`).
 *
 * Returns a Web-platform handler (`(req: Request) => Promise<Response>`)
 * that callers wire into their framework of choice — for Next.js App
 * Router, `export const POST = mirrorReceiver(...)` works because
 * Next's route handler signature accepts a Web `Request`.
 *
 * Behavior:
 *   - 401 if `Authorization: Bearer <secret>` does not match.
 *   - 400 if body is not valid JSON or fails `schema.safeParse`.
 *   - 500 if the upsert handler throws.
 *   - 200 with `{ ok: true }` on success.
 *
 * The schema parameter is duck-typed against zod's `safeParse` so any
 * compatible validator (zod, valibot wrapper, hand-rolled) works without
 * cascade taking on a runtime dependency.
 */
export declare function mirrorReceiver<T>(secret: string, schema: SafeParseSchema<T>, upsert: MirrorUpsert<T>): (req: Request) => Promise<Response>;
//# sourceMappingURL=mirror-receiver.d.ts.map