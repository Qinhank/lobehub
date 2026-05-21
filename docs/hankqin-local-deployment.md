# Hankqin 本地部署与接入说明

这份文档记录当前 fork 在本地开发时的部署方式，以及和主服务打通时应该采用的架构边界。

## 本地开发启动

前置条件：

- Node 版本按仓库 `.nvmrc`，建议用 `nvm use`。
- 包管理器使用仓库声明的 `pnpm@10.33.0`。
- 本地需要 Docker，用来启动 PostgreSQL、Redis、RustFS、SearXNG。

首次启动：

```bash
cd projects/lobehub
corepack enable
pnpm install
cp .env.example.development .env
cp docker-compose/dev/.env.example docker-compose/dev/.env
pnpm dev:docker
pnpm db:migrate
pnpm dev:next
```

访问地址：

- 开发服务：`http://localhost:3010`
- 构建后服务：`pnpm build && pnpm start`，默认 `http://localhost:3210`

如果本机 `5432`、`6379`、`9000`、`3010` 已被占用，需要同时调整 `.env`、`docker-compose/dev/.env` 和启动脚本里的端口。

## 使用远端数据库

可以不用本地 PostgreSQL，直接连接 `<LAN_SERVER_IP>` 上的数据库。建议在同一个 PostgreSQL 实例里给 LobeHub 单独建库，例如 `lobechat`，不要和主服务业务表混在同一个 database/schema 里。

`.env` 里改成远端连接：

```dotenv
DATABASE_URL=postgresql://<db-user>:<db-password>@<db-host>:5432/<db-name>
DATABASE_DRIVER=node
```

首次迁移前，需要在 `<LAN_SERVER_IP>` 上用 PostgreSQL 管理员账号把 `lobechat` 数据库和 `public` schema 授权给 `lobechat` 用户。否则 `pnpm db:migrate` 会在创建第一张表时报 `permission denied for schema public`。

```sql
ALTER DATABASE lobechat OWNER TO lobechat;
\c lobechat
GRANT CONNECT ON DATABASE lobechat TO lobechat;
GRANT USAGE, CREATE ON SCHEMA public TO lobechat;
ALTER SCHEMA public OWNER TO lobechat;
```

