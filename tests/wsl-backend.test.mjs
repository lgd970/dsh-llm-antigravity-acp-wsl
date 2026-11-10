import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWslConfig, mapWindowsPath, mapAgyInvocation, mapSessionParams } from '../lib/wsl-backend.js';

const config = {
    enabled: true,
    distro: 'UbuntuOpenWrt',
    linuxBinary: '/root/.local/share/dsh-agy-wsl/bin/agy',
    launcher: '/mnt/c/Users/ExampleUser/.dsh/plugins/dsh-llm-antigravity-acp/scripts/wsl-launch.py',
    proxy: 'http://127.0.0.1:7890',
    windowsBinary: 'C:\\Users\\ExampleUser\\AppData\\Local\\agy\\bin\\agy.exe',
};
const windowsCwd = 'C:\\Users\\ExampleUser\\a space\\workspace';
const argv = [config.windowsBinary, 'acp', '--process-per-session'];
const env = { HOME: 'C:\\Users\\ExampleUser\\account 1\\home', CUSTOM: 'preserved' };
function decode(invocation) {
    return JSON.parse(Buffer.from(invocation.argv[6], 'base64').toString('utf8'));
}

test('maps drive absolute paths and preserves Linux/relative strings', () => {
    assert.equal(mapWindowsPath('C:\\A B\\C'), '/mnt/c/A B/C');
    assert.equal(mapWindowsPath('D:/data/cache'), '/mnt/d/data/cache');
    for (const value of ['/root/agy', 'relative/path', 'C:relative', 'http://localhost', undefined])
        assert.equal(mapWindowsPath(value), value);
});

test('missing config disables backend; each config read sees current contents', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-wsl-test-'));
    const file = join(root, 'config.json');
    try {
        assert.equal(readWslConfig(file), undefined);
        writeFileSync(file, JSON.stringify(config));
        assert.equal(readWslConfig(file).distro, config.distro);
        writeFileSync(file, JSON.stringify({ enabled: false }));
        assert.equal(readWslConfig(file), undefined);
        writeFileSync(file, '\uFEFF' + JSON.stringify({ ...config, distro: 'Second' }));
        assert.equal(readWslConfig(file).distro, 'Second');
    }
    finally { rmSync(root, { recursive: true, force: true }); }
});

test('invalid enabled config fails closed without echoing contents', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-wsl-test-'));
    const file = join(root, 'config.json');
    try {
        writeFileSync(file, '{secret invalid JSON');
        assert.throws(() => readWslConfig(file), /^Error: antigravity-acp: invalid WSL backend JSON$/);
        writeFileSync(file, JSON.stringify({ enabled: true }));
        assert.throws(() => readWslConfig(file), /requires distro/);
        writeFileSync(file, JSON.stringify({ ...config, launcher: 'relative.py' }));
        assert.throws(() => readWslConfig(file), /absolute Linux paths/);
    }
    finally { rmSync(root, { recursive: true, force: true }); }
});

test('disabled backend returns native invocation references unmodified', () => {
    const disabled = mapAgyInvocation(argv, windowsCwd, env, undefinedConfig());
    assert.equal(disabled.argv, argv);
    assert.equal(disabled.env, env);
    assert.equal(disabled.cwd, windowsCwd);
});
// null explicitly disables injection without depending on the real local config.
function undefinedConfig() { return null; }

test('only configured agy binary is intercepted', () => {
    for (const binary of ['python3', 'python.exe', 'C:/other/agy.exe', 'agy.exe']) {
        const original = [binary, '--version'];
        assert.equal(mapAgyInvocation(original, windowsCwd, env, config).argv, original);
    }
    const result = mapAgyInvocation([config.windowsBinary.replace(/\\/g, '/').toUpperCase(), '--version'], windowsCwd, env, config);
    assert.equal(result.argv[0], 'wsl.exe');
    assert.equal(result.argv.at(-1), '--version');
});

