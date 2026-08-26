import { describe, expect, it } from "vitest";
import { countTopology, topologyProjects } from "./App";

describe("拓扑数据边界", () => {
  it("配置保存后 eRPC 返回空或半成品拓扑时仍能渲染", () => {
    expect(topologyProjects({ projects: null as never })).toEqual([]);
    expect(countTopology(null)).toEqual({ projects: 0, networks: 0, upstreams: 0 });
    expect(countTopology([{ id: "main", networks: null as never }])).toEqual({ projects: 1, networks: 0, upstreams: 0 });
    expect(countTopology([{ id: "main", networks: [{ id: "bsc", upstreams: null as never }] }])).toEqual({ projects: 1, networks: 1, upstreams: 0 });
  });
});
