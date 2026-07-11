/**
 * Transport abstraction: a raw byte pipe to an ELM327 adapter.
 *
 * The rest of the app talks to this interface only, so {@link MockTransport}
 * (simulator / trace replay) is a drop-in replacement for {@link BleTransport}
 * (Web Bluetooth) and the whole app is developable without a car.
 */
export type TransportState = 'disconnected' | 'connecting' | 'connected'

export type Unsubscribe = () => void

export interface Transport {
  readonly state: TransportState

  /** A human-readable label for the connected adapter, if known. */
  readonly label: string | null

  connect(): Promise<void>
  disconnect(): Promise<void>

  /** Write raw bytes (typically an ASCII ELM327 command terminated by `\r`). */
  write(data: Uint8Array): Promise<void>

  /** Subscribe to incoming raw byte chunks. Returns an unsubscribe function. */
  onData(listener: (chunk: Uint8Array) => void): Unsubscribe

  /** Subscribe to unexpected disconnects. Returns an unsubscribe function. */
  onDisconnect(listener: () => void): Unsubscribe
}

export class TransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransportError'
  }
}
