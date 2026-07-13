import type { DtcEventRow, SampleRow, SessionRow } from './db'

/** The fields of a DTC event carried in a session export (local or cloud). */
export type ExportDtcEvent = Pick<
  DtcEventRow,
  'ts' | 'kind' | 'code' | 'status' | 'system' | 'manufacturerSpecific' | 'description'
>

export interface PidMeta {
  name: string
  unit: string
}

export type PidResolver = (pidId: string) => PidMeta | undefined

function csvField(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Long-format CSV: one row per sample. Long format survives PIDs sampled at
 * different rates and pivots cleanly in a spreadsheet.
 */
export function buildCsv(samples: readonly SampleRow[], resolve: PidResolver): string {
  const header = ['iso_time', 'epoch_ms', 'pid_id', 'pid_name', 'unit', 'value']
  const lines = [header.join(',')]
  for (const s of samples) {
    const meta = resolve(s.pidId)
    lines.push(
      [
        csvField(new Date(s.ts).toISOString()),
        csvField(s.ts),
        csvField(s.pidId),
        csvField(meta?.name ?? s.pidId),
        csvField(meta?.unit ?? ''),
        csvField(s.value),
      ].join(','),
    )
  }
  return lines.join('\n')
}

export function buildSessionJson(
  session: SessionRow,
  samples: readonly SampleRow[],
  dtcEvents: readonly ExportDtcEvent[] = [],
): string {
  return JSON.stringify(
    {
      app: 'obd2-monitor',
      exportedAt: new Date().toISOString(),
      session,
      samples: samples.map((s) => ({ ts: s.ts, pidId: s.pidId, value: s.value })),
      dtcEvents: dtcEvents.map((e) => ({
        ts: e.ts,
        kind: e.kind,
        code: e.code,
        status: e.status,
        system: e.system,
        manufacturerSpecific: e.manufacturerSpecific,
        description: e.description,
      })),
    },
    null,
    2,
  )
}

/** A filesystem-safe base filename for a session export, from its start time. */
export function sessionFileBase(session: Pick<SessionRow, 'startedAt'>): string {
  const date = new Date(session.startedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `obd-${date}`
}

/** Trigger a browser download of text content. Browser-only. */
export function downloadText(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