如果数据库扩展还没有创建，也用管理员账号提前确认：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_search;
```

然后只启动本地仍然需要的辅助服务，不启动本地 PostgreSQL：

```bash
cd projects/lobehub
cp .env.example.development .env
cp docker-compose/dev/.env.example docker-compose/dev/.env
docker compose -f docker-compose/dev/docker-compose.yml up -d --wait redis rustfs searxng
pnpm db:migrate
pnpm dev:next
```

如果 `<LAN_SERVER_IP>` 上也已经有 Redis 和 S3/RustFS/MinIO，可以进一步把这些也指过去：

```dotenv
REDIS_URL=redis://:<redis-password>@<redis-host>:<redis-port>
REDIS_PASSWORD=<redis-password>
S3_ENDPOINT=http://<s3-host>:<s3-api-port>
S3_ACCESS_KEY_ID=<access-key>
S3_SECRET_ACCESS_KEY=<s3-secret-key>
S3_BUCKET=<s3-bucket>
S3_ENABLE_PATH_STYLE=1
S3_SET_ACL=0
```

注意事项：

- `pnpm db:migrate` 会在 `DATABASE_URL` 指向的数据库里创建 / 升级 LobeHub 表，执行前先确认连的是专用库。
- 如果远端 PostgreSQL 没开放局域网访问，需要放行 `listen_addresses`、`pg_hba.conf` 和防火墙。
- 如果只想验证聊天且暂时不用上传文件，可以先保留本地 RustFS；长期部署建议 Redis、数据库、对象存储都放到同一套服务里统一备份。

## 局域网服务清单

如果希望 `<LAN_SERVER_IP>` 统一提供 LobeHub 依赖，需要准备下面这些服务。

| 服务                 | 必需程度         | 用途                                                                                   | 关键环境变量                                                                                     |
| -------------------- | ---------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| PostgreSQL           | 必需             | 用户、会话、消息、AI provider、模型、文件元数据等核心数据                              | `DATABASE_URL`、`DATABASE_DRIVER=node`                                                           |
| PostgreSQL 扩展      | 必需             | 迁移会创建向量和 BM25 搜索能力                                                         | `vector`、`pg_search`                                                                            |
| Redis                | 建议正式环境提供 | Better Auth 二级存储、Agent 事件流、队列模式状态；简单本地模式可不用，但不建议正式缺失 | `REDIS_URL`、`REDIS_PREFIX`、可选 `REDIS_PASSWORD`                                               |
| S3 兼容对象存储      | 建议正式环境提供 | 上传文件、图片、知识库附件、生成结果持久化                                             | `S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_ENABLE_PATH_STYLE=1` |
| SearXNG              | 可选             | 联网搜索工具；不配置则搜索功能报未配置，普通聊天不受影响                               | `SEARXNG_URL`                                                                                    |
| AI Gateway           | 必需             | 聊天 / 图片模型调用                                                                    | `OPENAI_PROXY_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL_LIST`                                        |
| OIDC/SSO             | 正式身份打通需要 | 让主服务身份登录 LobeHub                                                               | `AUTH_SSO_PROVIDERS`、`AUTH_GENERIC_OIDC_*`                                                      |
| SMTP                 | 仅邮箱登录需要   | 邮箱验证、魔法链接、重置密码                                                           | `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS`                                               |
| QStash/Agent Gateway | 仅队列模式需要   | 生产级异步 Agent 执行                                                                  | `AGENT_RUNTIME_MODE=queue`、`QSTASH_TOKEN`、`AGENT_GATEWAY_*`                                    |
| Langfuse             | 可选             | LLM 调用观测                                                                           | `ENABLE_LANGFUSE`、`LANGFUSE_*`                                                                  |

本地 / 自托管环境建议显式禁用 LobeHub Market 云沙箱：

```dotenv
DISABLE_CLOUD_SANDBOX=1
```

云沙箱和沙箱文件导出依赖 LobeHub Market 授权；本地部署没有可用的 Market OAuth 授权链路时，开启云沙箱会在生成 HTML、报表等文件时出现 `Market authorization expired`。禁用后，HTML 会走对话内 artifact 预览 / 下载路径，不再触发 Market 授权。

如果已经部署了自托管的 `agent-infra/sandbox`，可以改成：

```dotenv
DISABLE_CLOUD_SANDBOX=0
SANDBOX_PROVIDER=agent-infra
SANDBOX_BASE_URL=http:// < sandbox-host > :62981
SANDBOX_WORKSPACE=/workspace/vite-project
```

这样 `lobe-cloud-sandbox` 和 `lobe-skills` 的脚本执行都会走本地 sandbox，不再依赖 Market 的 `runBuildInTool(...)`。

Market 能力拆分、Skill Connect 替代方案、Docker sandbox 和 AWS AgentCore Code Interpreter 路线见 [hankqin-market-sandbox-research.md](./hankqin-market-sandbox-research.md)。

如果需要在保留本地自定义逻辑的前提下同步 `lobehub/lobehub` 官方最新代码，操作说明见 [hankqin-upstream-sync.md](./hankqin-upstream-sync.md)。

当前推荐的最小正式组合：

```text
<LAN_SERVER_IP>:
  PostgreSQL + vector + pg_search
  Redis
  MinIO/RustFS
  SearXNG 可选

外部/已有:
  http://<OPENAI_COMPATIBLE_UPSTREAM> via LobeHub /sub2api proxy
  主服务 OIDC issuer
