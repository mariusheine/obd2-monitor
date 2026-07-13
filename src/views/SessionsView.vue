<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import { getPid } from '@/obd/pids/catalog'
import {
  db,
  deleteSession,
  sessionDtcEvents,
  sessionSamples,
  storageEstimate,
  type SampleRow,
  type SessionRow,
} from '@/storage/db'
import {
  buildCsv,
  buildSessionJson,
  downloadText,
  type PidMeta,
} from '@/storage/export'
import { sessionFolderName, SyncError } from '@/obd/sync/nextcloud'
import type { CloudSessionSummary, ReassembledSession } from '@/obd/sync/cloudSessions'
import { useSessionStore } from '@/stores/session'
import { useSyncStore } from '@/stores/sync'

/** One row in the merged list: a local record, a cloud folder, or (briefly) both. */
interface Entry {
  key: string
  startedAt: number
  local: SessionRow | null
  cloud: CloudSessionSummary | null
}

const session = useSessionStore()
const sync = useSyncStore()
const { active: syncActive, pendingIds, running: syncRunning } = storeToRefs(sync)
const { t, locale } = useI18n({ useScope: 'global' })
const localSessions = ref<SessionRow[]>([])
const cloudList = ref<CloudSessionSummary[]>([])
const usage = ref<{ usage: number; quota: number } | null>(null)
const busyKey = ref<string | null>(null)
const cloudError = ref<boolean>(false)

const entries = computed<Entry[]>(() => {
  const map = new Map<string, Entry>()
  for (const s of localSessions.value) {
    const key = sessionFolderName(s)
    map.set(key, { key, startedAt: s.startedAt, local: s, cloud: null })
  }
  for (const c of cloudList.value) {
    const existing = map.get(c.folderName)
    if (existing) existing.cloud = c
    else map.set(c.folderName, { key: c.folderName, startedAt: c.startedAt, local: null, cloud: c })
  }
  return Array.from(map.values()).sort((a, b) => b.startedAt - a.startedAt)
})

const resolvePid = (id: string): PidMeta | undefined => {
  const def = getPid(id)
  return def ? { name: def.name, unit: def.unit } : undefined
}

const transportLabel = (kind: string): string =>
  kind === 'ble' ? t('sessions.transport.ble') : t('sessions.transport.mock')

async function loadCloud(): Promise<void> {
  if (!syncActive.value) {
    cloudList.value = []
    return
  }
  cloudError.value = false
  try {
    cloudList.value = await sync.listCloud()
  } catch {
    cloudError.value = true
  }
}

async function reload(): Promise<void> {
  localSessions.value = await db.sessions.orderBy('startedAt').reverse().toArray()
  usage.value = await storageEstimate()
  await sync.refreshPending()
  await loadCloud()
}

async function syncNow(): Promise<void> {
  await sync.tick()
  await reload()
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(locale.value)
}

