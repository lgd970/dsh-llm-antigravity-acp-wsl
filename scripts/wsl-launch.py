"""Launch Linux agy with account-local environment and clean stdio lifecycle."""
import base64
import json
import os
import signal
import subprocess
import sys
import threading


def main():
    meta = json.loads(base64.b64decode(sys.argv[1]))
    argv = sys.argv[2:]
    if (not argv or not isinstance(argv[0], str) or not os.path.isabs(argv[0])
            or '\0' in argv[0] or argv[0] != meta.get('linuxBinary')):
        raise ValueError('Unexpected Linux executable')
    env = os.environ.copy()
    for key in ('HOME', 'DBUS_SESSION_BUS_ADDRESS', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
                'http_proxy', 'https_proxy', 'all_proxy', 'NO_PROXY', 'no_proxy'):
        env.pop(key, None)
    env.update(meta.get('env', {}))
    child = subprocess.Popen(argv, cwd=meta.get('cwd') or '/tmp', env=env,
                             stdin=subprocess.PIPE, start_new_session=True)
    def stop(*_):
        if child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    def feed():
        try:
            while True:
                data = os.read(sys.stdin.fileno(), 65536)
                if not data:
                    break
                child.stdin.write(data)
                child.stdin.flush()
        except (BrokenPipeError, OSError):
            pass
        finally:
            try:
                child.stdin.close()
            except OSError:
                pass
            # ACP stdin EOF must release all account workers.
            if 'acp' in argv:
                stop()
    threading.Thread(target=feed, daemon=True).start()
    code = child.wait()
    stop()
    return code

if __name__ == '__main__':
    sys.exit(main())
