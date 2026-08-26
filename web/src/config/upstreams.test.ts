import { describe, expect, it } from "vitest";
import { addUpstream, listUpstreams, randomUniqueId, removeUpstream, updateUpstream } from "./upstreams";

function manyNodePayload(count = 160) {
  return {
    projects: [
      {
        id: "main",
        futureProjectFlag: "keep",
        upstreams: Array.from({ length: count }, (_, index) => ({
          id: `node-${index}`,
          endpoint: `https://rpc-${index}.example.test`,
          type: "evm",
          futureNodeField: { ordinal: index },
        })),
      },
      { id: "backup", upstreams: [{ id: "node-0", endpoint: "https://backup.example.test" }] },
    ],
  };
}

describe("上游节点 CRUD", () => {
  it("读取大量节点时保留项目边界和稳定定位信息", () => {
    const payload = manyNodePayload();
    const rows = listUpstreams(payload);

    expect(rows).toHaveLength(161);
    expect(rows[0]).toMatchObject({ projectIndex: 0, upstreamIndex: 0, projectId: "main", id: "node-0" });
    expect(rows[159]).toMatchObject({ projectIndex: 0, upstreamIndex: 159, id: "node-159" });
    expect(rows[160]).toMatchObject({ projectIndex: 1, upstreamIndex: 0, projectId: "backup", id: "node-0" });
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it("新增节点只改目标项目，并保留原文档", () => {
    const payload = manyNodePayload(3);
    const next = addUpstream(payload, { projectIndex: 0, id: "new-node", endpoint: " https://new.example.test ", type: "custom-chain" });

    expect(listUpstreams(next)).toHaveLength(5);
    expect((next.projects as any[])[0].upstreams.at(-1)).toEqual({ id: "new-node", endpoint: "https://new.example.test", type: "custom-chain" });
    expect((next.projects as any[])[1].upstreams).toHaveLength(1);
    expect((payload.projects as any[])[0].upstreams).toHaveLength(3);
  });

  it("修改指定节点时保留未来字段，清空类型可恢复系统默认", () => {
    const payload = manyNodePayload(8);
    const next = updateUpstream(payload, { projectIndex: 0, upstreamIndex: 6 }, { projectIndex: 0, id: "node-6-renamed", endpoint: "https://changed.example.test", type: " " });
    const changed = (next.projects as any[])[0].upstreams[6];

    expect(changed).toEqual({ id: "node-6-renamed", endpoint: "https://changed.example.test", futureNodeField: { ordinal: 6 } });
    expect((payload.projects as any[])[0].upstreams[6].id).toBe("node-6");
  });

  it("删除中间节点不会错删相邻节点或另一个项目的同名节点", () => {
    const payload = manyNodePayload();
    const target = listUpstreams(payload).find((row) => row.projectId === "main" && row.id === "node-80")!;
    const next = removeUpstream(payload, target);
    const rows = listUpstreams(next);

    expect(rows).toHaveLength(160);
    expect(rows.some((row) => row.projectId === "main" && row.id === "node-80")).toBe(false);
    expect(rows.find((row) => row.projectId === "main" && row.id === "node-79")?.raw.futureNodeField).toEqual({ ordinal: 79 });
    expect(rows.find((row) => row.projectId === "main" && row.id === "node-81")?.raw.futureNodeField).toEqual({ ordinal: 81 });
    expect(rows.some((row) => row.projectId === "backup" && row.id === "node-0")).toBe(true);
  });

  it("只禁止同一项目重复 ID，跨项目可使用相同 ID", () => {
    const payload = manyNodePayload(2);

    expect(() => addUpstream(payload, { projectIndex: 0, id: "node-1", endpoint: "https://duplicate.example.test" })).toThrow("同一项目内");
    expect(() => addUpstream(payload, { projectIndex: 1, id: "node-1", endpoint: "https://allowed.example.test" })).not.toThrow();
    expect(() => addUpstream(payload, { projectIndex: 0, id: " ", endpoint: "https://invalid.example.test" })).toThrow("节点名称");
    expect(() => addUpstream(payload, { projectIndex: 0, id: "valid", endpoint: " " })).toThrow("RPC 地址");
  });
});

it("随机名称带前缀并跳过当前项目内冲突", () => {
  const values = ["00000000-0000-0000-0000-000000000000", "11111111-1111-1111-1111-111111111111"];
  expect(randomUniqueId("rpc", new Set(["rpc-00000000"]), () => values.shift()!)).toBe("rpc-11111111");
});
