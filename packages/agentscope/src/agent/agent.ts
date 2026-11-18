import { z } from 'zod';

import {
    ContentBlock,
    createMsg,
    getContentBlocks,
    Msg,
    ToolCallBlock,
    ToolResultBlock,
} from '../message';
import { ChatModelBase, ChatResponse, ChatUsage } from '../model';
import { Toolkit, ToolResponse } from '../tool';
import { ActingOptions, ObserveOptions, ReasoningOptions, ReplyOptions } from './interfaces';
import {
    AgentEvent,
    EventType,
    ModelCallEndEvent,
    ModelCallStartEvent,
    ReplyEndEvent,
    ReplyFinishedReason,
    ReplyStartEvent,
    TextBlockDeltaEvent,
    TextBlockEndEvent,
    TextBlockStartEvent,
    ThinkingBlockDeltaEvent,
    ThinkingBlockEndEvent,
    ThinkingBlockStartEvent,
    ToolCallDeltaEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
    ToolResultDataDeltaEvent,
    ToolResultEndEvent,
    ToolResultStartEvent,
    ToolResultTextDeltaEvent,
} from '../event';
import { StorageBase } from '../storage';

const DEFAULT_COMPRESSION_PROMPT =
    '<system-hint>You have been working on the task described above but have not yet completed it. ' +
    'Now write a continuation summary that will allow you to resume work efficiently in a future context window ' +
    'where the conversation history will be replaced with this summary. ' +
    'Your summary should be structured, concise, and actionable.</system-hint>';

const DEFAULT_SUMMARY_SCHEMA = z.object({
    task_overview: z
        .string()
        .max(300)
        .describe(
            "The user\'s core request and success criteria. Any clarifications or constraints they specified"
        ),
    current_state: z
        .string()
        .max(300)
        .describe(
            'What has been completed so far. File created, modified, or analyzed (with paths if relevant). Key outputs or artifacts produced.'
        ),
    important_discoveries: z
        .string()
        .max(300)
        .describe(
            "Technical constraints or requirements uncovered. Decisions made and their rationale. Errors encountered and how they were resolved. What approaches were tried that didn\'t work (and why)"
        ),
    next_steps: z
        .string()
        .max(200)
        .describe(
            'Specific actions needed to complete the task. Any blockers or open questions to resolve. Priority order if multiple steps remain'
        ),
    context_to_preserve: z
        .string()
        .max(300)
        .describe(
            "User preferences or style requirements. Domain-specific details that aren\'t obvious. Any promises made to the user"
        ),
});

export interface CompressionConfig {
    /**
     * 是否启用记忆压缩。
     */
    enabled: boolean;
    /**
     * 触发记忆压缩的 token 数量阈值。
     */
    triggerThreshold: number;
    /**
     * 统计记忆中消息 token 数的函数。未提供时默认使用启发式 token 计数方法。
     */
    tokenCountFunc?: (msgs: Msg[]) => number;
    /**
     * 用于压缩的聊天模型。未提供时默认使用与 agent 相同的模型。
     */
    compressionModel?: ChatModelBase;
    /**
     * 记忆压缩使用的提示词模板。应设计为指示模型在保留重要信息的前提下，把输入消息压缩成简洁摘要。未提供时使用默认提示词。
     */
    compressionPrompt?: string;
    /**
     * 压缩摘要的 JSON schema。模型会按该 schema 将记忆压缩为结构化摘要。未提供时使用仅含单个文本字段的默认 schema。
     */
    summarySchema?: z.ZodObject;
    /**
     * 上下文中保留不参与压缩的最近消息数量。
     */
    keepRecent?: number;
}

export interface AgentOptions {
    name: string;
    sysPrompt: string;
    model: ChatModelBase;
    maxIters?: number;
    toolkit?: Toolkit;
    storage?: StorageBase;
    compressionConfig?: CompressionConfig;
}

/**
 * AgentScope 库中统一的 agent 类。
 *
 * Harness 核心：把模型输出的概率 token 变成可执行、可恢复、可验证的过程。
 * - 可执行：_reasoning 调模型，_acting 执行工具
 * - 可恢复：loadState / saveState 持久化上下文与断点
 * - 可验证：ToolResponse.state / ToolResultBlock.state
 */
export class Agent {
    // Agent 配置
    name: string;
    model: ChatModelBase;
    maxIters: number;
    toolkit: Toolkit;
    storage?: StorageBase;
    context: Msg[];
    private _loaded: boolean;
    private _sysPrompt: string;
    compressionConfig?: CompressionConfig;

    // Agent 状态
    replyId: string;
    curIter: number;
    confirmedToolCallIds: string[];
    curSummary: string;

