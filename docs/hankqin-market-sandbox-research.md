# Hankqin Market, Skill Connect, and Sandbox Research

更新日期：2026-05-19

这份文档记录本地部署 LobeHub 时对 Lobe Market 授权、LobeHub Skill Connect、云沙箱和替代方案的研究结论。目标是保留社区发现能力，同时避免本地部署因为 Market OAuth 不可用而影响 HTML / 文件生成、代码执行和第三方工具接入。

## 结论

- Lobe Market 不是单一能力，可以拆成社区发现、社交、发布 / 创作者、Skill Connect、凭据、云沙箱 / 云 MCP 等几类。
- 本地部署不应该为了修复云沙箱，把整个 Market 社区发现能力关掉。社区浏览、MCP / 插件 / Agent 发现仍然有价值。
- Market Social 可以独立关闭或忽略，对社区发现不是硬依赖。
- LobeHub Skill Connect 是 Market 托管的 OAuth 工具代理。本地如果无法完成 Market 授权，这部分基本不可用，也不建议假装授权绕过。
- 云沙箱当前通过 Market SDK 调用 Lobe 托管服务，本地部署会遇到 `Market authorization expired`。短期应禁用云沙箱，长期应替换为 Docker sandbox 或 AWS Bedrock AgentCore Code Interpreter。
- AWS AgentCore Code Interpreter 是可行路线，但不是填 AWS key 即可使用。需要新增一个 AWS sandbox provider，实现现有 `ISandboxService` 接口，并处理会话、工具名映射、文件导入导出、S3、IAM 和费用。

## 当前代码中的 Market 边界

### 云沙箱

入口主要在：

- `src/server/routers/tools/market.ts`
- `src/services/cloudSandbox.ts`
- `packages/builtin-tool-cloud-sandbox/src/ExecutionRuntime/index.ts`
- `packages/builtin-tool-cloud-sandbox/src/types/service.ts`

当前云沙箱执行链路：

1. 前端或 runtime 调用 `cloudSandboxService.callTool(...)`。
2. tRPC 进入 `market.execInSandbox`。
3. 服务端通过 `market.plugins.runBuildInTool(toolName, params, { topicId, userId })` 调用 Market。
4. 文件导出时，LobeHub 先生成 S3 pre-signed upload URL，再让 Market 沙箱执行 `exportFile` 上传结果。

这意味着云沙箱不是直接连 AWS，而是先经过 Lobe Market。只要本地部署没有可用的 Market OAuth，这条链路就会在执行或导出时触发授权错误。

已加的本地部署保护：

```dotenv
DISABLE_CLOUD_SANDBOX=1
```

这个开关用于隐藏 / 禁用 `lobe-cloud-sandbox`，避免生成 HTML、报表等文件时误触发 Market 授权。

### LobeHub Skill Connect

入口主要在：

- `src/server/routers/tools/market.ts`
- `src/store/tool/slices/lobehubSkillStore/action.ts`
- `src/store/tool/slices/lobehubSkillStore/selectors.ts`
- `packages/const/src/lobehubSkill.ts`

它提供的是 Market 托管的第三方服务连接：

- 列出 provider 和 provider tools。
- 生成 OAuth 授权 URL。
- 查询、刷新、撤销连接。
- 通过 `ctx.marketSDK.skills.callTool(provider, ...)` 代理执行第三方工具。

代码里内置的 provider 包括 GitHub、Linear、Outlook Calendar、Notion、X/Twitter、Vercel 等，定义在 `packages/const/src/lobehubSkill.ts`。

这个能力不是社区市场本体。它依赖 Market 保存 / 刷新 OAuth token 并代理调用工具，所以本地部署无法完成 Market 授权时，Skill Connect 不应作为主路线。

### Market Social

Social 主要是关注、收藏、点赞、个人主页 / 创作者关系这类能力。它对普通社区发现不是必要条件，可以后续用独立开关隐藏。

建议后续开关：

```dotenv
MARKET_SOCIAL_ENABLED=0
LOBEHUB_SKILL_CONNECT_ENABLED=0
```

这两个开关的目的不是关闭 Market discovery，而是只关闭本地不可用或不需要的交互能力。

## 推荐架构

本地 / 自托管推荐组合：

```text
Community discovery:
  keep Lobe Market browsing where public API works

Social:
  disabled

LobeHub Skill Connect:
  disabled unless trusted Market auth is actually available

Sandbox:
  short term: disabled
  preferred self-hosted path: Docker sandbox service
  optional cloud path: AWS Bedrock AgentCore Code Interpreter

Third-party integrations:
  preferred self-hosted path: MCP servers / custom plugins
  optional SaaS path: Klavis

Credentials:
  short term: env/API keys passed to MCP or sandbox
  long term: local encrypted creds store
```

## 替代 Skill Connect 的方案

### 1. 自托管 MCP servers

这是最适合本地部署的替代路线。GitHub、Notion、Slack、Linear、Jira 等服务可以通过本地或 Docker 化 MCP server 接入。token 由本地 `.env`、容器 secret、或后续本地加密凭据系统管理，不依赖 Lobe Market OAuth。

