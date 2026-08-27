# eRPC Admin（Windows）

`Admin` 是独立于上游 eRPC 源码的本机管理服务。PostgreSQL 保存管理员账号和不可变配置版本；启动或重启时，Admin 校验最新版本、生成 YAML，并管理一个本地 eRPC 进程。

## 启动

```powershell
Set-Location E:\go\goProject\eRPC\Admin
go build -o admin.exe ./cmd/admin
.\admin.exe -config .\admin.yaml
```

PostgreSQL 连接串保存在已被 Git 忽略的 `admin.yaml` 的 `databaseUrl` 中，配置一次后无需在每个 PowerShell 窗口重新设置。`databaseUrlEnv` 是可选覆盖项；对应环境变量存在时优先使用环境变量。

前端开发服务：

```powershell
Set-Location E:\go\goProject\eRPC\web
pnpm install
pnpm dev -- --port 8180
```

打开 `http://127.0.0.1:8180/login`。首次运行时创建唯一管理员；已有 `data/admin-auth.json` 会把原 bcrypt 哈希一次性迁入 PostgreSQL，并改名为 `.migrated`。

## 配置与运行

- 保存只创建新配置版本，不会自动重启 eRPC。
- 启动或重启会再次调用 `erpc.exe validate`，随后应用最新有效版本。
- 运行文件位于 `data/runtime/revision-<版本>/erpc.yaml`，日志位于 `data/runtime/erpc.log`。
- 停止时先发送 Windows `CTRL_BREAK`，超过 `shutdownTimeout` 才强制终止。
- Admin 只在 PID 与进程创建时间同时匹配时执行停止，避免误杀复用 PID 的其他进程。

## 数据与密钥

管理员密码只保存 bcrypt 哈希。按当前单机方案，PostgreSQL 连接串保存在被 Git 忽略的 `admin.yaml`；eRPC RPC URL、Admin secret 和其他配置密钥会以明文保存于 PostgreSQL 及生成的 YAML。`admin.yaml`、数据库和 `Admin/data` 必须仅允许本机可信用户访问。

所有 eRPC 配置都通过中文字段表单维护。Admin 在保存和启动时内部生成
YAML，用户不需要编写、粘贴或理解 YAML。

## RPC 测试

登录后的 Web 控制台提供两种测试，均由 Admin 服务端发起请求：

- `POST /api/config/upstreams/test`：从指定配置版本读取静态上游的 HTTP/HTTPS 地址及 `jsonRpc.headers` 并直连测试；字段可继承 `upstreamDefaults`，环境变量按 Admin 进程环境展开，不要求重启 eRPC。
- `POST /api/targets/{targetId}/rpc-test`：通过运行中的 eRPC 测试网络，可选定向到一个上游，并请求跳过缓存读取；项目启用 Secret 认证时可提交仅用于本次请求的 `projectSecret`。

配置版本页支持删除历史版本。最新版本和运行记录引用的版本会被保护，删除前必须确认；厂商 Provider 只有在首次请求对应网络时才会懒加载上游，因此 RPC 调试页会使用配置中的项目作为首次请求入口。

## Alchemy 账号库

“Alchemy 账号”页面用于把账号资料导入 Admin 自己的 PostgreSQL 账号库。粘贴区支持单个 JSON、JSON 数组和 NDJSON；顶层必须包含 `email` 与 `api_key`，其余字段（包括 `checkpoint`）会原样保存。导入相同资料会跳过，同邮箱但内容不同会整批拒绝。账号列表显示邮箱、名称、Provider ID 和 API Key，打开详情后才编辑完整 JSON。

导入后需要在账号行点击“应用到项目”，选择项目和网络范围。应用只把该账号的 Provider ID、`vendor: alchemy`、节点名称模板和 `settings.apiKey` 写入新的配置版本，不会把邮箱密码、refresh token、bearer token 或 checkpoint 写入 eRPC YAML，也不会自动重启；要让运行中的 eRPC 使用新版本，需在“运行概览”明确重启。最新配置仍引用的账号不能删除，历史版本不会被自动改写。

对应接口为 `POST /api/alchemy/accounts/import`、`GET /api/alchemy/accounts`、`GET/PATCH/DELETE /api/alchemy/accounts/{id}` 和 `POST /api/alchemy/accounts/{id}/apply`，均要求管理员登录会话，初始请求体上限为 2 MiB。

浏览器不能提交任意目标 URL，也看不到已保存节点的静态认证头。Admin 管理密钥永远不会发送到项目或第三方上游。两条接口都要求有效的管理员登录会话。运行态的指定上游与跳过缓存仍服从项目的 `allowClientDirectives` 设置。若节点状态显示 401，请在“服务设置”填写 eRPC Admin 内部密钥；它与 Admin Web 登录账号密码分开，仅用于 Admin 调用 eRPC 的 `/admin` 接口。响应只返回被测服务的 HTTP 状态、耗时、正文，以及 eRPC 的上游和缓存诊断头；连接错误不会回显包含密钥的 RPC 地址。
