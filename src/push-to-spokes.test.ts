import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pushToSpokes } from "./push-to-spokes.js";
import type { SpokeTarget } from "./types.js";

interface CapturedRequest {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string;
}

const originalFetch = globalThis.fetch;
let captured: CapturedRequest[] = [];

function installFetchStub(
  responder: (req: CapturedRequest, idx: number) => Response | Promise<Response>,
): void {
  captured = [];
  globalThis.fetch = (async (...args: Parameters<typeof globalThis.fetch>) => {
    const [input, init] = args;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((value, key) => {
        headers[key] = value;
      });
    }
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const captureEntry: CapturedRequest = {
      url,
      method: init?.method,
      headers,
      body: typeof init?.body === "string" ? init.body : "",
    };
    captured.push(captureEntry);
    return responder(captureEntry, captured.length - 1);
  }) as typeof globalThis.fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

const SPOKE_HH: SpokeTarget = {
  slug: "harvest-home",
  baseUrl: "https://hh.example.com",
  apiKey: "rello_hh_test_key",
};
const SPOKE_DRUMBEAT: SpokeTarget = {
  slug: "drumbeat",
  baseUrl: "https://drumbeat.example.com",
  apiKey: "rello_drumbeat_test_key",
};

describe("pushToSpokes — happy path", () => {
  beforeEach(() => {
    installFetchStub(() => new Response('{"ok":true}', { status: 200 }));
  });
  afterEach(restoreFetch);

  test("posts to /api/provisioning/<resourceType> with Bearer auth on every spoke", async () => {
    const result = await pushToSpokes(
      "tenant-abc",
      "agent",
      { action: "update", payload: 1 },
      { spokes: [SPOKE_HH, SPOKE_DRUMBEAT] },
    );

    assert.strictEqual(result.status, "ok");
    assert.strictEqual(result.synced, 2);
    assert.strictEqual(result.failed, 0);
    assert.deepStrictEqual(result.errors, []);

    assert.strictEqual(captured.length, 2);
    const urls = captured.map((c) => c.url).sort();
    assert.deepStrictEqual(urls, [
      "https://drumbeat.example.com/api/provisioning/agent",
      "https://hh.example.com/api/provisioning/agent",
    ]);
    for (const c of captured) {
      assert.strictEqual(c.method, "POST");
      assert.strictEqual(c.headers["content-type"], "application/json");
      assert.match(c.headers["authorization"] ?? "", /^Bearer rello_/);
    }
  });

  test("body includes tenantId, syncedAt (ISO), and the spread payload", async () => {
    await pushToSpokes(
      "tenant-abc",
      "agent",
      { action: "update", agent: { id: "a-1" } },
      { spokes: [SPOKE_HH] },
    );

    const body = JSON.parse(captured[0]!.body);
    assert.strictEqual(body.tenantId, "tenant-abc");
    assert.strictEqual(typeof body.syncedAt, "string");
    assert.ok(!Number.isNaN(Date.parse(body.syncedAt)));
    assert.strictEqual(body.action, "update");
    assert.deepStrictEqual(body.agent, { id: "a-1" });
    assert.strictEqual("force" in body, false, "force omitted when not requested");
  });

  test("force: true is included in the body when requested", async () => {
    await pushToSpokes(
      "tenant-abc",
      "agent",
      {},
      { spokes: [SPOKE_HH], force: true },
    );
    const body = JSON.parse(captured[0]!.body);
    assert.strictEqual(body.force, true);
  });

  test("trailing slash on baseUrl is normalized", async () => {
    await pushToSpokes(
      "tenant-abc",
      "agent",
      {},
      { spokes: [{ ...SPOKE_HH, baseUrl: "https://hh.example.com/" }] },
    );
    assert.strictEqual(
      captured[0]!.url,
      "https://hh.example.com/api/provisioning/agent",
    );
  });

  test("excludeSpokeSlug skips the matching spoke", async () => {
    const result = await pushToSpokes(
      "tenant-abc",
      "agent",
      {},
      { spokes: [SPOKE_HH, SPOKE_DRUMBEAT], excludeSpokeSlug: "drumbeat" },
    );
    assert.strictEqual(result.synced, 1);
    assert.strictEqual(captured.length, 1);
    assert.match(captured[0]!.url, /hh\.example\.com/);
  });

  test("onlySpokeSlug restricts the fan-out", async () => {
    const result = await pushToSpokes(
      "tenant-abc",
      "agent",
      {},
      { spokes: [SPOKE_HH, SPOKE_DRUMBEAT], onlySpokeSlug: "drumbeat" },
    );
    assert.strictEqual(result.synced, 1);
    assert.strictEqual(captured.length, 1);
    assert.match(captured[0]!.url, /drumbeat\.example\.com/);
  });
});

