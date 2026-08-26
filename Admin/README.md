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

浏览器不能提交任意目标 URL，也看不到已保存节点的静态认证头。Admin 管理密钥永远不会发送到项目或第三方上游。两条接口都要求有效的管理员登录会话。运行态的指定上游与跳过缓存仍服从项目的 `allowClientDirectives` 设置。响应只返回被测服务的 HTTP 状态、耗时、正文，以及 eRPC 的上游和缓存诊断头；连接错误不会回显包含密钥的 RPC 地址。
