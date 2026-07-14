<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { dtcDescription, dtcEventIcon, dtcEventLabel, dtcSystemLabel } from '@/i18n/labels'
import type { Dtc } from '@/obd/dtc/decode'
import type { ActiveDtc } from '@/obd/dtc/monitor'
import { useConnectionStore } from '@/stores/connection'
import { useDtcStore } from '@/stores/dtc'
import { useDtcMonitorStore } from '@/stores/dtcMonitor'

const conn = useConnectionStore()
const dtc = useDtcStore()
const monitor = useDtcMonitorStore()
const { t, locale } = useI18n({ useScope: 'global' })
const { status, elm } = storeToRefs(conn)
const { stored, pending, permanent, loading, clearing, error, hasRead, lastReadAt, total } =
  storeToRefs(dtc)
const { active, recentEvents, lastPollAt, lastError, monitoring } = storeToRefs(monitor)

const connected = computed(() => status.value === 'connected')

// While a drive is recording the DTC monitor polls continuously, so the page
// reflects its live `active` set (auto-updating); otherwise it falls back to a
// manual one-shot read.
const grouped = computed<Record<ActiveDtc['status'], ActiveDtc[]>>(() => {
  const g: Record<ActiveDtc['status'], ActiveDtc[]> = { stored: [], pending: [], permanent: [] }
  for (const d of active.value) g[d.status].push(d)
  return g
})

const showData = computed(() => monitoring.value || hasRead.value)

interface Section {
  key: 'stored' | 'pending' | 'permanent'
  title: string
  codes: (Dtc | ActiveDtc)[]
  note: string
}
const sections = computed<Section[]>(() => {
  const src = monitoring.value
    ? grouped.value
    : { stored: stored.value, pending: pending.value, permanent: permanent.value }
  return [
    { key: 'stored', title: t('dtc.sections.storedTitle'), codes: src.stored, note: t('dtc.sections.storedNote') },
    { key: 'pending', title: t('dtc.sections.pendingTitle'), codes: src.pending, note: t('dtc.sections.pendingNote') },
    { key: 'permanent', title: t('dtc.sections.permanentTitle'), codes: src.permanent, note: t('dtc.sections.permanentNote') },
  ]
})

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(locale.value)
}

function readCodes(): void {
  if (elm.value) void dtc.readAll(elm.value)
}

function clearCodes(): void {
  if (!elm.value) return
  if (confirm(t('dtc.clearConfirm'))) void dtc.clear(elm.value)
}
</script>

<template>
  <div class="stack">
    <i18n-t v-if="!connected" keypath="dtc.notConnected" scope="global" tag="div" class="banner warn">
      <template #link>
        <RouterLink to="/connect">{{ t('dtc.connectLink') }}</RouterLink>
      </template>
    </i18n-t>

    <template v-else>
      <div class="row">
        <span v-if="monitoring" class="live-indicator">
          <span class="live-dot"></span>{{ t('dtc.live') }}
        </span>
        <button v-else class="primary" :disabled="loading" @click="readCodes">
          {{ loading ? t('dtc.reading') : t('dtc.readCodes') }}
        </button>
        <button v-if="showData" class="rec-btn" :disabled="clearing" @click="clearCodes">
          {{ clearing ? t('dtc.clearing') : t('dtc.clearCodes') }}
        </button>
        <span v-if="monitoring" class="muted">
          {{ t('dtc.codeCount', active.length) }}<template v-if="lastPollAt">
            · {{ t('dtc.updatedAt', { time: fmtTime(lastPollAt) }) }}</template>
        </span>
        <span v-else-if="lastReadAt" class="muted">
          {{ t('dtc.codeCount', total) }} · {{ t('dtc.readAt', { time: fmtTime(lastReadAt) }) }}
        </span>
      </div>

      <div v-if="error || lastError" class="banner danger">{{ error || lastError }}</div>

      <div v-if="!showData" class="card muted">
        {{ t('dtc.intro') }}
      </div>

      <template v-else>
        <section v-if="recentEvents.length" class="card stack">
          <div class="row" style="justify-content: space-between">
            <strong>{{ t('dtc.recentTitle') }}</strong>
            <span class="muted">{{ recentEvents.length }}</span>
          </div>
          <p class="muted section-note">{{ t('dtc.recentNote') }}</p>
          <ul class="dtc-list">
            <li v-for="(e, i) in recentEvents" :key="`${i}-${e.ts}-${e.code}`" class="dtc-row">
              <span class="event-kind" :class="e.kind">{{ dtcEventIcon(e.kind) }}</span>
              <span class="dtc-code" :class="`sys-${e.system}`">{{ e.code }}</span>
              <div class="dtc-info">
                <div>{{ dtcDescription(e.code, e.description) }}</div>
                <div class="muted dtc-tags">
                  {{ dtcEventLabel(e.kind) }} ·
                  {{ t(`dtc.status.${e.status}`) }} · {{ fmtTime(e.ts) }}
                </div>
              </div>
            </li>
          </ul>
        </section>

        <section v-for="s in sections" :key="s.key" class="card stack">
        <div class="row" style="justify-content: space-between">
          <strong>{{ s.title }}</strong>
          <span class="muted">{{ s.codes.length }}</span>
        </div>
        <p class="muted section-note">{{ s.note }}</p>

        <p v-if="s.codes.length === 0" class="muted">{{ t('dtc.noCodes') }}</p>
        <ul v-else class="dtc-list">
          <li v-for="d in s.codes" :key="d.code" class="dtc-row">
            <span class="dtc-code" :class="`sys-${d.system}`">{{ d.code }}</span>
            <div class="dtc-info">
              <div>{{ dtcDescription(d.code, d.description) }}</div>
              <div class="muted dtc-tags">
                {{ dtcSystemLabel(d.system)
                }}<template v-if="d.manufacturerSpecific">
                  {{ t('dtc.manufacturerSpecific') }}</template>
              </div>
            </div>
          </li>
        </ul>
        </section>
      </template>

      <i18n-t keypath="dtc.safe" scope="global" tag="div" class="banner warn">
        <template #clearing>
          <strong>{{ t('dtc.safeTerm') }}</strong>
        </template>
      </i18n-t>
    </template>
  </div>
</template>

<style scoped>
.section-note {
  margin: 0;
  font-size: 0.85rem;
}
.dtc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.dtc-row {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}
.dtc-code {
  font-family: ui-monospace, monospace;
  font-weight: 700;
  padding: 0.25rem 0.5rem;
  border-radius: 8px;
  background: var(--surface-2);
  border-left: 3px solid var(--accent);
  white-space: nowrap;
}
.dtc-code.sys-chassis {
  border-left-color: #9085e9;
}
.dtc-code.sys-body {
  border-left-color: #d55181;
}
.dtc-code.sys-network {
  border-left-color: #d95926;
}
.dtc-info {
  flex: 1;
}
.dtc-tags {
  font-size: 0.8rem;
  margin-top: 0.15rem;
}
.rec-btn {
  border-color: var(--danger);
  color: #fca5a5;
}
.live-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: #86efac;
  font-weight: 600;
}
.live-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #22c55e;
  animation: pulse 1.4s ease-in-out infinite;
}
.event-kind {
  font-size: 1rem;
  line-height: 1.6;
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
  .live-dot {
    animation: none;
  }
}
</style>
