export type ObdErrorKind =
  | 'no-data'
  | 'unable-to-connect'
  | 'bus-error'
  | 'stopped'
  | 'unknown-command'
  | 'error'
  | 'malformed'

export class ObdError extends Error {
  constructor(
    message: string,
    readonly kind: ObdErrorKind,
  ) {
    super(message)
    this.name = 'ObdError'
  }
}

export interface ObdResponse {
  mode: number
  pid: number
  /** Data bytes following the mode/pid echo. */
  data: number[]
  /** The raw text returned by the adapter (for the trace/log view). */
  raw: string
}
