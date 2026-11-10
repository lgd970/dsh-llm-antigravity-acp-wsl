export interface WslConfig {
  enabled: boolean
  distro: string
  linuxBinary: string
  launcher: string
  windowsBinary: string
  proxy?: string
}
export const WSL_CONFIG_URL: URL
export function readWslConfig(path?: string | URL): WslConfig | undefined
export function mapWindowsPath<T extends string | undefined>(value: T): T
export function mapAgyInvocation(argv: readonly string[], cwd: string, env: Readonly<NodeJS.ProcessEnv>, config?: WslConfig | null): { argv: readonly string[]; cwd: string; env: Readonly<NodeJS.ProcessEnv> }
export function mapSessionParams<T extends { cwd: string }>(params: T, config?: WslConfig | null): T
