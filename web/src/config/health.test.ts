import { describe, expect, it } from "vitest";
import { readProjectHealthSettings, updateProjectHealthSettings } from "./health";

describe("project health settings", () => {
  it("shows runtime defaults when the configuration omits health tuning", () => {
    expect(readProjectHealthSettings({ projects: [{ id: "main" }] }, 0)).toEqual({
      statePollerInterval: "30s",
      selectionEvalInterval: "15s",
      scoreMetricsWindowSize: "1m",
      svmStatePollerDebounce: "400ms",
    });
  });

  it("reads explicit project values", () => {
    const payload = { projects: [{
      id: "main",
      scoreMetricsWindowSize: "5m",
      upstreamDefaults: { evm: { statePollerInterval: "10s" } },
      networkDefaults: { selectionPolicy: { evalInterval: "4s" }, svm: { statePollerDebounce: "800ms" } },
    }] };
    expect(readProjectHealthSettings(payload, 0)).toEqual({
      statePollerInterval: "10s",
      selectionEvalInterval: "4s",
      scoreMetricsWindowSize: "5m",
      svmStatePollerDebounce: "800ms",
    });
  });

  it("updates one project without dropping unknown configuration", () => {
    const payload = { futureRoot: true, projects: [{ id: "main", futureProject: 1, providers: [{ id: "public", vendor: "repository" }] }, { id: "other" }] };
    const next = updateProjectHealthSettings(payload, 0, {
      statePollerInterval: "20s",
      selectionEvalInterval: "5s",
      scoreMetricsWindowSize: "2m",
      svmStatePollerDebounce: "1s",
    });

    expect(next).not.toBe(payload);
    expect(next.futureRoot).toBe(true);
    expect((next.projects as any[])[0]).toMatchObject({
      id: "main",
      futureProject: 1,
      providers: [{ id: "public", vendor: "repository" }],
      scoreMetricsWindowSize: "2m",
      upstreamDefaults: { evm: { statePollerInterval: "20s" } },
      networkDefaults: { selectionPolicy: { evalInterval: "5s" }, svm: { statePollerDebounce: "1s" } },
    });
    expect((next.projects as any[])[1]).toEqual({ id: "other" });
    expect(payload).toEqual({ futureRoot: true, projects: [{ id: "main", futureProject: 1, providers: [{ id: "public", vendor: "repository" }] }, { id: "other" }] });
  });

  it("does not pin displayed defaults that the operator did not change", () => {
    const baseline = readProjectHealthSettings({ projects: [{ id: "main" }] }, 0);
    const next = updateProjectHealthSettings({ projects: [{ id: "main" }] }, 0, {
      ...baseline,
      statePollerInterval: "20s",
    }, baseline);

    expect(next).toEqual({ projects: [{ id: "main", upstreamDefaults: { evm: { statePollerInterval: "20s" } } }] });
  });

  it("rejects a missing project instead of creating an ambiguous target", () => {
    expect(() => updateProjectHealthSettings({ projects: [] }, 0, {
      statePollerInterval: "30s",
      selectionEvalInterval: "15s",
      scoreMetricsWindowSize: "1m",
      svmStatePollerDebounce: "400ms",
    })).toThrow("项目不存在");
  });
});
