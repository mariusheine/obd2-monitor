import type { Transport, Unsubscribe } from '../transport/types'
import { buildCommand, extractPidData, parseObdBytes } from './parse'
import type { ObdResponse } from './types'

export interface Elm327Options {
  /** Default per-command timeout in milliseconds. */
  timeoutMs?: number
}

interface Pending {
  resolve: (raw: string) => void
  reject: (err: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * ELM327 driver: serialises commands over a {@link Transport}, reassembles the
 * `>`-prompt-terminated response stream, and decodes OBD PID responses.
 *
 * Commands are queued so only one is in flight at a time, matching how the ELM327
 * request/response protocol actually works.
 */
export class Elm327 {
  private buffer = ''
  private pending: Pending | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private readonly decoder = new TextDecoder()
  private readonly encoder = new TextEncoder()
  private readonly unsub: Unsubscribe
  private readonly defaultTimeout: number

  constructor(
    private readonly transport: Transport,
    options: Elm327Options = {},
  ) {
    this.defaultTimeout = options.timeoutMs ?? 5000
    this.unsub = transport.onData((chunk) => this.ingest(chunk))
  }

  /** Detach from the transport. */
  dispose(): void {
    this.unsub()
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending = null
    }
  }

  private ingest(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true })
    const promptIdx = this.buffer.indexOf('>')
    if (promptIdx !== -1 && this.pending) {
      const raw = this.buffer.slice(0, promptIdx)
      this.buffer = this.buffer.slice(promptIdx + 1)
      const pending = this.pending
      this.pending = null
      clearTimeout(pending.timer)
      pending.resolve(raw)
    }
  }

  /** Send a raw command (no trailing CR needed) and resolve with the raw response text. */
  send(command: string, timeoutMs: number = this.defaultTimeout): Promise<string> {
    const exec = (): Promise<string> => this.exec(command, timeoutMs)
    const result = this.chain.then(exec, exec)
    this.chain = result.catch(() => undefined)
    return result
  }

  private exec(command: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.buffer = ''
      const timer = setTimeout(() => {
        this.pending = null
        reject(new Error(`ELM327 timeout after ${timeoutMs}ms for "${command}"`))
      }, timeoutMs)
      this.pending = { resolve, reject, timer }
      this.transport.write(this.encoder.encode(`${command}\r`)).catch((err: unknown) => {
        if (this.pending?.timer === timer) {
          clearTimeout(timer)
          this.pending = null
        }
        reject(err)
      })
    })
  }

  /** Run the standard init sequence: reset, echo/linefeed/spaces off, headers off, auto protocol. */
  async init(): Promise<void> {
    await this.send('ATZ', 4000)
    await this.send('ATE0')
    await this.send('ATL0')
    await this.send('ATS0')
    await this.send('ATH0')
    await this.send('ATSP0')
  }

  /** Query a PID and decode the response header, returning the payload data bytes. */
  async query(mode: number, pid: number): Promise<ObdResponse> {
    const command = buildCommand(mode, pid)
    const raw = await this.send(command)
    const bytes = parseObdBytes(raw)
    const data = extractPidData(bytes, mode, pid)
    return { mode, pid, data, raw }
  }
}
