import { defineStore } from 'pinia'
import { reactive, ref, shallowRef } from 'vue'

import { AcquisitionScheduler, type PollSpec } from '@/obd/acquisition/scheduler'
import { getPid } from '@/obd/pids/catalog'
import type { PidDefinition, Sample } from '@/obd/pids/types'
import type { Elm327 } from '@/obd/elm327/Elm327'
import { TimeSeries } from '@/lib/TimeSeries'

/**
 * Live acquisition state. Latest values feed gauges/cards (reactive); per-PID
 * {@link TimeSeries} histories feed charts (kept non-reactive for performance,
 * with a `revision` counter bumped on each sample so charts know to redraw).
 */
export const useLiveStore = defineStore('live', () => {
  const latest = reactive<Record<string, number>>({})
  const updatedAt = reactive<Record<string, number>>({})
  const polling = ref(false)
  const activePids = shallowRef<PidDefinition[]>([])
  const revision = ref(0)
  const errorCount = ref(0)

  const histories = new Map<string, TimeSeries>()
  const sampleListeners = new Set<(sample: Sample) => void>()
  let scheduler: AcquisitionScheduler | null = null
  let lastSpecs: readonly PollSpec[] = []

  /** Subscribe to every decoded sample (used by the session recorder). */
  function addSampleListener(listener: (sample: Sample) => void): () => void {
    sampleListeners.add(listener)
    return () => sampleListeners.delete(listener)
  }

  function history(pidId: string): TimeSeries {
    let series = histories.get(pidId)
    if (!series) {
      series = new TimeSeries()
      histories.set(pidId, series)
    }
    return series
  }

  function onSample(sample: Sample): void {
    latest[sample.pidId] = sample.value
    updatedAt[sample.pidId] = sample.ts
    history(sample.pidId).push(sample.ts, sample.value)
    revision.value++
    for (const listener of sampleListeners) listener(sample)
  }

  function start(elm: Elm327, specs: readonly PollSpec[]): void {
    stop()
    lastSpecs = specs
    const defs = specs
      .map((s) => getPid(s.pidId))
      .filter((p): p is PidDefinition => p !== undefined)
    activePids.value = defs
    for (const def of defs) history(def.id)

    scheduler = new AcquisitionScheduler(elm, {
      onSample,
      onError: () => {
        errorCount.value++
      },
    })
    scheduler.setPids(specs)
    scheduler.start()
    polling.value = true
  }

  function stop(): void {
    scheduler?.stop()
    scheduler = null
    polling.value = false
  }

  /** Restart polling with the most recent specs on a new ELM driver (after reconnect). */
  function resume(elm: Elm327): void {
    if (lastSpecs.length > 0) start(elm, lastSpecs)
  }

  function clearHistories(): void {
    for (const series of histories.values()) series.clear()
    revision.value++
  }

  return {
    latest,
    updatedAt,
    polling,
    activePids,
    revision,
    errorCount,
    history,
    addSampleListener,
    start,
    stop,
    resume,
    clearHistories,
  }
})
