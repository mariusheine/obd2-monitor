import type { TimeSeries } from './TimeSeries'

/** A DTC state change to annotate on the timeline, on the same clock as samples. */
export interface ChartMarker {
  /** Epoch milliseconds. */
  ts: number
  kind: 'appeared' | 'cleared' | 'manual-clear'
  /** Trouble code, e.g. `P2002`, drawn as a label on the marker line. */
  code: string
  /** Human-readable fault description, shown in the hover tooltip when present. */
  description?: string
}

/** What the hover tooltip renders for the sample under the cursor. */
export interface TooltipModel {
  /** Epoch milliseconds of the hovered sample. */
  ts: number
  /** Decoded value at that sample. */
  value: number
  /** DTC events whose marker line sits within the pixel threshold of the cursor. */
  events: ChartMarker[]
}

/**
 * Build the hover-tooltip model for the sample at data index `idx`: its value
 * and timestamp, plus any DTC markers whose timestamp falls within
 * `intervalCount` PID poll intervals (`intervalMs`) of that sample — so hovering
 * at or near a marker reveals the code that appeared/cleared there. Both clocks
 * are epoch ms. Returns null when the index has no sample, so the caller hides
 * the tooltip.
 */
export function tooltipModelAt(
  series: TimeSeries,
  idx: number,
  markers: readonly ChartMarker[] | undefined,
  intervalMs: number,
  intervalCount = 3,
): TooltipModel | null {
  const ts = series.ts[idx]
  const value = series.values[idx]
  if (ts === undefined || value === undefined) return null
  const windowMs = intervalCount * intervalMs
  const events = markers?.filter((m) => Math.abs(m.ts - ts) <= windowMs) ?? []
  return { ts, value, events }
}

/** Formatting/color callbacks for {@link renderTooltipHtml}, supplied by the view (i18n, palette). */
export interface TooltipRenderOpts {
  unit: string
  /** Series color for the value line. */
  color: string
  /** Marker colors, keyed to match {@link ChartMarker.kind} (red appeared / green cleared). */
  appearedColor: string
  clearedColor: string
  /** Violet for a manual (Mode-04) clear; falls back to {@link clearedColor}. */
  manualClearColor?: string
  formatTime: (ts: number) => string
  formatValue: (value: number) => string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Render the tooltip body as an HTML string: the hovered time and value, then a
 * compact row per nearby DTC event (a color-coded dot — red appeared / green
 * cleared — and the code). Pure so it can be unit-tested; the caller injects it
 * into the uPlot overlay. All data-derived text is HTML-escaped.
 */
export function renderTooltipHtml(model: TooltipModel, opts: TooltipRenderOpts): string {
  const time = escapeHtml(opts.formatTime(model.ts))
  const value = escapeHtml(opts.formatValue(model.value))
  const unit = escapeHtml(opts.unit)
  const rows = model.events
    .map((e) => {
      const color =
        e.kind === 'appeared'
          ? opts.appearedColor
          : e.kind === 'manual-clear'
            ? (opts.manualClearColor ?? opts.clearedColor)
            : opts.clearedColor
      const code = escapeHtml(e.code)
      return (
        `<div class="chart-tt-dtc">` +
        `<span class="chart-tt-dot" style="background:${escapeHtml(color)}"></span>` +
        `<span class="chart-tt-code">${code}</span>` +
        `</div>`
      )
    })
    .join('')
  return (
    `<div class="chart-tt-time">${time}</div>` +
    `<div class="chart-tt-value" style="color:${escapeHtml(opts.color)}">` +
    `${value}<span class="chart-tt-unit">${unit ? ` ${unit}` : ''}</span></div>` +
    rows
  )
}
