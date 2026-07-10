/**
 * Controller for the directly-opened-session observer (#119).
 *
 * Owns a single `SessionObserver` for the main process and ties its lifecycle to
 * the `copilot_app_observe_enabled` setting. index.ts calls `initObserving` once
 * at startup and `setObserveEnabled` when the Settings toggle changes; everything
 * else (WS, reconciler, timers) is encapsulated in the observer, so turning the
 * setting off tears the whole pipeline down.
 */

import { getAppObserveEnabled, setAppObserveEnabled } from './settings'
import { SessionObserver, createSessionObserver } from './observer'

let observer: SessionObserver | null = null
let onChanged: (() => void) | null = null

/**
 * Wire up observing at startup. `notifyChanged` is invoked whenever a reconcile
 * actually changes something (the caller broadcasts `copilot:updated`). Starts the
 * observer only when the setting is enabled (default on).
 */
export function initObserving(notifyChanged: () => void): void {
  onChanged = notifyChanged
  if (getAppObserveEnabled()) startObserver()
}

function startObserver(): void {
  if (observer !== null || onChanged === null) return
  observer = createSessionObserver(onChanged)
  observer.start()
}

function stopObserver(): void {
  if (observer === null) return
  observer.stop()
  observer = null
}

/**
 * Persist the observe setting and start/stop the observer to match. Safe to call
 * before `initObserving` (it persists; the observer starts once wired).
 */
export function setObserveEnabled(enabled: boolean): void {
  setAppObserveEnabled(enabled)
  if (enabled) startObserver()
  else stopObserver()
}

/** Stop the observer (used on app shutdown). */
export function shutdownObserving(): void {
  stopObserver()
}

/** Test/diagnostic hook: is the observer currently running? */
export function isObserving(): boolean {
  return observer !== null
}
