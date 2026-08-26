const labels: Record<string, string> = {
  logLevel: "日志级别", clusterKey: "集群密钥", server: "服务监听", healthCheck: "健康检查",
  admin: "管理接口", database: "数据库与缓存", projects: "项目", rateLimiters: "速率限制",
  metrics: "监控指标", proxyPools: "代理池", tracing: "链路追踪", providers: "节点供应商",
  networks: "网络", upstreams: "上游节点", upstreamDefaults: "上游默认设置",
  networkDefaults: "网络默认设置", endpoint: "RPC 地址", chainId: "链 ID", architecture: "网络架构",
  httpHostV4: "IPv4 监听地址", httpPortV4: "IPv4 HTTP 端口", listenV4: "启用 IPv4",
  httpHostV6: "IPv6 监听地址", httpPortV6: "IPv6 HTTP 端口", listenV6: "启用 IPv6",
  grpcEnabled: "启用 gRPC", grpcHostV4: "gRPC IPv4 地址", grpcPortV4: "gRPC IPv4 端口",
  grpcHostV6: "gRPC IPv6 地址", grpcPortV6: "gRPC IPv6 端口", enabled: "启用",
  hostV4: "IPv4 地址", hostV6: "IPv6 地址", port: "端口", mode: "模式", id: "标识",
  type: "类型", vendorName: "供应商名称", failsafe: "容错策略", retry: "重试", hedge: "对冲请求",
  timeout: "超时", circuitBreaker: "熔断器", consensus: "共识", integrity: "完整性校验",
  statePollerInterval: "状态轮询周期", statePollerDebounce: "状态轮询防抖",
  fallbackStatePollerDebounce: "备用状态轮询防抖", maxAttempts: "最大尝试次数", maxCount: "最大数量",
  delay: "延迟", backoffMaxDelay: "最大退避延迟", backoffFactor: "退避系数", jitter: "随机抖动",
  duration: "持续时间", connectionUri: "连接地址", driver: "驱动", connectors: "连接器",
  policies: "策略", rules: "规则", budgets: "额度组", method: "RPC 方法", period: "统计周期",
  headers: "请求头", responseHeaders: "响应头", tags: "标签", evm: "EVM 设置", svm: "SVM 设置",
  jsonRpc: "JSON-RPC 设置", scoreMetricsWindowSize: "评分统计窗口", selectionPolicy: "选择策略",
  rateLimitBudget: "速率限制额度", ignoreMethods: "忽略的方法", allowMethods: "允许的方法",
  autoIgnoreUnsupportedMethods: "自动忽略不支持的方法", maxTimeout: "最大超时", readTimeout: "读取超时",
  writeTimeout: "写入超时", enableGzip: "启用 Gzip", tls: "TLS 设置", aliasing: "别名设置",
  username: "用户名", password: "密码", secret: "密钥", token: "令牌", apiKey: "API 密钥",
};

const tokens: Record<string, string> = {
  auto: "自动", block: "区块", cache: "缓存", count: "数量", default: "默认", error: "错误",
  execution: "执行", finality: "最终性", grpc: "gRPC", health: "健康", host: "地址", http: "HTTP",
  interval: "周期", limit: "限制", max: "最大", metrics: "指标", min: "最小", network: "网络",
  project: "项目", proxy: "代理", rate: "速率", request: "请求", response: "响应", retry: "重试",
  size: "大小", timeout: "超时", upstream: "上游", window: "窗口", enabled: "启用",
  v4: "IPv4", v6: "IPv6", url: "地址", uri: "地址", key: "键", value: "值",
  allow: "允许", allowed: "允许的", deny: "禁止", client: "客户端", direct: "直连", directives: "指令",
  address: "地址", bind: "绑定", read: "读取", write: "写入", get: "读取", set: "写入", send: "发送", recv: "接收",
  message: "消息", range: "范围", split: "拆分", concurrency: "并发数", batch: "批量",
  wait: "等待", backoff: "退避", factor: "系数", confidence: "置信度", state: "状态", poller: "轮询",
  poll: "轮询", genesis: "创世块", hash: "哈希", check: "检查", checks: "检查项", logs: "日志", bloom: "布隆过滤器",
  receipt: "回执", receipts: "回执", transaction: "交易", transactions: "交易", chain: "链", id: "标识", name: "名称",
  vendor: "供应商", serve: "服务", served: "服务的", tag: "标签", header: "请求头", content: "内容",
  type: "类型", mode: "模式", algorithm: "算法", compression: "压缩", tls: "TLS", cors: "跨域", origin: "来源",
  credentials: "凭据", credential: "凭据", auth: "认证", authentication: "认证", strategy: "策略", strategies: "策略",
  user: "用户", username: "用户名", password: "密码", secret: "密钥", token: "令牌", api: "API", keyid: "密钥标识",
  database: "数据库", connection: "连接", pool: "连接池", memory: "内存", redis: "Redis", postgresql: "PostgreSQL",
  table: "表", region: "区域", sample: "采样", sampling: "采样", trace: "追踪", tracing: "链路追踪", span: "跨度",
  skip: "跳过", ignore: "忽略", preserve: "保留", prefer: "优先", highest: "最高", lowest: "最低", lower: "下限", upper: "上限",
  active: "活跃", initialized: "已初始化", node: "节点", architecture: "架构", json: "JSON", rpc: "RPC", svm: "SVM", evm: "EVM",
  failure: "失败", success: "成功", circuit: "熔断", breaker: "器", penalty: "惩罚", capacity: "容量",
  minparticipants: "最少参与者", maxparticipants: "最多参与者", participant: "参与者", participants: "参与者",
};

export function labelFor(key: string): string {
  // Unknown upstream fields must never fall back to an English YAML key in
  // the primary UI.  The help panel still shows the raw key for diagnosis.
  if (labels[key]) return ensureChinese(labels[key]);
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  const translated = words.map((word) => tokens[word] || (word.startsWith("eth_") ? "EVM 方法" : "" )).filter(Boolean);
  return translated.length > 0 ? ensureChinese(translated.join("")) : "高级配置项";
}

function ensureChinese(label: string): string {
  return /[\u4e00-\u9fff]/.test(label) ? label : `${label} 配置`;
}

export function isSensitive(path: string[]): boolean {
  return /(password|secret|token|apiKey|privateKey|connectionUri|endpoint)/i.test(path.join("."));
}
