import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mirrorReceiver } from "./mirror-receiver.js";
import type { SafeParseSchema, SafeParseResult } from "./types.js";

interface AgentBody {
  tenantId: string;
  agentId: string;
}

const agentSchema: SafeParseSchema<AgentBody> = {
  safeParse(input: unknown): SafeParseResult<AgentBody> {
    if (
      input &&
      typeof input === "object" &&
      typeof (input as Record<string, unknown>).tenantId === "string" &&
      typeof (input as Record<string, unknown>).agentId === "string"
    ) {
      return {
        success: true,
        data: input as AgentBody,
      };
    }
    return { success: false, error: { message: "tenantId + agentId required" } };
  },
};

function buildRequest(
  body: unknown,
  options: { authHeader?: string; rawBody?: string } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.authHeader !== undefined) {
    headers["authorization"] = options.authHeader;
  }
  return new Request("https://spoke.example.com/api/provisioning/agent", {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(body),
  });
}

describe("mirrorReceiver — happy path", () => {
  test("200 + { ok: true } when auth passes, schema parses, upsert succeeds", async () => {
    let capturedParsed: AgentBody | null = null;
    const handler = mirrorReceiver(
      "test-secret-123",
      agentSchema,
      async (parsed) => {
        capturedParsed = parsed;
      },
    );

    const req = buildRequest(
      { tenantId: "tenant-A", agentId: "agent-1" },
      { authHeader: "Bearer test-secret-123" },
    );
    const res = await handler(req);

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as Record<string, unknown>;
    assert.deepStrictEqual(json, { ok: true });
    assert.deepStrictEqual(capturedParsed, {
      tenantId: "tenant-A",
      agentId: "agent-1",
    });
  });

  test("synchronous upsert is supported", async () => {
    let called = false;
    const handler = mirrorReceiver("s", agentSchema, () => {
      called = true;
    });
    const res = await handler(
      buildRequest(
        { tenantId: "t", agentId: "a" },
        { authHeader: "Bearer s" },
      ),
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(called, true);
  });
});

describe("mirrorReceiver — error path", () => {
  test("401 when Authorization header is missing", async () => {
    const handler = mirrorReceiver("secret", agentSchema, async () => {});
    const res = await handler(
      buildRequest({ tenantId: "t", agentId: "a" }),
    );
    assert.strictEqual(res.status, 401);
    const json = (await res.json()) as Record<string, unknown>;
    assert.strictEqual(json.error, "unauthorized");
  });

  test("401 when Bearer token does not match", async () => {
    const handler = mirrorReceiver("expected", agentSchema, async () => {});
    const res = await handler(
      buildRequest(
        { tenantId: "t", agentId: "a" },
        { authHeader: "Bearer wrong" },
      ),
    );
    assert.strictEqual(res.status, 401);
  });

  test("401 when scheme is not 'Bearer'", async () => {
    const handler = mirrorReceiver("secret", agentSchema, async () => {});
    const res = await handler(
      buildRequest(
        { tenantId: "t", agentId: "a" },
        { authHeader: "Basic secret" },
      ),
    );
    assert.strictEqual(res.status, 401);
  });

  test("400 when body is not valid JSON", async () => {
    const handler = mirrorReceiver("s", agentSchema, async () => {});
    const res = await handler(
      buildRequest(undefined, {
        authHeader: "Bearer s",
        rawBody: "{not json",
      }),
    );
    assert.strictEqual(res.status, 400);
    const json = (await res.json()) as Record<string, unknown>;
    assert.strictEqual(json.error, "invalid_json");
  });

  test("400 when schema rejects the body", async () => {
    const handler = mirrorReceiver("s", agentSchema, async () => {});
    const res = await handler(
      buildRequest({ wrong: "shape" }, { authHeader: "Bearer s" }),
    );
    assert.strictEqual(res.status, 400);
    const json = (await res.json()) as Record<string, unknown>;
    assert.strictEqual(json.error, "schema_validation_failed");
    assert.strictEqual(json.message, "tenantId + agentId required");
  });

  test("500 when upsert handler throws", async () => {
    const handler = mirrorReceiver("s", agentSchema, async () => {
      throw new Error("db_offline");
    });
    const res = await handler(
      buildRequest(
        { tenantId: "t", agentId: "a" },
        { authHeader: "Bearer s" },
      ),
    );
    assert.strictEqual(res.status, 500);
    const json = (await res.json()) as Record<string, unknown>;
    assert.strictEqual(json.error, "upsert_failed");
    assert.strictEqual(json.message, "db_offline");
  });

  test("constructor throws RangeError on empty secret", () => {
    assert.throws(
      () => mirrorReceiver("", agentSchema, async () => {}),
      RangeError,
    );
  });

  test("constructor throws RangeError on missing safeParse", () => {
    assert.throws(
      () =>
        mirrorReceiver(
          "s",
          {} as SafeParseSchema<AgentBody>,
          async () => {},
        ),
      RangeError,
    );
  });

  test("constructor throws RangeError on non-function upsert", () => {
    assert.throws(
      () =>
        mirrorReceiver(
          "s",
          agentSchema,
          null as unknown as Parameters<typeof mirrorReceiver>[2],
        ),
      RangeError,
    );
  });
});

describe("mirrorReceiver — tenant isolation", () => {
  test("upsert receives the parsed tenantId from the request body, not from any closure", async () => {
    const seenTenants: string[] = [];
    const handler = mirrorReceiver("s", agentSchema, async (parsed) => {
      seenTenants.push(parsed.tenantId);
    });

    const r1 = await handler(
      buildRequest(
        { tenantId: "tenant-A", agentId: "a-1" },
        { authHeader: "Bearer s" },
      ),
    );
    const r2 = await handler(
      buildRequest(
        { tenantId: "tenant-B", agentId: "a-2" },
        { authHeader: "Bearer s" },
      ),
    );

    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r2.status, 200);
    assert.deepStrictEqual(seenTenants, ["tenant-A", "tenant-B"]);
  });

  test("a request with secret for spoke A is rejected by handler configured for spoke B", async () => {
    const handlerB = mirrorReceiver(
      "secret-spoke-B",
      agentSchema,
      async () => {},
    );

    const reqWithSpokeASecret = buildRequest(
      { tenantId: "tenant-A", agentId: "a-1" },
      { authHeader: "Bearer secret-spoke-A" },
    );
    const res = await handlerB(reqWithSpokeASecret);
    assert.strictEqual(res.status, 401);
  });

  test("upsert is NOT invoked when auth fails (no work for unauthorized tenants)", async () => {
    let invoked = false;
    const handler = mirrorReceiver("s", agentSchema, async () => {
      invoked = true;
    });
    const res = await handler(
      buildRequest(
        { tenantId: "t", agentId: "a" },
        { authHeader: "Bearer wrong" },
      ),
    );
    assert.strictEqual(res.status, 401);
    assert.strictEqual(invoked, false);
  });

  test("upsert is NOT invoked when schema fails", async () => {
    let invoked = false;
    const handler = mirrorReceiver("s", agentSchema, async () => {
      invoked = true;
    });
    const res = await handler(
      buildRequest({ wrong: "shape" }, { authHeader: "Bearer s" }),
    );
    assert.strictEqual(res.status, 400);
    assert.strictEqual(invoked, false);
  });
});
