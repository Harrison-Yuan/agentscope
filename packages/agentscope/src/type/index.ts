import { ToolResponse } from '../tool';

export type JSONSerializableObject =
    | string
    | number
    | boolean
    | null
    | JSONSerializableObject[]
    | { [key: string]: JSONSerializableObject };

/** 回复结束的原因。 */
export enum ReplyFinishedReason {
    COMPLETED = 'completed',
    INTERRUPTED = 'interrupted',
    EXCEED_MAX_ITERS = 'exceed_max_iters',
    ERROR = 'error',
}

// Harness 错误分类：供上层统一重试/告警/展示；Agent 循环目前尚未接线。
/** 终止回复的致命错误分类。 */
export enum ErrorType {
    AUTHENTICATION = 'authentication',
    PERMISSION = 'permission',
    RATE_LIMIT = 'rate_limit',
    INVALID_REQUEST = 'invalid_request',
    UPSTREAM = 'upstream',
    CONNECTION = 'connection',
    INTERNAL = 'internal',
    SETUP = 'setup',
    UNKNOWN = 'unknown',
}

/** 面向 UI 的结构化致命回复错误描述。 */
export class ErrorInfo {
    type: ErrorType;
    message: string;

    /**
     * 创建错误信息。
     * @param options 错误字段。
     * @param options.message 已脱敏的消息。
     * @param options.type 稳定的分类。
     */
    constructor({ message, type = ErrorType.UNKNOWN }: { message: string; type?: ErrorType }) {
        this.type = type;
        this.message = message;
    }
}

export type ToolName = string;
export type ToolChoice = 'auto' | 'none' | 'required' | ToolName;

export interface ToolInputSchema {
    type: 'object';
    properties?: Record<string, object>;
    required?: string[];
    [key: string]: unknown;
}

export interface ToolSchema {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: ToolInputSchema;
    };
}

/**
 * 定义工具函数可能的函数类型：
 * - 同步：string
 * - 异步：Promise<string>
 * - 同步生成器：Generator<string>
 * - 异步生成器：AsyncGenerator<string>
 * - 同步：ToolResponse
 * - 异步：Promise<ToolResponse>
 * - 同步生成器：Generator<ToolResponse>
 * - 异步生成器：AsyncGenerator<ToolResponse>
 */
export type ToolFunction = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any
) =>
    | string
    | Promise<string>
    | Generator<string>
    | AsyncGenerator<string>
    | ToolResponse
    | Promise<ToolResponse>
    | Generator<ToolResponse>
    | AsyncGenerator<ToolResponse>;
