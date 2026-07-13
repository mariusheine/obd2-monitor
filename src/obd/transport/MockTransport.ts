import { VehicleSimulator } from './simulator'
import type { Transport, TransportState, Unsubscribe } from './types'

const hex2 = (b: number): string => b.toString(16).toUpperCase().padStart(2, '0')

/** Soot load (g/L) above which the simulator reports a pending soot-overload code. */
const SOOT_DTC_THRESHOLD = 15

/**
 * An in-memory ELM327 simulator that speaks just enough of the protocol for the
 * app to run without hardware. It answers the AT init sequence and Mode 01 / Mode
 * 22 PID requests from a {@link VehicleSimulator}, honouring echo (ATE0/1) and
 * emitting responses terminated by the `>` prompt like a real adapter.
 */
export class MockTransport implements Transport {
  readonly label = 'Mock ELM327 (simulator)'

  private _state: TransportState = 'disconnected'
  private echo = true
  private dtcsCleared = false
  private readonly encoder = new TextEncoder()
  private readonly dataListeners = new Set<(chunk: Uint8Array) => void>()
  private readonly disconnectListeners = new Set<() => void>()
  private readonly sim: VehicleSimulator

  /** Simulated per-response latency in milliseconds. */
  constructor(private readonly latencyMs = 25) {
    this.sim = new VehicleSimulator()
  }

  get state(): TransportState {
    return this._state
  }

  connect(): Promise<void> {
    this._state = 'connected'
    this.echo = true
    return Promise.resolve()
  }

  disconnect(): Promise<void> {
    this._state = 'disconnected'
    for (const l of this.disconnectListeners) l()
    return Promise.resolve()
  }

  write(data: Uint8Array): Promise<void> {
    if (this._state !== 'connected') {
      return Promise.reject(new Error('MockTransport: not connected'))
    }
    const command = new TextDecoder().decode(data).replace(/[\r\n]+$/, '')
    const reply = this.respond(command)
    setTimeout(() => this.emit(reply), this.latencyMs)
    return Promise.resolve()
  }

  onData(listener: (chunk: Uint8Array) => void): Unsubscribe {
    this.dataListeners.add(listener)
    return () => this.dataListeners.delete(listener)
  }

  onDisconnect(listener: () => void): Unsubscribe {
    this.disconnectListeners.add(listener)
    return () => this.disconnectListeners.delete(listener)
  }

  private emit(text: string): void {
    const chunk = this.encoder.encode(text)
    for (const l of this.dataListeners) l(chunk)
  }

  /** Build a Mode 03/07/0A response: `<mode+0x40> <count> <two bytes per code…>`. */
  private dtcResponse(mode: number, codes: readonly number[][]): string {
    return [mode + 0x40, codes.length, ...codes.flat()].map(hex2).join(' ')
  }

  private respond(rawCommand: string): string {
    const command = rawCommand.replace(/\s+/g, '').toUpperCase()
    const echoPart = this.echo ? `${rawCommand}\r` : ''
    const body = this.body(command)
    return `${echoPart}${body}\r\r>`
  }

  private body(command: string): string {
    if (command.startsWith('AT')) {
      const at = command.slice(2)
      if (at === 'Z' || at === 'WS' || at === 'D') {
        this.echo = true
        return 'ELM327 v1.5'
      }
      if (at === 'E0') {
        this.echo = false
        return 'OK'
      }
      if (at === 'E1') {
        this.echo = true
        return 'OK'
      }
      if (at === 'DPN') return '6' // ISO 15765-4 CAN (11 bit, 500 kbaud)
      if (at === 'RV') return '14.1V'
      if (at === 'I') return 'ELM327 v1.5'
      return 'OK'
    }

    // Diagnostic trouble codes: stored (03), pending (07), permanent (0A), clear (04).
    // Two stored codes (P2002 DPF efficiency + P0401 EGR) and one pending (P2453),
    // all clearable via 04. A soot-overload pending code (P2463) additionally appears
    // while simulated soot is high and clears after a regeneration, so a recorded
    // drive captures a real appear→clear transition for the DTC monitor.
    if (command === '03') {
      return this.dtcResponse(0x03, this.dtcsCleared ? [] : [[0x20, 0x02], [0x04, 0x01]])
    }
    if (command === '07') {
      const pending: number[][] = []
      if (!this.dtcsCleared) pending.push([0x24, 0x53]) // P2453
      if (this.sim.state(Date.now()).dpfSootGl > SOOT_DTC_THRESHOLD) pending.push([0x24, 0x63]) // P2463
      return this.dtcResponse(0x07, pending)
    }
    if (command === '0A') return this.dtcResponse(0x0a, [])
    if (command === '04') {
      this.dtcsCleared = true
      return '44'
    }

    // OBD request: mode + pid. Mode 22 uses a 2-byte PID, others 1 byte.
    const mode = parseInt(command.slice(0, 2), 16)
    const isMode22 = command.slice(0, 2) === '22'
    const pidHex = isMode22 ? command.slice(2, 6) : command.slice(2, 4)
    const pid = parseInt(pidHex, 16)
    if (Number.isNaN(mode) || Number.isNaN(pid)) return 'NO DATA'

    const data = this.sim.dataBytes(mode, pid, Date.now())
    if (data === null) return 'NO DATA'

    const header = [mode + 0x40]
    const pidEcho = isMode22 ? [(pid >> 8) & 0xff, pid & 0xff] : [pid & 0xff]
    return [...header, ...pidEcho, ...data].map(hex2).join(' ')
  }
}
