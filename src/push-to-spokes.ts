import type {
  PushToSpokesOptions,
  PushToSpokesResult,
  SpokeTarget,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 15_000;

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
export async function pushToSpokes(
  tenantId: string,
  resourceType: string,
  payload: Record<string, unknown>,
  options: PushToSpokesOptions,
): Promise<PushToSpokesResult> {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new RangeError("tenantId must be a non-empty string");
  }
  if (typeof resourceType !== "string" || resourceType.length === 0) {
    throw new RangeError("resourceType must be a non-empty string");
  }
  if (!options || !Array.isArray(options.spokes)) {
    throw new RangeError("options.spokes must be an array");
  }

  const {
    spokes,
    excludeSpokeSlug,
    onlySpokeSlug,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    force,
  } = options;

  const targets = spokes.filter((s) => isUsable(s, excludeSpokeSlug, onlySpokeSlug));

  if (targets.length === 0) {
    return { status: "no_spoke_apps", synced: 0, failed: 0, errors: [] };
  }

  const syncedAt = new Date().toISOString();
  const body = JSON.stringify({
    tenantId,
    syncedAt,
    ...(force === true ? { force: true } : {}),
    ...payload,
  });

  const results = await Promise.all(
    targets.map((spoke) => pushOne(spoke, resourceType, body, timeoutMs)),
  );

  const synced = results.filter((r) => r.ok).length;
  const failed = results.length - synced;
  const errors = results.filter((r) => !r.ok).map((r) => r.error);

  return { status: "ok", synced, failed, errors };
}

function isUsable(
  spoke: SpokeTarget,
  excludeSlug: string | undefined,
  onlySlug: string | undefined,
): boolean {
  if (!spoke || typeof spoke !== "object") return false;
  if (typeof spoke.slug !== "string" || spoke.slug.length === 0) return false;
  if (typeof spoke.baseUrl !== "string" || spoke.baseUrl.length === 0) return false;
  if (typeof spoke.apiKey !== "string" || spoke.apiKey.length === 0) return false;
  if (excludeSlug && spoke.slug === excludeSlug) return false;
  if (onlySlug && spoke.slug !== onlySlug) return false;
  return true;
}

interface PerSpokeResult {
  ok: boolean;
  slug: string;
  error: string;
}

async function pushOne(
  spoke: SpokeTarget,
  resourceType: string,
  body: string,
  timeoutMs: number,
): Promise<PerSpokeResult> {
  const url = `${trimTrailingSlash(spoke.baseUrl)}/api/provisioning/${resourceType}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${spoke.apiKey}`,
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      return { ok: true, slug: spoke.slug, error: "" };
    }
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      slug: spoke.slug,
      error: `${spoke.slug}: HTTP ${res.status} — ${text.slice(0, 200)}`,
    };
  } catch (err) {
    return {
      ok: false,
      slug: spoke.slug,
      error: `${spoke.slug}: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
}

function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