    /**
     * 使用给定参数初始化一个 agent 实例。
     *
     * @param options - Agent 配置选项。
     * @param options.name - Agent 的名称。
     * @param options.sysPrompt - Agent 的系统提示词。
     * @param options.model - 使用的聊天模型。
     * @param options.maxIters - 最大迭代次数（默认：5）。
     * @param options.memory - 记忆存储（默认：InMemoryMemory）。
     * @param options.toolkit - 工具集（默认：Toolkit）。
     */
    constructor(options: AgentOptions) {
        // 检查 maxIters 必须大于 0
        if (options.maxIters !== undefined && options.maxIters <= 0) {
            throw new Error('maxIters must be greater than 0');
        }

        this.name = options.name;
        this._sysPrompt = options.sysPrompt;
        this.model = options.model;
        // Harness 止损之一：最大轮次（默认 20）。本项目没有 max_budget_usd 成本止损。
        this.maxIters = options.maxIters ?? 20;
        this.context = [];
        this.toolkit = options.toolkit ?? new Toolkit();
        this.storage = options.storage;
        this.compressionConfig = options.compressionConfig;

        // 记录 agent 状态是否已从存储加载，避免重复加载
        this._loaded = false;

        // 跟踪当前 reply 会话的状态
        this.replyId = '';
        this.curIter = 0;
        this.confirmedToolCallIds = [];
        this.curSummary = '';
    }

    /**
     * 如果提供了存储且尚未加载，则从存储中加载状态。
     */
    async loadState() {
        if (this._loaded || !this.storage) return;
        const { context, metadata } = await this.storage.loadAgentState({ agentId: this.name });
        console.log(`Load state for agent "${this.name}" from storage:`, { context, metadata });
        this.context = context;
        this.replyId = (metadata.replyId as string) || '';
        this.curIter = (metadata.curIter as number) || 0;
        this.curSummary = (metadata.curSummary as string) || '';
        this._loaded = true;
    }

    /**
     * 如果提供了存储，则把当前 reply 会话的状态保存到存储中。
     */
    async saveState() {
        if (!this.storage) return;
        await this.storage.saveAgentState({
            agentId: this.name,
            context: this.context,
            metadata: {
                replyId: this.replyId,
                curIter: this.curIter,
                curSummary: this.curSummary,
            },
        });
    }

    /**
     * 获取 agent 的系统提示词。
     *
     * @returns 系统提示词字符串。
     */
    public get sysPrompt() {
        const skillsPrompt = this.toolkit.getSkillsPrompt();
        if (skillsPrompt.length > 0) {
            return this._sysPrompt + '\n\n' + skillsPrompt;
        }
        return this._sysPrompt;
    }

    /**
     * 回复给定消息，并在生成过程中流式输出 agent 事件。
     *
     * @param options - 包含传入消息的 reply 选项。
     * @returns 一个异步生成器，产出 agent 事件，并最终解析为最终回复消息。
     */
    public async *replyStream(options: ReplyOptions): AsyncGenerator<AgentEvent, Msg> {
        // 如果尚未加载，则从存储中加载 agent 状态
        await this.loadState();
        try {
            // 产出回复流
            return yield* this._reply(options);
        } finally {
            await this.saveState();
        }
    }

    /**
     * 回复给定消息，在内部消费所有流式事件。
     *
     * @param options - 包含传入消息的 reply 选项。
     * @param options.msgs - 需要回复的传入消息。
     * @returns 一个解析为最终回复消息的 promise。
     */
    public async reply(options: ReplyOptions): Promise<Msg> {
        // 如果尚未加载，则从存储中加载 agent 状态
        await this.loadState();
        try {
            const res = this._reply(options);
            while (true) {
                const { value, done } = await res.next();
                if (done) {
                    return value as Msg;
                }
            }
        } finally {
            await this.saveState();
        }
    }

    /**
     * 把给定的内容块作为新块保存到上下文中最后一条 assistant 消息里；
     * 如果最后一条消息不是来自该 assistant，或名称不同，则新建一条 assistant 消息。
     * @param blocks
     * @param usage
     */
    protected _saveToContext(blocks: ContentBlock[], usage?: ChatUsage): void {
        const msgUsage: Msg['usage'] = usage
            ? {
                  input_tokens: usage.inputTokens,
                  output_tokens: usage.outputTokens,
                  cache_input_tokens: 0,
                  cache_creation_input_tokens: 0,
              }
            : null;
        const lastMsg = this.context.at(-1);
        if (this.context.length === 0) {
            this.context.push(
                createMsg({
                    name: this.name,
                    content: blocks,
                    role: 'assistant',
                    usage: msgUsage,
                })
            );
        } else if (lastMsg && lastMsg.role === 'assistant' && lastMsg.name === this.name) {
            lastMsg.content.push(...blocks);
            if (msgUsage) {
                if (!lastMsg.usage) {
                    lastMsg.usage = {
                        input_tokens: 0,
                        output_tokens: 0,
                        cache_input_tokens: 0,
                        cache_creation_input_tokens: 0,
                    };
                }
                lastMsg.usage.input_tokens = lastMsg.usage.input_tokens + msgUsage.input_tokens;
                lastMsg.usage.output_tokens = lastMsg.usage.output_tokens + msgUsage.output_tokens;
            }
        } else {
            this.context.push(
                createMsg({
                    name: this.name,
                    content: blocks,
                    role: 'assistant',
                    usage: msgUsage,
                })
            );
        }
    }

