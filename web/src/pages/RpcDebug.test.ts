import { describe, expect, it } from "vitest";
import { RPC_NETWORK_PRESETS, buildPublicRPCUrl, buildRPCCommands, effectiveRPCPort, formatRPCBody, parseRPCParams, rpcResultSucceeded, savedRequestIsCurrent, savedResultForRevision, savedUpstreamRows, secretForCopiedCommand } from "./RpcDebug";

describe("RPC debug helpers", () => {
  it("provides convenience presets without closing the network input", () => {
    expect(RPC_NETWORK_PRESETS.map((item) => item.value)).toEqual([
      "evm:1",
      "evm:56",
      "evm:4663",
      "svm:mainnet-beta",
    ]);
  });

  it("accepts empty, array, and object params", () => {
    expect(parseRPCParams("  ")).toEqual([]);
    expect(parseRPCParams('["latest", false]')).toEqual(["latest", false]);
    expect(parseRPCParams('{"commitment":"finalized"}')).toEqual({ commitment: "finalized" });
  });

  it("rejects invalid JSON and scalar params", () => {
    expect(() => parseRPCParams("not-json")).toThrow("合法 JSON");
    expect(() => parseRPCParams("1")).toThrow("数组或对象");
  });

  it("formats JSON bodies and preserves non-JSON responses", () => {
    expect(formatRPCBody('{"result":"0x38"}')).toBe('{\n  "result": "0x38"\n}');
    expect(formatRPCBody("upstream unavailable")).toBe("upstream unavailable");
  });

  it("does not report HTTP 200 JSON-RPC errors as successful", () => {
    expect(rpcResultSucceeded({ httpStatus: 200, durationMs: 1, body: '{"jsonrpc":"2.0","id":1,"result":"0x38"}' })).toBe(true);
    expect(rpcResultSucceeded({ httpStatus: 200, durationMs: 1, body: '{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"denied"}}' })).toBe(false);
    expect(rpcResultSucceeded({ httpStatus: 200, durationMs: 1, body: "not-json" })).toBe(false);
    expect(rpcResultSucceeded({ httpStatus: 401, durationMs: 1, body: '{"error":"unauthorized"}' })).toBe(false);
  });

  it("builds the public three-segment request URL", () => {
    expect(buildPublicRPCUrl("http://127.0.0.1:4000/", "main", "evm:56")).toBe("http://127.0.0.1:4000/main/evm/56");
    expect(buildPublicRPCUrl("https://rpc.example", "project one", "future:network:v2")).toBe("https://rpc.example/project%20one/future/network%3Av2");
    expect(buildPublicRPCUrl("https://rpc.example", "main", "unknown")).toBe("");
  });

  it("reads the effective eRPC port and builds paste-ready commands", () => {
    expect(effectiveRPCPort({ server: { httpPortV4: 4100 } })).toBe(4100);
    expect(effectiveRPCPort({})).toBe(4000);
    expect(buildRPCCommands("http://127.0.0.1:4100/main/evm/56", "eth_chainId", [])).toEqual({
      powershell: `$body = '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'\nInvoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4100/main/evm/56' -ContentType 'application/json' -Body $body`,
      curl: `curl.exe -X POST 'http://127.0.0.1:4100/main/evm/56' -H 'Content-Type: application/json' --data-raw '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'`,
    });
    expect(buildRPCCommands("http://127.0.0.1:4100/main/evm/56", "eth_chainId", [], "project-secret")).toEqual({
      powershell: `$body = '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'\nInvoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4100/main/evm/56' -ContentType 'application/json' -Headers @{ 'X-ERPC-Secret-Token' = 'project-secret' } -Body $body`,
      curl: `curl.exe -X POST 'http://127.0.0.1:4100/main/evm/56' -H 'Content-Type: application/json' -H 'X-ERPC-Secret-Token: project-secret' --data-raw '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'`,
    });
  });

  it("keeps project secrets out of copied commands until explicitly enabled", () => {
    expect(secretForCopiedCommand("project-secret", false)).toBe("<PROJECT_SECRET>");
    expect(secretForCopiedCommand("project-secret", true)).toBe("project-secret");
    expect(secretForCopiedCommand("", true)).toBe("");
  });

  it("enumerates saved upstreams from the effective configuration", () => {
    const rows = savedUpstreamRows({
      payload: { projects: [{ id: "main" }] },
      effectivePayload: {
        projects: [{ id: "main", upstreams: [{ id: "inherited", endpoint: "https://rpc.example.test", type: "evm" }] }],
      },
    });

    expect(rows.map((row) => row.id)).toEqual(["inherited"]);
  });

  it("rejects saved responses from an obsolete revision or request sequence", () => {
    const token = { revision: 12, sequence: 4 };

    expect(savedRequestIsCurrent(token, 12, 4)).toBe(true);
    expect(savedRequestIsCurrent(token, 13, 4)).toBe(false);
    expect(savedRequestIsCurrent(token, 12, 5)).toBe(false);
  });

  it("clears an existing saved result when the configuration revision changes", () => {
    const result = { httpStatus: 200, durationMs: 5, body: '{"jsonrpc":"2.0","id":1,"result":"0x1"}' };

    expect(savedResultForRevision(result, 12, 12)).toBe(result);
    expect(savedResultForRevision(result, 12, 13)).toBeNull();
  });
});
