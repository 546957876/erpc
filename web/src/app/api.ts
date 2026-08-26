import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

export type TargetStatus = "healthy" | "degraded" | "offline" | "unauthorized";
export type AuthStatus = { setupRequired: boolean; authenticated: boolean };

export type Upstream = { id: string; vendor?: string };
export type Network = { id: string; alias?: string; upstreams: Upstream[] };
export type Project = { id: string; networks: Network[] };
export type Taxonomy = { projects: Project[] };
export type TargetSnapshot = {
  id: string;
  baseUrl: string;
  status: TargetStatus;
  latencyMs?: number;
  failureCount: number;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  taxonomy: Taxonomy;
};
export type ProjectView = { config: unknown; health: unknown };
export type CordonEntry = { upstream: string; reason: string };
export type Cordons = { projectId: string; cordoned: CordonEntry[] };
export type CordonRequest = { projectId: string; upstream: string; method?: string; reason?: string };
export type CordonResult = CordonRequest & { method: string; cordoned: boolean; reason: string };
export type RuntimeStatus = { state: "running" | "stopped"; pid?: number; processStartedAt?: string; runningRevision?: number; latestRevision?: number; outOfDate: boolean; binaryVersion: string; binaryCommit: string; lastError?: string };
export type ConfigPayload = Record<string, unknown>;
export type ConfigRevision = {
  revision: number;
  payload?: ConfigPayload;
  effectivePayload?: ConfigPayload;
  defaultPayload?: ConfigPayload;
  yaml?: string;
  contentHash?: string;
  createdBy?: string;
  createdAt?: string;
};
export type ValidationResult = { valid: boolean; errors: string[]; warnings: string[]; notices: string[]; report?: unknown };

export function normalizeValidationResult(value: Partial<ValidationResult> | null | undefined): ValidationResult {
  return {
    valid: value?.valid === true,
    errors: Array.isArray(value?.errors) ? value.errors : [],
    warnings: Array.isArray(value?.warnings) ? value.warnings : [],
    notices: Array.isArray(value?.notices) ? value.notices : [],
    report: value?.report,
  };
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Request failed (${response.status})`);
  return payload as T;
}

export function getAuthStatus(): Promise<AuthStatus> {
  return apiRequest<AuthStatus>("/api/auth/status");
}

export function setupAdministrator(username: string, password: string): Promise<{ authenticated: boolean }> {
  return apiRequest("/api/auth/setup", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function loginAdministrator(username: string, password: string): Promise<{ authenticated: boolean }> {
  return apiRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function logoutAdministrator(): Promise<void> {
  return apiRequest("/api/auth/logout", { method: "POST" });
}

export function useAuthStatus(): UseQueryResult<AuthStatus> {
  return useQuery({ queryKey: ["auth"], queryFn: getAuthStatus, retry: false });
}

export function useTargets(): UseQueryResult<TargetSnapshot[]> {
  return useQuery({ queryKey: ["targets"], queryFn: () => apiRequest<TargetSnapshot[]>("/api/targets"), refetchInterval: 10_000 });
}

export function useTaxonomy(targetId: string): UseQueryResult<Taxonomy> {
  return useQuery({ queryKey: ["taxonomy", targetId], queryFn: () => apiRequest<Taxonomy>(`/api/targets/${encodeURIComponent(targetId)}/taxonomy`), enabled: Boolean(targetId), refetchInterval: 10_000 });
}

export function useProject(targetId: string, projectId: string): UseQueryResult<ProjectView> {
  return useQuery({ queryKey: ["project", targetId, projectId], queryFn: () => apiRequest<ProjectView>(`/api/targets/${encodeURIComponent(targetId)}/projects/${encodeURIComponent(projectId)}`), enabled: Boolean(targetId && projectId) });
}

export function useCordons(targetId: string, projectId: string): UseQueryResult<Cordons> {
  return useQuery({ queryKey: ["cordons", targetId, projectId], queryFn: () => apiRequest<Cordons>(`/api/targets/${encodeURIComponent(targetId)}/cordons?projectId=${encodeURIComponent(projectId)}`), enabled: Boolean(targetId && projectId) });
}

export function useCordon(targetId: string, cordon: boolean) {
  return useMutation({
    mutationFn: (body: CordonRequest) => apiRequest<CordonResult>(`/api/targets/${encodeURIComponent(targetId)}/${cordon ? "cordon" : "uncordon"}`, { method: "POST", body: JSON.stringify(body) }),
  });
}

export function useRuntimeStatus(): UseQueryResult<RuntimeStatus> {
  return useQuery({ queryKey: ["runtime"], queryFn: () => apiRequest<RuntimeStatus>("/api/runtime"), refetchInterval: 3_000 });
}

export function useRuntimeAction(action: "start" | "stop" | "restart") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<RuntimeStatus>(`/api/runtime/${action}`, { method: "POST" }),
    onSuccess: (status) => { queryClient.setQueryData(["runtime"], status); void queryClient.invalidateQueries({ queryKey: ["targets"] }); },
  });
}

export function useCurrentConfig(): UseQueryResult<ConfigRevision> {
  return useQuery({ queryKey: ["config", "current"], queryFn: () => apiRequest<ConfigRevision>("/api/config/current") });
}

export function useConfigRevisions(): UseQueryResult<ConfigRevision[]> {
  return useQuery({ queryKey: ["config", "revisions"], queryFn: () => apiRequest<ConfigRevision[]>("/api/config/revisions") });
}

export function useConfigRevision(revision: number): UseQueryResult<ConfigRevision> {
  return useQuery({ queryKey: ["config", "revisions", revision], queryFn: () => apiRequest<ConfigRevision>(`/api/config/revisions/${revision}`), enabled: revision > 0 });
}

export function useValidateConfig() {
  return useMutation({ mutationFn: async (input: { yaml?: string; payload?: ConfigPayload }) => normalizeValidationResult(await apiRequest<ValidationResult>("/api/config/validate", { method: "POST", body: JSON.stringify(input) })) });
}

export function useSaveConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { yaml?: string; payload?: ConfigPayload; baseRevision: number }) => apiRequest<ConfigRevision>("/api/config/revisions", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["config"] }); void queryClient.invalidateQueries({ queryKey: ["runtime"] }); },
  });
}

export function useRestoreConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (revision: number) => apiRequest<ConfigRevision>(`/api/config/revisions/${revision}/restore`, { method: "POST" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["config"] }); void queryClient.invalidateQueries({ queryKey: ["runtime"] }); },
  });
}
