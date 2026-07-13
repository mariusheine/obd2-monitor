<script setup lang="ts">
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { CHART_INK, CHART_MARKER } from '@/lib/palette'
import type { TimeSeries } from '@/lib/TimeSeries'

/** A DTC state change to annotate on the timeline, on the same clock as samples. */
export interface ChartMarker {
  /** Epoch milliseconds. */
  ts: number
  kind: 'appeared' | 'cleared'
  /** Trouble code, e.g. `P2002`, drawn as a label on the marker line. */
  code: string
}

const props = defineProps<{
  series: TimeSeries
  revision: number
  label: string
  unit: string
  color: string
  min?: number
  max?: number
  markers?: readonly ChartMarker[]
}>()

const CHART_HEIGHT = 150
const container = ref<HTMLDivElement | null>(null)
let chart: uPlot | null = null
let resizeObserver: ResizeObserver | null = null
let rafId = 0

const lastText = computed<string>(() => {
  void props.revision // re-evaluate whenever a new sample arrives
  const v = props.series.last()
  if (v === undefined) return '—'
  const rounded = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)
  return `${rounded} ${props.unit}`
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
    const color = m.kind === 'appeared' ? CHART_MARKER.appeared : CHART_MARKER.cleared
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
    plugins: [{ hooks: { draw: drawMarkers } }],
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
  chart?.destroy()
  chart = null
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
