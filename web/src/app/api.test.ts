import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, getAuthStatus, loginAdministrator, setupAdministrator, type ConfigRevision } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("administrator authentication API", () => {
  it("loads setup state with same-origin cookies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ setupRequired: true, authenticated: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAuthStatus()).resolves.toEqual({ setupRequired: true, authenticated: false });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/status", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("sends credentials without a browser token header", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ authenticated: true }), { status: 201 })));
    vi.stubGlobal("fetch", fetchMock);

    await setupAdministrator("admin", "correct-horse");
    await loginAdministrator("admin", "correct-horse");

    for (const [, init] of fetchMock.mock.calls) {
      const headers = new Headers(init.headers);
      expect(headers.has("x-admin-token")).toBe(false);
      expect(init.credentials).toBe("same-origin");
    }
  });
});

describe("configuration API", () => {
  it("keeps override, effective, and default payloads as objects", async () => {
    const response: ConfigRevision = {
      revision: 1,
      payload: {},
      effectivePayload: { server: { httpPortV4: 4000 } },
      defaultPayload: { server: { httpPortV4: 4000 } },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest<ConfigRevision>("/api/config/current")).resolves.toEqual(response);
  });
});
