import {
    EventType,
    type AgentEvent,
    UserConfirmResultEvent,
} from '@agentscope-ai/agentscope/event';
import { ContentBlock, createMsg, Msg, ToolCallBlock } from '@agentscope-ai/agentscope/message';
import { useState, useEffect, useRef, startTransition } from 'react';

import { applyAgentEvent } from './agent-event-handler';

/**
 * 用于管理会话内聊天消息的自定义 hook。
 *
 * @param sessionId - 当前聊天会话的 ID。
 * @returns 包含消息、发送状态和消息发送函数的对象。
 */
export function useMessages(sessionId: string | null) {
    const [messages, setMessages] = useState<Msg[]>([]);
    const [sending, setSending] = useState(false);
    const prevSessionIdRef = useRef<string | null>(null);

    // 切换会话时加载历史消息并检查运行状态
    useEffect(() => {
        if (!sessionId) {
            startTransition(() => {
                setMessages([]);
                setSending(false);
            });
            prevSessionIdRef.current = null;
            return;
        }

        // 仅在一个会话切换到另一个会话时清空消息。
        // 若从 null 切换到某个值（创建新会话），则不清空消息，以保留乐观更新。
        if (prevSessionIdRef.current !== null && prevSessionIdRef.current !== sessionId) {
            startTransition(() => {
                setMessages([]);
            });
        }
        prevSessionIdRef.current = sessionId;

        Promise.all([
            window.api.chat.getMessages(sessionId),
            window.api.chat.isRunning(sessionId),
        ]).then(([msgs, running]) => {
            startTransition(() => {
                setMessages(prev => {
                    // 乐观更新
                    const msgIds = new Set(msgs.map(m => m.id));
                    const localMsgs = prev.filter(m => !msgIds.has(m.id));
                    return [...msgs, ...localMsgs];
                });
                setSending(running);
            });
        });
    }, [sessionId]);

    // 按 sessionId 订阅 agent 流式事件，切换会话时自动取消订阅
    useEffect(() => {
        if (!sessionId) return;
        return window.api.agent.subscribe(sessionId, (event: AgentEvent) => {
            applyAgentEvent(event, setMessages, setSending);
        });
    }, [sessionId]);

    const sendMessage = async (content: ContentBlock[], sessionId: string, agentKey: string) => {
        if (content.length === 0) return;
        setSending(true);
        const message = createMsg({
            id: crypto.randomUUID(),
            role: 'user',
            name: 'user',
            content,
        });
        // 用户消息的乐观更新
        setMessages(prev => [...prev, message]);
        await window.api.chat.sendMessage(sessionId, agentKey, message);
    };

    // 审批回传：把用户选择包装成 USER_CONFIRM_RESULT，恢复挂起的 Agent。
    const sendUserConfirm = async (
        toolCall: ToolCallBlock,
        confirm: boolean,
        replyId: string,
        sessionId: string,
        agentKey: string
    ) => {
        await window.api.chat.sendMessage(sessionId, agentKey, undefined, {
            type: EventType.USER_CONFIRM_RESULT,
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            reply_id: replyId,
            confirm_results: [
                {
                    confirmed: confirm,
                    tool_call: toolCall,
                },
            ],
        } as UserConfirmResultEvent);
    };

    return { messages, sending, sendMessage, sendUserConfirm };
}