    /**
     * 获取上下文中尚未有结果的待处理工具调用。
     * @returns 一个待处理 `ToolCallBlock` 数组，这些调用正在等待执行结果。
     */
    protected _getPendingToolCalls(): ToolCallBlock[] {
        if (this.context.length === 0) return [];

        const lastMsg = this.context.at(-1);
        if (!lastMsg) return [];
        if (lastMsg.role === 'assistant') {
            const toolCalls = getContentBlocks(lastMsg, 'tool_call');
            const toolResults = getContentBlocks(lastMsg, 'tool_result');
            return toolCalls.filter(toolCall => !toolResults.some(tr => tr.id === toolCall.id));
        }
        return [];
    }

    /**
     * 获取需要用户确认或外部执行的等待中工具调用。
     * @returns 一个 `ToolCallBlock` 数组，这些调用正在等待用户确认或外部执行。
     */
    protected _getAwaitingToolCalls(): {
        awaitingType?: EventType.REQUIRE_USER_CONFIRM | EventType.REQUIRE_EXTERNAL_EXECUTION;
        expectedEventType?: EventType.USER_CONFIRM_RESULT | EventType.EXTERNAL_EXECUTION_RESULT;
        awaitingToolCalls: ToolCallBlock[];
        preToolCalls: ToolCallBlock[];
    } {
        // 审批分组：连续需要确认的工具调用会一起挂起，返回给宿主一次性处理。
        const pendingToolCalls = this._getPendingToolCalls();

        // 在产出（可能存在的）用户确认或外部执行事件之前应当先执行的工具调用
        const preToolCalls: ToolCallBlock[] = [];
        for (const [index, toolCall] of pendingToolCalls.entries()) {
            if (
                this.toolkit.requireUserConfirm(toolCall.name) &&
                !this.confirmedToolCallIds.includes(toolCall.id)
            ) {
                toolCall.state = 'asking';
                // 查找连续的需要用户确认的工具调用
                let i = index + 1;
                for (; i < pendingToolCalls.length; i++) {
                    const nextToolCall = pendingToolCalls[i];
                    if (
                        !this.toolkit.requireUserConfirm(nextToolCall.name) ||
                        this.confirmedToolCallIds.includes(nextToolCall.id)
                    )
                        break;
                    nextToolCall.state = 'asking';
                }
                return {
                    awaitingType: EventType.REQUIRE_USER_CONFIRM,
                    expectedEventType: EventType.USER_CONFIRM_RESULT,
                    awaitingToolCalls: pendingToolCalls.slice(index, i),
                    preToolCalls,
                };
            }

            if (this.toolkit.requireExternalExecution(toolCall.name)) {
                // 查找连续的需要外部执行的工具调用
                let i = index + 1;
                for (; i < pendingToolCalls.length; i++) {
                    const nextToolCall = pendingToolCalls[i];
                    if (!this.toolkit.requireExternalExecution(nextToolCall.name)) break;
                }
                return {
                    awaitingType: EventType.REQUIRE_EXTERNAL_EXECUTION,
                    expectedEventType: EventType.EXTERNAL_EXECUTION_RESULT,
                    awaitingToolCalls: pendingToolCalls.slice(index, i),
                    preToolCalls,
                };
            }

            preToolCalls.push(toolCall);
        }
        return { awaitingToolCalls: [], preToolCalls };
    }