```

数据库特别注意：LobeHub 迁移会执行 `CREATE EXTENSION IF NOT EXISTS vector;` 和 `CREATE EXTENSION IF NOT EXISTS pg_search;`。如果远端 PostgreSQL 是普通发行版，可能没有 `pg_search`，建议直接用 ParadeDB PostgreSQL 镜像或先确认扩展已安装。

## 当前环境变量审计

当前本地 `.env` 按 “本地开发 + 主服务 SSO + 局域网 PostgreSQL/Redis/RustFS + 内置 `/sub2api` AI 代理” 审计。下面是这套运行方式必须保持的配置组。

| 配置组        | 必需变量                                                                                                                                                                   | 当前结论                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 应用地址      | `APP_URL`、`INTERNAL_APP_URL`                                                                                                                                              | 本地都指向 `http://localhost:3010`；后续 Docker / 生产部署时 `INTERNAL_APP_URL` 要改成容器或服务端可自访问地址 |
| 身份与 SSO    | `AUTH_SECRET`、`AUTH_TRUSTED_ORIGINS`、`AUTH_SSO_PROVIDERS`、`AUTH_DISABLE_EMAIL_PASSWORD`、`AUTH_GENERIC_OIDC_ID`、`AUTH_GENERIC_OIDC_SECRET`、`AUTH_GENERIC_OIDC_ISSUER` | 走 `generic-oidc`，并禁用邮箱密码登录 / 注册入口                                                               |
| 内部 JWT/OIDC | `JWKS_KEY`                                                                                                                                                                 | 必需；缺失会导致图片生成等 async task 启动失败                                                                 |
| 密钥加密      | `KEY_VAULTS_SECRET`                                                                                                                                                        | 必需；用于加密用户保存的 provider keyVaults/API keys，设置后不要更换                                           |
| 数据库        | `DATABASE_URL`、`DATABASE_DRIVER=node`                                                                                                                                     | 指向局域网 PostgreSQL 专用库                                                                                   |
| Redis         | `REDIS_URL`、`REDIS_PASSWORD`、`REDIS_PREFIX`、`REDIS_TLS`                                                                                                                 | 指向局域网 Redis                                                                                               |
| RustFS/S3     | `S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_ENABLE_PATH_STYLE=1`、`S3_SET_ACL=0`                                                           | 指向局域网 RustFS；bucket 权限由 RustFS 侧统一控制                                                             |
| AI 网关       | `OPENAI_API_KEY`、`OPENAI_PROXY_URL`、`OPENAI_MODEL_LIST`、`DEFAULT_AGENT_CONFIG`、`SUB2API_PROXY_TARGET`、`SUB2API_PROXY_TARGET_PREFIX`、`SUB2API_PROXY_API_KEY`          | LobeHub 使用内置 OpenAI provider，实际请求经 `/sub2api` 转到局域网上游                                         |
| 内网访问      | `SSRF_ALLOW_PRIVATE_IP_ADDRESS=1`                                                                                                                                          | 本地开发允许访问 `192.168.*` 内网服务                                                                          |

已验证项目：

- `.env` 必需变量静态检查通过，无缺项。
- `JWKS_KEY` 可解析，包含 RS256 RSA 私钥。
- `KEY_VAULTS_SECRET` base64 解码为 32 bytes，满足加密模块要求。
- PostgreSQL 可连接，当前用户有 `public` schema 创建权限。
- Redis 可连接并返回 `PONG`。
- RustFS/S3 bucket 可 `HeadBucket`、`PutObject`、`GetObject`、`DeleteObject`。
- 主服务 OIDC discovery 可访问，issuer 与 LobeHub 配置一致。
- `SUB2API_PROXY_TARGET` origin 可访问。
- LobeHub `src/envs/*` 环境模块可正常加载。

没有配置的能力项不影响当前核心路径：

- `QSTASH_TOKEN` / `AGENT_GATEWAY_*`：只用于队列模式 Agent Runtime；当前本地开发不启用。
- `SMTP_*` / `RESEND_*`：只用于邮箱验证、魔法链接、重置密码；当前纯 SSO 不需要。
- `S3_PUBLIC_DOMAIN`：不配置时走后端签名 URL 获取文件；如果后续希望对象直接走公开 CDN 再配置。
- `SEARXNG_URL`：只影响联网搜索工具；普通聊天、生图、SSO 不依赖。没有启动 SearXNG 时不要启用这个变量。
- `VISUAL_UNDERSTANDING_PROVIDER` / `VISUAL_UNDERSTANDING_MODEL`：只影响非视觉模型上传图片时的兜底视觉理解。

