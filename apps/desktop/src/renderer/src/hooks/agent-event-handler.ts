import { EventType, type AgentEvent } from '@agentscope-ai/agentscope/event';
import { createMsg, appendEvent, Msg } from '@agentscope-ai/agentscope/message';
import type { Dispatch, SetStateAction } from 'react';

/**
 * 应用一个 agent 事件以更新消息和发送状态。
 * @param event
 * @param setMessages
 * @param setSending
 */
// 事件驱动 UI：把类型化事件重放到消息列表，与模型上下文保持同一份记录。
export function applyAgentEvent(
    event: AgentEvent,
    setMessages: Dispatch<SetStateAction<Msg[]>>,
    setSending: Dispatch<SetStateAction<boolean>>
) {
    switch (event.type) {
        case EventType.REPLY_START: {
            setSending(true);
            setMessages(prev => {
                const existingMsg = prev.find(m => m.id === event.reply_id);
                if (existingMsg) {
                    // 已存在，标记为未完成
                    return prev.map(m =>
                        m.id === event.reply_id ? { ...m, finished_at: null } : m
                    );
                }
                const newMsg = createMsg({
                    id: event.reply_id,
                    role: event.role,
                    name: event.name,
                    content: [],
                });
                return [...prev, newMsg];
            });
            break;
        }

        case EventType.REPLY_END: {
            setSending(false);
            setMessages(prev => {
                return prev.map(m => {
                    if (m.id !== event.reply_id) return m;
                    const cloned: Msg = { ...m, content: m.content.map(b => ({ ...b })) };
                    appendEvent(cloned, event);
                    return cloned;
                });
            });
            break;
        }

        case EventType.MODEL_CALL_START:
            break;

        case EventType.MODEL_CALL_END: {
            setMessages(prev =>
                prev.map(m => {
                    if (m.id !== event.reply_id) return m;
                    const cloned: Msg = { ...m, content: m.content.map(b => ({ ...b })) };
                    appendEvent(cloned, event);
                    return cloned;
                })
            );
            break;
        }

        default: {
            if (!('reply_id' in event)) break;
            setMessages(prev => {
                return prev.map(m => {
                    if (m.id !== event.reply_id) return m;
                    // 深拷贝内容块以避免变更副作用
                    // （React Strict Mode 会调用更新函数两次以检测非纯函数）
                    // tool_result 块的 output 数组也需要深拷贝
                    const cloned: Msg = {
                        ...m,
                        content: m.content.map(b => {
                            if (b.type === 'tool_result') {
                                return {
                                    ...b,
                                    output:
                                        typeof b.output === 'string'
                                            ? b.output
                                            : b.output.map(o => ({ ...o })),
                                };
                            }
                            return { ...b };
                        }),
                    };
                    appendEvent(cloned, event);
                    return cloned;
                });
            });
        }
    }
}
