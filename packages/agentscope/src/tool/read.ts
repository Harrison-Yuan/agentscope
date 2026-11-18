import * as fs from 'fs';
import * as path from 'path';

import { z } from 'zod';

import { createToolResponse, ToolResponse } from './response';

/**
 * 用于从本地文件系统读取文件的工具。
 * 以 cat -n 格式返回带行号的文件内容。
 *
 * @returns 用于读取文件的 Tool 对象，其 call 方法负责执行读取操作并返回格式化后的内容，若文件为空则返回警告。
 */
export function Read() {
    return {
        name: 'Read',
        description: `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`,
        inputSchema: z.object({
            file_path: z.string().describe('The absolute path to the file to read'),
            offset: z
                .number()
                .int()
                .positive()
                .optional()
                .describe(
                    'The line number to start reading from. Only provide if the file is too large to read at once'
                ),
            limit: z
                .number()
                .int()
                .positive()
                .optional()
                .describe(
                    'The number of lines to read. Only provide if the file is too large to read at once'
                ),
        }),
        requireUserConfirm: true,

        /**
         * 读取文件并返回带行号的内容。
         *
         * @param root0 - 参数对象
         * @param root0.file_path - 要读取的文件的绝对路径
         * @param root0.offset - 开始读取的行号（从 1 开始）
         * @param root0.limit - 最大读取行数（上限为 2000）
         * @returns 格式化为带行号的文件内容，若文件为空则返回警告
         * @throws 若路径不是绝对路径、文件不存在，或路径是目录时抛出异常
         */
        call({
            file_path,
            offset,
            limit,
        }: {
            file_path: string;
            offset?: number;
            limit?: number;
        }): ToolResponse {
            if (!path.isAbsolute(file_path)) {
                throw new Error(`file_path must be an absolute path, got: ${file_path}`);
            }

            if (!fs.existsSync(file_path)) {
                throw new Error(`File not found: ${file_path}`);
            }

            const stat = fs.statSync(file_path);
            if (stat.isDirectory()) {
                throw new Error(
                    `${file_path} is a directory, not a file. Use Bash with ls to read directories.`
                );
            }

            const rawContent = fs.readFileSync(file_path, 'utf-8');

            if (rawContent.length === 0) {
                return createToolResponse({
                    content: [
                        {
                            id: crypto.randomUUID(),
                            created_at: new Date().toISOString(),
                            type: 'text',
                            text: rawContent,
                        },
                    ],
                    state: 'success',
                });
            }

            const allLines = rawContent.split('\n');
            const startLine = offset !== undefined ? offset - 1 : 0;
            // 裁剪手段：最多读取 2000 行，单行超过 2000 字符截断。
            const maxLines = 2000;
            const effectiveLimit = limit !== undefined ? Math.min(limit, maxLines) : maxLines;
            const selectedLines = allLines.slice(startLine, startLine + effectiveLimit);

            const maxLineLength = 2000;
            const formatted = selectedLines
                .map((line, i) => {
                    const lineNum = startLine + i + 1;
                    const truncated =
                        line.length > maxLineLength
                            ? line.substring(0, maxLineLength) + '[truncated]'
                            : line;
                    return `${String(lineNum).padStart(6)}\t${truncated}`;
                })
                .join('\n');

            return createToolResponse({
                content: [
                    {
                        id: crypto.randomUUID(),
                        created_at: new Date().toISOString(),
                        type: 'text',
                        text: formatted,
                    },
                ],
                state: 'success',
            });
        },
    };
}
