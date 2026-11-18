import type { JSONSerializableObject } from '../type';
import {
    ContentBlock,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolCallBlock,
    DataBlock,
    HintBlock,
    Base64Source,
    URLSource,
    ContentBlockType,
} from './block';
import { _generateId, _generateTimestamp, base64ToBytes, bytesToBase64 } from '../_utils/common';
import { EventType, ReplyFinishedReason } from '../event';
import type { AgentEvent, ErrorInfo } from '../event';

/** 在 Agent 之间或 Agent 与模型之间交换的聊天消息。 */
export interface Msg {
    /** 消息的唯一标识符。 */
    id: string;
    /** 消息发送者的显示名称。 */
    name: string;
    /** 发送者的对话角色。 */
    role: 'user' | 'assistant' | 'system';
    /** 消息正文。 */
    content: ContentBlock[];
    /** 附加到消息上的任意键值元数据。 */
    metadata: Record<string, JSONSerializableObject>;
    /** ISO-8601 创建时间戳。 */
    created_at: string;
    /** ISO-8601 结束时间戳。 */
    finished_at: string | null;
    /**
     * 本次回复的终止原因（error / interrupted / exceed_max_iters）。
     * 在应用 REPLY_END 事件之前为 undefined/null。
     */
    finished_reason: ReplyFinishedReason | null;
    /** 请求并成功生成时的结构化响应负载。 */
    structured_output: Record<string, JSONSerializableObject> | null;
    /**
     * 结构化错误信息，仅在
     * `finished_reason === ReplyFinishedReason.ERROR` 时填充。
     */
    error: ErrorInfo | null;
    /** 消息的用量信息，例如 token 计数。 */
    usage: Usage | null;
}

/** 存储在消息上的 token 用量。 */
export interface Usage {
    input_tokens: number;
    output_tokens: number;
    cache_input_tokens: number;
    cache_creation_input_tokens: number;
}

type UsageInput = Pick<Usage, 'input_tokens' | 'output_tokens'> & Partial<Usage>;

/**
 * 规范化 usage 输入中可选的缓存 token 计数。
 * @param usage
 * @returns 规范化后的 usage；若缺失则返回 `null`。
 */
function normalizeUsage(usage: UsageInput | null | undefined): Usage | null {
    if (usage == null) return null;
    return {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_input_tokens: usage.cache_input_tokens ?? 0,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    };
}

/**
 * 创建新的 {@link Msg} 对象，在省略时自动填充 `id` 和 `created_at`。
 * 纯字符串 `content` 会自动包装为单个 {@link TextBlock}。
 * @param root0
 * @param root0.name
 * @param root0.content
 * @param root0.role
 * @param root0.metadata
 * @param root0.id
 * @param root0.created_at
 * @param root0.finished_at
 * @param root0.usage
 * @returns 一个 Msg 对象。
 */
/**
 * 校验内容块是否允许用于给定角色。
 *
 * 与 Python 的 `_assert_user_content_blocks` / `_assert_system_content_blocks`
 * 守卫一致：用户消息只能包含文本或数据块；系统消息
 * 只能包含文本块；助手消息接受任意块类型。
 * @param role
 * @param content
 */
function assertContentBlocksForRole(role: Msg['role'], content: ContentBlock[]): void {
    if (role === 'user') {
        for (const block of content) {
            if (block.type !== 'text' && block.type !== 'data') {
                throw new Error('User message can only contain text blocks or data blocks.');
            }
        }
    } else if (role === 'system') {
        for (const block of content) {
            if (block.type !== 'text') {
                throw new Error('System message can only contain text blocks.');
            }
        }
    }
}

/**
 * createMsg 是用于构造 Msg 对象的底层工具，负责填充合理默认值并执行校验。
 * @param root0
 * @param root0.name
 * @param root0.content
 * @param root0.role
 * @param root0.metadata
 * @param root0.id
 * @param root0.created_at
 * @param root0.finished_at
 * @param root0.usage
 * @param root0.finished_reason
 * @param root0.structured_output
 * @param root0.error
 * @returns 具有指定属性的 Msg 对象，省略的字段使用默认值。
 */
