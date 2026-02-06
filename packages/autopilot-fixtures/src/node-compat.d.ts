declare module 'fs/promises' {
  export function readFile(path: string, encoding: string): Promise<string>
}

declare module 'url' {
  export function fileURLToPath(url: URL): string
}

declare module 'path' {
  const path: {
    join: (...parts: string[]) => string
  }
  export = path
}

declare class URL {
  constructor(input: string, base?: string)
}

interface ImportMeta {
  url: string
}
