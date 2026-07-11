<script setup lang="ts">
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { CHART_INK } from '@/lib/palette'
import type { TimeSeries } from '@/lib/TimeSeries'

const props = defineProps<{
  series: TimeSeries
  revision: number
  label: string
  unit: string
  color: string
  min?: number
  max?: number
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
