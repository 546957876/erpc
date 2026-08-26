import { fieldsFor, type ConfigSchema, type SchemaField, type SchemaNode } from "./document";
import { labelFor } from "./labels";

export type DefaultKind = "runtime" | "inherited" | "none" | "deprecated";
export type FieldMeta = {
  label: string;
  description: string;
  example: string;
  defaultKind: DefaultKind;
  defaultText?: string;
  restartRequired: boolean;
  yamlKey: string;
  deprecated?: boolean;
};

const catalog: Record<string, Partial<FieldMeta>> = {
  "Config.logLevel": { label: "日志级别", description: "控制 eRPC 输出日志的详细程度。", example: "INFO", defaultKind: "runtime", defaultText: "INFO" },
  "Config.clusterKey": { label: "集群标识", description: "用于区分共享状态和缓存命名空间的集群标识。", example: "erpc-default", defaultKind: "runtime", defaultText: "erpc-default" },
  "ServerConfig.httpHostV4": { label: "IPv4 监听地址", description: "HTTP 服务绑定的 IPv4 地址；0.0.0.0 表示监听本机所有 IPv4 网卡。", example: "0.0.0.0", defaultKind: "runtime", defaultText: "0.0.0.0" },
  "ServerConfig.httpPortV4": { label: "IPv4 HTTP 端口", description: "HTTP JSON-RPC 服务使用的 IPv4 端口。", example: "4000", defaultKind: "runtime", defaultText: "4000" },
  "ServerConfig.listenV4": { label: "启用 IPv4", description: "是否监听 IPv4 地址。", example: "启用", defaultKind: "runtime", defaultText: "启用" },
  "ServerConfig.listenV6": { label: "启用 IPv6", description: "是否监听 IPv6 地址；未设置时遵循 eRPC 默认行为。", example: "关闭", defaultKind: "runtime" },
  "ProjectConfig.id": { label: "项目标识", description: "项目的唯一标识，路由和上游默认策略通过它关联。", example: "bnb-mainnet", defaultKind: "none" },
  "ProjectConfig.upstreams": { label: "上游节点", description: "项目实际转发请求的 RPC 节点列表，可配置多个节点进行容错。", example: "添加一个上游节点", defaultKind: "none" },
  "UpstreamConfig.id": { label: "节点名称（唯一标识）", description: "项目内上游节点的唯一名称，不是链 ID；用于健康状态和路由选择。", example: "primary-rpc", defaultKind: "none" },
  "UpstreamConfig.endpoint": { label: "RPC 地址", description: "可填写任意 HTTP/HTTPS RPC，包括完整的 Alchemy RPC URL。", example: "https://rpc.example.com/v2/your-key", defaultKind: "none" },
  "UpstreamConfig.type": { label: "协议类型", description: "上游协议或架构类型（如 evm、svm），不是 RPC 服务厂商；也可填写 eRPC 支持的其他类型。", example: "evm", defaultKind: "inherited" },
  "RetryPolicyConfig.maxAttempts": { label: "最大尝试次数", description: "一次请求允许尝试的最大上游次数。", example: "3", defaultKind: "inherited" },
  "EvmUpstreamConfig.statePollerInterval": { label: "状态轮询周期", description: "检查 EVM 上游区块状态的时间间隔。", example: "30s", defaultKind: "inherited" },
  "TimeoutPolicyConfig.duration": { label: "超时时长", description: "限制单次请求等待上游响应的最长时间。", example: "10s", defaultKind: "inherited" },
  logLevel: { label: "日志级别", description: "控制 eRPC 输出日志的详细程度。", example: "INFO", defaultKind: "runtime", defaultText: "INFO" },
  clusterKey: { label: "集群标识", description: "用于区分共享状态和缓存命名空间的集群标识。", example: "erpc-default", defaultKind: "runtime", defaultText: "erpc-default" },
  server: { label: "服务监听", description: "配置 HTTP、gRPC、TLS 及服务关闭行为。", example: "展开后配置监听地址和端口。", defaultKind: "runtime" },
  httpHostV4: { label: "IPv4 监听地址", description: "HTTP 服务绑定的 IPv4 地址。", example: "0.0.0.0", defaultKind: "runtime", defaultText: "0.0.0.0" },
  httpPortV4: { label: "IPv4 HTTP 端口", description: "HTTP JSON-RPC 服务使用的 IPv4 端口。", example: "4000", defaultKind: "runtime", defaultText: "4000" },
  listenV4: { label: "启用 IPv4", description: "是否监听 IPv4 地址。", example: "启用", defaultKind: "runtime", defaultText: "启用" },
  httpPort: { label: "旧版 HTTP 端口", description: "旧版端口字段，仅用于兼容旧配置；新配置请使用 IPv4 HTTP 端口。", example: "4000", defaultKind: "deprecated", deprecated: true },
  projects: { label: "项目", description: "定义网络项目、上游节点和项目级默认策略。", example: "添加一个项目并配置上游 RPC。", defaultKind: "none" },
  upstreams: { label: "上游节点", description: "项目实际转发请求的 RPC 节点列表，可配置多个节点进行容错。", example: "https://rpc.example.com", defaultKind: "none" },
  endpoint: { label: "RPC 地址", description: "上游 JSON-RPC 服务的完整 HTTP(S) 地址。", example: "https://rpc.example.com/v2/your-key", defaultKind: "none" },
  chainId: { label: "链 ID", description: "上游节点对应的 EVM 链 ID；留空时由节点探测。", example: "56", defaultKind: "none" },
  type: { label: "节点类型", description: "上游协议或供应商类型。", example: "evm", defaultKind: "inherited" },
  healthCheck: { label: "健康检查", description: "配置 Admin 对 eRPC 实例的健康检查行为。", example: "展开后配置检查模式。", defaultKind: "runtime" },
  metrics: { label: "监控指标", description: "控制 Prometheus 指标和统计信息。", example: "按需启用指标端点。", defaultKind: "runtime" },
  tracing: { label: "链路追踪", description: "配置 OpenTelemetry 等链路追踪输出。", example: "https://otel.example.com", defaultKind: "none" },
  retry: { label: "重试策略", description: "请求失败后的重试次数、延迟和退避方式。", example: "最多重试 3 次。", defaultKind: "inherited" },
  timeout: { label: "超时策略", description: "限制单次请求等待上游响应的最长时间。", example: "60s", defaultKind: "inherited" },
  maxAttempts: { label: "最大尝试次数", description: "一次请求允许尝试的最大上游次数。", example: "3", defaultKind: "inherited" },
  statePollerInterval: { label: "状态轮询周期", description: "检查上游区块状态的时间间隔。", example: "30s", defaultKind: "inherited" },
  admin: { label: "管理接口", description: "配置 eRPC Admin API 的监听和认证。", example: "展开后配置认证策略。", defaultKind: "none" },
  database: { label: "数据库与缓存", description: "配置缓存、共享状态和数据库连接器。", example: "展开后选择连接器。", defaultKind: "none" },
  rateLimiters: { label: "速率限制", description: "定义请求速率和额度限制。", example: "按项目设置额度。", defaultKind: "none" },
};