test('WSL argv and metadata retain boundaries and host launch context', () => {
    const result = mapAgyInvocation(argv, windowsCwd, env, config);
    assert.deepEqual(result.argv.slice(0, 6), ['wsl.exe', '-d', config.distro, '--exec', 'python3', config.launcher]);
    assert.deepEqual(result.argv.slice(7), [config.linuxBinary, 'acp', '--process-per-session']);
    assert.equal(result.cwd, windowsCwd);
    assert.equal(result.env, env);
    const metadata = decode(result);
    assert.equal(metadata.linuxBinary, config.linuxBinary);
    assert.equal(metadata.cwd, '/mnt/c/Users/ExampleUser/a space/workspace');
    assert.equal(metadata.env.HOME, '/mnt/c/Users/ExampleUser/account 1/home');
    assert.equal(metadata.env.CUSTOM, undefined, 'arbitrary environment values must not leak into process arguments');
    assert.equal(env.HOME, 'C:\\Users\\ExampleUser\\account 1\\home');
});

test('isolates D-Bus per HOME and normalizes proxies including lowercase', () => {
    const first = decode(mapAgyInvocation(argv, windowsCwd, env, config));
    const second = decode(mapAgyInvocation(argv, windowsCwd, { ...env, HOME: 'C:/different/home' }, config));
    assert.match(first.env.DBUS_SESSION_BUS_ADDRESS, /^unix:path=\/tmp\/dsh-agy-no-dbus-[a-f0-9]+$/);
    assert.notEqual(first.env.DBUS_SESSION_BUS_ADDRESS, second.env.DBUS_SESSION_BUS_ADDRESS);
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'])
        assert.equal(first.env[key], config.proxy);
    assert.equal(first.env.NO_PROXY, '127.0.0.1,localhost,::1');
    assert.equal(first.env.no_proxy, first.env.NO_PROXY);
});

test('path flags support separated and equals forms only', () => {
    const result = mapAgyInvocation([config.windowsBinary, 'acp',
        '--gemini-dir', 'C:\\accounts\\one', '--log-file=D:/log/file.log',
        '--cli_log_file', 'C:/logs/acp.log', '--app-data-dir', 'agy',
        '--app_data_dir=E:\\app', '--gemini_dir=C:/other',
        '--unrelated', 'C:/leave/as-is', 'C:/positional'], windowsCwd, env, config);
    assert.deepEqual(result.argv.slice(7), [config.linuxBinary, 'acp',
        '--gemini-dir', '/mnt/c/accounts/one', '--log-file=/mnt/d/log/file.log',
        '--cli_log_file', '/mnt/c/logs/acp.log', '--app-data-dir', 'agy',
        '--app_data_dir=/mnt/e/app', '--gemini_dir=/mnt/c/other',
        '--unrelated', 'C:/leave/as-is', 'C:/positional']);
});

test('session params map cwd only and preserve nested protocol objects', () => {
    const params = { cwd: windowsCwd, sessionId: 's', mcpServers: [{ url: 'http://127.0.0.1:1234/mcp' }], _meta: { value: 'C:/not-a-cwd' } };
    const mapped = mapSessionParams(params, config);
    assert.equal(mapped.cwd, '/mnt/c/Users/ExampleUser/a space/workspace');
    assert.equal(mapped.mcpServers, params.mcpServers);
    assert.equal(mapped._meta, params._meta);
    assert.equal(mapped.sessionId, 's');
    assert.equal(params.cwd, windowsCwd);
    assert.equal(mapSessionParams(params, null), params);
    const linux = { cwd: '/root/workspace' };
    assert.equal(mapSessionParams(linux, config), linux);
});

test('both spawn routes and both ACP session routes are wired without Cordis imports', () => {
    const index = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
    const process = readFileSync(new URL('../lib/acp-process.js', import.meta.url), 'utf8');
    assert.equal((index.match(/const invocation = mapAgyInvocation\(/g) ?? []).length, 2);
    assert.match(process, /request\('session\/new', mapSessionParams\(params\)/);
    assert.match(process, /request\('session\/load', mapSessionParams\(params\)/);
});
