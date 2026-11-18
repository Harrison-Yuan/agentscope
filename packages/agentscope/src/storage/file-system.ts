import fs from 'fs';
import path from 'path';

import * as mime from 'mime-types';

import { Msg } from '../message';
import { AgentState, StorageBase } from './base';

/**
 * 本地文件系统存储实现。
 * 把 Agent 状态存为 JSON 文件，并支持上下文增量更新。
 */
export class LocalFileStorage extends StorageBase {
    saveDir: string;
    offloadDir?: string;

    /**
     * 存储层字段的内部元数据键前缀。
     * 带此前缀的字段由存储层管理，返回给 Agent 层时会被过滤掉。
     */
    private readonly INTERNAL_PREFIX = '_storage_';

    /**
     * 初始化 LocalFileStorage 实例。
     * @param root0
     * @param root0.pathSegments - 用于确定保存 Agent 状态目录的路径片段（例如 ['rootDir', '{sessionId}']）
     * @param root0.offloadPathSegments - 可选，用于外置压缩上下文以支持 agentic 检索的路径片段（例如 ['rootDir', 'offload']）
     */
    constructor({
        pathSegments = [],
        offloadPathSegments = [],
    }: {
        pathSegments?: string[];
        offloadPathSegments?: string[];
    }) {
        super();
        this.saveDir = path.join(...pathSegments);
        this.offloadDir =
            offloadPathSegments.length > 0 ? path.join(...offloadPathSegments) : undefined;
    }

    /**
     * 加载完整的 Agent 状态，包括上下文和元数据。
     * @param options
     * @param options.agentId - Agent 标识符
     * @returns 包含上下文和元数据的 Agent 状态（内部字段已过滤）
     */
    // 可恢复：从 context.jsonl + state.json 恢复上下文与断点信息。
    async loadAgentState(options?: { agentId?: string }): Promise<AgentState> {
        const agentDir = path.join(this.saveDir, options?.agentId || '');

        // 若 Agent 目录不存在，则返回空状态
        if (!fs.existsSync(agentDir)) {
            console.log(`Agent directory ${agentDir} does not exist. Returning empty state.`);
            return {
                context: [],
                metadata: {},
            };
        }
        console.log(`Loading agent state from directory: ${agentDir}`);

        const contextFile = path.join(agentDir, 'context.jsonl');
        const stateFile = path.join(agentDir, 'state.json');

        // 加载元数据
        let metadata: Record<string, unknown> = {};
        if (fs.existsSync(stateFile)) {
            const content = fs.readFileSync(stateFile, 'utf-8');
            metadata = JSON.parse(content);
        }

        // 提取内部压缩边界 ID
        const compressionBoundaryMsgId = metadata[
            `${this.INTERNAL_PREFIX}compressionBoundaryMsgId`
        ] as string | undefined;

        // 加载上下文（若存在压缩边界则增量加载）
        let context: Msg[] = [];
        if (fs.existsSync(contextFile)) {
            const content = fs.readFileSync(contextFile, 'utf-8');
            const allMsgs = content
                .trim()
                .split('\n')
                .filter(line => line.length > 0)
                .map(line => JSON.parse(line));

            if (compressionBoundaryMsgId) {
                // 仅加载压缩边界之后的消息
                const boundaryIndex = allMsgs.findIndex(msg => msg.id === compressionBoundaryMsgId);
                if (boundaryIndex !== -1) {
                    // 包含边界消息本身
                    context = allMsgs.slice(boundaryIndex);
                } else {
                    // 未找到边界，加载所有消息
                    context = allMsgs;
                }
            } else {
                // 无压缩，加载所有消息
                context = allMsgs;
            }
        }

        // 返回前从元数据中过滤掉内部字段
        const publicMetadata = this._filterInternalFields(metadata);

        return {
            context,
            metadata: publicMetadata,
        };
    }

