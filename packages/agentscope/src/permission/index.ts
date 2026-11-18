/**
 * 权限模式。
 *
 * 权限模式控制系统如何处理工具执行请求。
 * 不同模式适用于不同场景：
 *
 * - `DEFAULT`：除非匹配到 allow 规则，或工具的 `checkPermissions`
 *   对该次调用明确返回 `ALLOW`，否则每个操作都会请求授权
 *   （当前只有 `Bash` 会自动放行可识别的只读命令，
 *   如 `ls`/`git status`）。`Read`/`Glob`/`Grep` 会返回
 *   `PASSTHROUGH`，并在未匹配 allow 规则时
 *   回落到默认的 `ASK`。
 * - `ACCEPT_EDITS`：当所有目标路径都解析到工作目录内时，
 *   自动放行工作目录中的文件读写以及文件系统 bash 命令
 *   （`mkdir`、`rm`、`mv`、`cp` 等）。其他操作
 *   遵循常规规则。
 * - `EXPLORE`：只读模式。允许只读工具（`Read`/`Grep`/
 *   `Glob`）和只读 bash 命令（如 `ls`、`git status`）；拒绝
 *   任何修改类工具/命令。用户配置的 `DENY` 或 `ASK`
 *   规则优先于只读自动放行。
 * - `BYPASS`：跳过所有权限检查，但用户显式配置的
 *   `DENY` / `ASK` 规则和工具 `DENY` 除外。工具发出的安全 `ASK`
 *   不会被强制执行。请使用 deny 规则保护特定路径。
 * - `DONT_ASK`：把每个 `ASK`（包括安全 `ASK` 和匹配到
 *   `ASK` 规则的情况）都转换为 `DENY`。默认即安全，适合无人值守执行。
 */
// 注意：这里只有类型/模式定义，Agent 循环暂未消费；当前生效的是工具上的 requireUserConfirm。
export enum PermissionMode {
    DEFAULT = 'default',
    ACCEPT_EDITS = 'accept_edits',
    EXPLORE = 'explore',
    BYPASS = 'bypass',
    DONT_ASK = 'dont_ask',
}

/**
 * 权限行为。
 *
 * - `ALLOW`：允许该操作。
 * - `DENY`：拒绝该操作。
 * - `ASK`：向用户请求授权。
 * - `PASSTHROUGH`：让权限引擎继续进行规则匹配
 *   （工具借此把决定权交给引擎）。
 */
export enum PermissionBehavior {
    ALLOW = 'allow',
    DENY = 'deny',
    ASK = 'ask',
    PASSTHROUGH = 'passthrough',
}

/**
 * 工具使用的权限规则。
 *
 * 权限规则定义某个特定工具或工具操作应当被允许、拒绝，
 * 还是需要用户确认。`rule_content` 字段的语义
 * 取决于 `tool_name`：
 *
 * - 对于 `Bash`：`rule_content` 是匹配命令的
 *   子串模式。例如：`rule_content="npm install"` 可匹配
 *   `"npm install express"`。
 * - 对于 `Write`/`Read`：`rule_content` 是匹配文件路径的
 *   glob 模式。例如：`rule_content="src/**"` 可匹配
 *   `"src/main.py"`。
 * - 对于其他工具：`rule_content` 是工具特定的过滤模式。
 */
export interface PermissionRule {
    /** 该规则适用的工具名称（例如 "Bash"、"Write"、"Read"）。 */
    tool_name: string;
    /** 可选的过滤模式——语义取决于 `tool_name`。 */
    rule_content: string | null;
    /** 权限行为（"allow"、"deny" 或 "ask"）。 */
    behavior: PermissionBehavior;
    /** 该规则的来源（例如 "userSettings"、"projectSettings"）。 */
    source: string;
}

/**
 * 纳入权限范围的额外目录。
 *
 * 工作目录用于确定在 `ACCEPT_EDITS` 模式下
 * 哪些文件路径应被自动允许。
 */
export interface AdditionalWorkingDirectory {
    /** 该目录的绝对路径。 */
    path: string;
    /**
     * 该目录权限的来源
     * （例如 'userSettings'、'session'）。
     */
    source: string;
}

/**
 * 权限检查的上下文。
 *
 * 包含权限模式、工作目录，以及按行为类型（allow、deny、ask）
 * 组织的所有已配置权限规则。
 *
 * 规则映射以工具名称为键；每个工具支持
 * 通过数组值配置多条规则。
 */
