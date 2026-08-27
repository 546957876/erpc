import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteConfigRevision, normalizeValidationResult, testSavedUpstream, testTargetRpc } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockResponse(payload: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("validation response boundary", () => {
  it("turns omitted or null report lists into empty arrays", () => {
    expect(normalizeValidationResult({ valid: true, errors: null as never, warnings: null as never, notices: undefined })).toEqual({
      valid: true,
      errors: [],
      warnings: [],
      notices: [],
      report: undefined,
    });
  });
});

describe("RPC test requests", () => {
  it("posts an open method and params to a saved upstream revision", async () => {
    const result = { httpStatus: 200, durationMs: 17, body: "not-json" };
    const fetchMock = mockResponse(result);
    const input = {
      revision: 12,
      projectId: "future-project",
      upstreamId: "future-upstream",
      method: "future_rpcMethod",
      params: { untouched: [1, "two"] },
    };

    await expect(testSavedUpstream(input)).resolves.toEqual(result);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/config/upstreams/test");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it("URL-encodes the target and preserves an unknown network and method", async () => {
    const result = { httpStatus: 503, durationMs: 41, body: "{broken", upstream: "node-1" };
    const fetchMock = mockResponse(result);
    const input = {
      projectId: "future-project",
      networkId: "future:chain-x",
      upstreamId: "node-1",
      projectSecret: "project-secret",
      method: "future_namespace_probe",
      params: ["latest"],
    };

    await expect(testTargetRpc("local erpc/\u4e1c", input)).resolves.toEqual(result);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/targets/local%20erpc%2F%E4%B8%9C/rpc-test");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(input);
  });
});

describe("configuration revisions", () => {
  it("deletes a selected historical revision", async () => {
    const fetchMock = mockResponse({ revision: 7, deleted: true });

    await expect(deleteConfigRevision(7)).resolves.toEqual({ revision: 7, deleted: true });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/config/revisions/7");
    expect(init.method).toBe("DELETE");
  });
});