    /**
     * 不含中间件的核心回复逻辑。观察传入消息，执行
     * 推理/行动迭代直到 `maxIters`，并返回最终响应。
     *
     * @param options - 包含传入消息的 reply 选项。
     * @returns 一个异步生成器，产出 agent 事件，并最终解析为最终回复消息。
     */
    protected async *_reply(options?: ReplyOptions): AsyncGenerator<AgentEvent, Msg> {
        const { expectedEventType } = this._getAwaitingToolCalls();
        if (expectedEventType) {
            // 检查
            if (!options || !options.event || options.event.type !== expectedEventType) {
                throw new Error(
                    `Agent is awaiting for '${expectedEventType}' confirmation, but received event of type '${options?.event?.type ?? 'none'}'.`
                );
            }

            // 处理外部执行结果事件
            const event = options.event;
            if (event.type === EventType.EXTERNAL_EXECUTION_RESULT) {
                // 将工具结果记录到上下文，然后继续行动阶段
                this._saveToContext(event.execution_results);
            } else if (event.type === EventType.USER_CONFIRM_RESULT) {
                for (const result of event.confirm_results) {
                    if (result.confirmed) {
                        this.confirmedToolCallIds.push(result.tool_call.id);
                    } else {
                        // 如果用户拒绝，添加一个拒绝结果并处理待处理的工具调用
                        const rejectionRes = `<system-info>**Note** the user rejected the execution of tool "${result.tool_call.name}"!</system-info>`;
                        yield {
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                            type: EventType.TOOL_RESULT_START,
                            reply_id: this.replyId,
                            tool_call_id: result.tool_call.id,
                        } as ToolResultStartEvent;
                        yield {
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                            type: EventType.TOOL_RESULT_TEXT_DELTA,
                            reply_id: this.replyId,
                            tool_call_id: result.tool_call.id,
                            delta: rejectionRes,
                        } as ToolResultTextDeltaEvent;
                        yield {
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                            type: EventType.TOOL_RESULT_END,
                            reply_id: this.replyId,
                            tool_call_id: result.tool_call.id,
                            state: 'interrupted',
                        } as ToolResultEndEvent;
                        this._saveToContext([
                            {
                                type: 'tool_result',
                                id: result.tool_call.id,
                                name: result.tool_call.name,
                                output: [
                                    {
                                        id: crypto.randomUUID(),
                                        type: 'text',
                                        text: `<system-info>**Note** the user rejected the execution of tool "${result.tool_call.name}"!</system-info>`,
                                        created_at: new Date().toISOString(),
                                    },
                                ],
                                state: 'interrupted',
                                created_at: new Date().toISOString(),
                            },
                        ]);
                    }
                }
                // 根据确认结果更新工具调用状态
                const confirmedIds = new Set(
                    event.confirm_results.filter(r => r.confirmed).map(r => r.tool_call.id)
                );
                const deniedIds = new Set(
                    event.confirm_results.filter(r => !r.confirmed).map(r => r.tool_call.id)
                );
                this.context.at(-1)?.content.forEach(content => {
                    if (content.type === 'tool_call') {
                        if (confirmedIds.has(content.id)) {
                            content.state = 'allowed';
                        } else if (deniedIds.has(content.id)) {
                            content.state = 'finished';
                        }
                    }
                });
            }
        } else {
            // 正常回复流程在没有外部事件的情况下开始
            this.curIter = 0;
            this.replyId = crypto.randomUUID();
            this.confirmedToolCallIds = [];

            // 产出运行开始事件
            yield {
                id: crypto.randomUUID(),
                type: EventType.REPLY_START,
                created_at: new Date().toISOString(),
                session_id: '',
                reply_id: this.replyId,
                name: this.name,
                role: 'assistant',
            } as ReplyStartEvent;
        }

        // 将传入消息存储到记忆中
        if (Array.isArray(options?.msgs)) {
            // await this.memory.add(options.msg);
            this.context.push(...options.msgs);
        } else if (options?.msgs) {
            this.context.push(options.msgs);
        }

        // Harness 主循环：推理 → 执行工具 → 回写上下文，直到没有工具调用或触达 maxIters。
        // 当前没有 doom-loop guard（不检测重复的 tool + input），只靠轮次上限兜底。
        while (this.curIter < this.maxIters) {
            const pendingToolCalls = this._getPendingToolCalls();
            if (pendingToolCalls.length === 0) {
                await this.compressMemoryIfNeeded();
                const reasoningResponse = yield* this._reasoning({ toolChoice: 'auto' });
                this._saveToContext(reasoningResponse.content, reasoningResponse.usage);
            }

            // 提取等待中的工具调用，以及在产出 human-in-the-loop 事件之前应先执行的工具调用
            const { awaitingType, awaitingToolCalls, preToolCalls } = this._getAwaitingToolCalls();
            // 如果存在用户确认或外部执行事件，则先执行 pre-tool 调用，再产出该事件
            // 注意：这里是串行执行；本项目没有 parallel_tools / max_workers。
            for (const toolCall of preToolCalls) {
                const actingContent = yield* this._acting({ toolCall });
                this._saveToContext([actingContent]);
                // 执行后消费掉该确认
                this.confirmedToolCallIds = this.confirmedToolCallIds.filter(
                    id => id !== toolCall.id
                );
            }

            // 如果存在等待中的工具调用，产出用户确认或外部执行事件
            // Harness 审批：挂起并等待宿主确认/外部执行，下一次 reply 从断点恢复。
            if (awaitingType) {
                yield {
                    id: crypto.randomUUID(),
                    created_at: new Date().toISOString(),
                    type: awaitingType,
                    reply_id: this.replyId,
                    tool_calls: awaitingToolCalls,
                };

                return createMsg({
                    name: this.name,
                    content: [
                        {
                            id: crypto.randomUUID(),
                            type: 'text',
                            text:
                                awaitingType === EventType.REQUIRE_USER_CONFIRM
                                    ? 'Waiting for user confirmation ...'
                                    : 'Waiting for external execution ...',
                            created_at: new Date().toISOString(),
                        },
                    ],
                    role: 'assistant',
                });
            }

            // 如果推理消息中没有工具调用，则跳出循环
            if (preToolCalls.length === 0) break;

            this.curIter += 1;
        }

        // 如果超过最大迭代次数仍未产生文本输出
        if (this.context.at(-1)?.content.at(-1)?.type !== 'text') {
            // 生成最终回复
            const summaryResponse = yield* this._reasoning({ toolChoice: 'none' });
            this._saveToContext(summaryResponse.content, summaryResponse.usage);
        }

        // 产出运行结束事件
        yield {
            id: crypto.randomUUID(),
            type: EventType.REPLY_END,
            created_at: new Date().toISOString(),
            session_id: '',
            reply_id: this.replyId,
            finished_reason: ReplyFinishedReason.COMPLETED,
        } as ReplyEndEvent;

        return createMsg({
            id: this.replyId,
            name: this.name,
            // 最终输出消息的内容必须是字符串
            content: [this.context.at(-1)!.content.at(-1)!],
            role: 'assistant',
        });
    }

