<div align="center">

  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/logo-readme-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/brand/logo-readme-light.png">
    <img src="assets/brand/logo-readme-light.png" alt="skctl logo：三张索引卡，中间一张向右抽出" width="128" height="128">
  </picture>

# skctl

Agent Skill 管理器，提供命令行工具与终端工作台。

[English](README.md) · 简体中文

</div>

## 目录

- [简介](#简介)
- [特性](#特性)
- [原理](#原理)
- [安装](#安装)
- [快速开始](#快速开始)
- [概念](#概念)
- [使用](#使用)
- [Agent 集成](#agent-集成)
- [配置](#配置)
- [开发](#开发)

## 简介

你是不是遇到过这样的场景：

- 项目为了用 Agent 做运营，从 GitHub 装了一套 marketing Skill，集合里有一百多个成员 Skill。这次只是给 README 补一段使用说明，可按传统装法，定位、SEO、邮件、投放、达人合作十几个分组连同每个成员的描述会全部铺在 Agent 目录里，真正用得上的只有一个写作 Skill。
- 项目里装了三个性能分析 Skill，分工却不一样。单看描述很难判断先用哪个、怎么配合，每次都要在会话里重新交代一遍，换个人、换个项目又得重来。
- 比如 `solid-js-best-practices`，它只在 SolidJS 项目里有用。如果装到全局，React 项目、后端服务和 CLI 仓库的会话也会看到它；可要是只装在需要的项目里，两个 SolidJS 项目就各有一份副本，上游一改，两边很容易分叉，更新时还得挨个进去执行，项目一多，连哪些项目装过它都要记着。
- 上游一次改了几个 Skill，比如营销来源里的投放和邮件，想只更新这一套来源，`npx skills update` 没有按来源选择的用法，只能按成员名逐个指定。直接全部更新，又会把别的来源一起动。
- 团队交接时，`skills-lock.json` 能按来源把项目装过的 Skill 恢复出来，并用哈希校验内容，但恢复的仍是一份平铺清单。传统方案里没有集合这一层，团队为什么选这几套、哪几个该一起用，以及什么任务该先读哪个，都没有地方记录。新人装完还是得问同事，换个人再问一遍。
- 自己写的发布 Skill 想拿到另一个项目里试，只能把文件复制过去。项目 A 的构建结果放在 `dist/`，说明里也就写死了 `dist/`。到了 B，产物在 `build/`，Agent 照原样去找，什么也没找到，改一次还得同步两个地方。

这些麻烦看着不一样，根源却只有一个。Skill 存在哪里、怎么更新，以及 Agent 能看到哪些，本来可以分开决定，传统的安装方式却把它们绑在了一起。skctl 把这三件事分开处理。

## 特性

- **Collection as Skill**：用 Collection 作为组织单位整理已有的 Skill。它先把一组 Skill 收成目录里的一个入口，Agent 进入后再看成员，加载某个成员时才读正文，等于在原有 Skill 之上又加了一层渐进式披露，上下文窗口不再平铺一百多个成员 Skill；Collection 自己的 instructions 还能区分作用相近的 Skill，把几个 Skill 配合使用的经验沉淀下来，下次遇到同类任务直接照着走。
- **统一即时更新，各项目各自选用**：Skill 在本机只装一份，Source 记着它从哪个仓库来。更新一次，所有选用它的项目下次读取就是新版；哪个项目能用，由项目自己选用哪些 Collection 决定，没选用的看不到，选用的读同一份安装。远程来源按精确提交安装，装之前可以先把候选 Skill 列出来审一遍。
- **按 Source 更新**：更新时不用挨个回忆成员名，从 Source 进去就行。检查会列出这一组里的变化，你再挑要应用的成员；检查本身不改动任何已安装的内容，仓库里新加的 Skill 也不会被顺带装上。
- **团队共享**：来源、集合、成员选择、披露层级，还有指令，全部写在 JSONC 里，整套配置是声明式的。团队共用的部分写进仓库里的 `config.jsonc`，项目自己启用哪些入口写进 `skctl.jsonc`；新同事拿到仓库后，按这两份配置把缺的内容装上，团队的用法就照原样沿用下来，不用再挨个问。
- **本地开发**：自己写 Skill 时，把它所在的目录登记成本地 Source，就能在另一个项目里直接试用。正文和资源改完马上生效，只有名称和描述需要手动更新一次。

## 原理

skctl 通过 integration 把一条很短的入口写进 coding agent 的 system prompt：需要找 Skill 时，先调用 `skctl agent browse`。这个命令返回当前披露的 Skill 目录和一段简短的使用方法，Agent 之后每次要加载内容，都从这份目录里找地址。

目录里有哪些条目，由 `use` 声明决定：启用了几个 Collection，目录里就有几条，每条只有一段入口描述。这是第一层披露。任务对得上，Agent 就调用 `skctl agent browse <collection>`，看到这个 Collection 自定义的 instructions 和直属成员的描述；确定要用某个成员，再用 `skctl agent load <collection>:<member>` 读完整指令。脚本、参考资料等文件用 `agent ls` 列出，需要哪份再用 `agent read` 读哪份。每一层都等上一层不够用时才展开，Skill 正文留在磁盘上，不会一开始就进上下文。

举个例子：项目启用了 `frontend` 和 `docs` 两个 Collection，你让 Agent 改一个按钮的样式。Agent 从目录里看到 `frontend` 的入口描述，browse 进去，发现里面有个 `css-conventions` 成员，load 它的完整指令再动手。`docs` 跟这个任务无关，Agent 不会进去，里面的成员和正文都不会进上下文。

`skctl integration connect` 负责把这套入口装进宿主：Codex 用生命周期钩子，OpenCode 用插件；遇到不认识的宿主，就写入一段固定指令，让 Agent 自己去查目录。注入的内容只有入口和用法，Skill 正文仍留在磁盘上。Skill 装在哪里、哪个项目能用哪些 Collection，仍由 skctl 统一管理，所以更新时只改这一处安装，Agent 下次读到的就是新版本。

## 安装

skctl 交付两个程序，读取同一份配置和安装状态：

| 程序    | 作用                                   |
| ------- | -------------------------------------- |
| `skctl` | 管理 CLI；不带子命令运行时会打开工作台 |
| `sktui` | 独立的终端工作台                       |

两者都以原生二进制发布，运行时不依赖额外环境。发布产物按平台命名，例如 `skctl-linux-x64`、`sktui-linux-x64`、`skctl-darwin-arm64`、`skctl-windows-x64.exe`，可在仓库的 Releases 页面下载。下载后把 `skctl` 与 `sktui` 放进 `PATH`，或按发布名放在同一目录下；Windows 上保留 `.exe` 后缀。从源码构建的方法见[开发](#开发)。

```sh
skctl --help
skctl tui
sktui --project /path/to/project
```

两个程序都支持用 `--project` 指定项目边界。在交互式终端中直接运行 `skctl` 会打开工作台。

## 快速开始

### 1. 登记来源并安装

远程来源按精确提交安装，本地来源直接读取原目录。

```sh
# 登记一个 Git 仓库
skctl source register github team https://github.com/acme/skills --ref main --scope global

# 列出该修订下的候选 Skill Root（此时尚未安装任何内容）
skctl source discover team --json

# 按精确提交安装一个已审查的根目录
skctl install team skills/review --revision <40 位提交哈希>
```

登记本地目录的写法：

```sh
skctl source register local mine /path/to/skills --scope global
skctl install mine skills/review
```

### 2. 创建 Collection 并启用

```sh
skctl collection create task-review
skctl collection member add task-review review team skills/review
skctl use add task-review -g
```

`use add` 的作用是把 Collection 放进 Agent 目录。

### 3. 连接 Agent 宿主

按宿主和作用域配置一次即可：

```sh
skctl integration connect codex --scope global
skctl integration connect opencode --scope project --project /path/to/project
```

### 4. Agent 读取

Agent 通过下面的命令逐层读取内容：

```sh
skctl agent browse                  # 目录根与各条目的描述
skctl agent browse task-review      # 自定义指令与成员描述
skctl agent load task-review:review # 选中 Skill 的完整指令
skctl agent ls task-review:review   # 支撑资源清单，不加载内容
```

## 概念

| 术语                 | 含义                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Source**           | 提供 Skills 的仓库或目录，负责获取与更新。                                         |
| **已安装 Skill**     | 本机实际安装的一份 Skill；远程来源的 Skill 会固定到精确修订。                      |
| **Collection**       | 已安装 Skills 的命名分组，用一段描述说明 Agent 何时应当进入。                      |
| **Use**              | 把 Collection 放进 Agent 目录的声明，可以位于 global、project 或 local 作用域。    |
| **Reference / Link** | Collection 之间的关系：Reference 指向另一个 Collection 的条目，Link 则实时包含它。 |

一个 Skill 只需安装一次，可以属于任意多个 Collection。成员关系、可发现性与上下文加载互相独立，因此不同项目可以启用不同的 Collection，而它们使用的是同一份安装。

## 使用

### 配置 Collection

Collection 的写法与 Skill 类似：描述说明何时应当进入；进入之后，Agent 会得到成员的描述和你写的指令，不会再次看到 Collection 自身的描述。指令是可选的，写在 JSONC 配置中：

```jsonc
{
  "collections": {
    "frontend-perf-analysis": {
      "description": "诊断前端性能并规划改进。",
      "instructions": "先确认现有证据。\n只加载当前任务需要的成员 Skill。",
      // 保留此处的成员、Link 与 Reference
    },
  },
}
```

也可以通过 CLI 设置，默认写入 project 作用域：

```sh
skctl collection set frontend-perf-analysis --description "诊断前端性能"
skctl collection set frontend-perf-analysis --instructions-file ./collection-guide.md
skctl collection inspect frontend-perf-analysis --json
```

- `--instructions` 接受内联文本；`--instructions-file` 会把文件内容复制进 JSONC，不保留对文件的引用。
- 命令中未提及的字段、成员、Link 与 Reference 会原样保留。
- `--clear-description` 与 `--clear-instructions` 用于删除对应字段。
- `--scope global|project|local` 用于指定归属。

### 更新

**Check updates** 只刷新检查结果，不修改已安装的内容。要应用更新，在工作台的 **Updates** 页面打开对应的 Source，用 Space 勾选需要更新的 Skills 后执行。更新中途停止时，已经应用的部分会保留。工作台启动时会自动检查已安装 Source 的更新。

### 迁移到另一个 Source

把已安装的 Skill 迁移到另一个 Source 名下，需要先预览并审查，再应用：

```sh
skctl rebind preview old-source skills/review new-source --json > rebind-review.json
skctl rebind apply rebind-review.json
```

如果目标处的 Source 相对路径不同，在 `preview` 上加 `--path`。迁移的规则如下：

- Core 必须证明新旧两个地址指向同一个 Skill。
- 预览会列出受影响的直接成员关系。
- apply 会把可写的地址连同归属一起修复，并拒绝已经过期的证据。
- 该操作只覆盖被捕获的工作区，不包括同样引用了旧地址的未知项目。

### 终端工作台

工作台包含六个页面：**Skills、Collections、Sources、Updates、Agent、Settings**。

| 操作                   | 按键              |
| ---------------------- | ----------------- |
| 在区域之间移动         | Tab               |
| 浏览                   | 方向键            |
| 进入 / 返回            | Enter / Escape    |
| 打开当前页面的命令入口 | Ctrl+P（Actions） |

各页面的内容：

- **Skills**：已安装清单。本机尚无内容时，第一步是 **Add Source**。
- **Collections**：每个 Collection 包含 **Members**、**Description & instructions** 与 **Settings**。
- **Sources**：每个 Source 包含 **Installed** 与 **Source settings**。
- **Updates**：检查并应用更新。
- **Agent**：目录与宿主连接分开显示，可以连接、检查或断开 Codex 与 OpenCode。
- **Settings**：选择 Global、Project 或 Local 配置作用域。

## Agent 集成

`skctl integration connect` 会为宿主选择匹配的适配器：

- **Codex**：使用原生生命周期钩子调用 `skctl agent browse`。
- **OpenCode V2**：使用随二进制一起打包的插件。
- **其他情况**：没有匹配的适配器时，`default` 会把稳定的指引写入指令文件，不会自动改用别的机制。

兼容性未知或安装失败，自动配置会停止。重复执行 `connect` 会维护已有条目。用相同的宿主和作用域执行 `disconnect` 会删除条目。升级之后，已有条目仍沿用原来的机制。连接宿主只提供通路，Agent 能看到哪些内容由 `use` 声明决定。

<details>
<summary>宿主兼容性与已退役设置</summary>

Codex 0.164.0 使用原生适配器，0.118.0 使用指令指引，其他版本需要先验证兼容性再自动配置。Codex 需要在 `/hooks` 中审查钩子；OpenCode 在配置变化后，需要重载对应的服务或位置。真实宿主测试覆盖了 Codex 的可信 JSON 与内联钩子、启动、恢复、fork、压缩、子代理上下文和大目录交付，以及 OpenCode 2.0.32 的全局与项目加载、目录刷新、压缩、会话目录迁移、CLI 失败与移除。

`agents.opencode: "managed"` 已废弃并被忽略，`skctl managed set` 与 `unset` 会返回 `MANAGED_COMMAND_RETIRED`，且不写入任何配置。升级之后，已有的插件可能开始收到目录，即使旧的 managed 开关此前处于关闭状态。托管条目的路径、自定义宿主可执行文件、移除与迁移，请参阅 `skctl integration --help`。

</details>

## 配置

`skctl` 与 `sktui` 读取同一份配置与安装状态：

| 作用域       | 路径                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| 全局配置     | `$XDG_CONFIG_HOME/skctl/config.jsonc`，默认 `~/.config/skctl/config.jsonc` |
| 项目配置     | 项目根目录的 `skctl.jsonc`                                                 |
| 本地配置     | 项目根目录的 `skctl.local.jsonc`                                           |
| Linux 状态   | `$XDG_STATE_HOME/skctl`，默认 `~/.local/state/skctl`                       |
| macOS 状态   | `~/Library/Application Support/skctl`                                      |
| Windows 状态 | `%LOCALAPPDATA%\skctl`                                                     |

- `SKCTL_STATE_DIR` 可以覆盖状态目录，取值必须是绝对路径。
- 配置文件可以声明 `"$schema": "https://skctl.dev/schema.json"`。
- Agent 的入口文件归 Codex 或 OpenCode 所有，由 `skctl integration` 管理，只有 `global` 与 `project` 两种作用域；`local` 仅用于 skctl 自身的内容配置。

<details>
<summary>代理</summary>

在用户配置 `~/.config/skctl/config.jsonc`（设置了 `$XDG_CONFIG_HOME` 时为对应路径）中写入：

```jsonc
{
  "network": {
    "proxy": "http://127.0.0.1:7890",
  },
}
```

该设置作用于 HTTP(S) Source 的下载与更新检查，并且只能放在用户配置中；SSH 使用它自己的配置。未设置时，沿用现有的环境变量与 Git 代理设置。

</details>

<details>
<summary>安装状态与远程快照</summary>

安装状态使用 format v4。升级时请先关闭所有旧版 `skctl` 与 `sktui` 进程，再让新版本使用同一个状态目录。旧格式仍然可以离线读取，直到下一次成功的管理写入才会升级状态，这个过程不会移动已安装的内容，也不会重新哈希。Agent 的读取不会写入状态，但一旦状态升级为 v4，旧二进制就无法降级使用该目录。远程安装是私有的、只写一次的快照，并不承担篡改检测：读取命令只检查选中的路径，不会对每个已安装文件做哈希。本地资源的修改立即可见，Local 更新只刷新名称与描述元数据；远程预览比较的是已安装版本与目标 Git 版本，不包含私有快照目录里未被跟踪的修改。

</details>

## 开发

开发需要 Bun **1.4.3** 与 Docker。先准备依赖和运行器镜像：

```sh
bun install --frozen-lockfile
docker pull node:22.23.2-bookworm
```

验证与构建都通过受限的 [Docker 运行器](scripts/resource-run.md) 执行：

```sh
bun run typecheck
scripts/resource-run.sh bun node_modules/typescript/bin/tsc -p packages/integrations/tsconfig.json --noEmit
scripts/resource-run.sh bun run lint
scripts/resource-run.sh bun run schema:check
scripts/resource-run.sh --timeout 300 bun scripts/build.ts native
```

构建命令：

- `native`：构建当前平台的 CLI 与 TUI，并在 `dist/` 中生成 `opencode-adapter.js`、`opencode-adapter.tgz`、`SHA256SUMS` 与 `release-metadata.json`。
- `build:cli`、`build:tui`：只构建单个二进制及插件。
- `pack:plugin`：只构建插件。

分项测试：

```sh
bun run pack:plugin
scripts/resource-run.sh bun test packages/integrations/test packages/opencode-adapter/test
scripts/resource-run.sh bun test packages/skctl/test
bun run test:tui
```

从源码进行交互式开发：`bun run dev:tui`。
