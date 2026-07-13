<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import GaugeDial from '@/components/GaugeDial.vue'
import TimeSeriesChart from '@/components/TimeSeriesChart.vue'
import ValueCard from '@/components/ValueCard.vue'
import { pidDesc, pidName, pidShort } from '@/i18n/labels'
import { CHART_MARKER, pidColor } from '@/lib/palette'
import { defaultPollMs } from '@/obd/acquisition/scheduler'
import type { PidDefinition } from '@/obd/pids/types'
import { useConfigStore } from '@/stores/config'
import { useConnectionStore } from '@/stores/connection'
import { useDtcMonitorStore } from '@/stores/dtcMonitor'
import { useLiveStore } from '@/stores/live'
import { useSessionStore } from '@/stores/session'

const GAUGE_IDS = ['std.rpm', 'std.speed', 'fiat.dpf.soot', 'fiat.dpf.egt']
const CHART_IDS = ['std.rpm', 'std.speed', 'fiat.dpf.egt', 'fiat.dpf.soot', 'std.coolantTemp']

const conn = useConnectionStore()
const live = useLiveStore()
const config = useConfigStore()
const session = useSessionStore()
const dtcMonitor = useDtcMonitorStore()
const { t, locale } = useI18n({ useScope: 'global' })
const { status, elm } = storeToRefs(conn)
const { latest, polling, activePids, revision, errorCount } = storeToRefs(live)
const { recording, sampleCount, startedAt } = storeToRefs(session)
const { active: dtcActive, recentEvents: dtcEvents } = storeToRefs(dtcMonitor)

const connected = computed(() => status.value === 'connected')

/** Human text for the most recent DTC transition, e.g. "P2002 appeared 14:31". */
const latestDtc = computed<string | null>(() => {
  const e = dtcEvents.value[0]
  if (!e) return null
  const time = new Date(e.ts).toLocaleTimeString(locale.value)
  const key = e.kind === 'appeared' ? 'live.dtcLatestAppeared' : 'live.dtcLatestCleared'
  return t(key, { code: e.code, time })
})

const orderBy = (ids: string[]) => (a: PidDefinition, b: PidDefinition) =>
  ids.indexOf(a.id) - ids.indexOf(b.id)

const gaugePids = computed(() =>
  activePids.value.filter((p) => GAUGE_IDS.includes(p.id)).sort(orderBy(GAUGE_IDS)),
)
const chartPids = computed(() =>
  activePids.value.filter((p) => CHART_IDS.includes(p.id)).sort(orderBy(CHART_IDS)),
)
const cardPids = computed(() => activePids.value.filter((p) => !GAUGE_IDS.includes(p.id)))

/** This PID's configured poll interval (ms), for the chart's DTC-in-tooltip window. */
function intervalFor(p: PidDefinition): number {
  return config.specs.find((s) => s.pidId === p.id)?.intervalMs ?? defaultPollMs(p.category)
}

const nowTick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | undefined

const elapsed = computed<string>(() => {
  if (!recording.value || startedAt.value === null) return ''
  const total = Math.max(0, Math.floor((nowTick.value - startedAt.value) / 1000))
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
})

function startPolling(): void {
  if (elm.value) live.start(elm.value, config.specs)
}

function displayFor(p: PidDefinition): { display: string; unit: string; highlight: boolean } {
  const v = latest.value[p.id]
  if (v === undefined) return { display: '—', unit: p.unit, highlight: false }
  if (p.unit === 'bool')
    return { display: v >= 0.5 ? t('units.on') : t('units.off'), unit: '', highlight: v >= 0.5 }
  const display = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)
  return { display, unit: p.unit, highlight: false }
}

onMounted(() => {
  if (connected.value && !polling.value) startPolling()
  tickTimer = setInterval(() => (nowTick.value = Date.now()), 1000)
})
onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer)
  // Keep polling if a recording is in progress so switching views doesn't stop the log.
  if (!recording.value) live.stop()
})
</script>

