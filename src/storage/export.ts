import type { SampleRow, SessionRow } from './db'

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

export function buildSessionJson(session: SessionRow, samples: readonly SampleRow[]): string {
  return JSON.stringify(
    {
      app: 'obd2-monitor',
      exportedAt: new Date().toISOString(),
      session,
      samples: samples.map((s) => ({ ts: s.ts, pidId: s.pidId, value: s.value })),
    },
    null,
    2,
  )
}

/** A filesystem-safe base filename for a session export. */
export function sessionFileBase(session: SessionRow): string {
  const date = new Date(session.startedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const label = session.label.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '')
  return `obd-${date}${label ? `-${label}` : ''}`
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