export function createMsg({
    name,
    content,
    role,
    metadata = {},
    id = _generateId(),
    created_at = _generateTimestamp(),
    finished_at = null,
    finished_reason = null,
    structured_output = null,
    error = null,
    usage,
}: {
    name: string;
    content: string | ContentBlock[];
    role: Msg['role'];
    metadata?: Msg['metadata'];
    id?: string;
    created_at?: string;
    usage?: UsageInput | null;
    finished_at?: string | null;
    finished_reason?: ReplyFinishedReason | null;
    structured_output?: Msg['structured_output'];
    error?: ErrorInfo | null;
}): Msg {
    const contentBlocks: ContentBlock[] =
        typeof content === 'string' ? [TextBlock({ text: content })] : content;
    assertContentBlocksForRole(role, contentBlocks);
    return {
        id,
        name,
        role,
        content: contentBlocks,
        metadata,
        created_at,
        usage: normalizeUsage(usage),
        finished_at,
        finished_reason,
        structured_output,
        error,
    };
}

/**
 * 创建用户 {@link Msg}。
 * @param root0
 * @param root0.name
 * @param root0.content
 * @param root0.metadata
 * @param root0.id
 * @param root0.created_at
 * @param root0.finished_at
 * @param root0.finished_reason
 * @returns 角色为 'user' 的 Msg 对象。
 */
export function UserMsg({
    name,
    content,
    metadata,
    id,
    created_at,
    finished_at,
    finished_reason,
}: {
    name: string;
    content: string | ContentBlock[];
    metadata?: Record<string, JSONSerializableObject> | null;
    id?: string | null;
    created_at?: string | null;
    finished_at?: string | null;
    finished_reason?: ReplyFinishedReason | null;
}): Msg {
    const actualCreatedAt = created_at || _generateTimestamp();
    return createMsg({
        name,
        content,
        role: 'user',
        metadata: metadata ?? {},
        id: id || _generateId(),
        created_at: actualCreatedAt,
        finished_at: finished_at ?? actualCreatedAt,
        finished_reason,
    });
}

/**
 * 创建助手 {@link Msg}。
 * @param root0
 * @param root0.name
 * @param root0.content
 * @param root0.metadata
 * @param root0.id
 * @param root0.created_at
 * @param root0.usage
 * @param root0.finished_at
 * @param root0.finished_reason
 * @param root0.structured_output
 * @returns 角色为 'assistant' 的 Msg 对象。
 */
export function AssistantMsg({
    name,
    content,
    metadata,
    id,
    created_at,
    usage,
    finished_at,
    finished_reason,
    structured_output,
}: {
    name: string;
    content: string | ContentBlock[];
    metadata?: Record<string, JSONSerializableObject> | null;
    id?: string | null;
    created_at?: string | null;
    usage?: UsageInput | null;
    finished_at?: string | null;
    finished_reason?: ReplyFinishedReason | null;
    structured_output?: Msg['structured_output'];
}): Msg {
    return createMsg({
        name,
        content,
        role: 'assistant',
        metadata: metadata ?? {},
        id: id || _generateId(),
        created_at: created_at || _generateTimestamp(),
        usage,
        finished_at,
        finished_reason,
        structured_output,
    });
}

/**
 * 创建系统 {@link Msg}。
 * @param root0
 * @param root0.name
 * @param root0.content
 * @param root0.metadata
 * @param root0.id
 * @param root0.created_at
 * @param root0.finished_at
 * @param root0.finished_reason
 * @returns 角色为 'system' 的 Msg 对象。
 */
export function SystemMsg({
    name,
    content,
    metadata,
    id,
    created_at,
    finished_at,
    finished_reason,
}: {
    name: string;
    content: string | ContentBlock[];
    metadata?: Record<string, JSONSerializableObject> | null;
    id?: string | null;
    created_at?: string | null;
    finished_at?: string | null;
    finished_reason?: ReplyFinishedReason | null;
}): Msg {
    const actualCreatedAt = created_at || _generateTimestamp();
    return createMsg({
        name,
        content,
        role: 'system',
        metadata: metadata ?? {},
        id: id || _generateId(),
        created_at: actualCreatedAt,
        finished_at: finished_at ?? actualCreatedAt,
        finished_reason,
    });
}

