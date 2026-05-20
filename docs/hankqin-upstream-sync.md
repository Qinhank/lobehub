# Hankqin 上游同步操作说明

更新日期：2026-05-21

这份文档记录当前 fork 如何安全同步 `lobehub/lobehub` 的最新代码，同时优先保留自己的改动，不让自定义逻辑被覆盖。

目标不是“最快拉最新”，而是：

1. 先保住当前可工作的自定义代码。
2. 在独立分支上完成官方代码同步。
3. 验证通过后，再替换主开发分支。

## 适用前提

这套流程适合下面这种情况：

- 当前仓库是你的 fork。
- `origin` 指向你自己的 fork。
- `upstream` 或单独的官方 remote 指向 `https://github.com/lobehub/lobehub.git`。
- 你的改动已经是提交过的 commit，而不是一堆未提交的工作区改动。
- 你的自定义修改主要是线性提交挂在旧版 `canary` 之上。

如果你本地有未提交修改，先处理掉：

```bash
git status
```

如果不干净，先选一个：

- 直接提交：

```bash
git add .
git commit -m "wip: save local changes before upstream sync"
```

- 或临时 stash：

```bash
git stash push -u -m "before upstream sync"
```

## Remote 约定

推荐保持下面的 remote 语义：

- `origin`：你自己的 fork
- `upstream`：官方 `lobehub/lobehub`

检查：

```bash
git remote -v
```

如果 `upstream` 不是官方仓库，修正：

```bash
git remote set-url upstream https://github.com/lobehub/lobehub.git
git fetch upstream canary
```

如果你不想改现有 `upstream`，也可以新加一个官方 remote：

```bash
git remote add official https://github.com/lobehub/lobehub.git
git fetch official canary
```

后文默认用 `upstream/canary`。

## 推荐流程

下面是推荐的“安全同步流程”。

### 1. 先打备份分支

假设你当前要同步的是 `canary`：

```bash
git switch canary
git branch backup/canary-before-upstream-sync-YYYY-MM-DD canary
```

建议把这个备份也推到你的 fork：

```bash
git push -u origin backup/canary-before-upstream-sync-YYYY-MM-DD
```

这样即使后面 rebase、force push、误操作，远端也有完整快照。

### 2. 新建集成分支，不直接动主分支

不要在当前 `canary` 上直接 rebase。先开一条集成分支：

```bash
git switch -c integrate/upstream-canary-YYYY-MM-DD canary
```

### 3. 把你的自定义提交重放到官方最新 canary 上

```bash
git fetch upstream canary
git rebase upstream/canary
```

如果成功，你的自定义 commit 会被重写到官方最新 `canary` 顶部。

如果有冲突：

```bash
git status
```

修冲突后继续：

```bash
git add <冲突文件>
git rebase --continue
```

如果发现这次同步方向不对，直接退出：

```bash
git rebase --abort
```

### 4. 在集成分支上做验证

至少做两类验证：

- 你自己改过的核心链路
- 和本次同步强相关的定向测试

示例：

```bash
pnpm exec eslint src/server/services/aiAgent/index.ts
pnpm vitest run src/services/cloudSandbox.test.ts src/store/serverConfig/selectors.test.ts src/server/modules/Mecha/AgentToolsEngine/__tests__/index.test.ts
```

如果你的仓库允许，全量类型检查也建议跑：

```bash
pnpm exec tsgo --noEmit
```

如果 `tsgo` 在服务器上长期挂住，就不要把“命令能启动”误判成“类型检查已通过”。要么换更小范围检查，要么单独排查 `tsgo`。

### 5. 先把集成结果推到 fork

验证通过后，先推集成分支，不要立刻覆盖主分支：

```bash
git push -u origin integrate/upstream-canary-YYYY-MM-DD
```

这样远端就同时保留：

- 旧主线
- 备份分支
- 新集成分支

### 6. 确认无误后，再替换主分支

如果你确认集成分支可以替代原来的 `canary`，再做下面这一步。

先让本地 `canary` 指向集成结果：

```bash
git branch -f canary integrate/upstream-canary-YYYY-MM-DD
git switch canary
```

然后安全推送到 fork：

```bash
git push --force-with-lease origin canary
```

这里必须用 `--force-with-lease`，因为 rebase 之后 commit 哈希会变，普通 push 会失败。

不要无脑用 `--force`。`--force-with-lease` 至少会在远端分支被别人改动过时拒绝覆盖。

## 为什么不建议直接在 canary 上操作

直接在 `canary` 上 `rebase upstream/canary` 有两个问题：

1. 一旦中间冲突多、判断失误、测试不过，你的主开发分支会立即进入不稳定状态。
2. 如果后面你还想回到同步前状态，就得手动找旧 commit，不如一开始就单独开集成分支和备份分支。

所以推荐顺序永远是：

```text
备份分支 -> 集成分支 -> 验证 -> 替换主分支
```

## 什么时候不适合直接 rebase

下面几种情况，不建议直接按这份文档硬做：

- 你的修改不是线性 commit，而是夹杂大量 merge commit。
- 你有大量未提交修改。
- 你的 `canary` 已经和其他人共享，并且多人直接往上推。
- 你已经长期偏离官方分支，冲突面非常大。

这种情况下，更稳的是：

1. 从官方最新 `upstream/canary` 新开分支。
2. 按主题逐个 `cherry-pick` 你自己的 commit。
3. 对冲突面大的模块做手工迁移，不强行 replay 整条历史。

## 回滚方法

如果替换 `canary` 后发现有问题，回滚很直接。

本地回滚到备份分支：

```bash
git switch canary
git reset --hard backup/canary-before-upstream-sync-YYYY-MM-DD
```

再推回远端：

```bash
git push --force-with-lease origin canary
```

如果只是想继续排查，不想动主分支，也可以直接回到备份分支工作：

```bash
git switch backup/canary-before-upstream-sync-YYYY-MM-DD
```

## 当前仓库一次实际同步示例

这次仓库里实际做过一次同步，做法就是按上面流程来的：

1. 保留原分支 `canary`
2. 新建备份分支：
   `backup/canary-before-official-sync-2026-05-21`
3. 新建集成分支：
   `integrate/official-canary-2026-05-21`
4. 把 5 个自定义 commit rebase 到官方最新 `canary`
5. 跑定向验证
6. 推送备份分支和集成分支
7. 最后再用 `--force-with-lease` 更新远端 `canary`

如果后面继续按这个模式同步，建议继续沿用：

- `backup/canary-before-upstream-sync-YYYY-MM-DD`
- `integrate/upstream-canary-YYYY-MM-DD`

这种命名能让每次同步都可追溯。
