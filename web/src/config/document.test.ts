import { describe, expect, it } from "vitest";
import schema from "./schema.generated.json";
import { applyFormChanges, configDocumentsEqual, createInitialConfig, deleteOverride, extractOverrides, fieldState, fromFormDocument, materializeEffectiveConfig, mergeKnownConfig, toFormDocument, type ConfigSchema } from "./document";

const smallSchema: ConfigSchema = {
  root: { kind: "object", ref: "Config" },
  definitions: {
    Config: { fields: [{ key: "server", node: { kind: "object", ref: "Server" } }] },
    Server: { fields: [{ key: "httpPortV4", node: { kind: "number" } }] },
  },
};

describe("structured eRPC configuration", () => {
  it("starts with a sparse override until the API supplies pinned defaults", () => {
    expect(createInitialConfig()).toEqual({});
  });

  it("materializes defaults and extracts only changed values", () => {
    const defaults = { server: { httpPortV4: 4000, listenV4: true }, future: { enabled: true } };
    const effective = materializeEffectiveConfig({}, defaults, smallSchema);
    expect(effective).toEqual(defaults);
    expect(extractOverrides(effective, defaults, smallSchema)).toEqual({});
    expect(extractOverrides({ server: { httpPortV4: 4100, listenV4: true }, future: { enabled: true } }, defaults, smallSchema, { future: { enabled: false } })).toEqual({ server: { httpPortV4: 4100 }, future: { enabled: false } });
  });

  it("detects real sparse configuration changes and reversions", () => {
    const defaults = { server: { httpPortV4: 4000 } };
    const saved = {};
    const changed = extractOverrides({ server: { httpPortV4: 4100 } }, defaults, smallSchema, saved);
    const reverted = extractOverrides({ server: { httpPortV4: 4000 } }, defaults, smallSchema, changed);

    expect(configDocumentsEqual(saved, {})).toBe(true);
    expect(configDocumentsEqual(saved, changed)).toBe(false);
    expect(configDocumentsEqual(saved, reverted)).toBe(true);
    expect(configDocumentsEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("replaces arrays as a unit and resets one override", () => {
    const defaults = { projects: [{ id: "main" }] };
    const edited = { projects: [{ id: "main" }, { id: "backup" }] };
    expect(extractOverrides(edited, defaults, smallSchema)).toEqual({ projects: [{ id: "main" }, { id: "backup" }] });
    const overrides = { server: { httpPortV4: 4100 }, future: { enabled: true } };
    expect(deleteOverride(overrides, ["server", "httpPortV4"])).toEqual({ future: { enabled: true } });
    expect(fieldState(["server", "httpPortV4"], overrides, { server: { httpPortV4: 4000 } })).toBe("custom");
    expect(fieldState(["server", "httpPortV4"], {}, { server: { httpPortV4: 4000 } })).toBe("system-default");
    expect(fieldState(["server", "missing"], {}, { server: {} })).toBe("unset");
  });

  it("applies changed form fragments without losing existing unknown keys", () => {
    const defaults = { server: { httpPortV4: 4000 } };
    const overrides = { futureRoot: { keep: true } };
    expect(applyFormChanges(overrides, { server: { httpPortV4: 4100 } }, defaults, smallSchema)).toEqual({ futureRoot: { keep: true }, server: { httpPortV4: 4100 } });
  });

  it("keeps unknown fields nested under a known object", () => {
    const defaults = { server: { httpPortV4: 4000 } };
    const overrides = { server: { futureServerFlag: "keep" } };
    expect(extractOverrides({ server: { httpPortV4: 4000 } }, defaults, smallSchema, overrides)).toEqual(overrides);
  });

  it("keeps unknown fields inside an edited map value", () => {
    const schema: ConfigSchema = {
      root: { kind: "object", ref: "Config" },
      definitions: {
        Config: { fields: [{ key: "checks", node: { kind: "map", value: { kind: "object", ref: "Check" } } }] },
        Check: { fields: [{ key: "enabled", node: { kind: "boolean" } }] },
      },
    };
    const existing = { checks: { primary: { enabled: true, futureCheckFlag: "keep" } } };

    expect(extractOverrides({ checks: { primary: { enabled: false } } }, { checks: {} }, schema, existing)).toEqual({
      checks: { primary: { enabled: false, futureCheckFlag: "keep" } },
    });
  });

  it("does not resurrect a map entry deleted in the form", () => {
    const schema: ConfigSchema = {
      root: { kind: "object", ref: "Config" },
      definitions: {
        Config: { fields: [{ key: "checks", node: { kind: "map", value: { kind: "object", ref: "Check" } } }] },
        Check: { fields: [{ key: "enabled", node: { kind: "boolean" } }] },
      },
    };
    const existing = { checks: {
      keep: { enabled: true, futureCheckFlag: "keep" },
      remove: { enabled: true, futureCheckFlag: "remove" },
    } };

    expect(extractOverrides({ checks: { keep: { enabled: true } } }, { checks: {} }, schema, existing)).toEqual({
      checks: { keep: { enabled: true, futureCheckFlag: "keep" } },
    });
  });

  it("matches network array items by nested chain identity after deletion", () => {
    const schema: ConfigSchema = {
      root: { kind: "object", ref: "Config" },
      definitions: {
        Config: { fields: [{ key: "networks", node: { kind: "array", item: { kind: "object", ref: "Network" } } }] },
        Network: { fields: [{ key: "architecture", node: { kind: "string" } }, { key: "evm", node: { kind: "object", ref: "EvmNetwork" } }] },
        EvmNetwork: { fields: [{ key: "chainId", node: { kind: "number" } }] },
      },
    };
    const existing = { networks: [
      { architecture: "evm", evm: { chainId: 1 }, futureNetworkFlag: "one" },
      { architecture: "evm", evm: { chainId: 56 }, futureNetworkFlag: "two" },
    ] };

    expect(extractOverrides({ networks: [{ architecture: "evm", evm: { chainId: 56 } }] }, { networks: [] }, schema, existing)).toEqual({
      networks: [{ architecture: "evm", evm: { chainId: 56 }, futureNetworkFlag: "two" }],
    });
  });

  it("keeps unknown array fields when an identity is renamed in place", () => {
    const schema: ConfigSchema = {
      root: { kind: "object", ref: "Config" },
      definitions: {
        Config: { fields: [{ key: "items", node: { kind: "array", item: { kind: "object", ref: "Item" } } }] },
        Item: { fields: [{ key: "id", node: { kind: "string" } }] },
      },
    };
    const existing = { items: [{ id: "old", futureItemFlag: "keep" }, { id: "stable", futureItemFlag: "stable" }] };

    expect(extractOverrides({ items: [{ id: "renamed" }, { id: "stable" }] }, { items: [] }, schema, existing)).toEqual({
      items: [{ id: "renamed", futureItemFlag: "keep" }, { id: "stable", futureItemFlag: "stable" }],
    });
  });

  it("keeps unknown and deprecated fields inside arrays when saving known edits", () => {
    const schema: ConfigSchema = {
      root: { kind: "object", ref: "Config" },
      definitions: {
        Config: { fields: [{ key: "projects", node: { kind: "array", item: { kind: "object", ref: "Project" } } }, { key: "server", node: { kind: "object", ref: "Server" } }] },
        Project: { fields: [{ key: "id", node: { kind: "string" } }] },
        Server: { fields: [{ key: "httpPortV4", node: { kind: "number" } }, { key: "httpPort", node: { kind: "number" }, deprecated: true }] },
      },
    };
    const defaults = { projects: [{ id: "main" }], server: { httpPortV4: 4000 } };
    const existing = { projects: [{ id: "main", futureProjectFlag: true }], server: { httpPort: 3999 } };
    expect(extractOverrides({ projects: [{ id: "main" }], server: { httpPortV4: 4100 } }, defaults, schema, existing)).toEqual({ projects: [{ id: "main", futureProjectFlag: true }], server: { httpPortV4: 4100, httpPort: 3999 } });
  });

  it("does not resurrect deleted array items or attach opaque fields to another id", () => {
    const schema: ConfigSchema = {
      root: { kind: "object", ref: "Config" },
      definitions: {
        Config: { fields: [{ key: "projects", node: { kind: "array", item: { kind: "object", ref: "Project" } } }] },
        Project: { fields: [{ key: "id", node: { kind: "string" } }] },
      },
    };
    const defaults = { projects: [] };
    const existing = { projects: [{ id: "a", future: "A" }, { id: "b", future: "B" }] };
    expect(extractOverrides({ projects: [{ id: "b" }] }, defaults, schema, existing)).toEqual({ projects: [{ id: "b", future: "B" }] });
    expect(extractOverrides({ projects: [{ id: "b" }, { id: "a" }] }, defaults, schema, existing)).toEqual({ projects: [{ id: "b", future: "B" }, { id: "a", future: "A" }] });
  });

  it("contains every current root configuration group", () => {
    const generated = schema as ConfigSchema;
    const root = generated.definitions[generated.root.ref || ""];
    expect(root.fields.map((field) => field.key)).toEqual(expect.arrayContaining([
      "logLevel", "clusterKey", "server", "healthCheck", "admin",
      "database", "projects", "rateLimiters", "metrics", "proxyPools", "tracing",
    ]));
  });

  it("round-trips maps and preserves unknown fields from a newer eRPC version", () => {
    const original = { server: { httpPortV4: 4000, futureServerFlag: "keep" }, futureRoot: { enabled: true } };
    const formValue = toFormDocument({ headers: { authorization: "secret" } }, {
      root: { kind: "object", ref: "MapRoot" },
      definitions: { MapRoot: { fields: [{ key: "headers", node: { kind: "map", value: { kind: "string" } } }] } },
    });
    expect(fromFormDocument(formValue, {
      root: { kind: "object", ref: "MapRoot" },
      definitions: { MapRoot: { fields: [{ key: "headers", node: { kind: "map", value: { kind: "string" } } }] } },
    })).toEqual({ headers: { authorization: "secret" } });

    expect(mergeKnownConfig(original, { server: { httpPortV4: 4100 } }, smallSchema)).toEqual({
      server: { httpPortV4: 4100, futureServerFlag: "keep" },
      futureRoot: { enabled: true },
    });
  });

  it("omits empty optional network scope arrays from form documents", () => {
    const providerSchema: ConfigSchema = {
      root: { kind: "object", ref: "Config" },
      definitions: {
        Config: { fields: [{ key: "providers", node: { kind: "array", item: { kind: "object", ref: "Provider" } } }] },
        Provider: {
          fields: [
            { key: "id", node: { kind: "string" } },
            { key: "vendor", node: { kind: "string" } },
            { key: "onlyNetworks", node: { kind: "array", item: { kind: "string" } } },
            { key: "ignoreNetworks", node: { kind: "array", item: { kind: "string" } } },
          ],
        },
      },
    };

    expect(fromFormDocument({ providers: [{ id: "alchemy", vendor: "alchemy", onlyNetworks: [], ignoreNetworks: [] }] }, providerSchema)).toEqual({
      providers: [{ id: "alchemy", vendor: "alchemy" }],
    });

    const svmSchema: ConfigSchema = {
      root: { kind: "object", ref: "SvmNetworkConfig" },
      definitions: { SvmNetworkConfig: { fields: [{ key: "statePollerDebounce", node: { kind: "string" }, owner: "SvmNetworkConfig" }] } },
    };
    expect(fromFormDocument({ statePollerDebounce: "6000" }, svmSchema)).toEqual({ statePollerDebounce: "6000ms" });
    expect(fromFormDocument({ statePollerDebounce: 6000 }, svmSchema)).toEqual({ statePollerDebounce: "6000ms" });

    const authSchema: ConfigSchema = {
      root: { kind: "object", ref: "Config" },
      definitions: {
        Config: { fields: [{ key: "auth", node: { kind: "object", ref: "AuthConfig" } }] },
        AuthConfig: { fields: [{ key: "strategies", node: { kind: "array", item: { kind: "object", ref: "Strategy" } } }] },
        Strategy: { fields: [{ key: "type", node: { kind: "string" } }] },
      },
    };
    expect(fromFormDocument({ auth: { strategies: [] } }, authSchema)).toEqual({});
  });
});
