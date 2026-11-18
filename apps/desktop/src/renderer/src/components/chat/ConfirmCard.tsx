import { ToolCallBlock } from '@agentscope-ai/agentscope/message';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { useTranslation } from '@/i18n/useI18n';
import { cn } from '@/lib/utils';

/**
 * 返回工具名称的易读标签。
 * @param name - 工具名称。
 * @returns 该工具的展示字符串。
 */
function renderToolName(name: string) {
    switch (name.toLowerCase()) {
        case 'bash':
            return 'Bash command';
        case 'read':
            return 'Read file';
        default:
            return `${name} tool`;
    }
}

/**
 * 根据工具类型渲染格式化后的工具输入。
 * @param name - 工具名称。
 * @param input - 原始输入字符串（JSON）。
 * @returns 一个 React 元素或原始输入字符串。
 */
function renderToolInput(name: string, input: string) {
    try {
        switch (name.toLowerCase()) {
            case 'bash': {
                const inputObj = JSON.parse(input);
                return (
                    <div className="w-full max-w-full overflow-hidden text-ellipsis truncate">
                        <div className="text-secondary-foreground">{inputObj.command}</div>
                        <div className="text-muted-foreground">{inputObj.description}</div>
                    </div>
                );
            }
            case 'read': {
                const inputObj = JSON.parse(input);
                return (
                    <div className="w-full max-w-full overflow-hidden text-ellipsis truncate">
                        <div className="text-secondary-foreground">{inputObj.file_path}</div>
                    </div>
                );
            }
            default:
                return input;
        }
    } catch {
        return input;
    }
}

/**
 * 用于用户确认待处理工具调用的卡片组件。
 * @param root0 - 组件 props。
 * @param root0.toolCall - 等待确认的工具调用块。
 * @param root0.onUserConfirm - 携带用户决定的回调。
 * @returns 一个确认卡片元素。
 */
// 审批 UI：展示待确认的工具调用，用户选择后回传 USER_CONFIRM_RESULT。
export function ConfirmCard({
    toolCall,
    onUserConfirm,
}: {
    toolCall: ToolCallBlock;
    onUserConfirm: (confirm: boolean) => void;
}) {
    const { t } = useTranslation();
    const [selected, setSelected] = useState<'yes' | 'no'>('yes');

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'ArrowUp':
                case 'ArrowDown':
                    e.preventDefault();
                    setSelected(prev => (prev === 'yes' ? 'no' : 'yes'));
                    break;
                case 'Enter':
                    e.preventDefault();
                    onUserConfirm(selected === 'yes');
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onUserConfirm, selected]);

    return (
        <div className="ring ring-border rounded-xl w-full p-4 space-y-4 text-sm">
            <div className="flex flex-col gap-y-2">
                <strong className="text-secondary-foreground">
                    {renderToolName(toolCall.name)}
                </strong>
                <div className="px-4 py-2 bg-white rounded-sm">
                    {renderToolInput(toolCall.name, toolCall.input)}
                </div>
            </div>
            <div className="flex flex-col">
                <strong className="text-secondary-foreground mb-1">
                    {t('chat.confirmToolCall')}
                </strong>
                <Button
                    className={cn(
                        'flex justify-start cursor-pointer',
                        selected === 'yes' ? 'text-primary' : 'text-muted-foreground'
                    )}
                    size="sm"
                    variant="ghost"
                    onMouseEnter={() => setSelected('yes')}
                    onClick={e => {
                        e.stopPropagation();
                        e.preventDefault();
                        onUserConfirm(true);
                    }}
                >
                    <ChevronRight
                        className={cn('size-4', selected === 'yes' ? 'visible' : 'invisible')}
                    />
                    1. {t('common.yes')}
                    <div className={cn(selected === 'yes' ? 'text-muted-foreground' : 'invisible')}>
                        (<Kbd>Enter</Kbd> to confirm)
                    </div>
                </Button>
                <Button
                    className={cn(
                        'flex justify-start cursor-pointer',
                        selected === 'no' ? 'text-primary' : 'text-muted-foreground'
                    )}
                    size="sm"
                    variant="ghost"
                    onClick={e => {
                        e.stopPropagation();
                        e.preventDefault();
                        onUserConfirm(false);
                    }}
                    onMouseEnter={() => setSelected('no')}
                >
                    <ChevronRight
                        className={cn('size-4', selected === 'no' ? 'visible' : 'invisible')}
                    />
                    2. {t('common.no')}
                    <div className={cn(selected === 'no' ? 'text-muted-foreground' : 'invisible')}>
                        (<Kbd>Enter</Kbd> to confirm)
                    </div>
                </Button>
            </div>
        </div>
    );
}
