/**
 * A fixed-capacity time series of (timestamp, value) points for live charts.
 *
 * Kept as two parallel arrays so it can be handed straight to uPlot as
 * `[xs, ys]`. Oldest points are dropped once capacity is exceeded, bounding
 * memory during long drives.
 */
export class TimeSeries {
  readonly ts: number[] = []
  readonly values: number[] = []

  constructor(readonly capacity = 900) {}

  push(t: number, value: number): void {
    this.ts.push(t)
    this.values.push(value)
    if (this.ts.length > this.capacity) {
      this.ts.shift()
      this.values.shift()
    }
  }

  get length(): number {
    return this.ts.length
  }

  last(): number | undefined {
    return this.values[this.values.length - 1]
  }

  clear(): void {
    this.ts.length = 0
    this.values.length = 0
  }
}
