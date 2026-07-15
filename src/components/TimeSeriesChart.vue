<script setup lang="ts">
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { CHART_INK, CHART_MARKER } from '@/lib/palette'
import {
  renderTooltipHtml,
  tooltipModelAt,
  type ChartMarker,
} from '@/lib/chartTooltip'
import type { TimeSeries } from '@/lib/TimeSeries'

export type { ChartMarker }

const props = defineProps<{
  series: TimeSeries
  revision: number
  label: string
  unit: string
  color: string
  min?: number
  max?: number
  markers?: readonly ChartMarker[]
  /** This PID's poll interval (ms); the tooltip surfaces DTC events within 2 of these. */
  intervalMs: number
}>()

const CHART_HEIGHT = 150
const container = ref<HTMLDivElement | null>(null)
let chart: uPlot | null = null
let resizeObserver: ResizeObserver | null = null
let rafId = 0
/** HTML tooltip appended to the uPlot overlay on init; shown while hovering a point. */
let tooltip: HTMLDivElement | null = null

const { locale } = useI18n({ useScope: 'global' })

/** Same rounding the header uses, shared with the hover tooltip. */
function formatValue(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)
}

const lastText = computed<string>(() => {
  void props.revision // re-evaluate whenever a new sample arrives
  const v = props.series.last()
  if (v === undefined) return '—'
  return `${formatValue(v)} ${props.unit}`
})

function buildData(): uPlot.AlignedData {
  // uPlot time scale expects UNIX seconds.
  const xs = props.series.ts.map((t) => t / 1000)
  return [xs, props.series.values.slice()]
}

/**
 * Draw the DTC event markers as vertical dashed lines over the plot, colored by
 * kind (red = appeared, green = cleared) with the code labelled up the line.
 * Runs in uPlot's `draw` hook so it repaints with every redraw; positions come
 * from `valToPos` on the x (time) scale, and everything is clipped to the plot
 * box and skipped when the marker falls outside the visible time window.
 */
function drawMarkers(u: uPlot): void {
  const markers = props.markers
  if (!markers || markers.length === 0) return
  const xMin = u.scales.x?.min
  const xMax = u.scales.x?.max
  if (xMin == null || xMax == null) return

  const { ctx } = u
  const { left, top, width, height } = u.bbox
  const pr = uPlot.pxRatio ?? 1 // canvas is scaled by the device pixel ratio
  ctx.save()
  ctx.beginPath()
  ctx.rect(left, top, width, height)
  ctx.clip()
  ctx.lineWidth = Math.max(1, Math.round(pr))
  ctx.font = `${11 * pr}px system-ui, sans-serif`
  for (const m of markers) {
    const xval = m.ts / 1000 // x scale is in UNIX seconds (see buildData)
    if (xval < xMin || xval > xMax) continue
    const x = Math.round(u.valToPos(xval, 'x', true)) + 0.5
    const color = CHART_MARKER[m.kind]
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.setLineDash([4 * pr, 3 * pr])
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, top + height)
    ctx.stroke()
    // Code label reading upward alongside the line, anchored near the bottom.
    ctx.setLineDash([])
    ctx.save()
    ctx.translate(x + 3 * pr, top + height - 4 * pr)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText(m.code, 0, 0)
    ctx.restore()
  }
  ctx.restore()
}

/** Create the hover-tooltip element and park it in the plot overlay (hidden). */
function initTooltip(u: uPlot): void {
  const el = document.createElement('div')
  el.className = 'chart-tooltip'
  el.style.display = 'none'
  u.over.appendChild(el)
  tooltip = el
}

/**
 * On every cursor move, show the value + timestamp of the sample nearest the
 * cursor and any DTC events whose marker line is right there. uPlot gives us the
 * closest data index (`cursor.idx`) and the cursor's pixel position relative to
 * the plot area; `valToPos` maps marker times into that same space so we can
 * pixel-match them. The tooltip is hidden when the cursor leaves the plot.
 */
