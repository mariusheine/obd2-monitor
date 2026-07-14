<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import GaugeDial from '@/components/GaugeDial.vue'
import TimeSeriesChart from '@/components/TimeSeriesChart.vue'
import ValueCard from '@/components/ValueCard.vue'
import { pidDesc, pidName, pidShort } from '@/i18n/labels'
import { pidColor } from '@/lib/palette'
import { defaultPollMs } from '@/obd/acquisition/scheduler'
import { analyseDpf, worstSeverity, type DpfSeverity } from '@/obd/dpf/analysis'
import { getPid } from '@/obd/pids/catalog'
import type { PidDefinition } from '@/obd/pids/types'
import { useConfigStore } from '@/stores/config'
import { useConnectionStore } from '@/stores/connection'
import { useDtcMonitorStore } from '@/stores/dtcMonitor'
import { useLiveStore } from '@/stores/live'
import { useSessionStore } from '@/stores/session'

const GAUGE_IDS = ['fiat.dpf.soot', 'fiat.dpf.egt']
const CARD_IDS = [
  'fiat.dpf.regenActive',
  'fiat.dpf.kmSinceRegen',
  'fiat.dpf.regenOk',
  'fiat.dpf.regenDisrupted',
  'fiat.dpf.regenRetried',
]
const CHART_IDS = ['fiat.dpf.soot', 'fiat.dpf.egt']

const conn = useConnectionStore()
const live = useLiveStore()
const config = useConfigStore()
const session = useSessionStore()
const dtcMonitor = useDtcMonitorStore()
const { t } = useI18n({ useScope: 'global' })
const { status, elm } = storeToRefs(conn)
const { latest, polling, revision } = storeToRefs(live)
const { recording } = storeToRefs(session)
const { active: dtcActive, recentEvents: dtcEvents } = storeToRefs(dtcMonitor)

const connected = computed(() => status.value === 'connected')

const resolve = (ids: string[]): PidDefinition[] =>
  ids.map((id) => getPid(id)).filter((p): p is PidDefinition => p !== undefined)
const gaugePids = resolve(GAUGE_IDS)
const cardPids = resolve(CARD_IDS)
const chartPids = resolve(CHART_IDS)

const findings = computed(() => analyseDpf(latest.value, dtcActive.value))
const overall = computed<DpfSeverity>(() => worstSeverity(findings.value))
const hasData = computed(() => findings.value.length > 0)

const STATUS_ICON: Record<DpfSeverity, string> = { ok: '✓', info: 'ℹ', warn: '⚠', crit: '⛔' }

function intervalFor(p: PidDefinition): number {
  return config.specs.find((s) => s.pidId === p.id)?.intervalMs ?? defaultPollMs(p.category)
}

function displayFor(p: PidDefinition): { display: string; unit: string; highlight: boolean } {
  const v = latest.value[p.id]
  if (v === undefined) return { display: '—', unit: p.unit, highlight: false }
  if (p.unit === 'bool')
    return { display: v >= 0.5 ? t('units.on') : t('units.off'), unit: '', highlight: v >= 0.5 }
  const display = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)
  return { display, unit: p.unit, highlight: false }
}

function startPolling(): void {
  if (elm.value && !polling.value) live.start(elm.value, config.specs)
}

onMounted(() => {
  if (connected.value && !polling.value) startPolling()
})
onBeforeUnmount(() => {
  // Keep polling if a recording is in progress so leaving doesn't stop the log.
  if (!recording.value) live.stop()
})
</script>

<template>
  <div class="stack">
    <i18n-t
      v-if="!connected"
      keypath="dpf.notConnected"
      scope="global"
      tag="div"
      class="banner warn"
    >
      <template #link>
        <RouterLink to="/connect">{{ t('dpf.connectLink') }}</RouterLink>
      </template>
    </i18n-t>

    <template v-else>
      <div class="banner warn">{{ t('dpf.experimental') }}</div>

      <section class="card stack">
        <div class="row" style="justify-content: space-between; align-items: center">
          <strong>{{ t('dpf.findingsTitle') }}</strong>
          <span class="status-badge" :class="overall">
            {{ STATUS_ICON[overall] }} {{ t(`dpf.status.${overall}`) }}
          </span>
        </div>
        <p v-if="!hasData" class="muted">{{ t('dpf.noData') }}</p>
        <ul v-else class="findings">
          <li v-for="f in findings" :key="f.id" class="finding" :class="f.severity">
            <span class="finding-icon" aria-hidden="true">{{ STATUS_ICON[f.severity] }}</span>
            <span>{{ t(f.messageKey, f.params ?? {}) }}</span>
          </li>
        </ul>
      </section>

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

      <section v-if="chartPids.length" class="stack">
        <strong>{{ t('dpf.trendsTitle') }}</strong>
        <div class="chart-grid">
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
        </div>
      </section>
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
.findings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.finding {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  padding: 0.5rem 0.7rem;
  border-radius: 8px;
  background: var(--surface-2);
  border-left: 3px solid var(--border);
}
.finding-icon {
  line-height: 1.4;
}
.finding.ok {
  border-left-color: #22c55e;
}
.finding.info {
  border-left-color: #38bdf8;
}
.finding.warn {
  border-left-color: #fbbf24;
}
.finding.crit {
  border-left-color: var(--danger);
}
.status-badge {
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  white-space: nowrap;
  border: 1px solid var(--border);
}
.status-badge.ok {
  color: #86efac;
}
.status-badge.info {
  color: #7dd3fc;
}
.status-badge.warn {
  color: #fbbf24;
}
.status-badge.crit {
  color: #fca5a5;
}
</style>