/**
 * 从消息中提取纯文本内容。
 *
 * 当 `content` 为字符串时原样返回。当其为内容块数组时，
 * 所有 {@link TextBlock} 的文本会用 `separator` 连接。
 *
 * @param msg - 要读取的消息。
 * @param separator - 插入相邻文本块之间的字符串。默认为 `'\n'`。
 * @returns 拼接后的文本；若不存在文本块则返回 `null`。
 */
export function getTextContent(msg: Msg, separator: string = '\n'): string | null {
    const textBlocks = msg.content.filter(block => block.type === 'text');
    if (textBlocks.length === 0) return null;
    return textBlocks.map(block => (block as TextBlock).text).join(separator);
}

/**
 * 检查消息是否包含所请求类型的内容块。
 * @param msg
 * @param blockType
 * @returns 是否存在匹配的块。
 */
export function hasContentBlocks(
    msg: Msg,
    blockType?: ContentBlockType | ContentBlockType[] | null
): boolean {
    if (blockType == null) return msg.content.length > 0;
    const blockTypes = Array.isArray(blockType) ? blockType : [blockType];
    return msg.content.some(block => blockTypes.includes(block.type));
}

/**
 * 返回消息中的所有内容块，不区分类型。
 *
 * 当 `content` 为纯字符串时会被包装为单个 {@link TextBlock}。
 *
 * @param msg - 要读取的消息。
 * @returns 包含所有 {@link ContentBlock} 对象的数组。
 */
export function getContentBlocks(msg: Msg): ContentBlock[];
export function getContentBlocks(msg: Msg, blockType: 'text'): TextBlock[];
export function getContentBlocks(msg: Msg, blockType: 'thinking'): ThinkingBlock[];
export function getContentBlocks(msg: Msg, blockType: 'hint'): HintBlock[];
export function getContentBlocks(msg: Msg, blockType: 'data'): DataBlock[];
export function getContentBlocks(msg: Msg, blockType: 'tool_call'): ToolCallBlock[];
export function getContentBlocks(msg: Msg, blockType: 'tool_result'): ToolResultBlock[];
export function getContentBlocks(msg: Msg, blockType: ContentBlockType[]): ContentBlock[];
export function getContentBlocks(
    msg: Msg,
    blockType?: ContentBlockType | ContentBlockType[] | null
): ContentBlock[] {
    if (blockType == null) return msg.content;
    const blockTypes = Array.isArray(blockType) ? blockType : [blockType];
    return msg.content.filter(block => blockTypes.includes(block.type));
}

/**
 * 在消息中按类型和 id 查找内容块。
 * @param msg
 * @param blockType
 * @param blockId
 * @returns 匹配的 {@link ContentBlock}；若未找到则返回 `undefined`。
 */
function findBlock(msg: Msg, blockType: string, blockId: string): ContentBlock | undefined {
    return msg.content.find(block => block.type === blockType && block.id === blockId);
}

/**
 * 把流式 {@link AgentEvent} 应用到 {@link Msg}，并就地修改它。
 *
 * 只会修改 `content` 和 `finished_at`。`reply_id` 与
 * `msg.id` 不匹配的事件会被跳过并给出警告。
 * @param msg
 * @param event
 * @returns 修改后的 {@link Msg} 对象。
 */
