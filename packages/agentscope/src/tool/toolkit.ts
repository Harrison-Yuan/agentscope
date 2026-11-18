import * as fs from 'fs';
import * as path from 'path';

import { Validator } from '@cfworker/json-schema';
import matter from 'gray-matter';
import { z } from 'zod';

import { createToolResponse, isToolResponse, ToolResponse } from './response';
import { _jsonLoadsWithRepair } from '../_utils';
import { HTTPMCPClient, StdioMCPClient } from '../mcp';
import { ToolCallBlock } from '../message';
import { ToolInputSchema, ToolSchema } from '../type';
import { Tool } from './base';

interface RegisteredTool extends Tool {
    type: 'function' | 'mcp';
    mcpName?: string;
}

/**
 * AgentScope 中的 toolkit 模块，负责注册工具函数、MCP 以及 agent 技能。
 * 同时提供按分组管理工具的能力。
 */
export class Toolkit {
    tools: RegisteredTool[];
    skills: string[];
    skillDirs: string[];

    // 从技能名到工具包中对应工具名的缓存映射。
    private _skillCache: { [name: string]: string };

    /**
     * 初始化 Toolkit 类的新实例。
     * @param config - 用于初始化工具包的配置对象，可包含工具数组、技能路径数组、技能目录路径数组，以及一个布尔值，表示是否包含用于读取 SKILL.md 文件的内置技能工具。
     * @param config.tools - 要注册到工具包中的工具定义数组。
     * @param config.skills - 指向各个技能的文件路径数组。
     * @param config.skillDirs - 目录路径数组，每个目录的子目录中可包含多个技能。
     * @param config.builtInSkillTool - 布尔标志，表示是否包含用于读取 SKILL.md 文件的内置技能工具。
     */
    constructor(config?: {
        tools?: Tool[];
        skills?: string[];
        skillDirs?: string[];
        builtInSkillTool?: boolean;
    }) {
        const { tools = [], skills = [], skillDirs = [], builtInSkillTool = true } = config || {};

        this.tools = [];

        if (builtInSkillTool) {
            this.tools.push({
                type: 'function',
                name: 'Skill',
                description: `Retrieves the full content of a skill by reading its SKILL.md file. Skills are packages of domain expertise that extend agent capabilities. Use this tool to access detailed instructions, examples, and guidelines for a specific skill.

Usage:
- Provide the skill name as the input parameter
- The tool will return the complete SKILL.md file content for that skill
- If the skill is not found, an error message with available skills will be returned
- Available skills are listed in the skills-system section of the agent prompt`,
                inputSchema: z.object({ name: z.string().describe('The name of the skill') }),
                call: this._skillTool.bind(this),
                requireUserConfirm: false,
            });
        }

        tools.map(tool => {
            this.tools.push({
                type: 'function',
                ...tool,
            });
        });

        this.skills = skills;
        this.skillDirs = skillDirs;

        this._skillCache = {};
    }

    /**
     * 向工具包注册一个工具函数。该函数既可以是符合 ToolFunction 类型的普通函数，也可以是继承自 ToolBase 的类的实例。注册普通函数时，必须显式提供名称、描述和输入 schema；注册 ToolBase 实例时，这些属性将从实例本身中提取。
     *
     * @params tool - 要注册的工具函数，可以是带有显式属性的普通函数，也可以是继承自 ToolBase 的类的实例。
     * @returns 已注册新工具函数的 Toolkit 实例
     * @param tool
     */
    registerToolFunction(tool: Tool): Toolkit {
        this.tools.push({
            type: 'function',
            ...tool,
        });
        return this;
    }

