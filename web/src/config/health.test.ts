import { describe, expect, it } from "vitest";
import { readProjectHealthSettings, updateProjectHealthSettings } from "./health";

describe("project health settings", () => {
  it("shows runtime defaults when the configuration omits health tuning", () => {
    expect(readProjectHealthSettings({ projects: [{ id: "main" }] }, 0)).toEqual({
      statePollerInterval: 30,
      selectionEvalInterval: 15,
      scoreMetricsWindowSize: 1,
      svmStatePollerDebounce: 400,
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
      statePollerInterval: 10,
      selectionEvalInterval: 4,
      scoreMetricsWindowSize: 5,
      svmStatePollerDebounce: 800,
    });
  });

  it("converts compound durations into the fixed field units", () => {
    const payload = { projects: [{
      id: "main",
      scoreMetricsWindowSize: "1m30s",
      upstreamDefaults: { evm: { statePollerInterval: "1500ms" } },
      networkDefaults: { selectionPolicy: { evalInterval: "500ms" }, svm: { statePollerDebounce: "1.5s" } },
    }] };
    expect(readProjectHealthSettings(payload, 0)).toEqual({
      statePollerInterval: 1.5,
      selectionEvalInterval: 0.5,
      scoreMetricsWindowSize: 1.5,
      svmStatePollerDebounce: 1500,
    });
  });

  it("updates one project without dropping unknown configuration", () => {
    const payload = { futureRoot: true, projects: [{ id: "main", futureProject: 1, providers: [{ id: "public", vendor: "repository" }] }, { id: "other" }] };
    const next = updateProjectHealthSettings(payload, 0, {
      statePollerInterval: 20,
      selectionEvalInterval: 5,
      scoreMetricsWindowSize: 2,
      svmStatePollerDebounce: 1000,
    });

    expect(next).not.toBe(payload);
    expect(next.futureRoot).toBe(true);
    expect((next.projects as any[])[0]).toMatchObject({
      id: "main",
      futureProject: 1,
      providers: [{ id: "public", vendor: "repository" }],
      scoreMetricsWindowSize: "2m",
      upstreamDefaults: { evm: { statePollerInterval: "20s" } },
      networkDefaults: { selectionPolicy: { evalInterval: "5s" }, svm: { statePollerDebounce: "1000ms" } },
    });
    expect((next.projects as any[])[1]).toEqual({ id: "other" });
    expect(payload).toEqual({ futureRoot: true, projects: [{ id: "main", futureProject: 1, providers: [{ id: "public", vendor: "repository" }] }, { id: "other" }] });
  });

  it("does not pin displayed defaults that the operator did not change", () => {
    const baseline = readProjectHealthSettings({ projects: [{ id: "main" }] }, 0);
    const next = updateProjectHealthSettings({ projects: [{ id: "main" }] }, 0, {
      ...baseline,
      statePollerInterval: 20,
    }, baseline);

    expect(next).toEqual({ projects: [{ id: "main", upstreamDefaults: { evm: { statePollerInterval: "20s" } } }] });
  });

  it("rejects a missing project instead of creating an ambiguous target", () => {
    expect(() => updateProjectHealthSettings({ projects: [] }, 0, {
      statePollerInterval: 30,
      selectionEvalInterval: 15,
      scoreMetricsWindowSize: 1,
      svmStatePollerDebounce: 400,
    })).toThrow("项目不存在");
  });

  it("writes the fixed units back to eRPC duration strings", () => {
    const next = updateProjectHealthSettings({ projects: [{ id: "main" }] }, 0, {
      statePollerInterval: 600,
      selectionEvalInterval: 15,
      scoreMetricsWindowSize: 2,
      svmStatePollerDebounce: 400,
    });
    expect(next).toEqual({
      projects: [{
        id: "main",
        upstreamDefaults: { evm: { statePollerInterval: "600s" } },
        networkDefaults: { selectionPolicy: { evalInterval: "15s" }, svm: { statePollerDebounce: "400ms" } },
        scoreMetricsWindowSize: "2m",
      }],
    });
  });
});
