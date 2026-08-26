import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const advanced = readFileSync(new URL("./pages/Advanced.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("./pages/Settings.tsx", import.meta.url), "utf8");
const upstreams = readFileSync(new URL("./pages/Upstreams.tsx", import.meta.url), "utf8");
const providerFields = readFileSync(new URL("./pages/ProviderFormFields.tsx", import.meta.url), "utf8");
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
    expect(upstreams).toMatch(/名称（唯一标识）/);
    expect(upstreams).toMatch(/不是链 ID/);
    expect(upstreams).toMatch(/不是 RPC 服务厂商/);
    expect(upstreams).toMatch(/任意 HTTP\/HTTPS RPC/);
  });

  it("manages direct RPC nodes and vendor providers in one table", () => {
    expect(upstreams).toMatch(/listProviders/);
    expect(upstreams).toMatch(/ProviderFormFields/);
    expect(upstreams).toMatch(/自定义 RPC 节点/);
    expect(upstreams).toMatch(/providerOptions/);
    expect(upstreams).toMatch(/defaultPageSize:\s*20/);
  });

  it("generates project-unique identifiers and validates before saving", () => {
    expect(upstreams).toMatch(/randomUniqueId/);
    expect(upstreams).toMatch(/随机生成/);
    expect(upstreams).toMatch(/useValidateConfig/);
    expect(upstreams).toMatch(/validate\.mutateAsync/);
  });

  it("uses a Chinese grouped selector and binds the generated name to the input", () => {
    const idStart = upstreams.indexOf('label="名称（唯一标识）"');
    const accessModeField = upstreams.slice(upstreams.indexOf('name="accessMode"'), idStart);
    const idField = upstreams.slice(idStart, upstreams.indexOf('{accessMode === "custom"', idStart));

    expect(accessModeField).toMatch(/<Select/);
    expect(accessModeField).not.toMatch(/<AutoComplete/);
    expect(upstreams).toMatch(/label: "直接接入"/);
    expect(upstreams).toMatch(/label: "公共节点"/);
    expect(upstreams).toMatch(/label: "eRPC 内置厂商"/);
    expect(upstreams).toMatch(/其他 \/ 未收录 eRPC 厂商/);
    expect(idField).toMatch(/<Form\.Item name="id" noStyle/);
  });

  it("explains the generated node name format in Chinese", () => {
    expect(providerFields).toMatch(/自动生成的节点名称格式/);
    expect(providerFields).toMatch(/通常无需修改/);
    expect(providerFields).toMatch(/alchemy-main-evm:56/);
    expect(providerFields).toMatch(/allowCustomVendor/);
  });

  it("replaces vendor settings and keeps payload and revision on one snapshot", () => {
    expect(upstreams).toMatch(/form\.setFieldValue\("settings",/);
    expect(upstreams).toMatch(/if \(previousVendor === nextVendor\) return/);
    expect(upstreams).toMatch(/const \[editingSnapshot, setEditingSnapshot\]/);
    expect(upstreams).toMatch(/baseRevision: base\.revision/);
    expect(upstreams).toMatch(/await current\.refetch\(\)/);
    expect(upstreams).toMatch(/当前配置版本 v\{latestConfig\?\.revision\}/);
    expect(upstreams).not.toMatch(/loadedRevision/);
  });
});
