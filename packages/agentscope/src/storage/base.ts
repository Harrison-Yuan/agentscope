import { Msg } from '../message';

/**
 * 完整的 Agent 状态，包含对话上下文和元数据。
 */
export interface AgentState {
    /**
     * 对话上下文（消息历史）。
     */
    context: Msg[];
    /**
     * Agent 元数据（replyId、curIter、curSummary 等）。
     */
    metadata: Record<string, unknown>;
}

/**
 * 基础存储类，负责：
 * - 加载/保存 Agent 上下文和状态，以及
 * - 按需把压缩后的上下文外置到外部存储以支持 agentic 检索
 */
export abstract class StorageBase {
    /**
     * 加载完整的 Agent 状态，包括上下文和元数据。
     * @param options.agentId - Agent 标识符
     * @returns 包含上下文和元数据的 Agent 状态
     */
    abstract loadAgentState(options?: { agentId?: string }): Promise<AgentState>;

    /**
     * 保存完整的 Agent 状态，包括上下文和元数据。
     * @param options.agentId - Agent 标识符
     * @param options.context - 要保存的对话上下文
     * @param options.metadata - 要保存的 Agent 元数据
     */
    abstract saveAgentState(options: {
        agentId?: string;
        context: Msg[];
        metadata: Record<string, unknown>;
    }): Promise<void>;

    /**
     * 按需把压缩后的上下文外置到外部存储以支持 agentic 检索。
     * @param _options.msgs
     * @param _options
     * @returns 外置上下文的标识符或 URL；若未实现外置或无需外置则返回 undefined
     */
    // 上下文外置接口：设计上用于把压缩内容放到外部存储，支持后续检索；当前 Agent 循环未调用。
    async offloadContext(_options: { msgs: Msg[] }): Promise<string | undefined> {
        console.log('Offloading context is not implemented for this storage. Skipping offloading.');
        return undefined;
    }
}