如果要启用 Upstash QStash / Workflow，把 Upstash 控制台按区域导出的变量映射到 LobeHub 实际读取的变量：

```dotenv
QSTASH_REGION=EU_CENTRAL_1
QSTASH_URL=https://qstash-eu-central-1.upstash.io
QSTASH_TOKEN=<EU_CENTRAL_1_QSTASH_TOKEN>
QSTASH_CURRENT_SIGNING_KEY=<EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY>
QSTASH_NEXT_SIGNING_KEY=<EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY>

EU_CENTRAL_1_QSTASH_URL=https://qstash-eu-central-1.upstash.io
EU_CENTRAL_1_QSTASH_TOKEN=<same-as-QSTASH_TOKEN>
EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY=<same-as-QSTASH_CURRENT_SIGNING_KEY>
EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY=<same-as-QSTASH_NEXT_SIGNING_KEY>
```

注意：QStash 是 Upstash 云端回调 LobeHub 的机制。如果 workflow 目标 URL 仍然是 `localhost`，云端通常访问不到本机服务。只配置 token 可以消除 “client token is not set” 这类启动 / 触发错误；真正要让云端 workflow 回调成功，需要把 `APP_URL` 配成 Upstash 可访问的公网地址，例如 `https://<your-domain>`。`INTERNAL_APP_URL` 如果没有容器内直连地址，也可以先和 `APP_URL` 保持一致；后续 Docker / 生产部署再改成服务端可自访问地址。

## RustFS 安装

如果 `<LAN_SERVER_IP>` 还没有 S3 兼容对象存储，推荐用 RustFS。下面示例把 RustFS API 暴露到 `65395`，控制台暴露到 `65396`。

在 `<LAN_SERVER_IP>` 上创建目录：

```bash
mkdir -p /sd2/rustfs ~/services/rustfs
cd ~/services/rustfs
```

创建 `docker-compose.yml`。这个版本不依赖 `.env`，部署前只需要把 `x-rustfs-secret-key` 改成强密码。仓库里也放了一份相同配置：[rustfs-docker-compose.yml](./rustfs-docker-compose.yml)。

```yaml
x-rustfs-access-key: &rustfs_access_key lobechat
x-rustfs-secret-key: &rustfs_secret_key '<change-to-a-strong-password>'
x-rustfs-bucket: &rustfs_bucket lobe

services:
  rustfs-perms:
    image: alpine:latest
    container_name: lobechat-rustfs-perms
    user: root
    volumes:
      - /sd2/rustfs:/data
    command: >
      sh -c "
      mkdir -p /data &&
      chown -R 10001:10001 /data &&
      echo 'RustFS volume permissions fixed'
      "
    restart: 'no'

  rustfs:
    image: rustfs/rustfs:latest
    container_name: lobechat-rustfs
    restart: unless-stopped
    security_opt:
      - 'no-new-privileges:true'
    depends_on:
      rustfs-perms:
        condition: service_completed_successfully
    ports:
      - '65395:9000'
      - '65396:9001'
    environment:
      RUSTFS_ADDRESS: 0.0.0.0:9000
      RUSTFS_CONSOLE_ADDRESS: 0.0.0.0:9001
      RUSTFS_CONSOLE_ENABLE: 'true'
      RUSTFS_CONSOLE_CORS_ALLOWED_ORIGINS: '*'
      RUSTFS_ACCESS_KEY: *rustfs_access_key
      RUSTFS_SECRET_KEY: *rustfs_secret_key
      RUSTFS_OBS_LOGGER_LEVEL: info
    volumes:
      - /sd2/rustfs:/data
    command:
      - '--access-key'
      - *rustfs_access_key
      - '--secret-key'
      - *rustfs_secret_key
      - '/data'

  rustfs-init:
    image: minio/mc:latest
    container_name: lobechat-rustfs-init
    depends_on:
      - rustfs
    restart: 'no'
    entrypoint: /bin/sh
    command: >
      -c '
      set -eux;
      mc --version;
      until mc alias set rustfs http://rustfs:9000 "$$RUSTFS_ACCESS_KEY" "$$RUSTFS_SECRET_KEY"; do sleep 2; done;
      mc ls rustfs || true;
      mc mb "rustfs/$$RUSTFS_BUCKET" --ignore-existing;
      mc admin info rustfs || true;
      printf "{\"ID\":\"\",\"Statement\":[{\"Sid\":\"\",\"Effect\":\"Allow\",\"Principal\":{\"AWS\":[\"*\"]},\"Action\":[\"s3:GetObject\"],\"NotAction\":[],\"Resource\":[\"arn:aws:s3:::%s/*\"],\"NotResource\":[],\"Condition\":{}}],\"Version\":\"2012-10-17\"}\n" "$$RUSTFS_BUCKET" > /tmp/bucket.config.json;
      mc anonymous set-json /tmp/bucket.config.json "rustfs/$$RUSTFS_BUCKET";
      '
    environment:
      RUSTFS_ACCESS_KEY: *rustfs_access_key
      RUSTFS_SECRET_KEY: *rustfs_secret_key
      RUSTFS_BUCKET: *rustfs_bucket
```