    /**
     * 不含中间件的核心推理逻辑。使用当前记忆与系统提示词
     * 调用模型，把响应转换为 agent 事件，并将结果消息
     * 保存到记忆中。
     *
     * @param options - 推理选项，包含工具选择策略。
     * @returns 一个异步生成器，产出 agent 事件，并最终解析为模型响应的内容块。
     */
    protected async *_reasoning(
        options: ReasoningOptions
    ): AsyncGenerator<AgentEvent, ChatResponse> {
        // 推理阶段：组装 system prompt + 压缩摘要 + 历史上下文 + 工具 schema，然后调用模型。
        const tools = this.toolkit.getJSONSchemas();
        yield {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            type: EventType.MODEL_CALL_START,
            reply_id: this.replyId,
            model_name: this.model.modelName,
        } as ModelCallStartEvent;
        const res = await this.model.call({
            messages: [
                createMsg({
                    name: 'system',
                    content: [
                        {
                            type: 'text',
                            text: this.sysPrompt,
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                        },
                    ],
                    role: 'system',
                }),
                ...(this.curSummary
                    ? [
                          createMsg({
                              name: 'user',
                              content: [
                                  {
                                      type: 'text',
                                      text: this.curSummary,
                                      id: crypto.randomUUID(),
                                      created_at: new Date().toISOString(),
                                  },
                              ],
                              role: 'user',
                          }),
                      ]
                    : []),
                ...this.context,
            ],
            tools,
            toolChoice: options.toolChoice,
        });

        let blockIds = {
            textBlockId: null,
            thinkingBlockId: null,
            toolCallIds: [],
        } as {
            textBlockId: string | null;
            thinkingBlockId: string | null;
            toolCallIds: string[];
        };
        let completedResponse: ChatResponse;
        if (this.model.stream) {
            // 处理流式响应
            while (true) {
                const { value, done } = await (
                    res as AsyncGenerator<ChatResponse, ChatResponse>
                ).next();
                if (done) {
                    // 当 `done` 为 true 时，完整响应通过 `value` 返回
                    completedResponse = value as ChatResponse;
                    break;
                }
                const chunk = value as ChatResponse;
                yield* this.convertChatResponseToEvent(blockIds, chunk);
            }
        } else {
            // 处理非流式响应，此时 res 是一个 ChatResponse 实例
            completedResponse = res as ChatResponse;
            yield* this.convertChatResponseToEvent(blockIds, res as ChatResponse);
        }

        // 为文本消息、思考消息和工具调用发送结束事件
        if (blockIds.textBlockId) {
            yield {
                id: crypto.randomUUID(),
                created_at: new Date().toISOString(),
                type: EventType.TEXT_BLOCK_END,
                reply_id: this.replyId,
                block_id: blockIds.textBlockId,
            } as TextBlockEndEvent;
        }
        if (blockIds.thinkingBlockId) {
            yield {
                id: crypto.randomUUID(),
                created_at: new Date().toISOString(),
                type: EventType.THINKING_BLOCK_END,
                reply_id: this.replyId,
                block_id: blockIds.thinkingBlockId,
            } as ThinkingBlockEndEvent;
        }
        if (blockIds.toolCallIds.length > 0) {
            for (const tool_call_id of blockIds.toolCallIds) {
                yield {
                    id: crypto.randomUUID(),
                    created_at: new Date().toISOString(),
                    type: EventType.TOOL_CALL_END,
                    reply_id: this.replyId,
                    tool_call_id,
                } as ToolCallEndEvent;
            }
        }

        yield {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            type: EventType.MODEL_CALL_END,
            reply_id: this.replyId,
            input_tokens: completedResponse.usage?.inputTokens || 0,
            output_tokens: completedResponse.usage?.outputTokens || 0,
        } as ModelCallEndEvent;

        return completedResponse;
    }

