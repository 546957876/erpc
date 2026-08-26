import { describe, expect, it } from "vitest";
import schema from "./schema.generated.json";
import { allMetadata, metadataFor } from "./metadata";
import type { ConfigSchema } from "./document";

describe("配置字段中文元数据", () => {
  it("为生成 schema 的每个字段提供中文标签、说明、示例和默认分类", () => {
    const items = allMetadata(schema as ConfigSchema);
    expect(items.length).toBeGreaterThan(200);
    for (const item of items) {
      expect(item.label).toMatch(/[\u4e00-\u9fff]/);
      expect(item.description.length).toBeGreaterThan(4);
      expect(item.description).toMatch(/[\u4e00-\u9fff]/);
      expect(item.example.length).toBeGreaterThan(0);
      expect(["runtime", "inherited", "none", "deprecated"]).toContain(item.defaultKind);
      expect(typeof item.restartRequired).toBe("boolean");
      expect(item.yamlKey.length).toBeGreaterThan(0);
    }
  });

  it("将旧版 server.httpPort 标记为弃用", () => {
    const item = allMetadata(schema as ConfigSchema).find((candidate) => candidate.yamlKey === "httpPort");
    expect(item?.deprecated).toBe(true);
    expect(item?.defaultKind).toBe("deprecated");
  });

  it("按拥有者区分重复字段，并保持默认说明为中文", () => {
    const typed = schema as ConfigSchema;
    const serverPort = metadataFor(["ServerConfig", "httpPortV4"], { kind: "number" }, typed);
    const upstreamId = metadataFor(["UpstreamConfig", "id"], { kind: "string" }, typed);
    const upstreamType = metadataFor(["UpstreamConfig", "type"], { kind: "string" }, typed);
    const upstreamEndpoint = metadataFor(["UpstreamConfig", "endpoint"], { kind: "string" }, typed);
    expect(serverPort.label).toBe("IPv4 HTTP 端口");
    expect(upstreamId.label).toBe("节点名称（唯一标识）");
    expect(upstreamId.description).toContain("不是链 ID");
    expect(upstreamType.description).toContain("不是 RPC 服务厂商");
    expect(upstreamEndpoint.description).toContain("任意 HTTP/HTTPS RPC");
    expect(serverPort.description).toMatch(/[\u4e00-\u9fff]/);
  });

  it("沿数组通配路径找到上游字段元数据", () => {
    const item = metadataFor(["projects", "*", "upstreams", "*", "type"], { kind: "string" }, schema as ConfigSchema);

    expect(item.label).toBe("协议类型");
    expect(item.description).toContain("不是 RPC 服务厂商");
  });
});