function fmtDuration(startedAt: number, endedAt: number): string {
  const total = Math.max(0, Math.floor((endedAt - startedAt) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`
}

function localMeta(s: SessionRow): string {
  return t('sessions.meta', {
    duration: fmtDuration(s.startedAt, s.endedAt ?? Date.now()),
    samples: s.sampleCount.toLocaleString(locale.value),
    pids: s.pidIds.length,
    transport: transportLabel(s.transportKind),
  })
}

function cloudMeta(c: CloudSessionSummary): string {
  return t('sessions.cloudMeta', {
    duration: fmtDuration(c.startedAt, c.lastActivityAt ?? c.startedAt),
  })
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

/** Reassembled cloud samples as SampleRow-shaped objects for the export builders. */
function toRows(r: ReassembledSession): SampleRow[] {
  return r.samples.map((s) => ({ id: 0, sessionId: 0, ts: s.ts, pidId: s.pidId, value: s.value }))
}

/** A SessionRow-shaped stand-in so a cloud drive can reuse buildSessionJson. */
function synthRow(r: ReassembledSession): SessionRow {
  return {
    id: 0,
    note: '',
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    transportKind: r.transportKind,
    pidIds: r.pidIds,
    sampleCount: r.samples.length,
    syncSessionId: r.syncSessionId,
    syncCursorId: 0,
    syncDtcCursorId: 0,
  }
}

async function exportEntry(e: Entry, kind: 'csv' | 'json'): Promise<void> {
  busyKey.value = e.key
  try {
    // A drive with a cloud folder is the source of truth (its local samples were
    // reclaimed after upload), so rebuild it from the cloud; otherwise export local.
    if (e.cloud) {
      const r = await sync.fetchCloud(e.cloud.folderName)
      const rows = toRows(r)
      const content =
        kind === 'csv' ? buildCsv(rows, resolvePid) : buildSessionJson(synthRow(r), rows, r.dtcEvents)
      const mime = kind === 'csv' ? 'text/csv' : 'application/json'
      downloadText(`${e.cloud.folderName}.${kind}`, mime, content)
    } else if (e.local) {
      const rows = await sessionSamples(e.local.id)
      const events = kind === 'json' ? await sessionDtcEvents(e.local.id) : []
      const content =
        kind === 'csv' ? buildCsv(rows, resolvePid) : buildSessionJson(e.local, rows, events)
      const mime = kind === 'csv' ? 'text/csv' : 'application/json'
      downloadText(`${e.key}.${kind}`, mime, content)
    }
  } catch (err) {
    cloudError.value = err instanceof SyncError
  } finally {
    busyKey.value = null
  }
}

async function remove(e: Entry): Promise<void> {
  const label = fmtDate(e.startedAt)
  const message = e.cloud
    ? t('sessions.confirmDeleteCloud', { label })
    : t('sessions.confirmDelete', { label, count: e.local?.sampleCount ?? 0 })
  if (!confirm(message)) return
  busyKey.value = e.key
  try {
    if (e.cloud) await sync.removeCloud(e.cloud.folderName)
    if (e.local) await deleteSession(e.local.id)
    await reload()
  } catch (err) {
    cloudError.value = err instanceof SyncError
  } finally {
    busyKey.value = null
  }
}

const isActive = (e: Entry): boolean =>
  e.local !== null && session.recording && session.currentId === e.local.id

const isSynced = (e: Entry): boolean => (e.local ? !pendingIds.value.includes(e.local.id) : true)

const exportDisabled = (e: Entry): boolean =>
  e.cloud === null && (e.local === null || e.local.sampleCount === 0)

onMounted(reload)
</script>

<template>
  <div class="stack">
    <div v-if="syncActive" class="row" style="justify-content: flex-end">
      <button :disabled="syncRunning" @click="syncNow">
        {{ syncRunning ? t('sessions.syncing') : t('sessions.syncNow') }}
      </button>
    </div>

    <div v-if="cloudError" class="banner warn">{{ t('sessions.cloudError') }}</div>

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
      v-if="entries.length === 0"
      keypath="sessions.noSessions"
      scope="global"
      tag="div"
      class="banner warn"
    >
      <template #record>
        <strong>{{ t('sessions.noSessionsRecord') }}</strong>
      </template>
    </i18n-t>

    <div v-for="e in entries" :key="e.key" class="card session">
      <div class="session-head">
        <div>
          <strong>{{ fmtDate(e.startedAt) }}</strong>
          <span v-if="isActive(e)" class="rec-pill">{{ t('sessions.recordingPill') }}</span>
          <span v-else-if="e.cloud" class="cloud-pill">{{ t('sessions.cloudBadge') }}</span>
          <span v-else-if="syncActive" class="sync-pill" :class="{ pending: !isSynced(e) }">
            {{ isSynced(e) ? t('sessions.syncSynced') : t('sessions.syncPending') }}
          </span>
        </div>
      </div>
      <div class="session-meta muted">
        <template v-if="e.local">{{ localMeta(e.local) }}</template>
        <template v-else-if="e.cloud">{{ cloudMeta(e.cloud) }}</template>
      </div>
      <div class="row">
        <button :disabled="busyKey === e.key || exportDisabled(e)" @click="exportEntry(e, 'csv')">
          {{ busyKey === e.key ? t('sessions.downloading') : t('sessions.exportCsv') }}
        </button>
        <button :disabled="busyKey === e.key || exportDisabled(e)" @click="exportEntry(e, 'json')">
          {{ t('sessions.exportJson') }}
        </button>
        <button :disabled="isActive(e) || busyKey === e.key" @click="remove(e)">
          {{ t('sessions.delete') }}
        </button>
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
.cloud-pill {
  margin-left: 0.5rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.15);
  color: #93c5fd;
  font-size: 0.75rem;
  font-weight: 600;
}
</style>
