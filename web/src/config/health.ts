import type { ConfigPayload } from "../app/api";

export type ProjectHealthSettings = {
  statePollerInterval: number;
  selectionEvalInterval: number;
  scoreMetricsWindowSize: number;
  svmStatePollerDebounce: number;
};

type DurationUnit = "s" | "m" | "ms";

const runtimeDefaults: ProjectHealthSettings = {
  statePollerInterval: 30,
  selectionEvalInterval: 15,
  scoreMetricsWindowSize: 1,
  svmStatePollerDebounce: 400,
};

const durationUnits: Record<keyof ProjectHealthSettings, DurationUnit> = {
  statePollerInterval: "s",
  selectionEvalInterval: "s",
  scoreMetricsWindowSize: "m",
  svmStatePollerDebounce: "ms",
};

export function readProjectHealthSettings(payload: ConfigPayload, projectIndex: number): ProjectHealthSettings {
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  const project = record(projects[projectIndex]);
  const upstreamEvm = record(record(project.upstreamDefaults).evm);
  const networkDefaults = record(project.networkDefaults);
  const selectionPolicy = record(networkDefaults.selectionPolicy);
  const networkSvm = record(networkDefaults.svm);
  return {
    statePollerInterval: durationNumber(upstreamEvm.statePollerInterval, runtimeDefaults.statePollerInterval, durationUnits.statePollerInterval),
    selectionEvalInterval: durationNumber(selectionPolicy.evalInterval, runtimeDefaults.selectionEvalInterval, durationUnits.selectionEvalInterval),
    scoreMetricsWindowSize: durationNumber(project.scoreMetricsWindowSize, runtimeDefaults.scoreMetricsWindowSize, durationUnits.scoreMetricsWindowSize),
    svmStatePollerDebounce: durationNumber(networkSvm.statePollerDebounce, runtimeDefaults.svmStatePollerDebounce, durationUnits.svmStatePollerDebounce),
  };
}

export function updateProjectHealthSettings(payload: ConfigPayload, projectIndex: number, values: ProjectHealthSettings, baseline?: ProjectHealthSettings): ConfigPayload {
  const next = structuredClone(payload) as ConfigPayload;
  const projects = Array.isArray(next.projects) ? [...next.projects] : [];
  if (!projects[projectIndex]) throw new Error("项目不存在");
  const project = record(projects[projectIndex]);
  const changed = (key: keyof ProjectHealthSettings) => !baseline || values[key] !== baseline[key];
  if (changed("statePollerInterval")) {
    const upstreamDefaults = record(project.upstreamDefaults);
    upstreamDefaults.evm = { ...record(upstreamDefaults.evm), statePollerInterval: formatDuration(values.statePollerInterval, durationUnits.statePollerInterval) };
    project.upstreamDefaults = upstreamDefaults;
  }
  if (changed("selectionEvalInterval") || changed("svmStatePollerDebounce")) {
    const networkDefaults = record(project.networkDefaults);
    if (changed("selectionEvalInterval")) networkDefaults.selectionPolicy = { ...record(networkDefaults.selectionPolicy), evalInterval: formatDuration(values.selectionEvalInterval, durationUnits.selectionEvalInterval) };
    if (changed("svmStatePollerDebounce")) networkDefaults.svm = { ...record(networkDefaults.svm), statePollerDebounce: formatDuration(values.svmStatePollerDebounce, durationUnits.svmStatePollerDebounce) };
    project.networkDefaults = networkDefaults;
  }
  if (changed("scoreMetricsWindowSize")) project.scoreMetricsWindowSize = formatDuration(values.scoreMetricsWindowSize, durationUnits.scoreMetricsWindowSize);
  projects[projectIndex] = project;
  next.projects = projects;
  return next;
}

export function healthSettingsEqual(left: ProjectHealthSettings, right: ProjectHealthSettings): boolean {
  return (Object.keys(runtimeDefaults) as (keyof ProjectHealthSettings)[]).every((key) => left[key] === right[key]);
}

const durationMilliseconds: Record<DurationUnit, number> = { s: 1000, m: 60_000, ms: 1 };
const durationToken = /([+-]?(?:\d+(?:\.\d*)?|\.\d+))(ns|us|µs|ms|s|m|h)/g;

function durationNumber(value: unknown, fallback: number, unit: DurationUnit): number {
  const milliseconds = parseDurationMilliseconds(value);
  if (milliseconds == null || milliseconds <= 0) return fallback;
  return Number((milliseconds / durationMilliseconds[unit]).toFixed(6));
}

function parseDurationMilliseconds(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const text = String(value ?? "").trim();
  if (!text || text === "0") return undefined;
  durationToken.lastIndex = 0;
  let cursor = 0;
  let total = 0;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = durationToken.exec(text))) {
    if (match.index !== cursor) return undefined;
    const amount = Number(match[1]);
    const unit = match[2] === "h" ? 3_600_000 : match[2] === "m" ? 60_000 : match[2] === "s" ? 1000 : match[2] === "ms" ? 1 : match[2] === "us" || match[2] === "µs" ? 0.001 : 0.000001;
    if (!Number.isFinite(amount)) return undefined;
    total += amount * unit;
    cursor = durationToken.lastIndex;
    matched = true;
  }
  return matched && cursor === text.length && Number.isFinite(total) ? total : undefined;
}

function formatDuration(value: number, unit: DurationUnit): string {
  if (!Number.isFinite(value) || value <= 0) throw new Error("周期必须大于 0");
  return `${Number(value.toFixed(6))}${unit}`;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
