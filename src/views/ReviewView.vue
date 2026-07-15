<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

import TimeSeriesChart from '@/components/TimeSeriesChart.vue'
import { dtcEventIcon, dtcEventLabel, pidName } from '@/i18n/labels'
import { CHART_MARKER, pidColor } from '@/lib/palette'
import type { ChartMarker } from '@/lib/chartTooltip'
import type { TimeSeries } from '@/lib/TimeSeries'
import {
  activeDtcsAtEnd,
  buildReviewSeries,
  dtcEventsToMarkers,
  endStateSnapshot,
  type ReviewSample,
} from '@/lib/reviewSession'
import { defaultPollMs } from '@/obd/acquisition/scheduler'
import { analyseDpf, worstSeverity, type DpfFinding, type DpfSeverity } from '@/obd/dpf/analysis'
import { getPid } from '@/obd/pids/catalog'
import type { PidDefinition } from '@/obd/pids/types'
import { sessionFolderName, SyncError } from '@/obd/sync/nextcloud'
import type { CloudDtcEvent } from '@/obd/sync/cloudSessions'
import { db, sessionDtcEvents, sessionSamples } from '@/storage/db'
import { useSyncStore } from '@/stores/sync'

/** The order featured PIDs appear in, mirroring the Live dashboard. */
const CHART_ORDER = ['std.rpm', 'std.speed', 'fiat.dpf.egt', 'fiat.dpf.soot', 'std.coolantTemp']

/** A normalized drive, from either a reassembled cloud folder or a local session. */
interface ReviewSource {
  startedAt: number
  endedAt: number | null
  transportKind: string
  pidIds: string[]
  device: string
  samples: ReviewSample[]
  dtcEvents: CloudDtcEvent[]
}

const route = useRoute()
const sync = useSyncStore()
const { t, locale } = useI18n({ useScope: 'global' })

const loading = ref(true)
const errored = ref(false)
const notFound = ref(false)

const header = ref<{
  startedAt: number
  endedAt: number | null
  transportKind: string
  pidCount: number
  sampleCount: number
  device: string
} | null>(null)
const series = shallowRef<Map<string, TimeSeries>>(new Map())
const markers = shallowRef<ChartMarker[]>([])
const events = shallowRef<CloudDtcEvent[]>([])
const findings = ref<DpfFinding[]>([])

const STATUS_ICON: Record<DpfSeverity, string> = { ok: '✓', info: 'ℹ', warn: '⚠', crit: '⛔' }
const overall = computed<DpfSeverity>(() => worstSeverity(findings.value))
const hasDpf = computed(() => findings.value.length > 0)

const charts = computed<{ pid: PidDefinition; series: TimeSeries }[]>(() => {
  const rank = (id: string): number => {
    const i = CHART_ORDER.indexOf(id)
    return i === -1 ? CHART_ORDER.length + 1 : i
  }
  const pairs: { pid: PidDefinition; series: TimeSeries }[] = []
  for (const [pidId, s] of series.value) {
    const def = getPid(pidId)
    if (def) pairs.push({ pid: def, series: s })
  }
  pairs.sort((a, b) => rank(a.pid.id) - rank(b.pid.id))
  return pairs
})

function build(src: ReviewSource): void {
  series.value = buildReviewSeries(src.samples)
  markers.value = dtcEventsToMarkers(src.dtcEvents)
  events.value = src.dtcEvents
  findings.value = analyseDpf(endStateSnapshot(src.samples), activeDtcsAtEnd(src.dtcEvents))
  header.value = {
    startedAt: src.startedAt,
    endedAt: src.endedAt,
    transportKind: src.transportKind,
    pidCount: src.pidIds.length,
    sampleCount: src.samples.length,
    device: src.device,
  }
}

/** The still-existing local session whose folder matches, or undefined. */
async function findLocal(folderName: string): Promise<ReviewSource | undefined> {
  const s = (await db.sessions.toArray()).find((row) => sessionFolderName(row) === folderName)
  if (!s) return undefined
  return {
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    transportKind: s.transportKind,
    pidIds: s.pidIds,
    device: '',
    samples: await sessionSamples(s.id),
    dtcEvents: await sessionDtcEvents(s.id),
  }
}

async function load(): Promise<void> {
  const folderName = String(route.params.folderName ?? '')
  // A drive with a cloud folder is the source of truth (its local samples were
  // reclaimed after upload), so prefer the cloud; fall back to a local-only drive.
  if (sync.active) {
    try {
      const r = await sync.fetchCloud(folderName)
      build({ ...r })
      return
    } catch (err) {
      // A never-synced local drive has no cloud folder — fall through to local.
      if (!(err instanceof SyncError && err.kind === 'notfound')) errored.value = true
    }
  }
  const local = await findLocal(folderName)
  if (local) {
    errored.value = false
    build(local)
    return
  }
  if (!errored.value) notFound.value = true
}

