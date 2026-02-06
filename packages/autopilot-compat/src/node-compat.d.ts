declare module 'path' {
  const path: {
    dirname: (path: string) => string
    isAbsolute: (path: string) => boolean
    join: (...parts: string[]) => string
    resolve: (...parts: string[]) => string
  }
  export = path
}

declare module 'url' {
  export function fileURLToPath(url: URL): string
}

declare class URL {
  constructor(input: string, base?: string)
}

interface ImportMeta {
  url: string
}

declare const console: {
  log: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

declare const process: {
  argv: string[]
  env: Record<string, string | undefined>
  exit: (code?: number) => void
  cwd?: () => string
}
