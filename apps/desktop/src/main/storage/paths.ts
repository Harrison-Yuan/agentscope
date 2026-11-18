import os from 'os';
import path from 'path';

// 本地数据根目录；telemetry 目前只有路径占位，没有 OTel 导出。
export const ROOT_DIR = path.join(os.homedir(), '.agentscope');

export const PATHS = {
    root: ROOT_DIR,
    config: path.join(ROOT_DIR, 'config.json'),
    mcp: path.join(ROOT_DIR, 'mcp.json'),

    // 聊天
    chatDir: (sessionId: string) => path.join(ROOT_DIR, 'chat', sessionId),
    chatContext: (sessionId: string, agentId: string) =>
        path.join(ROOT_DIR, 'chat', sessionId, agentId, 'context.jsonl'),
    chatTelemetry: (sessionId: string) =>
        path.join(ROOT_DIR, 'chat', sessionId, 'telemetry', 'traces.json'),

    // 定时任务
    scheduleDir: (eventId: string) => path.join(ROOT_DIR, 'schedule', eventId),
    scheduleEvent: (eventId: string) => path.join(ROOT_DIR, 'schedule', eventId, 'event.json'),
    scheduleSession: (eventId: string, timestamp: string) =>
        path.join(ROOT_DIR, 'schedule', eventId, 'sessions', `${timestamp}.jsonl`),
    scheduleTelemetry: (eventId: string, timestamp: string) =>
        path.join(ROOT_DIR, 'schedule', eventId, 'telemetry', `${timestamp}.traces.json`),

    // 编辑器
    editorDir: (docId: string) => path.join(ROOT_DIR, 'editor', docId),
    editorContent: (docId: string) => path.join(ROOT_DIR, 'editor', docId, 'content.md'),
    editorSessionDir: (docId: string) => path.join(ROOT_DIR, 'editor', docId),
    editorSession: (docId: string, agentId: string) =>
        path.join(ROOT_DIR, 'editor', docId, agentId, `context.jsonl`),
    editorTelemetry: (docId: string, timestamp: string) =>
        path.join(ROOT_DIR, 'editor', docId, 'telemetry', `${timestamp}.traces.json`),

    // 技能
    skills: path.join(ROOT_DIR, 'skills'),
    skillDir: (skillName: string) => path.join(ROOT_DIR, 'skills', skillName),
    skillWatchDirs: path.join(ROOT_DIR, 'skills', 'watch-dirs.json'),
    skillStates: path.join(ROOT_DIR, 'skills', 'states.json'),

    // 工作区
    workspace: path.join(ROOT_DIR, 'workspace'),

    offloadDir: (sessionId: string) => path.join(ROOT_DIR, 'offload', sessionId),

    // 遥测
    telemetry: path.join(ROOT_DIR, 'telemetry'),
    telemetryUsage: path.join(ROOT_DIR, 'telemetry', 'usage.json'),
    telemetryDaily: (date: string) => path.join(ROOT_DIR, 'telemetry', 'daily', `${date}.json`),
};
