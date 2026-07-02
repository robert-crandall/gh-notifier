// Vitest global setup. jsdom in this project ships a non-functional `localStorage`
// (methods like `clear` are missing), so tests that touch it fail. Provide a small
// in-memory implementation when a working one isn't present. Node-environment tests
// simply gain a harmless localStorage they don't use.
const target = globalThis as unknown as { localStorage?: Storage }

if (typeof target.localStorage === 'undefined' || typeof target.localStorage.clear !== 'function') {
  const store = new Map<string, string>()
  const memoryStorage = {
    get length(): number {
      return store.size
    },
    clear(): void {
      store.clear()
    },
    getItem(key: string): string | null {
      return store.has(key) ? (store.get(key) as string) : null
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string): void {
      store.delete(key)
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value))
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage,
    configurable: true,
    writable: true,
  })
}
