import { exec } from 'child_process';
import { promisify } from 'util';

import { z } from 'zod';

import { createToolResponse, ToolResponse } from './response';

const execAsync = promisify(exec);

/**
 * 用于在 shell 环境中执行 bash 命令的工具。
 * 适用于 git、npm、docker 等终端操作。
 * 文件操作应改用专用的 Read、Write、Edit、Glob 和 Grep 工具。
 *
 * @returns 用于执行 bash 命令的 Tool 对象，其 call 方法负责执行命令并返回输出或错误信息。
 */
export function Bash() {
    return {
        name: 'Bash',
        description: `Executes a given bash command and returns its output.

The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile (bash or zsh).

IMPORTANT: Avoid using this tool to run \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user:

 - File search: Use Glob (NOT find or ls)
 - Content search: Use Grep (NOT grep or rg)
 - Read files: Use Read (NOT cat/head/tail)
 - Edit files: Use Edit (NOT sed/awk)
 - Write files: Use Write (NOT echo >/cat <<EOF)
 - Communication: Output text directly (NOT echo/printf)

While the Bash tool can do similar things, it's better to use the built-in tools as they provide a better user experience and make it easier to review tool calls and give permission.

# Instructions
 - If your command will create new directories or files, first use this tool to run \`ls\` to verify the parent directory exists and is the correct location.
 - Always quote file paths that contain spaces with double quotes in your command (e.g., cd "path with spaces/file.txt")
 - Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of \`cd\`. You may use \`cd\` if the User explicitly requests it.
 - You may specify an optional timeout in milliseconds (up to 600000ms / 10 minutes). By default, your command will timeout after 120000ms (2 minutes).
 - Write a clear, concise description of what your command does. For simple commands, keep it brief (5-10 words). For complex commands (piped commands, obscure flags, or anything hard to understand at a glance), include enough context so that the user can understand what your command will do.
 - When issuing multiple commands:
  - If the commands are independent and can run in parallel, make multiple Bash tool calls in a single message. Example: if you need to run "git status" and "git diff", send a single message with two Bash tool calls in parallel.
  - If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together.
  - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail.
  - DO NOT use newlines to separate commands (newlines are ok in quoted strings).
 - For git commands:
  - Prefer to create a new commit rather than amending an existing commit.
  - Before running destructive operations (e.g., git reset --hard, git push --force, git checkout --), consider whether there is a safer alternative that achieves the same goal. Only use destructive operations when they are truly the best approach.
  - Never skip hooks (--no-verify) or bypass signing (--no-gpg-sign, -c commit.gpgsign=false) unless the user has explicitly asked for it. If a hook fails, investigate and fix the underlying issue.
 - Avoid unnecessary \`sleep\` commands:
  - Do not sleep between commands that can run immediately — just run them.
  - Do not retry failing commands in a sleep loop — diagnose the root cause or consider an alternative approach.
  - If you must sleep, keep the duration short (1-5 seconds) to avoid blocking the user.`,
        inputSchema: z.object({
            command: z.string().describe('The bash command to execute'),
            description: z
                .string()
                .optional()
                .describe(
                    'Clear, concise description of what this command does. For simple commands, keep it brief (5-10 words). For complex commands, include enough context.'
                ),
            timeout: z
                .number()
                .int()
                .min(0)
                .max(600000)
                .optional()
                .describe('Optional timeout in milliseconds (default: 120000, max: 600000)'),
        }),
        requireUserConfirm: true,

        /**
         * 执行 bash 命令并返回其输出。
         *
         * @param root0 - 参数对象
         * @param root0.command - 要执行的 bash 命令
         * @param root0.description - 命令用途的可选描述
         * @param root0.timeout - 可选的超时时间（毫秒，默认 120000，最大 600000）
         * @returns 命令的 stdout，若命令失败则返回错误信息
         */
        async call({
            command,
            description: _description,
            timeout = 120000,
        }: {
            command: string;
            description?: string;
            timeout?: number;
        }): Promise<ToolResponse> {
            try {
                const maxTimeout = 600000;
                const effectiveTimeout = Math.min(timeout, maxTimeout);

                // 根据平台确定合适的 shell
                let shell: string;
                if (process.platform === 'win32') {
                    // 在 Windows 上使用 cmd.exe 或 PowerShell
                    shell = process.env.COMSPEC || 'cmd.exe';
                } else {
                    // 在类 Unix 系统上使用用户的 shell，默认回退到 bash
                    shell = process.env.SHELL || '/bin/bash';
                }

                // 注意：直接 exec，无沙箱、无 cwd、无进程组隔离；仅靠超时和输出上限兜底。
                const { stdout } = await execAsync(command, {
                    encoding: 'utf-8',
                    timeout: effectiveTimeout,
                    maxBuffer: 30000 * 1024,
                    shell,
                });

                // 为保持跨平台一致，将换行符统一规范化为 LF
                const normalizedOutput = stdout.replace(/\r\n/g, '\n');

                // 裁剪手段：输出超过 30000 字符直接截断。
                const maxOutputLength = 30000;
                if (normalizedOutput.length > maxOutputLength) {
                    return createToolResponse({
                        content: [
                            {
                                id: crypto.randomUUID(),
                                created_at: new Date().toISOString(),
                                type: 'text',
                                text:
                                    normalizedOutput.substring(0, maxOutputLength) +
                                    '\n\n[Output truncated - exceeded 30000 characters]',
                            },
                        ],
                        state: 'success',
                    });
                }

                return createToolResponse({
                    content: [
                        {
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                            type: 'text',
                            text: normalizedOutput,
                        },
                    ],
                    state: 'success',
                });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (error: any) {
                const errorMessage = error.message || 'Unknown error';
                const stderr = error.stderr?.toString().replace(/\r\n/g, '\n') || '';
                const stdout = error.stdout?.toString().replace(/\r\n/g, '\n') || '';

                let result = `Command failed: ${command}\n`;
                if (stdout) result += `\nStdout:\n${stdout}`;
                if (stderr) result += `\nStderr:\n${stderr}`;
                if (errorMessage && !stderr) result += `\nError: ${errorMessage}`;

                return createToolResponse({
                    content: [
                        {
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                            type: 'text',
                            text: result,
                        },
                    ],
                    state: 'error',
                });
            }
        },
    };
}
