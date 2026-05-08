# @rello-platform/cascade

Push/mirror primitives for cascading settings across Rello Platform spokes.

v1 (this release) ships **two helpers only** per the locked Q3 decision in
`PLATFORM-CASCADING-SETTINGS-ARCHITECTURE-BUILD-DOC.md` §8:

- `pushToSpokes()` — Rello-side fan-out POST to every enabled spoke for a
  tenant. Extracted from `pushAgentToSpokes` in
  `~/Rello/src/lib/provisioning/push-agent.ts` and made resource-agnostic.
- `mirrorReceiver()` — spoke-side handler factory: Bearer auth +
  schema validation + caller-supplied upsert. Extracted from the shape
  used by every spoke's `/api/provisioning/agent/route.ts`.

`readCascade<T>()` and `webhookInvalidate()` are explicitly **deferred**
until 2–3 per-feature applications validate the shape post-Phase-1.

## Install

This package is published to GitHub Packages. The consuming repo needs
an `.npmrc`:

```
@rello-platform:registry=https://npm.pkg.github.com
```

Then:

```
npm install @rello-platform/cascade
```

## Usage

### Rello side — fan-out push

```ts
import { pushToSpokes, type SpokeTarget } from "@rello-platform/cascade";

// Caller resolves spokes from the DB (TenantApp + App rows).
const spokes: SpokeTarget[] = enabledTenantApps.map((ta) => ({
  slug: ta.app.slug,
  baseUrl: ta.app.baseUrl,
  apiKey: (ta.app.settings as { provisioningApiKey: string }).provisioningApiKey,
}));

const result = await pushToSpokes(
  tenantId,
  "agent", // POSTs to ${baseUrl}/api/provisioning/agent
  { action: "update", agent: { ... }, agentProfile: { ... } },
  { spokes, excludeSpokeSlug: "rello" },
);

if (result.failed > 0) {
  // Queue a retry — cascade does not throw on per-spoke failure.
  await enqueueRetry(tenantId, result.errors);
}
```

### Spoke side — receive a mirrored write

```ts
// app/api/provisioning/agent/route.ts (Next.js App Router)
import { z } from "zod";
import { mirrorReceiver } from "@rello-platform/cascade";
import { prisma } from "@/lib/prisma";

const agentSchema = z.object({
  tenantId: z.string(),
  action: z.enum(["add", "remove", "update"]),
  agent: z.object({ relloAgentId: z.string(), email: z.string() }).passthrough(),
});

export const POST = mirrorReceiver(
  process.env.PROVISIONING_API_KEY!,
  agentSchema,
  async (parsed) => {
    await prisma.user.upsert({
      where: { relloAgentId: parsed.agent.relloAgentId },
      create: { ...mapToUser(parsed) },
      update: { ...mapToUser(parsed) },
    });
  },
);
```

## API

### `pushToSpokes(tenantId, resourceType, payload, options)`

Fans out `POST ${baseUrl}/api/provisioning/${resourceType}` to every
spoke in `options.spokes` whose slug is not excluded. Body is
`{ tenantId, syncedAt, force?, ...payload }`. Per-request timeout
is `options.timeoutMs ?? 15000`.

Returns `{ status, synced, failed, errors }` — never throws on
per-spoke failure. Throws `RangeError` on missing or invalid arguments.

### `mirrorReceiver(secret, schema, upsert)`

Returns `(req: Request) => Promise<Response>`. Validates
`Authorization: Bearer <secret>` (constant-time compare), parses
the JSON body, runs `schema.safeParse(body)`, and calls
`upsert(parsed.data)`. The `schema` parameter is duck-typed
against zod's `safeParse` — any compatible validator works.

Status codes: `401` (auth), `400` (json/schema), `500` (upsert
threw), `200` `{ ok: true }` on success.

## Contract

- No I/O outside the explicit `fetch` in `pushToSpokes` and the
  caller-supplied `upsert` in `mirrorReceiver`.
- No database client, no env access, no global state.
- Failures in `pushToSpokes` are collected into `errors` rather than
  thrown — callers decide retry vs surface.
- Public boundaries validate inputs and throw `RangeError` on misuse.

## License

UNLICENSED — internal Rello Platform use only.
