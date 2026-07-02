/**
 * Helpers for fire-and-forget IPC. The renderer often kicks off a mutation
 * without awaiting it; these ensure a rejected Promise is logged rather than
 * surfacing as an unhandled rejection.
 */

/** Run a promise fire-and-forget, logging any rejection. */
export function fire(promise: Promise<unknown>, context = 'ipc'): void {
  void promise.catch((err: unknown) => console.error(`[${context}] failed:`, err))
}

/** Open a URL in the default browser, fire-and-forget with error logging. */
export function openExternal(url: string): void {
  fire(window.electron.openExternal(url), 'openExternal')
}
