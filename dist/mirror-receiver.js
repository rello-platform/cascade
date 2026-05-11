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
export function mirrorReceiver(secret, schema, upsert) {
    if (typeof secret !== "string" || secret.length === 0) {
        throw new RangeError("secret must be a non-empty string");
    }
    if (!schema || typeof schema.safeParse !== "function") {
        throw new RangeError("schema must expose a safeParse(input) method");
    }
    if (typeof upsert !== "function") {
        throw new RangeError("upsert must be a function");
    }
    return async function handler(req) {
        const authHeader = req.headers.get("authorization") ?? "";
        const expected = `Bearer ${secret}`;
        if (!constantTimeEquals(authHeader, expected)) {
            return jsonResponse(401, { error: "unauthorized" });
        }
        let raw;
        try {
            raw = await req.json();
        }
        catch {
            return jsonResponse(400, { error: "invalid_json" });
        }
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            return jsonResponse(400, {
                error: "schema_validation_failed",
                message: parsed.error.message,
            });
        }
        try {
            await upsert(parsed.data);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "unknown_error";
            return jsonResponse(500, { error: "upsert_failed", message });
        }
        return jsonResponse(200, { ok: true });
    };
}
function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}
function constantTimeEquals(a, b) {
    if (a.length !== b.length)
        return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) {
        mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return mismatch === 0;
}
//# sourceMappingURL=mirror-receiver.js.map