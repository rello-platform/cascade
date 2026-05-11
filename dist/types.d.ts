/**
 * Shape of a single spoke target the caller has resolved (typically by
 * reading TenantApp + App rows out of Rello's DB and filtering for enabled
 * apps with a `provisioningApiKey`). Cascade is framework-free and does not
 * touch a database — the caller resolves spokes and hands them to
 * `pushToSpokes`.
 */
export interface SpokeTarget {
    /** Canonical lowercase-hyphenated app slug (e.g. "harvest-home"). */
    slug: string;
    /** Spoke base URL — no trailing slash, no `/api`. */
    baseUrl: string;
    /** Bearer credential the spoke recognizes (typically a `rello_*` ApiKey). */
    apiKey: string;
}
export interface PushToSpokesOptions {
    /** Resolved spoke targets. Empty array → `no_spoke_apps` short-circuit. */
    spokes: SpokeTarget[];
    /** Skip a spoke by slug — prevents loops on bidirectional sync. */
    excludeSpokeSlug?: string;
    /** Restrict the fan-out to a single spoke. */
    onlySpokeSlug?: string;
    /** Per-request abort timeout in ms. Default 15000. */
    timeoutMs?: number;
    /**
     * Mark the push as an operator-initiated bypass of the receiver's
     * stale-sync check. Reserved for recovery flows; never default to true.
     */
    force?: boolean;
}
export type PushToSpokesStatus = "ok" | "no_spoke_apps";
export interface PushToSpokesResult {
    status: PushToSpokesStatus;
    synced: number;
    failed: number;
    errors: string[];
}
/**
 * Duck-typed schema interface compatible with zod's `safeParse`. Cascade
 * does not depend on zod — any validator that returns this shape works.
 */
export interface SafeParseSchema<T> {
    safeParse: (input: unknown) => SafeParseResult<T>;
}
export type SafeParseResult<T> = {
    success: true;
    data: T;
} | {
    success: false;
    error: {
        message: string;
    };
};
/**
 * Caller-supplied write handler for the receiver. Throwing causes
 * `mirrorReceiver` to return 500; returning resolves to 200.
 */
export type MirrorUpsert<T> = (parsed: T) => Promise<void> | void;
//# sourceMappingURL=types.d.ts.map