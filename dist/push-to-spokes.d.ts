import type { PushToSpokesOptions, PushToSpokesResult } from "./types.js";
/**
 * Generic fan-out push to a tenant's spoke apps. Extracted from Rello's
 * `pushAgentToSpokes` (`src/lib/provisioning/push-agent.ts`) and made
 * resource-agnostic.
 *
 * Posts to `${baseUrl}/api/provisioning/${resourceType}` with
 * `Authorization: Bearer <apiKey>` and a body of:
 *
 *     { tenantId, syncedAt, force?, ...payload }
 *
 * Slow or failing spokes do not hold up the others — the fan-out is
 * `Promise.all` over per-spoke promises, each with its own AbortSignal
 * timeout. Per-spoke failures are collected into `errors` rather than
 * thrown, so callers decide whether to surface the error or queue a
 * retry (Trigger.dev DLQ, in-DB retry table, etc).
 */
export declare function pushToSpokes(tenantId: string, resourceType: string, payload: Record<string, unknown>, options: PushToSpokesOptions): Promise<PushToSpokesResult>;
//# sourceMappingURL=push-to-spokes.d.ts.map