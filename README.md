<p align="center">
  <img
    src="https://img.alicdn.com/imgextra/i1/O1CN01nTg6w21NqT5qFKH1u_!!6000000001621-55-tps-550-550.svg"
    alt="AgentScope Logo"
    width="200"
  />
</p>

<p align="center">
    <a href="https://arxiv.org/abs/2402.14034">
        <img
            src="https://img.shields.io/badge/cs.MA-2402.14034-B31C1C?logo=arxiv&logoColor=B31C1C"
            alt="arxiv"
        />
    </a>
    <a href="https://pypi.org/project/agentscope/">
        <img
            src="https://img.shields.io/badge/node-18.0.0+-blue?logo=node.js"
            alt="npm"
        />
    </a>
    <a href="./LICENSE">
        <img
            src="https://img.shields.io/badge/license-Apache--2.0-black"
            alt="license"
        />
    </a>
</p>

> **演示材料**：本仓库的 Harness 工程化拆解（Agent Loop / 工具执行 / 沙箱 / 审批 / 上下文 / Hooks / Subagent / 可观测性）见 [Harness 工程化拆解（逐节代码对照）](#harness-工程化拆解以-agentscope-typescript-为例)。

## What is AgentScope?

AgentScope is a production-ready, easy-to-use agent framework with essential abstractions that work with rising model capability and built-in support for finetuning.

We design for increasingly agentic LLMs.
Our approach leverages the models' reasoning and tool use abilities
rather than constraining them with strict prompts and opinionated orchestrations.

## Why use AgentScope?

- **Simple**: start building your agents in 5 minutes with built-in ReAct agent, tools, skills, human-in-the-loop steering, memory, planning, realtime voice, evaluation and model finetuning
- **Extensible**: large number of ecosystem integrations for tools, memory and observability; built-in support for MCP and A2A; message hub for flexible multi-agent orchestration and workflows
- **Production-ready**: deploy and serve your agents locally, as serverless in the cloud, or on your K8s cluster with built-in OTel support

## Requirements

- **Node.js**: 18.0.0 or higher (20.x recommended)
- **Package Manager**: pnpm 8.0.0+ (recommended) or npm

## Features

- **Human-in-the-loop**: Built-in support for user confirmation and external execution, allowing seamless human intervention in agent workflows.

- **Event System**: Multi-agent oriented event-driven architecture for tracking agent lifecycle, tool calls, and streaming responses, designed to be frontend-friendly.

- **MCP Support**: Full integration with Model Context Protocol via both HTTP and stdio transports, enabling standardized tool communication.

- **Skill System**: Extensible skill system for adding custom capabilities with automatic schema generation and hot-reloading support.

## Quick Start

```bash
pnpm install @agentscope-ai/agentscope
# or
# npm install @agentscope-ai/agentscope
```

A quick example for using AgentScope

```typescript
import { Agent } from '@agentscope-ai/agentscope/agent';
import { OpenAIModel } from '@agentscope-ai/agentscope/model';
import { Toolkit, Bash, Read, Write } from '@agentscope-ai/agentscope/tool';

// Create a model
const model = new OpenAIModel({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o',
});

// Create a toolkit with built-in tools
const toolkit = new Toolkit({
    tools: [Bash(), Read(), Write()],
    skills: ['/path/to/your/skills'],
    skillDirs: ['/path/to/your/skillDirs'], // Monitoring these directories
});

// Initialize an agent
const agent = new Agent({
    name: 'Friday',
    sysPrompt: 'You are a helpful assistant named Friday.',
    model: model,
    toolkit: toolkit,
});

// Use the agent
const res = await agent.reply();
console.log(res.text);

// Or, get streaming events from the agent reply
let name = '';
for await (const event of agent.replyStream({})) {
    switch (event.type) {
        case EventType.RUN_STARTED:
            name = event.name;
            break;
        case EventType.TEXT_BLOCK_START:
            process.stdout.write(`${name}: `);
            break;
        case EventType.TEXT_BLOCK_DELTA:
            process.stdout.write(event.delta);
            break;
        case EventType.TEXT_BLOCK_END:
            process.stdout.write('\n\n');
            break;
    }
}
```

## Project Structure

This is a monorepo containing:

- `packages/agentscope`: Core AgentScope library
- `apps/desktop`: Example Electron application built with AgentScope

## Harness 工程化拆解：以 agentscope-typescript 为例

> 用途：给同事讲解 agent harness 的 10 个核心能力，每个概念都能跳到本仓库的**实现代码**或**可运行范例**。
>
> 链接约定：链接文本中带中文注释，例如 `agent.ts#L500-L551（主循环）`，点击可直接定位到对应代码行。
>
> 状态标记：`有` = 已实现；`部分` = 有骨架/单点实现，未成体系；`无` = 未实现。

### 0. 快速索引

| #   | Harness 概念                            | 本仓库落点                                                                                            | 可运行范例                                                                                                         | 状态 |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---- |
| 1   | 运行时定义与职责边界                    | [agent.ts#L121-L577（Agent 类：循环/状态/压缩）](packages/agentscope/src/agent/agent.ts#L121-L577)    | [agent.test.ts#L57（HITL 测试入口）](packages/agentscope/src/agent/agent.test.ts#L57)                              | 有   |
| 2   | Agent Loop 双止损 / 错误分类 / 防死循环 | [agent.ts#L500-L577（主循环与收尾）](packages/agentscope/src/agent/agent.ts#L500-L577)                | [agent.test.ts（Agent 单测全集）](packages/agentscope/src/agent/agent.test.ts)                                     | 部分 |
| 3   | 工具执行：并行与顺序回放                | [agent.ts#L509-L518（工具串行执行）](packages/agentscope/src/agent/agent.ts#L509-L518)                | [toolkit.test.ts#L272-L440（流式工具测试）](packages/agentscope/src/tool/toolkit.test.ts#L272-L440)                | 部分 |
| 4   | 沙箱与进程边界                          | [bash.ts#L90-L129（exec 执行实现）](packages/agentscope/src/tool/bash.ts#L90-L129)                    | [bash.test.ts（Bash 单测）](packages/agentscope/src/tool/bash.test.ts)                                             | 无   |
| 5   | 审批策略（与沙箱解耦）                  | [agent.ts#L330-L384（待确认工具分组）](packages/agentscope/src/agent/agent.ts#L330-L384)              | [agent.test.ts#L57-L301（确认/拒绝流程）](packages/agentscope/src/agent/agent.test.ts#L57-L301)                    | 部分 |
| 6   | 上下文管理：压缩 / 裁剪 / 隔离          | [agent.ts#L924-L1093（压缩与切分）](packages/agentscope/src/agent/agent.ts#L924-L1093)                | [test-compression.ts（交互式压缩脚本）](packages/agentscope/src/agent/test-compression.ts)                         | 部分 |
| 7   | Hooks：pre/post-tool 生命周期           | [event/index.ts#L8-L47（事件枚举）](packages/agentscope/src/event/index.ts#L8-L47)                    | [agent-event-handler.ts（前端事件消费）](apps/desktop/src/renderer/src/hooks/agent-event-handler.ts)               | 无   |
| 8   | Subagent 调度                           | [toolkit.ts#L427-L595（Skill 注入与读取）](packages/agentscope/src/tool/toolkit.ts#L427-L595)         | [toolkit.test.ts#L668（SKILL.md 测试）](packages/agentscope/src/tool/toolkit.test.ts#L668)                         | 无   |
| 9   | AGENTS.md 规格与渐进披露                | [chatService.ts#L112-L128（系统提示词拼接）](apps/desktop/src/main/services/chatService.ts#L112-L128) | [agent-skills.mdx（技能文档）](docs/guides/agent-skills.mdx)                                                       | 无   |
| 10  | 可观测性：类型化事件流                  | [event/index.ts#L267-L298（事件联合类型）](packages/agentscope/src/event/index.ts#L267-L298)          | [agent-event-handler.ts#L11-L94（事件转消息）](apps/desktop/src/renderer/src/hooks/agent-event-handler.ts#L11-L94) | 部分 |

### 1. 技术定义：把概率 token 变成可执行、可恢复、可验证的过程

**概念**：模型只负责判断；harness 负责它能看见什么、能调用什么、状态存在哪里、什么时候停止。

#### 代码落点

| 能力              | 实现                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| 循环与状态机      | [agent.ts#L121-L173（Agent 类与字段）](packages/agentscope/src/agent/agent.ts#L121-L173)                       |
| 对外入口          | [agent.ts#L224-L256（replyStream / reply）](packages/agentscope/src/agent/agent.ts#L224-L256)                  |
| 推理（模型调用）  | [agent.ts#L587-L705（\_reasoning）](packages/agentscope/src/agent/agent.ts#L587-L705)                          |
| 行动（工具执行）  | [agent.ts#L714-L740（\_acting）](packages/agentscope/src/agent/agent.ts#L714-L740)                             |
| 模型输出转事件    | [agent.ts#L774-L849（convertChatResponseToEvent）](packages/agentscope/src/agent/agent.ts#L774-L849)           |
| 工具输出转事件    | [agent.ts#L859-L906（convertToolResponseToEvent）](packages/agentscope/src/agent/agent.ts#L859-L906)           |
| 可恢复：加载/保存 | [agent.ts#L178-L203（loadState / saveState）](packages/agentscope/src/agent/agent.ts#L178-L203)                |
| 落盘格式          | [file-system.ts#L48-L80（context.jsonl + state.json）](packages/agentscope/src/storage/file-system.ts#L48-L80) |

#### 最小片段

```typescript
// agent.ts L224-L233
public async *replyStream(options: ReplyOptions): AsyncGenerator<AgentEvent, Msg> {
    await this.loadState();
    try {
        return yield* this._reply(options);
    } finally {
        await this.saveState();
    }
}
```

#### 讲点

- **可执行**：模型只产出 `ChatResponse.content`（text / thinking / tool_call），副作用全部发生在 `_acting` → `Toolkit.callToolFunction`。
- **可恢复**：`loadState/saveState` 用 `context + metadata(replyId/curIter/curSummary)` 恢复断点。
- **可验证**：`ToolResponse.state` 与 `ToolResultBlock.state` 是确定性的结果标记。
- **边界**：`ChatModelBase` 里没有文件/网络/存储；所有 I/O 都在工具和 Storage。

### 2. Agent Loop：双止损、错误分类、doom-loop guard

#### 代码落点

- `maxIters` 默认 20：[agent.ts#L159（默认轮次上限）](packages/agentscope/src/agent/agent.ts#L159)
- 主循环：[agent.ts#L500-L551（while 循环）](packages/agentscope/src/agent/agent.ts#L500-L551)
- 达到上限后的强制收尾：[agent.ts#L553-L558（force final answer）](packages/agentscope/src/agent/agent.ts#L553-L558)
- token 计量事件：[event/index.ts#L82-L89（MODEL_CALL_END）](packages/agentscope/src/event/index.ts#L82-L89)
- 错误分类枚举：[type/index.ts#L20-L30（ErrorType）](packages/agentscope/src/type/index.ts#L20-L30)
- 结束事件与错误字段：[event/index.ts#L63-L74（ReplyEndEvent.error）](packages/agentscope/src/event/index.ts#L63-L74)

#### 最小片段

```typescript
// agent.ts L500-L551（省略内部细节）
while (this.curIter < this.maxIters) {
    // 1) 无待执行工具 → 调模型
    // 2) 执行 preToolCalls（串行）
    // 3) 有需要确认的调用 → 发事件并挂起
    if (preToolCalls.length === 0) break;
    this.curIter += 1;
}
```

#### 三类止损的实际情况

| 止损             | 状态 | 说明                                                                                                          |
| ---------------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| `max_turns`      | 有   | `maxIters`，构造时校验必须大于 0（[L150-L159（构造校验）](packages/agentscope/src/agent/agent.ts#L150-L159)） |
| `max_budget_usd` | 无   | 只有 token 计量（`MODEL_CALL_END`），没有成本累计与熔断                                                       |
| doom-loop guard  | 无   | 没有重复 `(tool, input)` 检测，只靠轮次上限 + `toolChoice: 'none'` 收尾                                       |

错误分类的现状：

- `ErrorType` 定义了 9 类（authentication / permission / rate_limit / invalid_request / upstream / connection / internal / setup / unknown）
- `ReplyEndEvent.error` 字段存在，但 [agent.ts#L560-L568（固定发 COMPLETED）](packages/agentscope/src/agent/agent.ts#L560-L568) 永远发 `COMPLETED`
- 工具异常被 [toolkit.ts#L333-L347（工具异常转文本）](packages/agentscope/src/tool/toolkit.ts#L333-L347) 转成文本，不参与错误分类

#### 讲点

> 声明了 schema 不等于接上了执行。`EXCEED_MAX_ITERS` 事件和 `ReplyFinishedReason.EXCEED_MAX_ITERS` 都定义了，但循环里从未发出。

改造练习：在 `curIter` 到达上限时发出 `EXCEED_MAX_ITERS`；在 `_reasoning` 失败时用 `ErrorType` 分类后填进 `ReplyEndEvent.error`。

### 3. 工具执行：并行 + 按调用顺序返回

#### 代码落点

- 执行主循环（串行）：[agent.ts#L509-L518（串行执行）](packages/agentscope/src/agent/agent.ts#L509-L518)
- 工具调用实现：[toolkit.ts#L146-L397（callToolFunction）](packages/agentscope/src/tool/toolkit.ts#L146-L397)
- 流式工具支持：[toolkit.ts#L228-L273（AsyncGenerator 分支）](packages/agentscope/src/tool/toolkit.ts#L228-L273)
- 需确认调用的分组：[agent.ts#L341-L379（HITL 连续分组）](packages/agentscope/src/agent/agent.ts#L341-L379)

#### 最小片段

```typescript
// agent.ts L511-L518
for (const toolCall of preToolCalls) {
    const actingContent = yield * this._acting({ toolCall });
    this._saveToContext([actingContent]);
    this.confirmedToolCallIds = this.confirmedToolCallIds.filter(id => id !== toolCall.id);
}
```

#### 讲点

- 本项目**没有** `parallel_tools` / `max_workers`，是一次一个工具。
- 顺序执行天然保证轨迹顺序，回放时不需要额外排序。
- 工具本身支持流式输出（`AsyncGenerator<ToolResponse>`），只是并发没做。
- 如果要做并行，需要同时处理：事件顺序、`tool_call` / `tool_result` 配对、HITL 分组、失败重试。

范例：生成器形态的工具测试在 [toolkit.test.ts#L272-L440（生成器工具测试）](packages/agentscope/src/tool/toolkit.test.ts#L272-L440)。

### 4. 沙箱：本项目没有独立沙箱层

#### 代码落点

- `Bash` 工具：[bash.ts#L17-L166（Bash 工具定义）](packages/agentscope/src/tool/bash.ts#L17-L166)
- 执行实现：[bash.ts#L90-L129（execAsync 执行）](packages/agentscope/src/tool/bash.ts#L90-L129)
- 超时参数定义：[bash.ts#L62-L68（timeout 参数）](packages/agentscope/src/tool/bash.ts#L62-L68)
- 文件类工具（直接 fs）：[read.ts（文件读取）](packages/agentscope/src/tool/read.ts)、[write.ts（文件写入）](packages/agentscope/src/tool/write.ts)、[edit.ts（文件编辑）](packages/agentscope/src/tool/edit.ts)
- 桌面端渲染进程显式关闭沙箱：[main/index.ts#L76-L79（sandbox: false）](apps/desktop/src/main/index.ts#L76-L79)

#### 最小片段

```typescript
// bash.ts L104-L109
const { stdout } = await execAsync(command, {
    encoding: 'utf-8',
    timeout: effectiveTimeout,
    maxBuffer: 30000 * 1024,
    shell, // process.env.SHELL 或 cmd.exe
});
```

#### 现状与差距

| 项       | 现状                                                       |
| -------- | ---------------------------------------------------------- |
| 进程边界 | 直接 `exec`，无独立进程组，无进程树 kill                   |
| 工作目录 | 无 `cwd` 参数，继承主进程 cwd                              |
| 系统隔离 | 无 Seatbelt / seccomp / bubblewrap / 容器                  |
| 输出边界 | 超时（默认 120s，最大 600s）+ 30000 字符截断 + 30MB buffer |

#### 讲点

> 工具注册很便宜，执行隔离很贵。

最小改造清单：

1. `Bash` 增加 `cwd` 参数并做白名单校验；
2. 用 `execFile` 替代 `exec`，不经过 shell 解释；
3. 执行层外包一层 `sandbox-exec`（macOS）/ bubblewrap（Linux）/ Job Object（Windows）；
4. 记录并 kill 整个进程组。

### 5. 审批策略：与沙箱解耦的独立层

#### 代码落点

- 工具声明是否需要确认：[tool/base.ts#L22（requireUserConfirm 声明）](packages/agentscope/src/tool/base.ts#L22)
- 循环内挂起逻辑：[agent.ts#L330-L384（\_getAwaitingToolCalls）](packages/agentscope/src/agent/agent.ts#L330-L384)
- 发出挂起事件并 return：[agent.ts#L520-L545（发出挂起事件）](packages/agentscope/src/agent/agent.ts#L520-L545)
- 接收确认结果并恢复：[agent.ts#L403-L473（USER_CONFIRM_RESULT 恢复）](packages/agentscope/src/agent/agent.ts#L403-L473)
- 权限模式/规则类型（未接线）：[permission/index.ts#L27-L113（PermissionMode / 规则类型）](packages/agentscope/src/permission/index.ts#L27-L113)
- 桌面端确认卡片：[ConfirmCard.tsx#L67（确认卡片组件）](apps/desktop/src/renderer/src/components/chat/ConfirmCard.tsx#L67)
- 桌面端回传确认：[use-messages.ts#L80-L99（sendUserConfirm）](apps/desktop/src/renderer/src/hooks/use-messages.ts#L80-L99)

#### 最小片段

```typescript
// agent.ts L521-L528
if (awaitingType) {
    yield {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        type: awaitingType,
        reply_id: this.replyId,
        tool_calls: awaitingToolCalls,
    };
    return createMsg({ /* Waiting for user confirmation ... */ });
}
```

#### 讲点

- 审批和执行环境是解耦的：工具只声明 `requireUserConfirm`，具体谁来问、怎么问由宿主决定。
- 外部执行同理：工具没有 `call` 时走 `requireExternalExecution`（[toolkit.ts#L612-L615（外部执行判定）](packages/agentscope/src/tool/toolkit.ts#L612-L615)）。
- 缺口：`PermissionMode` 五种模式只有定义，没有引擎；允许规则不持久化，`confirmedToolCallIds` 仅在本次 reply 内有效。
- 因此“审批次数降不下来”的根因不是模型，而是**没有规则记忆**。要做 `PermissionPolicy`，从这里接。

范例：完整人工确认流程（确认/拒绝/混合调用）在 [agent.test.ts#L57-L301（确认/拒绝用例）](packages/agentscope/src/agent/agent.test.ts#L57-L301)。

### 6. 上下文管理：压缩 / 去重裁剪 / 隔离

#### 代码落点

| 手段                                 | 实现                                                                                                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 压缩配置                             | [agent.ts#L77-L106（CompressionConfig）](packages/agentscope/src/agent/agent.ts#L77-L106)                                                                                                 |
| 压缩触发与摘要生成                   | [agent.ts#L992-L1093（compressMemoryIfNeeded）](packages/agentscope/src/agent/agent.ts#L992-L1093)                                                                                        |
| 压缩边界切分（不拆散工具调用对）     | [agent.ts#L924-L987（\_splitContextForCompression）](packages/agentscope/src/agent/agent.ts#L924-L987)                                                                                    |
| 摘要注入上下文                       | [agent.ts#L612-L627（摘要注入 messages）](packages/agentscope/src/agent/agent.ts#L612-L627)                                                                                               |
| 输出截断（Read）                     | [read.ts#L100-L116（行数/行长截断）](packages/agentscope/src/tool/read.ts#L100-L116)                                                                                                      |
| 输出截断（Bash）                     | [bash.ts#L114-L129（30000 字符截断）](packages/agentscope/src/tool/bash.ts#L114-L129)                                                                                                     |
| 压缩内容外置（定义存在，循环未调用） | [storage/base.ts#L48-L51（offloadContext 定义）](packages/agentscope/src/storage/base.ts#L48-L51)、[file-system.ts#L207（外置实现）](packages/agentscope/src/storage/file-system.ts#L207) |

#### 最小片段

```typescript
// 摘要结构（agent.ts L44-L75 的默认 schema 的一部分）
const DEFAULT_SUMMARY_SCHEMA = z.object({
    task_overview: z.string().max(300),
    current_state: z.string().max(300),
    important_discoveries: z.string().max(300),
    next_steps: z.string().max(200),
    context_to_preserve: z.string().max(300),
});
```

#### 讲点

- **压缩**：按 token 阈值触发，生成结构化摘要 + 保留最近 N 块，且保证 `tool_call` 与 `tool_result` 不被拆散。
- **裁剪**：没有通用 `TruncateOutputHook`，截断写死在各个工具里（Read 2000 行 / 单行 2000 字符；Bash 30000 字符）。
- **隔离**：没有 Subagent 独立窗口；`offloadContext` 有实现但 agent 循环没调用。

范例：交互式压缩脚本在 [test-compression.ts（压缩演示脚本）](packages/agentscope/src/agent/test-compression.ts)；存储层测试在 [file-system.test.ts#L402（offload 测试）](packages/agentscope/src/storage/file-system.test.ts#L402)。

### 7. Hooks：pre/post-tool 生命周期

#### 现状

**没有 Hook 机制。** 证据：

- `agent.ts` 里三处注释写着 “without middlewares”：[agent.ts#L387（注释：without middlewares）](packages/agentscope/src/agent/agent.ts#L387)、[agent.ts#L580（同上）](packages/agentscope/src/agent/agent.ts#L580)、[agent.ts#L707（同上）](packages/agentscope/src/agent/agent.ts#L707)
- [agent-base.ts（空的中间件基类占位）](packages/agentscope/src/agent/agent-base.ts) 是空文件（占位）
- 只有**只读事件流**，没有拦截/改写能力

#### 可插入的位置

| 位置          | 代码                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工具执行前后  | [toolkit.ts#L146（callToolFunction 入口）](packages/agentscope/src/tool/toolkit.ts#L146)、[toolkit.ts#L333-L347（异常出口）](packages/agentscope/src/tool/toolkit.ts#L333-L347) |
| 单次工具执行  | [agent.ts#L714-L740（\_acting，可继承覆盖）](packages/agentscope/src/agent/agent.ts#L714-L740)                                                                                  |
| 模型调用前后  | [agent.ts#L587-L705（\_reasoning，可继承覆盖）](packages/agentscope/src/agent/agent.ts#L587-L705)                                                                               |
| UI 侧事件消费 | [agent-event-handler.ts#L11-L94（事件驱动 UI）](apps/desktop/src/renderer/src/hooks/agent-event-handler.ts#L11-L94)                                                             |

#### 讲点

> 事件不是 Hook。事件是事后广播；Hook 要能事前拦截、改写、短路。

如果要在本项目加 `TruncateOutputHook`，最自然的方式是继承 `Toolkit` 或 `Agent` 覆盖 `callToolFunction` / `_acting`，在 `tool_result` 写入上下文前裁剪。这属于“讲解用的改造建议”，不是现有实现。

### 8. Subagent 调度：description 是质量瓶颈

#### 现状

- **没有 Subagent。**
- `TaskCreate/TaskUpdate/TaskGet/TaskList` 是 todo 列表，不是子 agent：[task.ts#L11-L24（todo 任务 Map）](packages/agentscope/src/tool/task.ts#L11-L24)
- 桌面端甚至没有注册这组工具：[utils.ts#L66-L92（桌面端工具装配）](apps/desktop/src/main/services/utils.ts#L66-L92)
- 可类比的是 **Skill 调度**：技能清单以 `<name>/<description>/<location>` 注入 system prompt（[toolkit.ts#L519-L526（技能清单注入）](packages/agentscope/src/tool/toolkit.ts#L519-L526)），模型再调用 `Skill(name)` 读全文（[toolkit.ts#L539-L595（Skill 工具实现）](packages/agentscope/src/tool/toolkit.ts#L539-L595)）

#### 讲点

“description 匹配是质量瓶颈”在本项目对应成：**SKILL.md front matter 写得好不好**。

对比：

```yaml
# 差
name: docs
description: 处理文档
```

```yaml
# 好
name: docs
description: 当用户需要总结 PDF/Word 文档并输出 Markdown 摘要时使用
```

范例：SKILL.md 读取测试在 [toolkit.test.ts#L668（SKILL.md 测试）](packages/agentscope/src/tool/toolkit.test.ts#L668)。

### 9. AGENTS.md 规格：50–200 行、渐进披露、过期检测

#### 现状

- 仓库**没有 AGENTS.md**，也没有加载逻辑
- 系统提示词是硬编码 + 用户 instruction 拼接：[chatService.ts#L112-L128（系统提示词拼接）](apps/desktop/src/main/services/chatService.ts#L112-L128)
- 渐进披露的近似实现是 Skill：system prompt 只放摘要，全文按需读取（[toolkit.ts#L427-L530（getSkillsPrompt）](packages/agentscope/src/tool/toolkit.ts#L427-L530)）
- 没有 linter / CI 检查规范里引用的文件是否存在

参考文档：[agent-skills.mdx（技能指南）](docs/guides/agent-skills.mdx)

#### 可讲的模板

```markdown
# AGENTS.md（控制在 50–200 行）

## 项目地图

- 入口：packages/agentscope/src/agent/agent.ts
- 桌面端：apps/desktop

## 常用命令

- pnpm build:agentscope
- pnpm test:agentscope

## 禁区

- 不要修改 packages/agentscope/dist
- 不要提交 .devhome

## 按需读取

- 详细架构：docs/friday/architecture.mdx
```

#### 讲点

- 只写“入口 + 命令 + 禁区”，细节放链接里，靠按需读取实现渐进披露。
- 用祈使句，删掉无法验证的描述性内容。
- CI 可以加一步：校验 AGENTS.md 里出现的路径是否真实存在。

### 10. 可观测性：类型化事件流、计量、回放资产

#### 代码落点

- 事件枚举：[event/index.ts#L8-L47（EventType 枚举）](packages/agentscope/src/event/index.ts#L8-L47)
- 事件联合类型：[event/index.ts#L267-L298（AgentEvent 联合类型）](packages/agentscope/src/event/index.ts#L267-L298)
- token 计量：[event/index.ts#L82-L89（token 计量字段）](packages/agentscope/src/event/index.ts#L82-L89)
- 事件重放到消息：[message.ts#L382（appendEvent）](packages/agentscope/src/message/message.ts#L382)
- 前端消费事件：[agent-event-handler.ts#L11-L94（事件驱动 UI）](apps/desktop/src/renderer/src/hooks/agent-event-handler.ts#L11-L94)
- 桌面端 telemetry 路径（占位）：[paths.ts#L12-L49（telemetry 目录）](apps/desktop/src/main/storage/paths.ts#L12-L49)

#### 最小片段

```typescript
// 事件 → 消息（前端 applyAgentEvent 内部）
appendEvent(clonedMsg, event);
```

#### 现状

| 能力              | 状态                                      |
| ----------------- | ----------------------------------------- |
| 带类型消息流      | 有，27 种 `EventType`，全部可 JSON 序列化 |
| token 统计        | 有，`MODEL_CALL_END` 与 `Msg.usage`       |
| OTel              | 无（README 有描述，TS 仓库无实现）        |
| cassette 录制回放 | 无；最接近的是测试里的 MockChatModel      |

范例：可回放模型替身在 [agent.test.ts#L12-L55（MockChatModel）](packages/agentscope/src/agent/agent.test.ts#L12-L55)。

#### 讲点

最小 cassette 形态 = `context.jsonl` + 事件流 + MockModel 回放。本仓库三块原料都有，只差一个统一的录制器。

### 附录 A：一次真实调用的完整链路

```
渲染进程发送消息
  apps/desktop/src/renderer/src/hooks/use-messages.ts#L66-L78   （sendMessage）
        │  IPC: chat:sendMessage
        ▼
主进程处理
  apps/desktop/src/main/services/chatService.ts#L66-L158   （发送消息 IPC 处理）
        │  组装 model / storage / toolkit / agentOptions
        ▼
Agent 入口
  apps/desktop/src/main/agent/index.ts#L20-L31   （runAgent 包装）
        │
        ▼
Agent.replyStream
  packages/agentscope/src/agent/agent.ts#L224-L233   （replyStream 入口）
        │
        ├─ _reasoning  → 模型调用      agent.ts#L587-L705   （推理）
        ├─ _acting     → 工具执行      agent.ts#L714-L740   （行动）
        └─ saveState   → 落盘          agent.ts#L192-L203   （保存状态）
```

工具集装配位置：[utils.ts#L66-L92（桌面端工具装配）](apps/desktop/src/main/services/utils.ts#L66-L92)
存储位置：[paths.ts#L4-L49（数据目录）](apps/desktop/src/main/storage/paths.ts#L4-L49)

### 附录 B：运行与验证

```bash
# 核心库构建（桌面端依赖 dist）
pnpm build:agentscope

# 单测：Human-in-the-loop（审批主流程）
pnpm test:agentscope -- agent.test.ts

# 单测：工具注册 / 流式输出 / Skill
pnpm test:agentscope -- toolkit.test.ts

# 单测：存储与 compression offload
pnpm test:agentscope -- file-system.test.ts

# 核心库 watch
pnpm dev:agentscope

# 桌面应用
pnpm dev:desktop
```

> 注意：如果在 Trae 终端里启动桌面应用，终端沙箱不允许写 `~/.agentscope`，需要把 HOME 指到工作区内：
>
> ```bash
> cd apps/desktop
> HOME=$PWD/.devhome ./node_modules/.bin/electron-vite dev
> ```

### 附录 C：五个可动手的改造练习

| #   | 练习                                                   | 起点                                                                                                                                                                | 对应概念        |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | 给 `Bash` 增加 `cwd` 与白名单校验                      | [bash.ts#L54-L109（参数与执行）](packages/agentscope/src/tool/bash.ts#L54-L109)                                                                                     | 沙箱            |
| 2   | 给循环加重复调用检测（最近 N 次 `(tool, input)` 哈希） | [agent.ts#L500-L551（主循环）](packages/agentscope/src/agent/agent.ts#L500-L551)                                                                                    | doom-loop guard |
| 3   | 在超限时发出 `EXCEED_MAX_ITERS` 并填 `finished_reason` | [agent.ts#L553-L568（收尾与结束事件）](packages/agentscope/src/agent/agent.ts#L553-L568)                                                                            | 止损/错误分类   |
| 4   | 实现 `PermissionPolicy`：同类命令只问一次              | [permission/index.ts（权限类型）](packages/agentscope/src/permission/index.ts) + [agent.ts#L403-L473（确认恢复）](packages/agentscope/src/agent/agent.ts#L403-L473) | 审批            |
| 5   | 统一 `TruncateOutputHook`，替换工具内散落的截断        | [read.ts#L100-L116（Read 截断）](packages/agentscope/src/tool/read.ts#L100-L116)、[bash.ts#L114-L129（Bash 截断）](packages/agentscope/src/tool/bash.ts#L114-L129)  | 上下文/Hooks    |

### 附录 D：模块地图

| 模块       | 职责                   | 路径                                                                                     |
| ---------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| Agent      | 循环、事件、压缩、HITL | [packages/agentscope/src/agent/（Agent 循环/压缩/HITL）](packages/agentscope/src/agent/) |
| Message    | 消息模型、事件重放     | [packages/agentscope/src/message/（消息模型）](packages/agentscope/src/message/)         |
| Event      | 事件类型定义           | [packages/agentscope/src/event/（事件定义）](packages/agentscope/src/event/)             |
| Model      | 多厂商模型适配         | [packages/agentscope/src/model/（模型适配）](packages/agentscope/src/model/)             |
| Tool       | 内置工具与 Toolkit     | [packages/agentscope/src/tool/（工具与 Toolkit）](packages/agentscope/src/tool/)         |
| MCP        | HTTP / stdio 客户端    | [packages/agentscope/src/mcp/（MCP 客户端）](packages/agentscope/src/mcp/)               |
| Permission | 权限模式与规则类型     | [packages/agentscope/src/permission/（权限类型）](packages/agentscope/src/permission/)   |
| Storage    | 状态持久化             | [packages/agentscope/src/storage/（状态持久化）](packages/agentscope/src/storage/)       |
| Desktop    | Electron 宿主与 UI     | [apps/desktop/src/（桌面端）](apps/desktop/src/)                                         |

## License

AgentScope is released under Apache License 2.0.

## Contributors

All thanks to our contributors:

<a href="https://github.com/agentscope-ai/agentscope-typescript/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=agentscope-ai/agentscope-typescript&max=999&columns=12&anon=1" />
</a>
