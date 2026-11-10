# Windows Desktop + WSL ACP（实验性）

此分支为 Windows 上的 DeepSeek Harness Desktop 增加 WSL 传输：Desktop 中的插件以 ACP/stdio 启动 WSL 内的官方 Linux `agy`，而不是经 CLI Proxy API 转发模型请求。Windows 本机回环 MCP 桥负责 DSH 工具调用。

## 优势

- **Windows 原生 Desktop + Linux 官方 ACP**：继续使用 Windows 图形界面、模型选择器和 DSH 工具。
- **多账号隔离与智能调度**：WSL 内每个普通账号使用独立 HOME 与失效的 D-Bus 地址；插件调度器按会话粘性、优先级、权重和模型族冷却选择可用账号。Windows 原生凭据管理器本身不提供此隔离。
- **多账号额度卡片**：在额度弹层按账号切换，分别查看五小时与每周额度；该操作仅查看，不改变路由。
- **按需 WSL 启动**：使用模型时由插件启动 WSL 进程，无需长期手动开启终端。

## 前置条件与配置

1. Windows 11、WSL2、Linux 发行版、Python 3，及 Windows Desktop 已安装此插件。
2. WSL 内安装官方 Linux `agy`（>= 1.5.0），Windows 上也安装 `agy.exe`（插件用于定位及预检）。
3. 将 `wsl-backend.example.json` 复制为插件目录的 `wsl-backend.json`，按照本机发行版和路径修改并设置 `enabled: true`。`windowsBinary` 是 Windows agy 的绝对路径；`linuxBinary` 是 WSL 内 agy 的绝对路径；`launcher` 是本插件 `scripts/wsl-launch.py` 的 WSL 绝对路径。`proxy` 是 WSL 可访问的代理地址，也可留空。
4. 使用插件的普通账号条目建立独立登录态；每个账号应分别完成授权。Windows 的 system 账号不是 WSL 独立账号。插件的账号 HOME、工作区和会话目录须可通过 `/mnt/<drive>/...` 访问。
5. 在 Desktop 选择 **Antigravity** 分组下的模型。`mybridge`/CLI Proxy API 是其他独立线路。

## 安全与限制

- **不要提交 `wsl-backend.json`、账号 token、日志、Desktop 配置备份或用户目录。** WSL 的共享 Windows 目录使用 Windows ACL 控制访问，Linux 的权限位不等同于隔离安全边界。
- 此实现只将最小 HOME/代理信息传给 WSL，不传其他自定义账号环境变量。代理 URL 禁止包含用户名、密码、查询或片段，因为启动参数对同机进程可能可见。
- 使用依赖 WSL 到 Windows `127.0.0.1` 的连通性；不可用时工具桥需单独适配，**不要将工具桥直接公开到局域网**。
- 账号因额度耗尽切换仅在原插件允许重试的条件下发生；已输出内容后不保证无缝续接。账号失效和所有账号耗尽需人工处理。
- WSL/Windows 跨系统共享 SQLite 的长期并发可靠性、冷启动与真实额度耗尽后的完整接力仍需在目标环境验证。
- 为避免公开仓库包含 OAuth 客户端凭据，本分支移除了上游源码中的硬编码 client ID/secret。额度直读若需要自行刷新过期访问令牌，需由用户自行提供 `AGY_OAUTH_CLIENT_ID` 和 `AGY_OAUTH_CLIENT_SECRET`；未配置时会尝试插件的 `agy -p /usage` 回退。相关环境变量必须来自安全来源，不要提交到仓库。此改动不影响 agy 自己管理的登录和 ACP 模型调用，但可能影响额度读取，具体取决于账户和 CLI 行为。
- 原版提供源码编译脚本；此仓库同时提供预编译 `lib`。测试可能需要 DeepSeek Harness 的 peer 依赖和 TypeScript 开发环境。

## 来源与许可

基于 [lili-luo/dsh-plugin-bundle](https://github.com/lili-luo/dsh-plugin-bundle/tree/main/dsh-llm-antigravity-acp) 的 `dsh-llm-antigravity-acp`，遵循原项目 MIT 许可证。原项目及本项目均非 Google 或 DeepSeek 官方产品。
