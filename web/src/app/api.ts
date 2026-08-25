import { useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";

export type TargetStatus = "healthy" | "degraded" | "offline" | "unauthorized";

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

export async function apiRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("x-admin-token", token);
  const response = await fetch(path, { ...init, headers });
  const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Request failed (${response.status})`);
  return payload as T;
}

export function useTargets(token: string): UseQueryResult<TargetSnapshot[]> {
  return useQuery({ queryKey: ["targets"], queryFn: () => apiRequest<TargetSnapshot[]>("/api/targets", token), enabled: Boolean(token) || sessionStorage.getItem("erpc-admin-empty-session") === "1", refetchInterval: 10_000 });
}

export function useTaxonomy(token: string, targetId: string): UseQueryResult<Taxonomy> {
  return useQuery({ queryKey: ["taxonomy", targetId], queryFn: () => apiRequest<Taxonomy>(`/api/targets/${encodeURIComponent(targetId)}/taxonomy`, token), enabled: Boolean(targetId), refetchInterval: 10_000 });
}

export function useProject(token: string, targetId: string, projectId: string): UseQueryResult<ProjectView> {
  return useQuery({ queryKey: ["project", targetId, projectId], queryFn: () => apiRequest<ProjectView>(`/api/targets/${encodeURIComponent(targetId)}/projects/${encodeURIComponent(projectId)}`, token), enabled: Boolean(targetId && projectId) });
}

export function useCordons(token: string, targetId: string, projectId: string): UseQueryResult<Cordons> {
  return useQuery({ queryKey: ["cordons", targetId, projectId], queryFn: () => apiRequest<Cordons>(`/api/targets/${encodeURIComponent(targetId)}/cordons?projectId=${encodeURIComponent(projectId)}`, token), enabled: Boolean(targetId && projectId) });
}

export function useCordon(token: string, targetId: string, cordon: boolean) {
  return useMutation({
    mutationFn: (body: CordonRequest) => apiRequest<CordonResult>(`/api/targets/${encodeURIComponent(targetId)}/${cordon ? "cordon" : "uncordon"}`, token, { method: "POST", body: JSON.stringify(body) }),
  });
}
