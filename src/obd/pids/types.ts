export type PidCategory =
  | 'engine'
  | 'temperature'
  | 'pressure'
  | 'fuel'
  | 'electrical'
  | 'speed'
  | 'dpf'
  | 'other'

export interface PidDefinition {
  /** Stable catalog key, e.g. `std.rpm` or `fiat.dpf.soot`. */
  id: string
  mode: number
  pid: number
  name: string
  shortName: string
  unit: string
  category: PidCategory
  min: number
  max: number
  /** Decode payload data bytes to a physical value; `null` if not decodable. */
  decode: (data: readonly number[]) => number | null
  /** Community/experimental PID pending on-vehicle verification. */
  experimental?: boolean
  /** Where the definition/formula came from (for experimental PIDs). */
  source?: string
}

/** A single decoded reading. */
export interface Sample {
  pidId: string
  value: number
  /** Epoch milliseconds. */
  ts: number
}