export interface PermissionContext {
    /** 当前权限模式。默认为 {@link PermissionMode.DEFAULT}。 */
    mode: PermissionMode;
    /** 允许进行文件操作的额外目录，以路径为键。 */
    working_directories: Record<string, AdditionalWorkingDirectory>;
    /** 允许执行工具的规则，以工具名称为键。 */
    allow_rules: Record<string, PermissionRule[]>;
    /** 拒绝执行工具的规则，以工具名称为键。 */
    deny_rules: Record<string, PermissionRule[]>;
    /** 需要用户确认的规则，以工具名称为键。 */
    ask_rules: Record<string, PermissionRule[]>;
}

/**
 * 创建带合理默认值的空 {@link PermissionContext} 的工厂函数。
 * 与 Python 侧 Pydantic 的 `default_factory` 语义保持一致。
 *
 * @param mode - 初始权限模式。默认为 {@link PermissionMode.DEFAULT}。
 * @returns 一个全新的 `PermissionContext`，其规则 / 工作目录映射均为空。
 */
export function createPermissionContext(
    mode: PermissionMode = PermissionMode.DEFAULT
): PermissionContext {
    return {
        mode,
        working_directories: {},
        allow_rules: {},
        deny_rules: {},
        ask_rules: {},
    };
}

/**
 * 权限检查的决策结果。
 *
 * 表示一次权限检查的结果，包括该操作应被允许、拒绝，
 * 还是需要用户确认。
 */
export interface PermissionDecision {
    /** 权限行为决策。 */
    behavior: PermissionBehavior;
    /** 描述该决策的人类可读消息。 */
    message: string;
    /**
     * 对该决策原因的可选说明。
     *
     * 接受 `null`，以便来自 Python 侧的 JSON 负载
     * （其把 `None` 序列化为 `null`）能干净地往返。
     */
    decision_reason?: string | null;
    /**
     * 可选的已修改输入数据（例如清理后的路径）。
     *
     * 接受 `null`，原因同 {@link decision_reason}
     * 中的 Python `None` → JSON `null`。
     */
    updated_input?: Record<string, unknown> | null;
    /**
     * 可选的建议权限规则列表，供用户应用。
     *
     * 接受 `null`，原因同 {@link decision_reason}
     * 中的 Python `None` → JSON `null`。
     */
    suggested_rules?: PermissionRule[] | null;
    /**
     * 该决策是否不受 allow 规则抑制
     * （"bypass-immune"）。仅在 `behavior` 为
     * {@link PermissionBehavior.ASK} 时有意义。
     *
     * 工具将其设为 `true` 表示该操作足够危险，
     * **任何 allow 规则**都不得把 `ASK` 转换为 `ALLOW`
     * ——用户必须在当下显式确认。在
     * {@link PermissionMode.DONT_ASK} 且没有用户可用时，
     * bypass-immune 的 `ASK` 会被转换为 `DENY`，
     * 而不是被静默允许。
     *
     * `bypass_immune=true` 的 `ASK` 在各模式下的处理：
     * - `DEFAULT` / `ACCEPT_EDITS`：生效——allow 规则无法覆盖。
     * - `EXPLORE`：不适用（引擎通过只读检查
     *   解析 EXPLORE，不会调用 `checkPermissions`）。
     * - `BYPASS`：有意忽略——BYPASS 的约定是“用户已选择
     *   关闭安全提示；只有 deny / ask 规则作为防护栏。”
     *   在 BYPASS 中使用 deny 规则来强制执行具体的
     *   保护措施。
     * - `DONT_ASK`：转换为 `DENY`（没有用户可用）。
     *
     * 默认为 `false`：即普通 `ASK`，在 `DEFAULT` / `ACCEPT_EDITS`
     * 中可被 allow 规则覆盖，并会被 `BYPASS` 的
     * 回退逻辑静默允许。工具只应在真正的安全检查中
     * 设置它（例如写入危险路径、`rm -rf /`、命令注入
     * 模式）——而不是“我更喜欢用户输入”这类情况。
     *
     * 注意：该字段是权限引擎的内部元数据。
     * 处理决策的调用方（Agent 循环、HITL 后端、UI）会把
     * bypass-immune 的 `ASK` 视为普通 `ASK`——两者都会提示
     * 用户。该区别只决定引擎级规则 / 模式
     * 是否能在到达调用方之前覆盖它。
     */
    bypass_immune?: boolean;
}
