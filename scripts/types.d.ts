declare module '*.mjs' {
  export const createBackup: (options?: Record<string, unknown>) => Promise<{ path: string; removed: string[] }>
  export const parseRetentionDays: (raw?: string) => number
}
