import type { ConfigPayload } from "../app/api";

export type UpstreamLocation = { projectIndex: number; upstreamIndex: number };
export type UpstreamInput = { projectIndex: number; id: string; endpoint: string; type?: string };
export type UpstreamRow = UpstreamLocation & {
  key: string;
  projectId: string;
  id: string;
  endpoint: string;
  type: string;
  raw: Record<string, any>;
};

export function randomUniqueId(prefix: string, existing: Set<string>, randomUUID: () => string = () => crypto.randomUUID()): string {
  for (;;) {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const candidate = `${prefix || "rpc"}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
}

/** Return the project-scoped upstream rows without changing the source document. */
export function listUpstreams(payload: ConfigPayload): UpstreamRow[] {
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  return projects.flatMap((projectValue, projectIndex) => {
    const project = record(projectValue);
    const projectId = String(project.id || `项目 ${projectIndex + 1}`);
    const upstreams = Array.isArray(project.upstreams) ? project.upstreams : [];
    return upstreams.map((item, upstreamIndex) => {
      const raw = record(item);
      const id = String(raw.id || "");
      return {
        key: `${projectIndex}/${projectId}/${id}/${upstreamIndex}`,
        projectIndex,
        upstreamIndex,
        projectId,
        id,
        endpoint: String(raw.endpoint || ""),
        type: String(raw.type || ""),
        raw,
      };
    });
  });
}

export function addUpstream(payload: ConfigPayload, input: UpstreamInput): ConfigPayload {
  const next = structuredClone(payload) as ConfigPayload;
  const project = projectAt(next, input.projectIndex);
  const values = normalizedInput(input);
  validate(values, project, undefined);
  const upstreams = Array.isArray(project.upstreams) ? [...project.upstreams] : [];
  upstreams.push(buildUpstream({}, values));
  project.upstreams = upstreams;
  const projects = Array.isArray(next.projects) ? next.projects : [];
  projects[input.projectIndex] = project;
  next.projects = projects;
  return next;
}

export function updateUpstream(payload: ConfigPayload, location: UpstreamLocation, input: UpstreamInput): ConfigPayload {
  const next = structuredClone(payload) as ConfigPayload;
  const project = projectAt(next, location.projectIndex);
  const upstreams = Array.isArray(project.upstreams) ? [...project.upstreams] : [];
  if (!upstreams[location.upstreamIndex]) throw new Error("上游不存在");
  const values = normalizedInput({ ...input, projectIndex: location.projectIndex });
  validate(values, project, location.upstreamIndex);
  upstreams[location.upstreamIndex] = buildUpstream(record(upstreams[location.upstreamIndex]), values);
  project.upstreams = upstreams;
  const projects = Array.isArray(next.projects) ? next.projects : [];
  projects[location.projectIndex] = project;
  next.projects = projects;
  return next;
}

export function removeUpstream(payload: ConfigPayload, location: UpstreamLocation): ConfigPayload {
  const next = structuredClone(payload) as ConfigPayload;
  const project = projectAt(next, location.projectIndex);
  const upstreams = Array.isArray(project.upstreams) ? [...project.upstreams] : [];
  if (location.upstreamIndex < 0 || location.upstreamIndex >= upstreams.length) throw new Error("上游不存在");
  upstreams.splice(location.upstreamIndex, 1);
  project.upstreams = upstreams;
  const projects = Array.isArray(next.projects) ? next.projects : [];
  projects[location.projectIndex] = project;
  next.projects = projects;
  return next;
}

function normalizedInput(input: UpstreamInput): UpstreamInput {
  return { projectIndex: input.projectIndex, id: input.id.trim(), endpoint: input.endpoint.trim(), type: input.type?.trim() || "" };
}

function validate(input: UpstreamInput, project: Record<string, any>, editingIndex: number | undefined): void {
  if (!input.id) throw new Error("请输入节点名称");
  if (!input.endpoint) throw new Error("请输入 RPC 地址");
  const upstreams = Array.isArray(project.upstreams) ? project.upstreams : [];
  const duplicate = upstreams.some((item, index) => index !== editingIndex && String(record(item).id || "").trim() === input.id);
  if (duplicate) throw new Error("同一项目内的节点名称不能重复");
}

function buildUpstream(base: Record<string, any>, input: UpstreamInput): Record<string, any> {
  const upstream: Record<string, any> = { ...base, id: input.id, endpoint: input.endpoint };
  if (input.type) upstream.type = input.type;
  else delete upstream.type;
  return upstream;
}

function projectAt(payload: ConfigPayload, index: number): Record<string, any> {
  if (!Array.isArray(payload.projects) || !payload.projects[index]) throw new Error("所属项目不存在");
  return record(payload.projects[index]);
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
