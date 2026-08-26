import { describe, expect, it } from "vitest";
import { countTopology, runtimeProbeState, topologyProjects, topologyRowKey, upstreamHealthDetails } from "./App";

describe("拓扑数据边界", () => {
  it("配置保存后 eRPC 返回空或半成品拓扑时仍能渲染", () => {
    expect(topologyProjects({ projects: null as never })).toEqual([]);
    expect(countTopology(null)).toEqual({ projects: 0, networks: 0, upstreams: 0 });
    expect(countTopology([{ id: "main", networks: null as never }])).toEqual({ projects: 1, networks: 0, upstreams: 0 });
    expect(countTopology([{ id: "main", networks: [{ id: "bsc", upstreams: null as never }] }])).toEqual({ projects: 1, networks: 1, upstreams: 0 });
  });

  it("只返回网络和上游都精确匹配的一条健康记录", () => {
    const health = { upstreams: [
      { id: "node-a", networkId: "evm:1", metrics: { "*": { errorRate: 0 } } },
      { id: "node-a", networkId: "evm:56", metrics: { "*": { errorRate: 0.5 } } },
    ] };
    expect(upstreamHealthDetails(health, "node-a", "evm:56")).toEqual(health.upstreams[1]);
    expect(upstreamHealthDetails(health, "missing", "evm:56")).toBeNull();
    expect(upstreamHealthDetails({ upstreams: [health.upstreams[1], health.upstreams[1]] }, "node-a", "evm:56")).toBeNull();
  });

  it("只有实际上游匹配时才把定向测试标记为通过", () => {
    const success = { httpStatus: 200, durationMs: 5, body: '{"jsonrpc":"2.0","id":1,"result":"0x38"}' };
    expect(runtimeProbeState({ ...success, upstream: "node-a" }, "node-a")).toEqual({ status: "healthy", label: "测试通过" });
    expect(runtimeProbeState({ ...success, upstream: "node-b" }, "node-a")).toEqual({ status: "degraded", label: "定向未生效" });
    expect(runtimeProbeState(success, "node-a")).toEqual({ status: "unknown", label: "响应成功" });
    expect(runtimeProbeState({ ...success, httpStatus: 401 }, "node-a")).toEqual({ status: "unauthorized", label: "需认证" });
  });

  it("不同 eRPC 实例的同名上游使用不同测试状态键", () => {
    expect(topologyRowKey("local-a", "main", "evm:56", "node-a"))
      .not.toBe(topologyRowKey("local-b", "main", "evm:56", "node-a"));
  });
});
