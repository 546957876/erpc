import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const advanced = readFileSync(new URL("./pages/Advanced.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("./pages/Settings.tsx", import.meta.url), "utf8");
const upstreams = readFileSync(new URL("./pages/Upstreams.tsx", import.meta.url), "utf8");
const configFields = readFileSync(new URL("./config/ConfigFields.tsx", import.meta.url), "utf8");

describe("field-only configuration UI", () => {
  it("never asks the operator to edit or import YAML", () => {
    expect(advanced).not.toMatch(/Input\.TextArea|yaml-editor|粘贴完整的 erpc\.yaml/i);
    expect(settings).not.toMatch(/导入 erpc\.yaml/i);
    expect(upstreams).not.toMatch(/导入 erpc\.yaml/i);
  });

  it("renders the generated schema as Chinese field controls", () => {
    expect(advanced).toMatch(/ConfigFields/);
    expect(advanced).toMatch(/完整配置/);
    expect(advanced).toMatch(/首次配置/);
  });

  it("exports a reusable renderer for one schema definition", () => {
    expect(configFields).toMatch(/export function ConfigDefinitionFields/);
    expect(configFields).toMatch(/ref: definition/);
  });

  it("only enables revision saves for real configuration changes", () => {
    expect(advanced).toMatch(/configDocumentsEqual/);
    expect(settings).toMatch(/configDocumentsEqual/);
    expect(advanced.match(/disabled=\{!dirty\}/g)).toHaveLength(2);
    expect(settings).toMatch(/disabled=\{!dirty\}/);
  });

  it("keeps the latest saved baseline across asynchronous config refreshes", () => {
    expect(advanced).toMatch(/baseRevision: loadedRevision\.current/);
    expect(settings).toMatch(/const loadedRevision = useRef\(0\)/);
    expect(settings).toMatch(/dirty \|\| revision < loadedRevision\.current/);
    expect(settings).toMatch(/baseRevision: loadedRevision\.current/);
    expect(settings).not.toMatch(/String\(payload\.logLevel\)\.toUpperCase\(\)/);
  });

  it("explains upstream identity and accepts vendor-neutral RPC addresses", () => {
    expect(upstreams).toMatch(/节点名称（唯一标识）/);
    expect(upstreams).toMatch(/不是链 ID/);
    expect(upstreams).toMatch(/不是 RPC 服务厂商/);
    expect(upstreams).toMatch(/任意 HTTP\/HTTPS RPC/);
  });
});
