/** Optional Windows-to-WSL transport. Configuration is read per invocation. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const WSL_CONFIG_URL = new URL('../wsl-backend.json', import.meta.url);
const PATH_FLAGS = new Set(['--gemini-dir', '--gemini_dir', '--log-file', '--cli_log_file', '--app-data-dir', '--app_data_dir']);
const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];

/** Missing/disabled config preserves the original native backend. Invalid config fails closed. */
export function readWslConfig(path = WSL_CONFIG_URL) {
    let text;
    try { text = readFileSync(path, 'utf8'); }
    catch (error) {
        if (error?.code === 'ENOENT') return undefined;
        throw new Error('antigravity-acp: could not read WSL backend config');
    }
    let config;
    try { config = JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch { throw new Error('antigravity-acp: invalid WSL backend JSON'); }
    if (config?.enabled !== true) return undefined;
    for (const key of ['distro', 'linuxBinary', 'launcher', 'windowsBinary']) {
        if (typeof config[key] !== 'string' || config[key].trim().length === 0 || config[key].includes('\0'))
            throw new Error(`antigravity-acp: WSL config requires ${key}`);
    }
    if (!config.linuxBinary.startsWith('/') || !config.launcher.startsWith('/'))
        throw new Error('antigravity-acp: WSL binary and launcher must be absolute Linux paths');
    if (config.proxy !== undefined && typeof config.proxy !== 'string')
        throw new Error('antigravity-acp: WSL proxy must be a string');
    return config;
}

/** Translate drive-absolute paths only; relative strings and Linux paths stay unchanged. */
export function mapWindowsPath(value) {
    if (typeof value !== 'string' || !/^[A-Za-z]:[\\/]/.test(value)) return value;
    return `/mnt/${value[0].toLowerCase()}/${value.slice(3).replace(/\\/g, '/')}`;
}
function binaryKey(value) {
    return typeof value === 'string' ? value.replace(/\\/g, '/').toLowerCase() : '';
}
function isTarget(argv, config) {
    return config != null && binaryKey(argv[0]) === binaryKey(config.windowsBinary);
}

/** Intercept only the configured Windows agy executable, never Python or other helpers. */
export function mapAgyInvocation(argv, cwd, env, config = readWslConfig()) {
    if (!isTarget(argv, config)) return { argv, cwd, env };
    const mapped = [config.linuxBinary];
    for (let index = 1; index < argv.length; index += 1) {
        const arg = argv[index];
        const equals = arg.indexOf('=');
        if (equals > 0 && PATH_FLAGS.has(arg.slice(0, equals))) {
            mapped.push(`${arg.slice(0, equals)}=${mapWindowsPath(arg.slice(equals + 1))}`);
        }
        else {
            mapped.push(arg);
            if (PATH_FLAGS.has(arg) && index + 1 < argv.length)
                mapped.push(mapWindowsPath(argv[++index]));
        }
    }
    // Metadata is visible in the process command line. Never serialize arbitrary
    // account environment variables or credentials into it.
    const linuxEnv = {};
    if (typeof env?.HOME === 'string') linuxEnv.HOME = mapWindowsPath(env.HOME);
    const accountKey = createHash('sha256').update(String(linuxEnv.HOME ?? cwd ?? '')).digest('hex').slice(0, 24);
    linuxEnv.DBUS_SESSION_BUS_ADDRESS = `unix:path=/tmp/dsh-agy-no-dbus-${accountKey}`;
    const proxy = config.proxy ?? '';
    if (proxy) {
        const parsed = new URL(proxy);
        if (parsed.username || parsed.password || parsed.search || parsed.hash)
            throw new Error('antigravity-acp: WSL proxy must not include credentials or query parameters');
        if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol))
            throw new Error('antigravity-acp: unsupported WSL proxy protocol');
    }
    for (const key of PROXY_KEYS) linuxEnv[key] = proxy;
    linuxEnv.NO_PROXY = '127.0.0.1,localhost,::1';
    linuxEnv.no_proxy = linuxEnv.NO_PROXY;
    const metadata = Buffer.from(JSON.stringify({ linuxBinary: config.linuxBinary, cwd: mapWindowsPath(cwd), env: linuxEnv }), 'utf8').toString('base64');
    return {
        argv: ['wsl.exe', '-d', config.distro, '--exec', 'python3', config.launcher, metadata, ...mapped],
        // The host subprocess API still receives a Windows cwd/environment.
        cwd,
        env,
    };
}

/** Map only ACP session cwd; preserve MCP endpoints and every other parameter. */
export function mapSessionParams(params, config = readWslConfig()) {
    if (config == null || typeof params?.cwd !== 'string') return params;
    const cwd = mapWindowsPath(params.cwd);
    return cwd === params.cwd ? params : { ...params, cwd };
}
