# Admin / Web TODO

这份清单是当前独立 Admin 与 Web 的施工状态。eRPC 根项目不在本清单的修改范围内。

## 已完成

- [x] PostgreSQL 连接、幂等表结构和管理员首次创建/登录。
- [x] 本机 `admin.yaml` 直接保存 PostgreSQL 连接串，环境变量仅作为可选覆盖；启动不再要求每次手工设置。
- [x] 配置版本不可变保存、并发版本号校验和历史恢复为新版本。
- [x] 首次启动从指定 eRPC 二进制生成系统默认快照；版本 1 使用稀疏覆盖文档。
- [x] Admin 调用同一个 eRPC 二进制执行 `validate` / `dump`，保存不自动重启。
- [x] Windows 下由 Admin 启停单个 eRPC 进程，并记录 PID、启动时间、运行版本。
- [x] eRPC 子进程使用绝对配置路径，避免工作目录变化导致配置文件找不到。
- [x] 中文深色 Web：运行概览、服务设置、上游增删改、完整字段配置、版本历史。
- [x] 上游 CRUD 多节点回归测试：前端 160 个节点，Admin API 129 个节点，覆盖重复 ID、删除错位、版本恢复和未知字段。
- [x] 保存后空白页回归：校验结果和实时拓扑中的缺失列表统一按空数组处理，并完成浏览器隔离保存演练。
- [x] 表单不要求用户编写或粘贴 YAML；未知字段、弃用字段和 RPC 密钥按既定策略保留。
- [x] eRPC 默认值通过 Admin API 返回并在字段帮助中展示；字段状态显示“系统默认/自定义/未设置”。
- [x] 上游管理统一支持自定义 RPC 节点与 eRPC 当前 24 个厂商实例；包含随机名称、完整 ProviderConfig CRUD、覆盖配置、保存前校验和 160 个厂商实例回归。
- [x] 运行态调试在 eRPC 尚未返回拓扑时回退到配置中的项目，支持厂商 Provider 的首次网络请求；无 `admin.auth` 时将 eRPC 的 HTTP 200 / JSON-RPC `-32603` 正确识别为未授权，并明确提示配置位置。
- [x] 配置版本支持删除历史版本；最新版本和运行记录引用的版本受保护，并覆盖 PostgreSQL、API 与 Web 回归测试。

## 下一阶段

- [ ] 启动后等待 eRPC HTTP Admin 端点就绪，再把运行版本和拓扑目标写入 Registry。
- [ ] 从 eRPC 响应头读取并持久化 `X-ERPC-Version` / `X-ERPC-Commit`。
- [ ] 为完整字段 schema 增加更多按配置拥有者区分的中文说明和安全示例。
- [ ] 增加 Admin/Web 的 Windows 手工验收脚本：首次设置、保存不重启、重启应用、恢复版本、外部进程保护。
- [ ] 对 PostgreSQL 断开、端口占用、eRPC 启动失败补充端到端错误提示和恢复说明。
- [ ] 评估前端产物拆包，处理 Vite 的大 chunk 警告。

## 约束

- PostgreSQL 是唯一权威配置存储；SQLite 不在当前方案内。
- eRPC 配置密钥按已确认的单机方案明文保存；Admin 登录密码仍只保存 bcrypt 哈希。
- 保存配置不会启动、停止或重启 eRPC；只有运行概览中的明确操作会应用最新版本。
- 修改 eRPC 上游时优先同步上游 schema 与生成器，再更新 `web/src/config/metadata.ts` 和测试。

## 验证命令（Windows PowerShell）

```powershell
Set-Location E:\go\goProject\eRPC\Admin
go test ./... -count=1
go build ./cmd/admin

Set-Location E:\go\goProject\eRPC\web
pnpm test -- --run
pnpm build
```

本清单不包含数据库 DSN、RPC URL 或任何真实密钥。