const technicalLabels: Record<string, string> = {
  enabled: "启用", id: "标识", mode: "模式", name: "名称", host: "主机地址", port: "端口", interval: "时间间隔",
  duration: "持续时间", delay: "延迟", jitter: "随机抖动", headers: "请求头", tags: "标签", rules: "规则", policies: "策略",
  connectors: "连接器", budgets: "额度组", method: "RPC 方法", network: "网络", architecture: "网络架构", vendorName: "供应商名称",
  finality: "最终性", selectionPolicy: "选择策略", scoreMetricsWindowSize: "评分统计窗口", fallback: "备用值", min: "最小值", max: "最大值",
  username: "用户名", password: "密码", secret: "密钥", token: "令牌", apiKey: "API 密钥", connectionUri: "连接地址", driver: "驱动",
};

export function metadataFor(path: string[], node: SchemaNode, _schema?: ConfigSchema): FieldMeta {
  const yamlKey = path.at(-1) || "配置项";
  const source = _schema ? fieldForPath(_schema, path) : undefined;
  const ownerKey = source?.owner ? `${source.owner}.${yamlKey}` : undefined;
  const ownerCatalog = ownerKey ? catalog[ownerKey] : undefined;
  const explicit = ownerCatalog || catalog[yamlKey] || technicalLabels[yamlKey] ? { ...(ownerCatalog || catalog[yamlKey] || {}), label: ownerCatalog?.label || catalog[yamlKey]?.label || technicalLabels[yamlKey] } : undefined;
  const deprecated = path.join(".") === "server.httpPort" || explicit?.deprecated === true || source?.deprecated === true;
  const knownLabel = labelFor(yamlKey);
  const label = explicit?.label || (knownLabel === "配置项" ? "高级配置项" : knownLabel);
  const kind = deprecated ? "deprecated" : (explicit?.defaultKind || "none");
  const example = explicit?.example || exampleFor(node);
  const sourceDescription = source?.comment?.replace(/\s+/g, " ").trim();
  const description = explicit?.description || (sourceDescription && /[\u4e00-\u9fff]/.test(sourceDescription) ? sourceDescription : `用于控制 eRPC 的${label}；请结合当前有效默认值进行调整。原始字段为 ${yamlKey}。`);
  return {
    label,
    description,
    example,
    defaultKind: kind,
    defaultText: explicit?.defaultText,
    restartRequired: true,
    yamlKey,
    deprecated,
  };
}

function fieldForPath(schema: ConfigSchema, path: string[]): SchemaField | undefined {
  let node = schema.root;
  let parts = path;
  if (path.length > 1 && schema.definitions[path[0]]) {
    node = { kind: "object", ref: path[0] };
    parts = path.slice(1);
  }
  let field: SchemaField | undefined;
  for (const part of parts) {
    if (part === "*") {
      if (node.kind === "array" && node.item) node = node.item;
      else if (node.kind === "map" && node.value) node = node.value;
      continue;
    }
    field = fieldsFor(node, schema).find((candidate) => candidate.key === part);
    if (!field) return undefined;
    node = field.node;
  }
  return field;
}

function exampleFor(node: SchemaNode): string {
  switch (node.kind) {
    case "boolean": return "启用";
    case "number": return "1";
    case "array": return "添加一项";
    case "map": return "键: 值";
    case "object": return "展开配置";
    default: return "按需填写";
  }
}

export function allMetadata(schema: ConfigSchema): FieldMeta[] {
  const result: FieldMeta[] = [];
  for (const [owner, definition] of Object.entries(schema.definitions)) {
    for (const field of definition.fields) result.push(metadataFor([owner, field.key], field.node, schema));
  }
  return result;
}
