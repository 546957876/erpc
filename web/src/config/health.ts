import type { ConfigPayload } from "../app/api";

export type ProjectHealthSettings = {
  statePollerInterval: string;
  selectionEvalInterval: string;
  scoreMetricsWindowSize: string;
  svmStatePollerDebounce: string;
};

const runtimeDefaults: ProjectHealthSettings = {
  statePollerInterval: "30s",
  selectionEvalInterval: "15s",
  scoreMetricsWindowSize: "1m",
  svmStatePollerDebounce: "400ms",
};

export function readProjectHealthSettings(payload: ConfigPayload, projectIndex: number): ProjectHealthSettings {
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  const project = record(projects[projectIndex]);
  const upstreamEvm = record(record(project.upstreamDefaults).evm);
  const networkDefaults = record(project.networkDefaults);
  const selectionPolicy = record(networkDefaults.selectionPolicy);
  const networkSvm = record(networkDefaults.svm);
  return {
    statePollerInterval: durationValue(upstreamEvm.statePollerInterval, runtimeDefaults.statePollerInterval),
    selectionEvalInterval: durationValue(selectionPolicy.evalInterval, runtimeDefaults.selectionEvalInterval),
    scoreMetricsWindowSize: durationValue(project.scoreMetricsWindowSize, runtimeDefaults.scoreMetricsWindowSize),
    svmStatePollerDebounce: durationValue(networkSvm.statePollerDebounce, runtimeDefaults.svmStatePollerDebounce),
  };
}

export function updateProjectHealthSettings(payload: ConfigPayload, projectIndex: number, values: ProjectHealthSettings, baseline?: ProjectHealthSettings): ConfigPayload {
  const next = structuredClone(payload) as ConfigPayload;
  const projects = Array.isArray(next.projects) ? [...next.projects] : [];
  if (!projects[projectIndex]) throw new Error("项目不存在");
  const project = record(projects[projectIndex]);
  const changed = (key: keyof ProjectHealthSettings) => !baseline || values[key].trim() !== baseline[key].trim();
  if (changed("statePollerInterval")) {
    const upstreamDefaults = record(project.upstreamDefaults);
    upstreamDefaults.evm = { ...record(upstreamDefaults.evm), statePollerInterval: values.statePollerInterval.trim() };
    project.upstreamDefaults = upstreamDefaults;
  }
  if (changed("selectionEvalInterval") || changed("svmStatePollerDebounce")) {
    const networkDefaults = record(project.networkDefaults);
    if (changed("selectionEvalInterval")) networkDefaults.selectionPolicy = { ...record(networkDefaults.selectionPolicy), evalInterval: values.selectionEvalInterval.trim() };
    if (changed("svmStatePollerDebounce")) networkDefaults.svm = { ...record(networkDefaults.svm), statePollerDebounce: values.svmStatePollerDebounce.trim() };
    project.networkDefaults = networkDefaults;
  }
  if (changed("scoreMetricsWindowSize")) project.scoreMetricsWindowSize = values.scoreMetricsWindowSize.trim();
  projects[projectIndex] = project;
  next.projects = projects;
  return next;
}

export function healthSettingsEqual(left: ProjectHealthSettings, right: ProjectHealthSettings): boolean {
  return (Object.keys(runtimeDefaults) as (keyof ProjectHealthSettings)[]).every((key) => left[key].trim() === right[key].trim());
}

function durationValue(value: unknown, fallback: string): string {
  if (value == null || String(value).trim() === "" || String(value).trim() === "0" || String(value).trim() === "0s") return fallback;
  return String(value);
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
