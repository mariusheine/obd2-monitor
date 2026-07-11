export interface ReconnectorOptions {
  /** Perform one full reconnect attempt (transport connect + ELM init + resume). Throws to retry. */
  attempt: () => Promise<void>
  /** Max attempts before giving up. Default 8. */
  maxAttempts?: number
  /** Backoff in ms for attempt N (1-based). Default: exponential capped at 15s. */
  backoffMs?: (attempt: number) => number
  onStatus?: (status: 'reconnecting' | 'connected' | 'failed') => void
}

const defaultBackoff = (attempt: number): number => Math.min(1000 * 2 ** (attempt - 1), 15000)

/**
 * Retries a reconnect operation with backoff after an unexpected disconnect.
 *
 * Web Bluetooth can re-open an already-permitted device without a new user
 * gesture, so reconnection can happen silently in the background while driving.
 */
export class Reconnector {
  private attempts = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false

  constructor(private readonly options: ReconnectorOptions) {}

  start(): void {
    this.stopped = false
    this.attempts = 0
    void this.run()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  private async run(): Promise<void> {
    if (this.stopped) return
    this.attempts += 1
    this.options.onStatus?.('reconnecting')
    try {
      await this.options.attempt()
      if (this.stopped) return
      this.attempts = 0
      this.options.onStatus?.('connected')
    } catch {
      if (this.stopped) return
      const max = this.options.maxAttempts ?? 8
      if (this.attempts >= max) {
        this.options.onStatus?.('failed')
        return
      }
      const wait = (this.options.backoffMs ?? defaultBackoff)(this.attempts)
      this.timer = setTimeout(() => void this.run(), wait)
    }
  }
}