启动：

```bash
docker compose up -d
```

然后把 LobeHub `.env` 改成：

```dotenv
S3_ENDPOINT=http://<s3-host>:<s3-api-port>
S3_BUCKET=<s3-bucket>
S3_ACCESS_KEY_ID=<s3-access-key>
S3_SECRET_ACCESS_KEY=<s3-secret-key>
S3_ENABLE_PATH_STYLE=1
S3_SET_ACL=0
```

RustFS 控制台地址是 `http://<S3_HOST>:<S3_CONSOLE_PORT>`。

## OIDC/SSO 状态

OIDC/SSO 现在可以先不装。影响是 LobeHub 暂时不能直接复用主服务登录态。

开发验证阶段可以先用：

```dotenv
ENABLE_MOCK_DEV_USER=1
MOCK_DEV_USER_ID=DEV_USER
```

正式打通时再做主服务 OIDC issuer，然后在 LobeHub 配 `generic-oidc`。这个是身份架构工作，不影响 AI provider、数据库、Redis、S3 先跑起来。

## 默认 AI 配置

当前 fork 的默认业务模型已经改为：

- 默认聊天 provider：`openai`
- 默认聊天模型：`gpt5.5`
- 默认图片 provider：`openai`
- 默认图片模型：`gpt-image-2`
- 默认 OpenAI 兼容网关：LobeHub 内置 `/sub2api` 代理

本地 `.env` 关键项：

```dotenv
APP_URL=http://localhost:3010
INTERNAL_APP_URL=http://localhost:3010
AUTH_DISABLE_EMAIL_PASSWORD=1
JWKS_KEY='{"keys":[...]}'
OPENAI_API_KEY=unused
OPENAI_PROXY_URL=/sub2api
OPENAI_MODEL_LIST=gpt5.5=GPT-5.5<1050000:reasoning:vision:fc:search>,gpt-image-2
DEFAULT_AGENT_CONFIG="model=gpt5.5;provider=openai;"
SUB2API_PROXY_TARGET=http://<openai-compatible-upstream-host>:<port>
SUB2API_PROXY_TARGET_PREFIX=/v1
SUB2API_PROXY_API_KEY=<upstream-api-key>
```

说明：