优点：

- 完全绕开 Market 授权。
- 更符合自托管边界。
- 能保留 “社区发现 + 本地执行” 的组合。

缺点：

- 没有 Skill Connect 那种统一 OAuth 授权体验。
- 每个服务需要单独配置 token、scope、回调或 MCP server。

### 2. Klavis

代码里已经支持 Klavis。它也是第三方 OAuth/tool proxy，但不走 Lobe Market。启用条件是配置 `KLAVIS_API_KEY`，服务端会暴露 `enableKlavis`。

优点：

- 已有代码集成。
- OAuth 体验比手动 token 更完整。

缺点：

- 仍然依赖外部 SaaS。
- 不等同于本地自托管。

### 3. 本地 Creds + Docker sandbox

后续可以实现本地加密凭据库，把 API key/OAuth token 注入 Docker sandbox。这样可以替代 Market-backed `lobe-creds` 在自托管场景里的角色。

## Docker sandbox 路线

Docker sandbox 是当前最可控的路线。它应该实现 `ISandboxService`：

```ts
interface ISandboxService {
  callTool: (toolName: string, params: Record<string, any>) => Promise<SandboxCallToolResult>;
  exportAndUploadFile: (path: string, filename: string) => Promise<SandboxExportFileResult>;
}
```

建议能力覆盖：

- `executeCode`
- `runCommand`
- `getCommandOutput`
- `killCommand`
- `listFiles`
- `readFile`
- `writeFile`
- `editFile`
- `moveFiles`
- `searchFiles`
- `grepContent`
- `globFiles`
- `exportFile`

实现建议：

- 每个 `topicId + userId` 对应一个隔离 workspace。
- 容器使用固定 base image，可参考现有 prompt 里的 `lobehubbot/python-node:latest` 能力集合。
- 禁止默认挂载宿主敏感目录。
- 限制 CPU、内存、磁盘、超时、网络访问。
- 文件导出仍然走 LobeHub 已有 S3/RustFS/MinIO 文件系统，保持下载链接形态一致。

## AWS AgentCore Code Interpreter 路线

### 是否可以申请 AWS 服务来替代 Lobe Market 云沙箱？

可以。AWS 官方提供 Amazon Bedrock AgentCore Code Interpreter，可以直接通过 AWS SDK/Boto3/API 调用，不需要经过 Lobe Market。它适合替代云端代码执行和文件处理能力。

但这里要区分两层：

- Lobe 官方云沙箱：Lobe Market 托管，LobeHub 通过 `market.plugins.runBuildInTool(...)` 调用。
- 你自己的 AWS 沙箱：你的 AWS 账号直接调用 AgentCore Code Interpreter，需要我们在 LobeHub 里新增 provider。

所以申请 / 开通 AWS 后，仍然要做代码改造。

### AWS 官方能力摘要

官方文档确认：

- Code Interpreter 支持安全托管环境执行代码。
- 官方提供 Strands 和 direct usage 两条接入方式；direct usage 更适合 LobeHub 这种已有 agent/runtime 的系统。
- 直接调用时可以通过 `bedrock-agentcore` SDK 或底层 `boto3`/AWS SDK 管理 session。
- 基础内置 interpreter 标识为 `aws.codeinterpreter.v1`。
- 会话启动后通过 `InvokeCodeInterpreter` 调用工具。
- 支持 Python、JavaScript、TypeScript；JavaScript/TypeScript runtime 可选 `nodejs` 或 `deno`。
- 文件能力包括 `writeFiles`、`readFiles`、`listFiles`、`removeFiles`。
- 命令能力包括 `executeCommand`、`startCommandExecution`、`getTask`、`stopTask`。
- 会话默认 900 秒，创建 session 时可配置，最长 8 小时。
- session 文件在会话生命周期内可用；session 结束后环境终止，数据会清理。官方还提到 session data TTL 为 30 天。
- 每个 session 运行在隔离 microVM 中，具备独立 CPU、内存和文件系统。
- 当前配额包括：每账号 1000 个并发 active sessions、每 session 2 vCPU/8 GB、同步请求 15 分钟、异步命令最长 8 小时、每 session 10 GB 磁盘。
- API 限流默认包括 `StartCodeInterpreterSession` 30 TPS、`InvokeCodeInterpreter` 30 TPS。
- AgentCore Built-in Tools 在官方 region 表里覆盖多个 AWS 区域，包括 us-east-1、us-east-2、us-west-2、eu-central-1、ap-southeast-1、ap-northeast-1 等。

### AWS 接入前置条件

最小需要：

- AWS account。
- 支持 AgentCore Built-in Tools 的 region。
- AWS credentials 或部署环境 IAM role。
- IAM 权限至少覆盖：
  - `bedrock-agentcore:CreateCodeInterpreter`
  - `bedrock-agentcore:StartCodeInterpreterSession`
  - `bedrock-agentcore:InvokeCodeInterpreter`
  - `bedrock-agentcore:StopCodeInterpreterSession`
  - `bedrock-agentcore:DeleteCodeInterpreter`
  - `bedrock-agentcore:ListCodeInterpreters`
  - `bedrock-agentcore:GetCodeInterpreter`
  - `bedrock-agentcore:GetCodeInterpreterSession`
  - `bedrock-agentcore:ListCodeInterpreterSessions`