export function appendEvent(msg: Msg, event: AgentEvent): Msg {
    if (!('reply_id' in event)) return msg;
    if (event.reply_id !== msg.id) {
        console.warn(
            `Event reply_id "${event.reply_id}" does not match message id "${msg.id}", skipping.`
        );
        return msg;
    }

    switch (event.type) {
        case EventType.REPLY_END:
            msg.finished_at = event.created_at;
            msg.finished_reason = event.finished_reason;
            msg.error = event.error ?? null;
            break;

        case EventType.TEXT_BLOCK_START:
            msg.content.push(TextBlock({ id: event.block_id, text: '' }));
            break;

        case EventType.TEXT_BLOCK_DELTA: {
            const block = findBlock(msg, 'text', event.block_id);
            if (!block) {
                console.warn(`TextBlock "${event.block_id}" not found, skipping.`);
            } else {
                (block as TextBlock).text += event.delta;
            }
            break;
        }

        case EventType.TEXT_BLOCK_END: {
            const block = findBlock(msg, 'text', event.block_id);
            if (!block) {
                console.warn(`TextBlock "${event.block_id}" not found, skipping.`);
            } else {
                (block as TextBlock).finished_at = event.created_at;
            }
            break;
        }

        case EventType.THINKING_BLOCK_START:
            msg.content.push(ThinkingBlock({ id: event.block_id, thinking: '' }));
            break;

        case EventType.THINKING_BLOCK_DELTA: {
            const block = findBlock(msg, 'thinking', event.block_id);
            if (!block) {
                console.warn(`ThinkingBlock "${event.block_id}" not found, skipping.`);
            } else {
                (block as ThinkingBlock).thinking += event.delta;
            }
            break;
        }

        case EventType.THINKING_BLOCK_END: {
            const block = findBlock(msg, 'thinking', event.block_id);
            if (!block) {
                console.warn(`ThinkingBlock "${event.block_id}" not found, skipping.`);
            } else {
                (block as ThinkingBlock).finished_at = event.created_at;
            }
            break;
        }

        case EventType.HINT_BLOCK: {
            // 提示块不是流式的——完整内容在单个事件中到达，
            // 并作为完整的 HintBlock 追加。
            const hintBlock = HintBlock({
                id: event.block_id,
                hint: event.hint,
                source: event.source ?? null,
            });
            hintBlock.finished_at = hintBlock.created_at;
            msg.content.push(hintBlock);
            break;
        }

        case EventType.DATA_BLOCK_START:
            msg.content.push(
                DataBlock({
                    id: event.block_id,
                    source: Base64Source({ data: '', media_type: event.media_type }),
                })
            );
            break;

        case EventType.DATA_BLOCK_DELTA: {
            const block = findBlock(msg, 'data', event.block_id);
            if (!block) {
                console.warn(`DataBlock "${event.block_id}" not found, skipping.`);
            } else if (event.data) {
                // 每个 delta 都是独立 base64 编码的分片（各自带有
                // 填充）；直接做字符串拼接会把 '=' 注入到字节流的
                // 中间并破坏数据。因此先解码、
                // 拼接字节，再重新编码。
                const src = (block as DataBlock).source as Base64Source;
                const existing = src.data ? base64ToBytes(src.data) : new Uint8Array(0);
                const incoming = base64ToBytes(event.data);
                const merged = new Uint8Array(existing.length + incoming.length);
                merged.set(existing, 0);
                merged.set(incoming, existing.length);
                src.data = bytesToBase64(merged);
            }
            break;
        }

        case EventType.DATA_BLOCK_END: {
            const block = findBlock(msg, 'data', event.block_id);
            if (!block) {
                console.warn(`DataBlock "${event.block_id}" not found, skipping.`);
            } else {
                (block as DataBlock).finished_at = event.created_at;
            }
            break;
        }

        case EventType.TOOL_CALL_START:
            msg.content.push(
                ToolCallBlock({
                    id: event.tool_call_id,
                    name: event.tool_call_name,
                    input: '',
                })
            );
            break;

        case EventType.TOOL_CALL_DELTA: {
            const block = findBlock(msg, 'tool_call', event.tool_call_id);
            if (!block) {
                console.warn(`ToolCallBlock "${event.tool_call_id}" not found, skipping.`);
            } else {
                (block as ToolCallBlock).input += event.delta;
            }
            break;
        }

        case EventType.TOOL_CALL_END: {
            const block = findBlock(msg, 'tool_call', event.tool_call_id);
            if (!block) {
                console.warn(`ToolCallBlock "${event.tool_call_id}" not found, skipping.`);
            } else {
                (block as ToolCallBlock).finished_at = event.created_at;
            }
            break;
        }

        case EventType.TOOL_RESULT_START:
            msg.content.push(
                ToolResultBlock({
                    id: event.tool_call_id,
                    name: event.tool_call_name,
                    output: [],
                })
            );
            break;

        case EventType.TOOL_RESULT_TEXT_DELTA: {
            const block = findBlock(msg, 'tool_result', event.tool_call_id);
            if (!block) {
                console.warn(`ToolResultBlock "${event.tool_call_id}" not found, skipping.`);
            } else {
                const trb = block as ToolResultBlock;
                if (typeof trb.output === 'string') {
                    trb.output = [TextBlock({ text: trb.output })];
                }
                const last = trb.output[trb.output.length - 1];
                if (!last || last.type !== 'text') {
                    trb.output.push(TextBlock({ text: event.delta }));
                } else {
                    (last as TextBlock).text += event.delta;
                }
            }
            break;
        }

        case EventType.TOOL_RESULT_DATA_DELTA: {
            const block = findBlock(msg, 'tool_result', event.tool_call_id);
            if (!block) {
                console.warn(`ToolResultBlock "${event.tool_call_id}" not found, skipping.`);
            } else {
                const trb = block as ToolResultBlock;
                if (typeof trb.output === 'string') {
                    trb.output = [TextBlock({ text: trb.output })];
                }
                const source: Base64Source | URLSource =
                    event.data != null
                        ? Base64Source({ data: event.data, media_type: event.media_type })
                        : URLSource({ url: event.url!, media_type: event.media_type });
                trb.output.push(DataBlock({ id: event.block_id ?? _generateId(), source }));
            }
            break;
        }

        case EventType.TOOL_RESULT_END: {
            const block = findBlock(msg, 'tool_result', event.tool_call_id);
            if (!block) {
                console.warn(`ToolResultBlock "${event.tool_call_id}" not found, skipping.`);
            } else {
                (block as ToolResultBlock).state = event.state;
                (block as ToolResultBlock).metadata = event.metadata ?? {};
                (block as ToolResultBlock).finished_at = event.created_at;
            }
            // 配对的 ToolCallBlock 生命周期随其结果结束
            // ——把它置为 'finished'
            const callBlock = findBlock(msg, 'tool_call', event.tool_call_id);
            if (callBlock) {
                (callBlock as ToolCallBlock).state = 'finished';
            }
            break;
        }

        case EventType.MODEL_CALL_END:
            // 在此累加输入和输出 token。
            if (msg.usage) {
                msg.usage.input_tokens += event.input_tokens;
                msg.usage.output_tokens += event.output_tokens;
                msg.usage.cache_input_tokens += event.cache_input_tokens ?? 0;
                msg.usage.cache_creation_input_tokens += event.cache_creation_input_tokens ?? 0;
            } else {
                msg.usage = {
                    input_tokens: event.input_tokens,
                    output_tokens: event.output_tokens,
                    cache_input_tokens: event.cache_input_tokens ?? 0,
                    cache_creation_input_tokens: event.cache_creation_input_tokens ?? 0,
                };
            }
            break;

        case EventType.REQUIRE_USER_CONFIRM:
            for (const tc of event.tool_calls) {
                const b = findBlock(msg, 'tool_call', tc.id);
                if (b) {
                    (b as ToolCallBlock).state = 'asking';
                    (b as ToolCallBlock).suggested_rules = tc.suggested_rules || [];
                }
            }
            break;

        case EventType.USER_CONFIRM_RESULT:
            for (const result of event.confirm_results) {
                const b = findBlock(msg, 'tool_call', result.tool_call.id);
                // 只有处于 'asking' 的调用才能转换；跳过过期
                // 结果（例如在中断已将工具调用
                // 解析为 'finished' 之后才到达的结果）。
                if (b && (b as ToolCallBlock).state === 'asking') {
                    (b as ToolCallBlock).state = result.confirmed ? 'allowed' : 'finished';
                }
            }
            break;

        case EventType.REQUIRE_EXTERNAL_EXECUTION:
            for (const tc of event.tool_calls) {
                const b = findBlock(msg, 'tool_call', tc.id);
                if (b) (b as ToolCallBlock).state = 'submitted';
            }
            break;

        case EventType.EXTERNAL_EXECUTION_RESULT: {
            // 按已有 tool_result id 去重——跳过其 tool_call
            // 已存在持久化 tool_result 的结果（例如在中断
            // 已注入伪 tool_result 之后才迟到到达的结果）。
            // 与 Python 后端在
            // ``agentscope.message._base.Msg.append_event`` 中的守卫一致。
            const existingResultIds = new Set(
                msg.content
                    .filter(b => b.type === 'tool_result')
                    .map(b => (b as ToolResultBlock).id)
            );
            for (const result of event.execution_results) {
                if (existingResultIds.has(result.id)) continue;
                if (result.finished_at == null) {
                    result.finished_at = event.created_at;
                }
                msg.content.push(result);
            }
            break;
        }
    }

    return msg;
}