    /**
     * 注册来自指定 MCP 客户端的函数。
     *
     * @param root0
     * @param root0.client
     * @param root0.enabledTools
     * @param root0.disabledTools
     * @param root0.requireUserConfirm
     * @returns 已注册新工具的 Toolkit 实例
     */
    async registerMCPClient({
        client,
        enabledTools,
        disabledTools = [],
        requireUserConfirm = false,
    }: {
        client: HTTPMCPClient | StdioMCPClient;
        enabledTools?: string[];
        disabledTools?: string[];
        requireUserConfirm?: boolean;
    }): Promise<Toolkit> {
        const tools = await client.listTools();

        const appendTools: string[] = [];
        tools
            .filter(
                tool =>
                    !(enabledTools && !enabledTools.includes(tool.name)) &&
                    !disabledTools.includes(tool.name)
            )
            .forEach(tool => {
                this.tools.push({
                    type: 'mcp',
                    mcpName: client.name,
                    ...tool,
                    requireUserConfirm,
                });
                appendTools.push(tool.name);
            });
        console.log(`Registered tools from MCP client '${client.name}': ${appendTools.join(', ')}`);
        return this;
    }

    /**
     * 根据传入的 ToolUseBlock 执行已注册的工具函数。
     * 注意：无论工具函数是何种类型，该方法始终返回 ToolResponse 的 AsyncGenerator。
     *
     * @param toolCall - 包含工具名和输入参数的 ToolUseBlock
     * @yields 工具函数执行过程中产生的增量 ToolResponse 对象
     * @returns 工具函数执行完毕后的最终完整 ToolResponse
     */
    // 工具执行入口：校验入参 → 调用工具 → 把 string / ToolResponse / Generator 统一收敛成 ToolResponse。
    async *callToolFunction(toolCall: ToolCallBlock): AsyncGenerator<ToolResponse, ToolResponse> {
        // 如果该工具已注册
        const tool = this.tools.find(tool => tool.name === toolCall.name);

        if (!tool) {
            const notFoundRes = createToolResponse({
                content: [
                    {
                        id: crypto.randomUUID(),
                        created_at: new Date().toISOString(),
                        type: 'text',
                        text: `FunctionNotFoundError: Cannot find the function named ${toolCall.name}`,
                    },
                ],
                state: 'error',
            });
            yield notFoundRes;
            return notFoundRes;
        }

        // 使用工具的 schema 解析输入参数
        let parsedInput: Record<string, unknown>;
        try {
            parsedInput = _jsonLoadsWithRepair(toolCall.input);
            if (tool.inputSchema instanceof z.ZodObject) {
                tool.inputSchema.parse(parsedInput);
            } else {
                //
                const validator = new Validator(tool.inputSchema);
                const validation = validator.validate(parsedInput);
                if (!validation.valid) {
                    throw new Error(`Invalid input arguments: ${validation.errors}`);
                }
            }
        } catch (error) {
            const parseErrorRes = createToolResponse({
                content: [
                    {
                        id: crypto.randomUUID(),
                        created_at: new Date().toISOString(),
                        type: 'text',
                        text: `InvalidArgumentError: ${String(error)}`,
                    },
                ],
                state: 'error',
            });
            yield parseErrorRes;
            return parseErrorRes;
        }

        // 记录带解析后输入的工具调用
        if (!tool.call) {
            throw new Error(
                `Cannot execute external tool '${toolCall.name}' because no call method is defined for it in the toolkit.`
            );
        }

        // 执行工具函数并等待结果
        // 注意：对非 Promise 值使用 await 会直接返回该值本身
        let finalRes: ToolResponse | null = null;
        try {
            const res = await tool.call(parsedInput);

            // 如果 res 是字符串
            if (typeof res === 'string') {
                const textRes = createToolResponse({
                    content: [
                        {
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                            type: 'text',
                            text: res,
                        },
                    ],
                    state: 'success',
                });
                yield textRes;
                finalRes = textRes;
            } else if (isToolResponse(res)) {
                // 如果 res 是 ToolResponse
                yield res as ToolResponse;
                finalRes = res as ToolResponse;
            } else if (Symbol.asyncIterator in res) {
                // 流式工具：AsyncGenerator 的每个中间结果都会转成事件，最终结果再写入上下文。
                // 如果 res 是 string 或 ToolResponse 的 AsyncGenerator
                const accContent: ToolResponse['content'] = [];
                let nextResult = await (res as AsyncGenerator<string | ToolResponse>).next();

                while (!nextResult.done) {
                    const currentValue = nextResult.value;
                    // 预读下一个值以判断当前值是否为最后一个
                    nextResult = await (res as AsyncGenerator<string | ToolResponse>).next();
                    const isLastValue = nextResult.done;

                    if (typeof currentValue === 'string') {
                        const itemRes = createToolResponse({
                            content: [
                                {
                                    id: crypto.randomUUID(),
                                    created_at: new Date().toISOString(),
                                    type: 'text',
                                    text: currentValue,
                                },
                            ],
                            isLast: isLastValue,
                            state: 'running',
                        });
                        yield itemRes;

                        // 将文本内容累积到 finalRes
                        accContent.push({
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                            type: 'text',
                            text: currentValue,
                        });
                    } else if (isToolResponse(currentValue)) {
                        // 如果 ToolResponse 中已设置 isLast 则沿用，否则使用上面计算出的值
                        currentValue.isLast = currentValue.isLast ?? isLastValue;
                        yield currentValue as ToolResponse;

                        // 将 ToolResponse 的内容累积到 finalRes
                        accContent.push(...currentValue.content);
                    }
                }
                finalRes = createToolResponse({
                    content: accContent,
                    state: 'success',
                });
            } else if (Symbol.iterator in res) {
                // 如果 res 是 string 或 ToolResponse 的 Generator
                const accContent: ToolResponse['content'] = [];
                let nextResult = (res as Generator<string | ToolResponse>).next();

                while (!nextResult.done) {
                    const currentValue = nextResult.value;
                    // 预读下一个值以判断当前值是否为最后一个
                    nextResult = (res as Generator<string | ToolResponse>).next();
                    const isLastValue = nextResult.done;

                    if (typeof currentValue === 'string') {
                        const itemRes = createToolResponse({
                            content: [
                                {
                                    id: crypto.randomUUID(),
                                    created_at: new Date().toISOString(),
                                    type: 'text',
                                    text: currentValue,
                                },
                            ],
                            isLast: isLastValue,
                            state: 'running',
                        });
                        yield itemRes;
                        // 将文本内容累积到 finalRes
                        accContent.push({
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                            type: 'text',
                            text: currentValue,
                        });
                    } else if (isToolResponse(currentValue)) {
                        // 如果 ToolResponse 中已设置 isLast 则沿用，否则使用上面计算出的值
                        currentValue.isLast = currentValue.isLast ?? isLastValue;
                        yield currentValue as ToolResponse;
                        // 将 ToolResponse 的内容累积到 finalRes
                        accContent.push(...currentValue.content);
                    }
                }
                finalRes = createToolResponse({
                    content: accContent,
                    state: 'success',
                });
            } else {
                const invalidRes = createToolResponse({
                    content: [
                        {
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                            type: 'text',
                            text: String(res),
                        },
                    ],
                    state: 'running',
                });
                yield invalidRes;
                finalRes = invalidRes;
            }
        } catch (error) {
            const errorRes = createToolResponse({
                content: [
                    {
                        id: crypto.randomUUID(),
                        created_at: new Date().toISOString(),
                        type: 'text',
                        text: `ToolExecutionError: ${String(error)}`,
                    },
                ],
                state: 'error',
            });
            yield errorRes;
            finalRes = errorRes;
        }

        if (!finalRes) {
            return createToolResponse({
                content: [
                    {
                        id: crypto.randomUUID(),
                        created_at: new Date().toISOString(),
                        type: 'text',
                        text: `Tool ${toolCall.name} executed successfully.`,
                    },
                ],
                state: 'success',
            });
        }

        // 清理 finalRes：把相邻的文本块合并为一个块，
        // 多模态内容块（如图片、音频）保持不变
        const cleanedContent: ToolResponse['content'] = [];
        let textBuffer = '';
        for (const block of finalRes.content) {
            if (block.type === 'text') {
                textBuffer += block.text;
            } else {
                if (textBuffer) {
                    cleanedContent.push({
                        id: crypto.randomUUID(),
                        created_at: new Date().toISOString(),
                        type: 'text',
                        text: textBuffer,
                    });
                    textBuffer = '';
                }
                cleanedContent.push(block);
            }
        }
        // 缓冲区中剩余的文本（如果有）也应推入 cleanedContent
        if (textBuffer) {
            cleanedContent.push({
                id: crypto.randomUUID(),
                created_at: new Date().toISOString(),
                type: 'text',
                text: textBuffer,
            });
        }

        return {
            ...finalRes,
            content: cleanedContent,
        };
    }

