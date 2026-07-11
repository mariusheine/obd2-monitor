<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import { getPid } from '@/obd/pids/catalog'
import {
  db,
  deleteSession,
  sessionSamples,
  storageEstimate,
  type SessionRow,
} from '@/storage/db'
import {
  buildCsv,
  buildSessionJson,
  downloadText,
  sessionFileBase,
  type PidMeta,
} from '@/storage/export'
import { useSessionStore } from '@/stores/session'
import { useSyncStore } from '@/stores/sync'

const session = useSessionStore()
const sync = useSyncStore()
const { active: syncActive, pendingIds, running: syncRunning } = storeToRefs(sync)
const { t, locale } = useI18n({ useScope: 'global' })
const sessions = ref<SessionRow[]>([])
const usage = ref<{ usage: number; quota: number } | null>(null)
const busyId = ref<number | null>(null)

const isSynced = (s: SessionRow): boolean => !pendingIds.value.includes(s.id)

const resolvePid = (id: string): PidMeta | undefined => {
  const def = getPid(id)
  return def ? { name: def.name, unit: def.unit } : undefined
}

const transportLabel = (kind: string): string =>
  kind === 'ble' ? t('sessions.transport.ble') : t('sessions.transport.mock')

async function reload(): Promise<void> {
  sessions.value = await db.sessions.orderBy('startedAt').reverse().toArray()
  usage.value = await storageEstimate()
  await sync.refreshPending()
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(locale.value)
}

function fmtDuration(s: SessionRow): string {
  const end = s.endedAt ?? Date.now()
  const total = Math.max(0, Math.floor((end - s.startedAt) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(1)} ${units[i]}`
}

const usagePct = computed(() => {
  if (!usage.value || usage.value.quota === 0) return 0
  return Math.min(100, (usage.value.usage / usage.value.quota) * 100)
})

async function exportCsv(s: SessionRow): Promise<void> {
  busyId.value = s.id
  try {
    const rows = await sessionSamples(s.id)
    downloadText(`${sessionFileBase(s)}.csv`, 'text/csv', buildCsv(rows, resolvePid))
  } finally {
    busyId.value = null
  }
}

async function exportJson(s: SessionRow): Promise<void> {
  busyId.value = s.id
  try {
    const rows = await sessionSamples(s.id)
    downloadText(`${sessionFileBase(s)}.json`, 'application/json', buildSessionJson(s, rows))
  } finally {
    busyId.value = null
  }
}

async function remove(s: SessionRow): Promise<void> {
  if (!confirm(t('sessions.confirmDelete', { label: fmtDate(s.startedAt), count: s.sampleCount })))
    return
  await deleteSession(s.id)
  await reload()
}

const isActive = (s: SessionRow): boolean =>
  session.recording && session.currentId === s.id

onMounted(reload)
</script>

<template>
  <div class="stack">
    <div v-if="syncActive" class="row" style="justify-content: flex-end">
      <button :disabled="syncRunning" @click="sync.tick()">
        {{ syncRunning ? t('sessions.syncing') : t('sessions.syncNow') }}
      </button>
    </div>

    <div v-if="usage" class="card">
      <div class="row" style="justify-content: space-between">
        <strong>{{ t('sessions.localStorage') }}</strong>
        <span class="muted">{{
          t('sessions.storageOf', { used: fmtBytes(usage.usage), total: fmtBytes(usage.quota) })
        }}</span>
      </div>
      <div class="usage-bar"><div class="usage-fill" :style="{ width: usagePct + '%' }"></div></div>
    </div>

    <i18n-t
      v-if="sessions.length === 0"
      keypath="sessions.noSessions"
      scope="global"
      tag="div"
      class="banner warn"
    >
      <template #record>
        <strong>{{ t('sessions.noSessionsRecord') }}</strong>
      </template>
    </i18n-t>

    <div v-for="s in sessions" :key="s.id" class="card session">
      <div class="session-head">
        <div>
          <strong>{{ fmtDate(s.startedAt) }}</strong>
          <span v-if="isActive(s)" class="rec-pill">{{ t('sessions.recordingPill') }}</span>
          <span v-else-if="syncActive" class="sync-pill" :class="{ pending: !isSynced(s) }">
            {{ isSynced(s) ? t('sessions.syncSynced') : t('sessions.syncPending') }}
          </span>
        </div>
      </div>
      <div class="session-meta muted">
        {{
          t('sessions.meta', {
            duration: fmtDuration(s),
            samples: s.sampleCount.toLocaleString(locale),
            pids: s.pidIds.length,
            transport: transportLabel(s.transportKind),
          })
        }}
      </div>
      <div class="row">
        <button :disabled="busyId === s.id || s.sampleCount === 0" @click="exportCsv(s)">
          {{ t('sessions.exportCsv') }}
        </button>
        <button :disabled="busyId === s.id || s.sampleCount === 0" @click="exportJson(s)">
          {{ t('sessions.exportJson') }}
        </button>
        <button :disabled="isActive(s)" @click="remove(s)">{{ t('sessions.delete') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.usage-bar {
  margin-top: 0.6rem;
  height: 8px;
  background: var(--surface-2);
  border-radius: 999px;
  overflow: hidden;
}
.usage-fill {
  height: 100%;
  background: var(--accent);
}
.session {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.session-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
}
.session-meta {
  font-size: 0.9rem;
}
.rec-pill {
  margin-left: 0.5rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.15);
  color: #fca5a5;
  font-size: 0.75rem;
  font-weight: 600;
}
.sync-pill {
  margin-left: 0.5rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: rgba(34, 197, 94, 0.15);
  color: #86efac;
  font-size: 0.75rem;
  font-weight: 600;
}
.sync-pill.pending {
  background: rgba(234, 179, 8, 0.15);
  color: #fde047;
}
</style>
