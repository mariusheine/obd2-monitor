<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    value?: number
    unit: string
    min: number
    max: number
    color: string
    experimental?: boolean
  }>(),
  { value: undefined, experimental: false },
)

const R = 52
const CX = 60
const CY = 64
const LEN = Math.PI * R
const bgPath = `M ${CX - R},${CY} A ${R},${R} 0 0 1 ${CX + R},${CY}`

const fraction = computed<number>(() => {
  if (props.value === undefined || props.max === props.min) return 0
  const f = (props.value - props.min) / (props.max - props.min)
  return Math.min(1, Math.max(0, f))
})

const dash = computed<string>(() => `${(fraction.value * LEN).toFixed(2)} ${LEN.toFixed(2)}`)

const valueText = computed<string>(() => {
  if (props.value === undefined) return '—'
  return Math.abs(props.value) >= 100 ? props.value.toFixed(0) : props.value.toFixed(1)
})
</script>

<template>
  <div class="gauge" :class="{ experimental }">
    <svg viewBox="0 0 120 74" class="gauge-svg" role="img" :aria-label="`${label}: ${valueText} ${unit}`">
      <path :d="bgPath" fill="none" stroke="var(--surface-2)" stroke-width="9" stroke-linecap="round" />
      <path
        :d="bgPath"
        fill="none"
        :stroke="color"
        stroke-width="9"
        stroke-linecap="round"
        :stroke-dasharray="dash"
      />
    </svg>
    <div class="gauge-value">{{ valueText }}<span class="gauge-unit">{{ unit }}</span></div>
    <div class="gauge-label">{{ label }}</div>
  </div>
</template>

<style scoped>
.gauge {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem 0.75rem 0.9rem;
  text-align: center;
}
.gauge.experimental {
  border-style: dashed;
  border-color: var(--warn);
}
.gauge-svg {
  width: 100%;
  height: auto;
  display: block;
}
.gauge-value {
  font-size: 1.6rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-top: -0.4rem;
}
.gauge-unit {
  font-size: 0.85rem;
  color: var(--text-dim);
  margin-left: 0.2rem;
}
.gauge-label {
  color: var(--text-dim);
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-top: 0.15rem;
}
</style>
