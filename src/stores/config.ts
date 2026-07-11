import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import { DPF_PRESET_IDS, getPid } from '@/obd/pids/catalog'
import { buildPollSpecs, defaultPollMs, type PollSpec } from '@/obd/acquisition/scheduler'

const STORAGE_KEY = 'obd.config.pollSpecs.v1'

function isValidSpec(value: unknown): value is PollSpec {
  if (typeof value !== 'object' || value === null) return false
  const spec = value as Record<string, unknown>
  return (
    typeof spec.pidId === 'string' &&
    getPid(spec.pidId) !== undefined &&
    typeof spec.intervalMs === 'number' &&
    Number.isFinite(spec.intervalMs) &&
    spec.intervalMs > 0
  )
}

function loadSpecs(): PollSpec[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const valid = parsed.filter(isValidSpec)
    return valid.length > 0 ? valid : null
  } catch {
    return null
  }
}

/** User-configurable acquisition settings: which PIDs to poll and how often. */
export const useConfigStore = defineStore('config', () => {
  const specs = ref<PollSpec[]>(loadSpecs() ?? buildPollSpecs(DPF_PRESET_IDS))

  watch(
    specs,
    (value) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      } catch {
        // Storage may be unavailable (private mode); non-fatal.
      }
    },
    { deep: true },
  )

  function resetToDpfPreset(): void {
    specs.value = buildPollSpecs(DPF_PRESET_IDS)
  }

  function setInterval(pidId: string, intervalMs: number): void {
    const spec = specs.value.find((s) => s.pidId === pidId)
    if (spec) spec.intervalMs = intervalMs
  }

  function togglePid(pidId: string): void {
    const idx = specs.value.findIndex((s) => s.pidId === pidId)
    if (idx >= 0) {
      specs.value.splice(idx, 1)
    } else {
      const def = getPid(pidId)
      if (def) specs.value.push({ pidId, intervalMs: defaultPollMs(def.category) })
    }
  }

  return { specs, resetToDpfPreset, setInterval, togglePid }
})