    /**
     * 不含中间件的核心行动逻辑。执行给定的工具调用，流式输出
     * 中间的工具结果事件，并把最终工具响应保存到记忆中。
     *
     * @param options - 行动选项，包含要执行的工具调用。
     * @returns 一个异步生成器，产出工具结果事件。
     */
    protected async *_acting(options: ActingOptions): AsyncGenerator<AgentEvent, ToolResultBlock> {
        // 行动阶段：执行单个工具，并把流式结果转成 TOOL_RESULT_* 事件。
        const res = this.toolkit.callToolFunction(options.toolCall);

        yield {
            type: EventType.TOOL_RESULT_START,
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            reply_id: this.replyId,
            tool_call_id: options.toolCall.id,
            tool_call_name: options.toolCall.name,
        } as ToolResultStartEvent;

        while (true) {
            const { value, done } = await res.next();
            if (done) {
                return {
                    type: 'tool_result',
                    id: options.toolCall.id,
                    name: options.toolCall.name,
                    output: value.content,
                    state: value.state,
                    created_at: new Date().toISOString(),
                } as ToolResultBlock;
            }
            yield* this.convertToolResponseToEvent(options.toolCall, value);
        }
    }

    /**
     * 接收外部观察消息，并将其保存到记忆中。
     *
     * @param options - 观察选项，包含要存储的消息。
     * @returns 一个 promise，在消息保存到记忆后解析。
     */
    protected async _observe(options: ObserveOptions): Promise<void> {
        // 如果尚未加载，则从存储中加载 agent 状态
        await this.loadState();

        if (Array.isArray(options.msg)) {
            // await this.memory.add(options.msg);
            this.context.push(...options.msg);
        } else if (options.msg) {
            this.context.push(options.msg);
        }
    }

    /**
     * 把一个 `ChatResponse` 分块转换为一系列带类型的 agent 事件。
     * 通过可变的 `responseId` 对象跨调用跟踪消息 ID，
     * 从而正确关联 start/content/end 事件。
     *
     * @param responseId - 用于跟踪当前文本、思考和工具调用消息 ID 的可变对象。
     * @param responseId.textMessageId - 进行中的文本消息 ID，若尚未开始则为 `null`。
     * @param responseId.thinkingMessageId - 进行中的思考消息 ID，若尚未开始则为 `null`。
     * @param responseId.textBlockId
     * @param responseId.thinkingBlockId
     * @param responseId.toolCallIds - 本次响应目前已见到的工具调用 ID 列表。
     * @param chunk - 要转换的聊天响应分块。
     * @returns 一个异步生成器，产出对应的 agent 事件。
     */
    protected async *convertChatResponseToEvent(
        responseId: {
            textBlockId: string | null;
            thinkingBlockId: string | null;
            toolCallIds: string[];
        },
        chunk: ChatResponse
    ): AsyncGenerator<AgentEvent> {
        for (const block of chunk.content) {
            switch (block.type) {
                case 'text':
                    if (responseId.textBlockId === null) {
                        // 生成一个新的 uuid
                        responseId.textBlockId = crypto.randomUUID();
                        yield {
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                            type: EventType.TEXT_BLOCK_START,
                            reply_id: this.replyId,
                            block_id: responseId.textBlockId,
                        } as TextBlockStartEvent;
                    }
                    yield {
                        id: crypto.randomUUID(),
                        created_at: new Date().toISOString(),
                        type: EventType.TEXT_BLOCK_DELTA,
                        reply_id: this.replyId,
                        block_id: responseId.textBlockId,
                        delta: block.text,
                    } as TextBlockDeltaEvent;
                    break;

                case 'thinking':
                    if (responseId.thinkingBlockId === null) {
                        responseId.thinkingBlockId = crypto.randomUUID();
                        yield {
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                            type: EventType.THINKING_BLOCK_START,
                            reply_id: this.replyId,
                            block_id: responseId.thinkingBlockId,
                        } as ThinkingBlockStartEvent;
                    }
                    yield {
                        id: crypto.randomUUID(),
                        created_at: new Date().toISOString(),
                        type: EventType.THINKING_BLOCK_DELTA,
                        reply_id: this.replyId,
                        block_id: responseId.thinkingBlockId,
                        delta: block.thinking,
                    } as ThinkingBlockDeltaEvent;
                    break;

                case 'tool_call':
                    if (!responseId.toolCallIds.includes(block.id)) {
                        responseId.toolCallIds.push(block.id);
                        yield {
                            id: crypto.randomUUID(),
                            type: EventType.TOOL_CALL_START,
                            created_at: new Date().toISOString(),
                            reply_id: this.replyId,
                            tool_call_id: block.id,
                            tool_call_name: block.name,
                        } as ToolCallStartEvent;
                    }
                    yield {
                        id: crypto.randomUUID(),
                        created_at: new Date().toISOString(),
                        type: EventType.TOOL_CALL_DELTA,
                        delta: block.input,
                        reply_id: this.replyId,
                        tool_call_id: block.id,
                    } as ToolCallDeltaEvent;
            }
        }
    }