    /**
     * 以兼容 LLM API 的格式返回所有已注册工具的 JSON schema。
     *
     * @returns ToolJSONSchema 对象数组
     */
    getJSONSchemas(): ToolSchema[] {
        return this.tools.map(tool => {
            const inputSchema =
                tool.inputSchema instanceof z.ZodObject
                    ? tool.inputSchema.toJSONSchema({ target: 'openapi-3.0' })
                    : tool.inputSchema;

            return {
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: inputSchema as ToolInputSchema,
                },
            };
        });
    }

    /**
     * 获取供 agent 使用技能的指令提示词。
     *
     * @returns 包含可用技能及其使用方式的指令提示词字符串。
     */
    // 渐进披露：system prompt 只注入 name/description/location，全文由 Skill 工具按需读取。
    getSkillsPrompt(): string {
        this._skillCache = {};
        if (this.skills.length === 0 && this.skillDirs.length === 0) return '';

        if (typeof process !== 'undefined' && process.versions && process.versions.node) {
            const skillsInfo: { name: string; description: string; location: string }[] = [];
            this.skills.forEach(skillPath => {
                // 首先获取绝对路径
                const absSkillPath = path.resolve(skillPath);

                // 检查目录是否存在
                if (!fs.existsSync(absSkillPath) || !fs.statSync(absSkillPath).isDirectory()) {
                    return;
                }

                // 首先检查该目录下是否直接存在 SKILL.md
                const skillMdPath = path.join(absSkillPath, 'SKILL.md');
                if (!fs.existsSync(skillMdPath)) return;

                // 读取 SKILL.md 文件，并从 YAML front matter 中提取 name 与 description
                try {
                    const content = fs.readFileSync(skillMdPath, 'utf-8');
                    const { data } = matter(content);

                    const name = data.name || path.basename(skillPath);
                    const description = data.description || 'No description provided';

                    skillsInfo.push({
                        name,
                        description,
                        location: absSkillPath,
                    });

                    this._skillCache[name] = absSkillPath;
                } catch (e) {
                    console.error(`Error reading SKILL.md for skill at ${skillPath}:`, e);
                }
            });

            this.skillDirs.forEach(skillDir => {
                const absSkillDir = path.resolve(skillDir);

                // 检查目录是否存在
                if (!fs.existsSync(absSkillDir) || !fs.statSync(absSkillDir).isDirectory()) {
                    return;
                }

                // 读取 skillDir 下的所有子目录
                const subdirs = fs.readdirSync(absSkillDir).filter(subdir => {
                    const subdirPath = path.join(absSkillDir, subdir);
                    return fs.statSync(subdirPath).isDirectory();
                });

                subdirs.forEach(subdir => {
                    const skillMdPath = path.join(absSkillDir, subdir, 'SKILL.md');
                    if (!fs.existsSync(skillMdPath)) return;

                    try {
                        const content = fs.readFileSync(skillMdPath, 'utf-8');
                        const { data } = matter(content);

                        const name = data.name || subdir;
                        const description = data.description || 'No description provided';

                        skillsInfo.push({
                            name,
                            description,
                            location: path.join(skillDir, subdir),
                        });

                        this._skillCache[name] = path.join(absSkillDir, subdir);
                    } catch (e) {
                        console.error(
                            `Error reading SKILL.md for skill at ${path.join(skillDir, subdir)}:`,
                            e
                        );
                    }
                });
            });

            if (skillsInfo.length === 0) return '';

            const skillsXml = skillsInfo
                .map(
                    skill => `<skill>
<name>${skill.name}</name>
<description>${skill.description}</description>
<location>${skill.location}</location>
</skill>`
                )
                .reduce((acc, skillInfo) => acc + `\n${skillInfo}\n`, '');

            return `<skills-system>
## What are Skills?
Skills are packages of domain expertise that extend your capabilities.

## Important: How to Use Skills
**Skill names are NOT callable functions.** You cannot call a skill directly by its name.
${skillsXml}
</skills-system>`;
        }

        return '';
    }

    /**
     * agent 技能工具，用于根据技能名读取 SKILL.md 文件内容。
     * @param root0
     * @param root0.name
     * @returns 指定技能的 SKILL.md 文件内容；若技能未找到或
     * SKILL.md 文件无法读取，则返回错误信息。
     */
    // Skill 不是函数调用：模型按 description 选中技能后，再用 name 读取 SKILL.md 全文。
    private async _skillTool({ name }: { name: string }): Promise<ToolResponse> {
        if (this._skillCache[name]) {
            // 在缓存中查找技能名，以获取对应的目录路径
            const skillDir = this._skillCache[name];
            // 读取技能目录中的 SKILL.md 文件，并将其内容作为工具响应返回
            const skillMdPath = path.join(skillDir, 'SKILL.md');
            if (!fs.existsSync(skillMdPath)) {
                try {
                    const fileContent = fs.readFileSync(skillMdPath, 'utf-8');
                    return createToolResponse({
                        content: [
                            {
                                id: crypto.randomUUID(),
                                created_at: new Date().toISOString(),
                                type: 'text',
                                text: fileContent,
                            },
                        ],
                        state: 'success',
                    });
                } catch {}
            }
        }

        // 若缓存中不存在该技能，则重新扫描 skills 和 skillDirs 查找该技能，同时刷新缓存
        this.getSkillsPrompt();
        const refreshedSkillDir = this._skillCache[name];
        if (refreshedSkillDir) {
            const skillMdPath = path.join(refreshedSkillDir, 'SKILL.md');
            try {
                const fileContent = fs.readFileSync(skillMdPath, 'utf-8');
                return createToolResponse({
                    content: [
                        {
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                            type: 'text',
                            text: fileContent,
                        },
                    ],
                    state: 'success',
                });
            } catch {}
        }

        return createToolResponse({
            content: [
                {
                    id: crypto.randomUUID(),
                    created_at: new Date().toISOString(),
                    type: 'text',
                    text: `SkillNotFoundError: Cannot find the skill named ${name}, current available skills are ${Object.keys(this._skillCache).join(', ')}`,
                },
            ],
            state: 'error',
        });
    }

    /**
     * 根据工具名检查该工具在执行前是否需要用户确认。
     * @param toolName 要检查是否需要用户确认的工具名称。
     * @returns 布尔值，表示指定工具在执行前是否需要用户确认。若工具未找到，则返回 false。
     */
    // 审批声明：工具层只表达“要不要问”，具体交互（UI/策略/白名单）由宿主实现。
    requireUserConfirm(toolName: string): boolean {
        const tool = this.tools.find(tool => tool.name === toolName);
        return tool ? (tool.requireUserConfirm ?? false) : false;
    }

    /**
     * 根据工具名检查该工具是否需要外部执行（例如由 MCP 客户端执行）。
     * @param toolName
     * @returns 布尔值，表示指定工具是否需要外部执行。若工具未找到，则返回 false。
     */
    requireExternalExecution(toolName: string): boolean {
        const tool = this.tools.find(tool => tool.name === toolName);
        return tool ? !tool.call : false;
    }
}
