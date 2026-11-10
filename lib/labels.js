/**
 * Short Chinese label per stable failure code, prefixed onto messages that
 * reach the transcript so a bare English code is readable at a glance.
 */
/** Code → short label. Unknown codes stay unlabelled. */
const FAILURE_LABELS = {
    RATE_LIMIT: '频率限制',
    QUOTA: '额度用尽',
    AUTH: '未登录',
    CONTEXT_WINDOW_EXCEEDED: '上下文超限',
    TIMEOUT: '超时',
    TRANSPORT: '连接中断',
    SERVER: '服务端错误',
    REFUSAL: '请求被拒绝',
    MAX_SESSIONS: '并发已满',
    UNKNOWN_MODEL: '模型不可用',
    INVALID_MODEL_CONFIG: '模型参数未生效',
    IMAGE_TOO_LARGE: '图片过大',
    EMPTY_RESPONSE: '空响应',
    DEGRADED_ROUTE: '自动重答',
    DEGRADED_ROUTE_EXHAUSTED: '降智未恢复',
    PROCESS_CLEANUP_FAILED: '进程未退出',
    PLAN_REQUIRED: '套餐不含该模型',
    PROVIDER_ERROR: '模型请求失败',
};
/**
 * Prefix a message with its code's short label.
 * @param code - stable failure code.
 * @param message - provider or plugin message.
 * @returns `[频率限制] …`, or the message unchanged for unlabelled codes.
 */
export function labeled(code, message) {
    const label = FAILURE_LABELS[code];
    return label === undefined || message.startsWith(`[${label}]`) ? message : `[${label}] ${message}`;
}
