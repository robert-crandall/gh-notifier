// Type declarations for bun:sqlite — used only in integration tests.
// The real types ship with bun-types; this is a minimal shim so tsc
// doesn't error when type-checking test files outside of Bun's compiler.
declare module 'bun:sqlite' {
  export class Database {
    constructor(path: string)
    exec(sql: string): void
    prepare(sql: string): Statement
    query(sql: string): Statement
    transaction<T extends (...args: unknown[]) => unknown>(fn: T): T
    close(): void
  }

  interface Statement {
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
    run(...params: unknown[]): void
    finalize(): void
  }
}