    /**
     * 把一个 `ToolResponse` 转换为一系列带类型的 agent 事件，
     * 最后再产出一个 `TOOL_RESULT_END` 事件。
     *
     * @param toolCall - 触发该响应的原始工具调用块。
     * @param toolRes - 包含结果内容块的工具响应。
     * @returns 一个异步生成器，产出工具结果事件。
     */
    protected async *convertToolResponseToEvent(toolCall: ToolCallBlock, toolRes: ToolResponse) {
        for (const block of toolRes.content) {
            switch (block.type) {
                case 'text':
                    yield {
                        id: crypto.randomUUID(),
                        created_at: new Date().toISOString(),
                        type: EventType.TOOL_RESULT_TEXT_DELTA,
                        reply_id: this.replyId,
                        tool_call_id: toolCall.id,
                        delta: block.text,
                    } as ToolResultTextDeltaEvent;
                    break;

                case 'data':
                    if (block.source.type === 'base64') {
                        yield {
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                            type: EventType.TOOL_RESULT_DATA_DELTA,
                            reply_id: this.replyId,
                            tool_call_id: toolCall.id,
                            media_type: block.source.media_type,
                            data: block.source.data,
                        } as ToolResultDataDeltaEvent;
                    } else if (block.source.type === 'url') {
                        yield {
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                            type: EventType.TOOL_RESULT_DATA_DELTA,
                            reply_id: this.replyId,
                            tool_call_id: toolCall.id,
                            media_type: block.source.media_type,
                            url: block.source.url,
                        } as ToolResultDataDeltaEvent;
                    }
                    break;
            }
        }
        yield {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            type: EventType.TOOL_RESULT_END,
            reply_id: this.replyId,
            tool_call_id: toolCall.id,
            state: toolRes.state,
        } as ToolResultEndEvent;
    }

    /**
     * 把 agent 实例转换为可 JSON 序列化的对象。
     * @returns 一个包含 agent 名称和系统提示词的对象。
     */
    public async toJSON() {
        return {
            reply_id: this.replyId,
            confirmedToolCallIds: this.confirmedToolCallIds,
            curIter: this.curIter,
        };
    }

    /**
     * 根据压缩配置，把当前上下文切分为两部分：一部分需要压缩，另一部分应当保留。该方法根据压缩配置中的 `keepRecent` 设置计算需要保留多少最近的“单元”（块或工具调用对）不参与压缩，并确保切分时不会把工具调用与其对应结果分开。
     * @returns 一个对象，包含需要压缩的消息 `toCompressedContext`，以及应保持不压缩的最近消息 `reservedContext`。
     */
    protected _splitContextForCompression() {
        let toCompressedContext: Msg[] = [];
        let reservedContext: Msg[] = [];

        // 计算哪些消息需要被压缩
        // keepRecent 指定需要保持不压缩的最近“单元”数量
        // 一个单元要么是单个块（text/thinking），要么是一个 tool_call + tool_result 对
        const keepRecent = this.compressionConfig!.keepRecent ?? 0;

        const nBlocks = this.context.map(msg => msg.content.length).reduce((a, b) => a + b, 0);
        const toCompressedBlockNumber = nBlocks - keepRecent > 0 ? nBlocks - keepRecent : 0;

        let currentCompressedBlocks = 0;
        for (const [index, msg] of this.context.entries()) {
            if (currentCompressedBlocks + msg.content.length <= toCompressedBlockNumber) {
                toCompressedContext.push(msg);
                currentCompressedBlocks += msg.content.length;
            } else {
                // 根据 keepRecent 数量应当保留的块
                const reservedBlocks = msg.content.slice(
                    toCompressedBlockNumber - currentCompressedBlocks
                );
                // 检查保留的块中是否存在未配对的 tool_call 或 tool_result
                const unPairedToolResultIds = new Set<string>();
                for (const block of reservedBlocks) {
                    if (block.type == 'tool_call') {
                        unPairedToolResultIds.add(block.id);
                    } else if (block.type == 'tool_result') {
                        if (unPairedToolResultIds.has(block.id)) {
                            unPairedToolResultIds.delete(block.id);
                        }
                    }
                }
                // 如果存在未配对的工具调用，则需要把它们移到保留的块中
                let i = toCompressedBlockNumber - currentCompressedBlocks - 1;
                for (; i >= 0; i--) {
                    const block = msg.content[i];
                    if (block.type === 'tool_call' && unPairedToolResultIds.has(block.id)) {
                        unPairedToolResultIds.delete(block.id);
                    }
                    if (unPairedToolResultIds.size === 0) break;
                }
                // 如果 i 满足该条件，则该消息中的所有内容都应保留
                if (i <= 0) {
                    reservedContext.push(msg);
                    break;
                }

                // 切分消息内容，并把需要压缩的部分推入压缩上下文
                const lastMsg = { ...msg };
                lastMsg.content = msg.content.slice(0, i);
                toCompressedContext.push(lastMsg);

                const reservedMsg = { ...msg };
                reservedMsg.content = msg.content.slice(i);
                reservedContext.push(reservedMsg);

                // 其余消息都应保留
                reservedContext.push(...this.context.slice(index + 1));
                break;
            }
        }
        return { toCompressedContext, reservedContext };
    }

