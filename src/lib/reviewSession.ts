/**
 * Pure transforms that turn a stored drive (a flat, time-ordered sample list plus
 * its DTC event log) into the shapes the live components already consume: one
 * {@link TimeSeries} per PID for the charts, {@link ChartMarker}s for the DTC
 * overlay, and an end-of-drive snapshot + active-code set for the DPF analysis.
 *
 * Kept free of Vue/Dexie so it can be unit-tested and reused for both cloud
 * ({@link ../obd/sync/cloudSessions}) and local ({@link ../storage/db}) sessions.
 */
import type { ActiveDtc } from '@/obd/dtc/monitor'
import type { DpfLatest } from '@/obd/dpf/analysis'
import type { CloudDtcEvent } from '@/obd/sync/cloudSessions'
import type { ChartMarker } from '@/lib/chartTooltip'
import { TimeSeries } from '@/lib/TimeSeries'

/** One reading, as carried by both a reassembled cloud drive and a local session. */
export interface ReviewSample {
  ts: number
  pidId: string
  value: number
}

/**
 * Reduce a full-resolution point list to at most `maxPoints` while always keeping
 * the first and last point, so a whole-drive chart stays smooth on mobile without
 * distorting its start/end. Uniform stride over the index range.
 */
function decimate<T>(points: readonly T[], maxPoints: number): T[] {
  const n = points.length
  if (n <= maxPoints || maxPoints < 2) return points.slice()
  const step = (n - 1) / (maxPoints - 1)
  const out: T[] = []
  let lastIdx = -1
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step)
    if (idx !== lastIdx) {
      out.push(points[idx]!)
      lastIdx = idx
    }
  }
  return out
}

/**
 * Group samples by PID into one {@link TimeSeries} each, in time order. Each
 * series' capacity is sized to its (decimated) point count so nothing is dropped —
 * unlike the live default cap, which would discard the *start* of a long drive.
 * Series longer than `maxPoints` are decimated (first/last preserved).
 */
export function buildReviewSeries(
  samples: readonly ReviewSample[],
  maxPoints = 2000,
): Map<string, TimeSeries> {
  const byPid = new Map<string, ReviewSample[]>()
  for (const s of samples) {
    let list = byPid.get(s.pidId)
    if (!list) {
      list = []
      byPid.set(s.pidId, list)
    }
    list.push(s)
  }

  const result = new Map<string, TimeSeries>()
  for (const [pidId, list] of byPid) {
    list.sort((a, b) => a.ts - b.ts)
    const points = decimate(list, maxPoints)
    const series = new TimeSeries(Math.max(1, points.length))
    for (const p of points) series.push(p.ts, p.value)
    result.set(pidId, series)
  }
  return result
}

/** Map stored DTC events onto the chart-marker shape (drops the extra fields). */
export function dtcEventsToMarkers(events: readonly CloudDtcEvent[]): ChartMarker[] {
  return events.map((e) => ({
    ts: e.ts,
    kind: e.kind,
    code: e.code,
    description: e.description,
  }))
}

/** Last value seen per PID over the drive (samples are time-ordered) — the DPF panel's snapshot. */
export function endStateSnapshot(samples: readonly ReviewSample[]): DpfLatest {
  const snapshot: Record<string, number> = {}
  for (const s of samples) snapshot[s.pidId] = s.value
  return snapshot
}

/**
 * Reconstruct the trouble codes that were still active at the end of the drive by
 * replaying its event log in time order: a code is added when it `appeared` and
 * removed when it `cleared` or was `manual-clear`ed.
 */
export function activeDtcsAtEnd(events: readonly CloudDtcEvent[]): ActiveDtc[] {
  const ordered = [...events].sort((a, b) => a.ts - b.ts)
  const active = new Map<string, ActiveDtc>()
  for (const e of ordered) {
    if (e.kind === 'appeared') {
      active.set(e.code, {
        code: e.code,
        status: e.status,
        system: e.system,
        manufacturerSpecific: e.manufacturerSpecific,
        description: e.description,
      })
    } else {
      active.delete(e.code)
    }
  }
  return Array.from(active.values())
}