    /**
     * 保存完整的 Agent 状态，包括上下文和元数据。
     * @param options
     * @param options.agentId - Agent 标识符
     * @param options.context - 要保存的对话上下文
     * @param options.metadata - 要保存的 Agent 元数据
     */
    async saveAgentState(options: {
        agentId?: string;
        context: Msg[];
        metadata: Record<string, unknown>;
    }): Promise<void> {
        const agentDir = path.join(this.saveDir, options.agentId || '');
        const contextFile = path.join(agentDir, 'context.jsonl');
        const stateFile = path.join(agentDir, 'state.json');

        // 确保目录存在
        if (!fs.existsSync(agentDir)) {
            fs.mkdirSync(agentDir, { recursive: true });
        }

        // 确定压缩边界（当前上下文中的第一条消息）
        const compressionBoundaryMsgId = options.context[0]?.id;

        // 以增量追加方式保存上下文
        if (!fs.existsSync(contextFile)) {
            // 首次：写入所有消息
            const content = options.context.map(msg => JSON.stringify(msg)).join('\n');
            if (content) {
                fs.writeFileSync(contextFile, content + '\n', 'utf-8');
            }
        } else {
            // 文件已存在：仅追加新消息
            const existingContent = fs.readFileSync(contextFile, 'utf-8');
            const existingLines = existingContent
                .trim()
                .split('\n')
                .filter(line => line.length > 0);

            if (existingLines.length > 0) {
                const lastLine = existingLines[existingLines.length - 1];
                const lastMsg = JSON.parse(lastLine);

                // 找出需要保存的新消息（包含最后一条已保存消息，以便覆盖它）
                const lastMsgIndex = options.context.findIndex(msg => msg.id === lastMsg.id);
                const newMsgs =
                    lastMsgIndex >= 0 ? options.context.slice(lastMsgIndex) : options.context;

                if (newMsgs.length > 0) {
                    // 合并已有消息（去掉最后一行）与新消息
                    const allLines = [
                        ...existingLines.slice(0, -1),
                        ...newMsgs.map(msg => JSON.stringify(msg)),
                    ];
                    const content = allLines.join('\n') + '\n';
                    fs.writeFileSync(contextFile, content, 'utf-8');
                }
            } else {
                // 文件为空，写入所有消息
                const content = options.context.map(msg => JSON.stringify(msg)).join('\n');
                if (content) {
                    fs.writeFileSync(contextFile, content + '\n', 'utf-8');
                }
            }
        }

        // 保存元数据，并写入内部压缩边界
        const internalMetadata = {
            ...options.metadata,
            [`${this.INTERNAL_PREFIX}compressionBoundaryMsgId`]: compressionBoundaryMsgId,
        };
        fs.writeFileSync(stateFile, JSON.stringify(internalMetadata, null, 2), 'utf-8');
    }

    /**
     * 从元数据中过滤掉内部存储字段。
     * @param metadata - 元数据对象
     * @returns 已移除内部字段的元数据
     */
    private _filterInternalFields(metadata: Record<string, unknown>): Record<string, unknown> {
        const filtered: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(metadata)) {
            if (!key.startsWith(this.INTERNAL_PREFIX)) {
                filtered[key] = value;
            }
        }
        return filtered;
    }

    /**
     * 按需把压缩后的上下文外置到外部存储以支持 agentic 检索。
     * @param options
     * @param options.agentId - Agent 标识符
     * @param options.msgs - 要外置的消息
     * @returns 外置上下文的文件路径；若未实现外置或无需外置则返回 undefined
     */
    async offloadContext(options: { agentId?: string; msgs: Msg[] }): Promise<string | undefined> {
        if (!this.offloadDir) {
            return;
        }

        // 把压缩后的上下文外置到文本文件
        // 例如 2026-03-01.txt
        const fileName = `${new Date().toISOString().split('T')[0]}.txt`;
        const offloadFile = path.join(this.offloadDir, options.agentId || '', fileName);
        const offloadDataDir = path.join(this.offloadDir, options.agentId || '', 'data');

        // 目录不存在时创建它
        const offloadAgentDir = path.dirname(offloadFile);
        if (!fs.existsSync(offloadAgentDir)) {
            fs.mkdirSync(offloadAgentDir, { recursive: true });
        }

        // 把新的上下文追加到外置文件
        let appendContent = '';
        for (const msg of options.msgs) {
            const msgContent: string[] = [];
            for (const block of msg.content) {
                switch (block.type) {
                    case 'text':
                        msgContent.push(`${msg.name}: ${block.text}`);
                        break;
                    case 'data':
                        if (block.source.type === 'url') {
                            msgContent.push(
                                `${msg.name}: <data src={${block.source.url}} type={${block.source.media_type}} />`
                            );
                        } else if (block.source.type === 'base64') {
                            // 把 base64 数据保存为文件，并在外置内容中添加对该文件的引用
                            const mainType = block.source.media_type.split('/')[0];
                            const extension = mime.extension(block.source.media_type) || 'bin';
                            const filePath = path.join(
                                offloadDataDir,
                                `${mainType}-${Date.now()}.${extension}`
                            );
                            if (!fs.existsSync(offloadDataDir)) {
                                fs.mkdirSync(offloadDataDir, { recursive: true });
                            }
                            const buffer = Buffer.from(block.source.data, 'base64');
                            fs.writeFileSync(filePath, buffer);
                            msgContent.push(
                                `${msg.name}: <data src={${filePath}} type={${block.source.media_type}} />`
                            );
                        }
                        break;
                    case 'tool_call':
                        msgContent.push(`${msg.name}: Calling tool ${block.name} ...`);
                        break;
                }
            }
            appendContent += msgContent.join('\n') + '\n';
        }

        // 追加到外置文件
        fs.appendFileSync(offloadFile, appendContent, 'utf-8');

        return offloadFile;
    }
}