- 如果需要让 sandbox 自己访问 S3，还需要创建 custom Code Interpreter、execution role，以及 S3 `GetObject`/`PutObject` 权限。

Node.js 接入侧，AWS SDK v3 已有包：

- `@aws-sdk/client-bedrock-agentcore`
- `@aws-sdk/client-bedrock-agentcore-control`

本地查询到的 npm 版本为 `3.1049.0`。

### AWS provider 的代码改造建议

建议新增抽象：

```text
SANDBOX_PROVIDER=disabled|market|docker|aws-agentcore
AWS_AGENTCORE_REGION=us-west-2
AWS_AGENTCORE_CODE_INTERPRETER_ID=aws.codeinterpreter.v1
AWS_AGENTCORE_SESSION_TIMEOUT_SECONDS=1800
```

服务端 provider：

```text
ISandboxService
  MarketSandboxService        current behavior
  DockerSandboxService        self-hosted local/lan sandbox
  AwsAgentCoreSandboxService  AWS direct sandbox
```

AWS provider 需要做的映射：

| Lobe tool          | AWS AgentCore tool                          | 备注                                                       |
| ------------------ | ------------------------------------------- | ---------------------------------------------------------- |
| `executeCode`      | `executeCode`                               | language/runtime 参数需要适配                              |
| `runCommand`       | `executeCommand` 或 `startCommandExecution` | 同步 / 后台命令分开                                        |
| `getCommandOutput` | `getTask`                                   | 对应后台任务                                               |
| `killCommand`      | `stopTask`                                  | 终止后台任务                                               |
| `writeFile`        | `writeFiles`                                | 单文件包装成数组                                           |
| `readFile`         | `readFiles`                                 | 单文件包装成数组，行号范围需本地裁剪                       |
| `listFiles`        | `listFiles`                                 | 参数名需核对                                               |
| `exportFile`       | `readFiles` 或 S3 upload command            | 小文件可读回后写入 Lobe S3，大文件建议让 sandbox 上传到 S3 |

需要特别确认 / 补齐的点：

- AWS 原生文件工具是否覆盖 `editFile`、`moveFiles`、`searchFiles`、`grepContent`、`globFiles`。如果没有，可用 `executeCommand` 封装 shell 命令实现。
- 大文件导出路径。Lobe 当前是 pre-signed URL + sandbox 上传；AWS 可用 `readFiles` 读回小文件，也可创建 custom interpreter + S3 execution role 让沙箱执行 `aws s3 cp`。
- 会话缓存。需要维护 `topicId/userId -> sessionId`，并处理 session 过期后重建。
- 清理策略。用户切换话题、长时间不用、服务重启时需要停止 session 或允许超时自动结束。
- 成本保护。应限制并发 session、单次执行时长、文件大小、导出大小和后台命令时长。

### AWS 路线的成本判断

AWS pricing 页面给的 Code Interpreter 示例使用如下单价估算：

- CPU：`$0.0895 / vCPU-hour`
- Memory：`$0.00945 / GB-hour`

官方示例中，一个数据分析 agent 每月 10K requests、每个 request 3 次代码执行、每次执行 2 分钟、2 vCPU active、4 GB memory，月成本示例约为 `$109.40`。

实际成本会随运行时间、并发、内存、I/O wait、文件读写和其他 AWS 服务费用变化。对本地开发或低频内部工具来说，AWS 成本大概率可控；对高并发场景，需要显式加配额和成本保护。

### AWS vs Docker 的取舍

| 方案                | 优点                                  | 缺点                                          | 推荐用途                            |
| ------------------- | ------------------------------------- | --------------------------------------------- | ----------------------------------- |
| Docker sandbox      | 完全自托管、成本固定、可自定义镜像    | 需要自己做隔离、超时、资源限制、安全加固      | 本地 / 局域网 / 私有部署优先        |
| AWS AgentCore       | 托管隔离、microVM、配额清晰、云端弹性 | 需要 AWS 账号 / IAM / 费用，仍要开发 provider | 想要托管沙箱且能接受 AWS 依赖       |
| Lobe Market sandbox | 官方体验完整                          | 本地部署依赖 Market 授权，不可控              | Lobe 官方云或 trusted client 可用时 |

当前建议：先做 Docker sandbox，把 Market 授权错误彻底绕开；如果后面希望少维护容器隔离，再做 AWS AgentCore provider。

## 官方资料

- AWS Code Interpreter getting started: <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-getting-started.html>
- AWS direct usage: <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-using-directly.html>
- AWS runtime selection: <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-runtime-selection.html>
- AWS file operations: <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-file-operations.html>
- AWS S3 integration: <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-s3-integration.html>
- AWS session management: <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-session-characteristics.html>
- AWS service quotas: <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html>
- AWS supported regions: <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html>
- AWS AgentCore pricing: <https://aws.amazon.com/bedrock/agentcore/pricing/>
