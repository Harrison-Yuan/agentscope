import {
    OllamaChatModel,
    ChatModelBase,
    DashScopeChatModel,
    DeepSeekChatModel,
    OpenAIChatModel,
} from '@agentscope-ai/agentscope/model';
import { Bash, Toolkit, Write, Edit, Read, Glob, Grep } from '@agentscope-ai/agentscope/tool';
import { ModelConfig } from '@shared/types/config';

import { mcpGetAvailableClients } from './mcpService';
import { skillGetAll } from './skillService';
import {
    ScheduleCreate,
    ScheduleDelete,
    ScheduleGet,
    ScheduleList,
    ScheduleUpdate,
} from '../scheduler/tools';

/**
 * 根据 provider 配置创建聊天模型实例。
 * @param modelConfig - 模型配置。
 * @returns 一个 ChatModelBase 实例。
 */
export function getModel(modelConfig: ModelConfig) {
    let model: ChatModelBase;
    switch (modelConfig.provider) {
        case 'dashscope':
            model = new DashScopeChatModel({
                modelName: modelConfig.modelName,
                apiKey: modelConfig.apiKey,
                stream: true,
            });
            break;
        case 'openai':
            model = new OpenAIChatModel({
                modelName: modelConfig.modelName,
                apiKey: modelConfig.apiKey,
                stream: true,
            });
            break;
        case 'ollama':
            model = new OllamaChatModel({
                modelName: modelConfig.modelName,
                stream: true,
            });
            break;
        case 'deepseek':
            model = new DeepSeekChatModel({
                modelName: modelConfig.modelName,
                apiKey: modelConfig.apiKey,
                stream: true,
            });
            break;
    }
    return model;
}

/**
 * 为会话构建包含所有可用工具和 MCP 客户端的 toolkit。
 * @param sessionId - 当前会话 ID。
 * @param agentKey - agent 实例的唯一键（用于定时任务工具）。
 * @returns 一个已配置的 Toolkit 实例。
 */
// 桌面端工具装配：内置工具 + 定时任务工具 + 所有可用 MCP 工具。
export async function getToolkit(sessionId: string, agentKey: string) {
    const skills = skillGetAll().map(skill => skill.dirPath);

    const toolkit = new Toolkit({
        tools: [
            Bash(),
            Glob(),
            Write(),
            Edit(),
            Read(),
            Glob(),
            Grep(),
            ScheduleCreate(sessionId, agentKey),
            ScheduleDelete(),
            ScheduleList(),
            ScheduleGet(),
            ScheduleUpdate(),
        ],
        skills,
        builtInSkillTool: true,
    });
    // 注册所有可用的 MCP 客户端
    const mcpClients = await mcpGetAvailableClients();
    for (const client of mcpClients) {
        await toolkit.registerMCPClient({ client });
    }
    return toolkit;
}