- LobeHub 的 provider ID 仍然使用内置 `openai`，只是把 OpenAI compatible base URL 指向同站 `/sub2api`。
- `APP_URL` 用于浏览器访问、OAuth 回调、QStash webhook 等外部回调；本地开发用 `http://localhost:3010`，公网 QStash 场景用 `https://<your-domain>`。
- `INTERNAL_APP_URL` 用于服务端内部自调用；本地和 `APP_URL` 一样即可。如果没有单独的容器内直连地址，也可以先设置为 `https://<your-domain>`。
- `AUTH_DISABLE_EMAIL_PASSWORD=1` 让 LobeHub 走纯 SSO，不暴露邮箱密码登录 / 注册入口。
- `JWKS_KEY` 用于 OIDC 和 LobeHub 内部 lambda -> async 调用签名；图片生成会先创建数据库记录，再用它启动后台异步任务。缺失时会出现 `start async task error: JWKS_KEY environment variable is not set`。
- `JWKS_KEY` 可以用 `node scripts/generate-oidc-jwk.mjs` 生成；真实值只放本地 `.env`，不要提交。
- `/sub2api/*` 会由 Next.js 代理到 `SUB2API_PROXY_TARGET + SUB2API_PROXY_TARGET_PREFIX + /*`。默认即 `/sub2api/images/generations` -> `http://<OPENAI_COMPATIBLE_UPSTREAM>/v1/images/generations`。
- 如果上游 `<LAN_SERVER_IP>:8080` 本身不需要 `/v1` 前缀，把 `SUB2API_PROXY_TARGET_PREFIX` 设为空字符串。
- `OPENAI_ENABLE_RESPONSES_API` 默认不要配置；当前局域网上游只支持 Chat Completions，不支持 `/v1/responses`，误开会导致聊天请求 400。
- `OPENAI_API_KEY=unused` 只是 LobeHub 侧占位；真实上游 key 放在 `SUB2API_PROXY_API_KEY`，代理会覆盖 `Authorization` 后再转发。
- `gpt5.5` 是 Hankqin 网关模型 ID，已作为 OpenAI 模型别名写入 model bank。
- `gpt-image-2` 已存在于 OpenAI image model bank，这里把图片生成功能的初始选择切到它。

## 聊天请求链路

主链路参考根仓库 `docs/lobechat-ai-chat-architecture.md`：

```text
frontend ChatService
  -> POST /webapi/chat/openai
  -> checkAuth()
  -> initModelRuntimeFromDB(db, userId, "openai")
  -> ModelRuntime.initializeWithProvider("openai", { apiKey, baseURL })
  -> /sub2api
  -> http://<OPENAI_COMPATIBLE_UPSTREAM>
```

AI provider 的最终运行时配置来自两层合并：

- 服务端环境变量：`OPENAI_API_KEY`、`OPENAI_PROXY_URL`、`OPENAI_MODEL_LIST`
- 用户数据库配置：`ai_providers`、`ai_models`

如果用户在设置页手动保存过 provider keyVaults，DB 里的 `baseURL/apiKey` 会优先覆盖环境变量。

## 身份打通方案

主服务现在是自己的 WebAuth token：

- 前端把 token 存在 localStorage。
- API 用 `Authorization: Bearer <token>`。
- `/api/users/me` 同时校验管理员 session 和微信 web token。

LobeHub 浏览器端默认是 Better Auth session cookie；聊天接口 `checkAuth()` 的顺序是：

1. 开发模式 `ENABLE_MOCK_DEV_USER=1`
2. OIDC JWT header
3. Better Auth session cookie

正式打通建议走 OIDC，不建议直接改 LobeHub 的 Better Auth 内部表：

1. 主服务增加一个 OIDC issuer，负责把现有微信 / 管理员身份签成标准 OIDC 登录。
2. LobeHub 开启 `generic-oidc`：

```dotenv
AUTH_SSO_PROVIDERS=generic-oidc
AUTH_GENERIC_OIDC_ID=lobehub
AUTH_GENERIC_OIDC_SECRET=<shared-secret>
AUTH_GENERIC_OIDC_ISSUER=<main-service-issuer-url>
AUTH_TRUSTED_ORIGINS=http://localhost:65385,http://localhost:3010
```

这样主服务继续负责登录和用户身份，LobeHub 只消费标准 OIDC 并生成自己的 Better Auth session。这个方案对上游代码侵入最小，后续同步 LobeHub upstream 时冲突也最少。

开发阶段如果只验证 AI 链路，可以先在 `.env` 增加：

```dotenv
ENABLE_MOCK_DEV_USER=1
MOCK_DEV_USER_ID=DEV_USER
```

这会绕过真实登录，但不能作为正式身份方案。