<template>
  <div class="stack">
    <i18n-t v-if="!connected" keypath="live.notConnected" scope="global" tag="div" class="banner warn">
      <template #link>
        <RouterLink to="/connect">{{ t('live.connectLink') }}</RouterLink>
      </template>
    </i18n-t>

    <template v-else>
      <div class="row">
        <button v-if="!polling" class="primary" @click="startPolling">
          {{ t('live.startPolling') }}
        </button>
        <button v-else class="rec-btn" @click="conn.disconnect()">{{ t('live.stop') }}</button>
        <button @click="live.clearHistories()">{{ t('live.clearCharts') }}</button>
        <RouterLink to="/sessions" class="muted">{{ t('live.sessionsLink') }}</RouterLink>
      </div>

      <div class="row status-line">
        <span v-if="recording" class="rec-indicator">
          <span class="rec-dot"></span>{{ t('live.recording', { elapsed, count: sampleCount }) }}
        </span>
        <span class="muted">{{ t('live.pidsCount', { count: activePids.length }) }}</span>
        <span v-if="errorCount > 0" class="muted">{{
          t('live.readErrors', { count: errorCount })
        }}</span>
      </div>

      <div v-if="recording" class="row status-line">
        <span class="dtc-watch" :class="{ alert: dtcActive.length > 0 }">
          {{
            dtcActive.length > 0
              ? t('live.dtcWatchActive', dtcActive.length)
              : t('live.dtcWatchClear')
          }}
          <span v-if="latestDtc" class="muted">· {{ latestDtc }}</span>
        </span>
      </div>

      <section v-if="gaugePids.length" class="gauge-grid">
        <GaugeDial
          v-for="p in gaugePids"
          :key="p.id"
          :label="pidShort(p)"
          :name="pidName(p)"
          :description="pidDesc(p)"
          :value="latest[p.id]"
          :unit="p.unit"
          :min="p.min"
          :max="p.max"
          :color="pidColor(p)"
          :experimental="p.experimental"
        />
      </section>

      <section v-if="chartPids.length" class="chart-grid">
        <TimeSeriesChart
          v-for="p in chartPids"
          :key="p.id"
          :series="live.history(p.id)"
          :revision="revision"
          :label="pidName(p)"
          :unit="p.unit"
          :color="pidColor(p)"
          :interval-ms="intervalFor(p)"
          :markers="dtcEvents"
        />
      </section>

      <p v-if="dtcEvents.length" class="dtc-legend muted">
        {{ t('live.dtcMarkerLegend') }}
        <span class="swatch" :style="{ background: CHART_MARKER.appeared }"></span>
        {{ t('live.dtcMarkerAppeared') }}
        <span class="swatch" :style="{ background: CHART_MARKER.cleared }"></span>
        {{ t('live.dtcMarkerCleared') }}
      </p>

      <section v-if="cardPids.length" class="value-grid">
        <ValueCard
          v-for="p in cardPids"
          :key="p.id"
          :label="pidShort(p)"
          :name="pidName(p)"
          :description="pidDesc(p)"
          v-bind="displayFor(p)"
          :experimental="p.experimental"
        />
      </section>

      <i18n-t
        v-if="activePids.some((p) => p.experimental)"
        keypath="live.experimental"
        scope="global"
        tag="p"
        class="muted"
      >
        <template #term>
          <strong>{{ t('live.experimentalTerm') }}</strong>
        </template>
      </i18n-t>
    </template>
  </div>
</template>

<style scoped>
.gauge-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.75rem;
}
.chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.75rem;
}
.status-line {
  min-height: 1.2rem;
}
.dtc-legend {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
  margin-top: -0.25rem;
}
.dtc-legend .swatch {
  display: inline-block;
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 2px;
}
.dtc-legend .swatch + span,
.dtc-legend span + .swatch {
  margin-left: 0.15rem;
}
.rec-btn {
  border-color: var(--danger);
  color: #fca5a5;
}
.rec-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: #fca5a5;
  font-weight: 600;
}
.dtc-watch {
  font-size: 0.9rem;
  color: var(--text-2, #9ca3af);
}
.dtc-watch.alert {
  color: #fbbf24;
  font-weight: 600;
}
.rec-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--danger);
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
@media (prefers-reduced-motion: reduce) {
  .rec-dot {
    animation: none;
  }
}
</style>
