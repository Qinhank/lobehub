# Shared AI Provider Research

更新日期：2026-05-21

这份文档记录“超级管理员在 `/settings/provider/all` 添加服务商后，全体用户共享使用该配置”的研究结论和实施方案。

超级管理员的判定依据固定为邮箱：

```text
00000000-0000-0000-0000-000000000000@users.claw.local
```

## 目标

- 超级管理员维护一份 AI Provider / Model 配置。
- 普通用户能在服务商列表、模型列表和聊天运行时使用这份共享配置。
- 普通用户不能编辑、删除或排序共享配置本体。
- 管理员密钥不能下发到普通用户浏览器。

## 当前代码现状

- 服务商表 `ai_providers` 的主键维度是 `(id, user_id)`，模型表 `ai_models` 的主键维度是 `(id, provider_id, user_id)`。
- `AiProviderModel` 和 `AiModelModel` 都按当前 `userId` 构造，因此默认只能读写当前用户自己的配置。
- `/settings/provider/all` 通过 `src/server/routers/lambda/aiProvider.ts` 写入 `AiProviderModel`。
- 服务商模型编辑通过 `src/server/routers/lambda/aiModel.ts` 写入 `AiModelModel`。
- 后端运行时通过 `initModelRuntimeFromDB(db, userId, provider)` 读取当前用户的 provider 密钥。

所以原始行为是：超级管理员添加的 provider 只属于管理员自己，其他用户不可见、不可用。

## 关键安全约束

`getAiProviderRuntimeState` 会把 provider runtime config 返回给浏览器 store，其中包含解密后的 `keyVaults`。

因此共享配置不能简单把管理员的 runtime config 合并给普通用户，否则所有普通用户浏览器都会拿到管理员 API Key。

本方案把共享配置拆成两条路径：

- 前端读路径：共享 provider / model 元数据，但清空共享 `keyVaults`，并强制 `fetchOnClient=false`。
- 服务端运行时路径：用户真正发起模型调用时，后端再读取超级管理员的加密密钥并初始化 runtime。

## 方案

不新增数据库表，也不做 migration。复用超级管理员账号现有的 `ai_providers` 和 `ai_models` 行作为共享来源。

### 1. 超级管理员解析

新增服务端 helper，根据固定邮箱查询用户：

- `sharedProviderUserId`：该邮箱对应的用户 ID。
- `isSharedProviderAdmin`：当前用户是否就是该用户。

邮箱是唯一判断依据。即使数据库里的 user id 变化，只要邮箱不变，共享管理员身份仍然成立。

### 2. 仓库读路径

`AiInfraRepos` 支持传入共享管理员 user id。

普通用户读取时：

- `getAiProviderList()` 合并内置 provider、共享管理员 provider、当前用户 provider。
- `getAiProviderDetail()` 在用户没有个人配置时返回共享 provider 详情，但清空共享 `keyVaults`。
- `getAiProviderRuntimeState()` 返回共享 provider / model，但共享 runtime config 会清空 `keyVaults` 并强制 `fetchOnClient=false`。
- `getEnabledModels()` 和 `getAiProviderModelList()` 合并共享管理员模型和当前用户模型。

合并优先级是：当前用户配置覆盖共享管理员配置，共享管理员配置覆盖内置默认配置。

### 3. 后端运行时回退

`initModelRuntimeFromDB` 的读取顺序调整为：

1. 先读取当前用户的 provider 配置。
2. 如果当前用户有可用 `keyVaults`，使用当前用户密钥。
3. 如果当前用户没有可用密钥，且共享管理员配置了该 provider，则后端使用共享管理员密钥。
4. billing/hooks 仍然使用真实请求用户的 `userId`，只借用共享 provider 凭据。

这样普通用户可以使用共享 provider，但管理员密钥只存在服务端。

### 4. 写入保护

普通用户访问共享 provider 时，后端 mutation 会拒绝以下操作：

- provider 新增、更新、配置更新、删除、启停、排序。
- model 新增、更新、删除、启停、批量更新、清空、排序。

如果用户原本就有同 id 的个人 provider 配置，则继续允许按个人配置路径写入，避免破坏已有用户数据。

## 边界行为

- 如果固定邮箱对应的超级管理员不存在，系统退回原来的按用户隔离行为。
- 超级管理员本人不走共享回退逻辑，仍然管理自己的 provider 配置。
- 普通用户已有同 id provider 时，个人配置优先。
- 普通用户只有残留空 provider 行时，详情页仍保留共享 provider 元数据，但不会暴露共享密钥。
- 共享 provider 对普通用户默认走服务端调用，不允许浏览器直接拿共享密钥请求 provider。

## 已实施代码路径

- 共享管理员 helper：`src/server/modules/SharedAiProvider/index.ts`
- 服务商仓库合并：`packages/database/src/repositories/aiInfra/index.ts`
- provider 初始化控制：`packages/database/src/models/aiProvider.ts`
- 后端 runtime 回退：`src/server/modules/ModelRuntime/index.ts`
- provider mutation 保护：`src/server/routers/lambda/aiProvider.ts`
- model mutation 保护：`src/server/routers/lambda/aiModel.ts`
- 覆盖测试：`src/server/routers/lambda/__tests__/` 和 `packages/database/src/repositories/aiInfra/__tests__/`