function transportLabel(kind: string): string {
  return kind === 'ble' ? t('sessions.transport.ble') : t('sessions.transport.mock')
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(locale.value)
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(locale.value)
}

function fmtDuration(startedAt: number, endedAt: number): string {
  const total = Math.max(0, Math.floor((endedAt - startedAt) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`
}

const metaLine = computed<string>(() => {
  const h = header.value
  if (!h) return ''
  return t('review.meta', {
    duration: fmtDuration(h.startedAt, h.endedAt ?? h.startedAt),
    samples: h.sampleCount.toLocaleString(locale.value),
    pids: h.pidCount,
    transport: transportLabel(h.transportKind),
  })
})

function intervalFor(p: PidDefinition): number {
  return defaultPollMs(p.category)
}

onMounted(async () => {
  try {
    await load()
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="stack">
    <RouterLink to="/sessions" class="muted back">{{ t('review.back') }}</RouterLink>

    <div v-if="loading" class="banner">{{ t('review.loading') }}</div>
    <div v-else-if="errored" class="banner warn">{{ t('review.error') }}</div>
    <div v-else-if="notFound" class="banner warn">{{ t('review.notFound') }}</div>

    <template v-else-if="header">
      <section class="card stack" style="gap: 0.35rem">
        <strong>{{ fmtDate(header.startedAt) }}</strong>
        <span class="muted">{{ metaLine }}</span>
        <span v-if="header.device" class="muted">{{
          t('review.device', { device: header.device })
        }}</span>
      </section>

      <section class="card stack">
        <div class="row" style="justify-content: space-between; align-items: center">
          <strong>{{ t('dpf.findingsTitle') }}</strong>
          <span class="status-badge" :class="overall">
            {{ STATUS_ICON[overall] }} {{ t(`dpf.status.${overall}`) }}
          </span>
        </div>
        <p v-if="!hasDpf" class="muted">{{ t('review.noDpf') }}</p>
        <ul v-else class="findings">
          <li v-for="f in findings" :key="f.id" class="finding" :class="f.severity">
            <span class="finding-icon" aria-hidden="true">{{ STATUS_ICON[f.severity] }}</span>
            <span>{{ t(f.messageKey, f.params ?? {}) }}</span>
          </li>
        </ul>
        <p class="muted small">{{ t('dpf.experimental') }}</p>
      </section>

      <section v-if="charts.length" class="stack">
        <strong>{{ t('review.chartsTitle') }}</strong>
        <div class="chart-grid">
          <TimeSeriesChart
            v-for="c in charts"
            :key="c.pid.id"
            :series="c.series"
            :revision="1"
            :label="pidName(c.pid)"
            :unit="c.pid.unit"
            :color="pidColor(c.pid)"
            :interval-ms="intervalFor(c.pid)"
            :markers="markers"
          />
        </div>
        <p v-if="markers.length" class="dtc-legend muted">
          {{ t('live.dtcMarkerLegend') }}
          <span class="swatch" :style="{ background: CHART_MARKER.appeared }"></span>
          {{ t('live.dtcMarkerAppeared') }}
          <span class="swatch" :style="{ background: CHART_MARKER.cleared }"></span>
          {{ t('live.dtcMarkerCleared') }}
          <span class="swatch" :style="{ background: CHART_MARKER['manual-clear'] }"></span>
          {{ t('live.dtcMarkerManualCleared') }}
        </p>
      </section>
      <p v-else class="muted">{{ t('review.noCharts') }}</p>

      <section v-if="events.length" class="card stack">
        <strong>{{ t('review.dtcTimeline') }}</strong>
        <ul class="event-list">
          <li v-for="(ev, i) in events" :key="`${i}-${ev.ts}-${ev.code}`" class="event-row">
            <span class="event-kind" :class="ev.kind">{{ dtcEventIcon(ev.kind) }}</span>
            <span class="event-code">{{ ev.code }}</span>
            <span class="muted event-tags">{{ dtcEventLabel(ev.kind) }} · {{ fmtTime(ev.ts) }}</span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.back {
  align-self: flex-start;
  text-decoration: none;
}
.chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.75rem;
}
.small {
  font-size: 0.8rem;
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
.event-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.event-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.85rem;
}
.event-kind.appeared {
  color: #fbbf24;
}
.event-kind.cleared {
  color: #86efac;
}
.event-kind.manual-clear {
  color: #c4b5fd;
}
.event-code {
  font-family: ui-monospace, monospace;
  font-weight: 700;
}
.event-tags {
  font-size: 0.8rem;
}
</style>