    /**
     * 使用指定的压缩模型（若提供）或原始模型来压缩 agent 的记忆。
     */
    protected async compressMemoryIfNeeded() {
        // 工具调用与结果对必须一起保留或一起移除
        // Harness 上下文压缩：超过 token 阈值后生成结构化摘要，并保留最近 N 块。
        // 切分时保证 tool_call 与 tool_result 成对保留，避免上下文断裂。
        if (!this.compressionConfig || !this.compressionConfig.enabled) return;

        const { toCompressedContext, reservedContext } = this._splitContextForCompression();

        // 压缩 toCompressedContext
        if (
            toCompressedContext.length <= 0 ||
            (toCompressedContext.length === 1 && toCompressedContext.at(0)?.content.length === 1)
        )
            return;

        // 计算上下文是否超过阈值
        const messages = [
            createMsg({
                name: 'system',
                content: [
                    {
                        type: 'text',
                        text: this.sysPrompt,
                        id: crypto.randomUUID(),
                        created_at: new Date().toISOString(),
                    },
                ],
                role: 'system',
            }),
            ...toCompressedContext,
            // 用于把上下文压缩成摘要的指令
            createMsg({
                name: 'user',
                content: [
                    {
                        id: crypto.randomUUID(),
                        type: 'text',
                        text:
                            this.compressionConfig.compressionPrompt || DEFAULT_COMPRESSION_PROMPT,
                        created_at: new Date().toISOString(),
                    },
                ],
                role: 'user',
            }),
        ];

        const nTokens = await this.model.countTokens({
            messages,
            tools: this.toolkit.getJSONSchemas(),
        });
        console.debug(`[AGENT ${this.name}] Current context token count: ${nTokens}.`);
        if (nTokens <= this.compressionConfig.triggerThreshold) return;

        console.log(
            `[AGENT ${this.name}] Compressing memory with ${toCompressedContext.length} messages.`
        );
        // 生成结构化的摘要内容
        const res = await this.model.callStructured({
            messages: [
                createMsg({
                    name: 'system',
                    content: [
                        {
                            type: 'text',
                            text: this.sysPrompt,
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                        },
                    ],
                    role: 'system',
                }),
                ...toCompressedContext,
                // 用于把上下文压缩成摘要的指令
                createMsg({
                    name: 'user',
                    content: [
                        {
                            id: crypto.randomUUID(),
                            type: 'text',
                            text:
                                this.compressionConfig.compressionPrompt ||
                                DEFAULT_COMPRESSION_PROMPT,
                            created_at: new Date().toISOString(),
                        },
                    ],
                    role: 'user',
                }),
            ],
            schema: this.compressionConfig.summarySchema || DEFAULT_SUMMARY_SCHEMA,
        });

        // 构造压缩摘要
        let summaryText = '<system-reminder>Here is a summary of your previous work\n';
        for (const [key, value] of Object.entries(res.content)) {
            summaryText += `# ${key}\n${value}\n`;
        }
        summaryText += '</system-reminder>';

        console.debug(`[AGENT ${this.name}] Compression summary: ${summaryText}`);

        // 使用压缩摘要和保留的最近块更新上下文
        this.context = reservedContext;
        this.curSummary = summaryText;
    }
}