function updateTooltip(u: uPlot): void {
  const el = tooltip
  if (!el) return
  const idx = u.cursor.idx
  const left = u.cursor.left ?? -1
  if (idx == null || left < 0) {
    el.style.display = 'none'
    return
  }
  const model = tooltipModelAt(props.series, idx, props.markers, props.intervalMs, 3)
  if (!model) {
    el.style.display = 'none'
    return
  }
  el.innerHTML = renderTooltipHtml(model, {
    unit: props.unit,
    color: props.color,
    appearedColor: CHART_MARKER.appeared,
    clearedColor: CHART_MARKER.cleared,
    manualClearColor: CHART_MARKER['manual-clear'],
    formatValue,
    formatTime: (ts) => new Date(ts).toLocaleTimeString(locale.value),
  })
  el.style.display = 'block'
  positionTooltip(u, el, left, u.cursor.top ?? 0)
}

/**
 * Place the tooltip next to the cursor, clamped inside the plot overlay (which
 * clips overflow): prefer above-right, flip when it would spill past an edge.
 */
function positionTooltip(u: uPlot, el: HTMLDivElement, left: number, top: number): void {
  const pad = 8
  const overW = u.over.clientWidth
  const overH = u.over.clientHeight
  const w = el.offsetWidth
  const h = el.offsetHeight
  let x = left + pad
  if (x + w > overW) x = left - pad - w
  x = Math.max(0, Math.min(x, Math.max(0, overW - w)))
  let y = top - h - pad
  if (y < 0) y = top + pad
  y = Math.max(0, Math.min(y, Math.max(0, overH - h)))
  el.style.transform = `translate(${x}px, ${y}px)`
}

function makeOptions(width: number): uPlot.Options {
  const axisStyle = {
    stroke: CHART_INK.axis,
    grid: { stroke: CHART_INK.grid, width: 1 },
    ticks: { stroke: CHART_INK.grid, width: 1 },
    font: '11px system-ui, sans-serif',
  }
  const yScale: uPlot.Scale =
    props.min !== undefined && props.max !== undefined
      ? { range: [props.min, props.max] }
      : {}
  return {
    width,
    height: CHART_HEIGHT,
    legend: { show: false },
    cursor: { y: false, points: { size: 7 } },
    scales: { x: { time: true }, y: yScale },
    axes: [
      { ...axisStyle, size: 28 },
      { ...axisStyle, size: 42 },
    ],
    series: [
      {},
      { label: props.label, stroke: props.color, width: 2, points: { show: false } },
    ],
    plugins: [
      { hooks: { init: initTooltip, setCursor: updateTooltip, draw: drawMarkers } },
    ],
  }
}

function draw(): void {
  chart?.setData(buildData())
}

function scheduleDraw(): void {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    draw()
  })
}

onMounted(() => {
  const el = container.value
  if (!el) return
  const width = el.clientWidth || 320
  chart = new uPlot(makeOptions(width), buildData(), el)
  resizeObserver = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width
    if (w && chart) chart.setSize({ width: w, height: CHART_HEIGHT })
  })
  resizeObserver.observe(el)
})

watch(() => props.revision, scheduleDraw)
// A new/removed DTC event should repaint the markers even without a fresh sample.
watch(() => props.markers, scheduleDraw)

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  resizeObserver?.disconnect()
  chart?.destroy() // removes the overlay (and the tooltip child) from the DOM
  chart = null
  tooltip = null
})
</script>

<template>
  <div class="chart-card">
    <div class="chart-head">
      <span class="chart-title">{{ label }}</span>
      <span class="chart-last" :style="{ color }">{{ lastText }}</span>
    </div>
    <div ref="container" class="chart-body"></div>
  </div>
</template>

<style scoped>
.chart-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
}
.chart-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}
.chart-title {
  color: var(--text-dim);
  font-size: 0.85rem;
}
.chart-last {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.chart-body {
  width: 100%;
  height: 150px;
}
</style>

<!-- Non-scoped: the tooltip is created imperatively inside the uPlot overlay, so
     it never carries this SFC's scope attribute. Classes are prefixed to stay
     out of the global namespace. -->
<style>
.chart-tooltip {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 10;
  pointer-events: none;
  min-width: 4rem;
  max-width: 15rem;
  padding: 0.35rem 0.5rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  font-size: 0.75rem;
  line-height: 1.3;
  white-space: nowrap;
}
.chart-tooltip .chart-tt-time {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.chart-tooltip .chart-tt-value {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.chart-tooltip .chart-tt-unit {
  font-weight: 400;
  color: var(--text-dim);
}
.chart-tooltip .chart-tt-dtc {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.25rem;
}
.chart-tooltip .chart-tt-dot {
  flex: none;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
}
.chart-tooltip .chart-tt-code {
  font-weight: 600;
  color: var(--text);
}
</style>