describe("pushToSpokes — error path", () => {
  afterEach(restoreFetch);

  test("HTTP 500 from a spoke is collected into errors, not thrown", async () => {
    installFetchStub((_req, idx) => {
      if (idx === 0) return new Response("upstream boom", { status: 500 });
      return new Response('{"ok":true}', { status: 200 });
    });
    const result = await pushToSpokes(
      "tenant-abc",
      "agent",
      {},
      { spokes: [SPOKE_HH, SPOKE_DRUMBEAT] },
    );
    assert.strictEqual(result.status, "ok");
    assert.strictEqual(result.synced, 1);
    assert.strictEqual(result.failed, 1);
    assert.strictEqual(result.errors.length, 1);
    assert.match(result.errors[0]!, /HTTP 500/);
    assert.match(result.errors[0]!, /upstream boom/);
  });

  test("network error (fetch throws) is collected into errors", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof globalThis.fetch;
    const result = await pushToSpokes(
      "tenant-abc",
      "agent",
      {},
      { spokes: [SPOKE_HH] },
    );
    assert.strictEqual(result.failed, 1);
    assert.match(result.errors[0]!, /ECONNRESET/);
  });

  test("empty spokes array short-circuits to no_spoke_apps", async () => {
    installFetchStub(() => new Response("never", { status: 200 }));
    const result = await pushToSpokes("tenant-abc", "agent", {}, { spokes: [] });
    assert.strictEqual(result.status, "no_spoke_apps");
    assert.strictEqual(result.synced, 0);
    assert.strictEqual(result.failed, 0);
    assert.strictEqual(captured.length, 0);
  });

  test("spokes filtered to empty (excludeSpokeSlug) short-circuits to no_spoke_apps", async () => {
    installFetchStub(() => new Response("never", { status: 200 }));
    const result = await pushToSpokes(
      "tenant-abc",
      "agent",
      {},
      { spokes: [SPOKE_HH], excludeSpokeSlug: "harvest-home" },
    );
    assert.strictEqual(result.status, "no_spoke_apps");
    assert.strictEqual(captured.length, 0);
  });

  test("malformed spoke (missing apiKey) is filtered out", async () => {
    installFetchStub(() => new Response('{"ok":true}', { status: 200 }));
    const malformed = { slug: "broken", baseUrl: "https://broken.example.com", apiKey: "" } as SpokeTarget;
    const result = await pushToSpokes(
      "tenant-abc",
      "agent",
      {},
      { spokes: [malformed, SPOKE_HH] },
    );
    assert.strictEqual(result.synced, 1);
    assert.strictEqual(captured.length, 1);
    assert.match(captured[0]!.url, /hh\.example\.com/);
  });

  test("empty tenantId throws RangeError", async () => {
    await assert.rejects(
      () => pushToSpokes("", "agent", {}, { spokes: [SPOKE_HH] }),
      RangeError,
    );
  });

  test("empty resourceType throws RangeError", async () => {
    await assert.rejects(
      () => pushToSpokes("tenant-abc", "", {}, { spokes: [SPOKE_HH] }),
      RangeError,
    );
  });

  test("missing options.spokes throws RangeError", async () => {
    await assert.rejects(
      () =>
        pushToSpokes(
          "tenant-abc",
          "agent",
          {},
          {} as Parameters<typeof pushToSpokes>[3],
        ),
      RangeError,
    );
  });
});

describe("pushToSpokes — tenant isolation", () => {
  beforeEach(() => {
    installFetchStub(() => new Response('{"ok":true}', { status: 200 }));
  });
  afterEach(restoreFetch);

  test("each call carries its own tenantId — no cross-tenant leakage", async () => {
    await pushToSpokes("tenant-A", "agent", { name: "Alice" }, { spokes: [SPOKE_HH] });
    await pushToSpokes("tenant-B", "agent", { name: "Bob" }, { spokes: [SPOKE_HH] });

    assert.strictEqual(captured.length, 2);
    const bodyA = JSON.parse(captured[0]!.body);
    const bodyB = JSON.parse(captured[1]!.body);
    assert.strictEqual(bodyA.tenantId, "tenant-A");
    assert.strictEqual(bodyA.name, "Alice");
    assert.strictEqual(bodyB.tenantId, "tenant-B");
    assert.strictEqual(bodyB.name, "Bob");
  });

  test("apiKey from one spoke is never sent to another spoke", async () => {
    await pushToSpokes(
      "tenant-abc",
      "agent",
      {},
      { spokes: [SPOKE_HH, SPOKE_DRUMBEAT] },
    );
    const hhCall = captured.find((c) => c.url.includes("hh.example.com"))!;
    const drumbeatCall = captured.find((c) => c.url.includes("drumbeat.example.com"))!;
    assert.strictEqual(hhCall.headers["authorization"], "Bearer rello_hh_test_key");
    assert.strictEqual(
      drumbeatCall.headers["authorization"],
      "Bearer rello_drumbeat_test_key",
    );
  });
});
