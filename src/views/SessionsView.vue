<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

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

const session = useSessionStore()
const sessions = ref<SessionRow[]>([])
const usage = ref<{ usage: number; quota: number } | null>(null)
const busyId = ref<number | null>(null)

const resolvePid = (id: string): PidMeta | undefined => {
  const def = getPid(id)
  return def ? { name: def.name, unit: def.unit } : undefined
}

async function reload(): Promise<void> {
  sessions.value = await db.sessions.orderBy('startedAt').reverse().toArray()
  usage.value = await storageEstimate()
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString()
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
  if (!confirm(`Delete session "${s.label}" and its ${s.sampleCount} samples?`)) return
  await deleteSession(s.id)
  await reload()
}

const isActive = (s: SessionRow): boolean =>
  session.recording && session.currentId === s.id

onMounted(reload)
</script>

<template>
  <div class="stack">
    <div v-if="usage" class="card">
      <div class="row" style="justify-content: space-between">
        <strong>Local storage</strong>
        <span class="muted">{{ fmtBytes(usage.usage) }} of {{ fmtBytes(usage.quota) }}</span>
      </div>
      <div class="usage-bar"><div class="usage-fill" :style="{ width: usagePct + '%' }"></div></div>
    </div>

    <div v-if="sessions.length === 0" class="banner warn">
      No recorded sessions yet. Start the simulator or connect an adapter, then hit
      <strong>● Record</strong> on the Live dashboard.
    </div>

    <div v-for="s in sessions" :key="s.id" class="card session">
      <div class="session-head">
        <div>
          <strong>{{ s.label }}</strong>
          <span v-if="isActive(s)" class="rec-pill">recording</span>
        </div>
        <span class="muted">{{ fmtDate(s.startedAt) }}</span>
      </div>
      <div class="session-meta muted">
        {{ fmtDuration(s) }} · {{ s.sampleCount.toLocaleString() }} samples · {{ s.pidIds.length }}
        PIDs · {{ s.transportKind }}
      </div>
      <div class="row">
        <button :disabled="busyId === s.id || s.sampleCount === 0" @click="exportCsv(s)">
          Export CSV
        </button>
        <button :disabled="busyId === s.id || s.sampleCount === 0" @click="exportJson(s)">
          Export JSON
        </button>
        <button :disabled="isActive(s)" @click="remove(s)">Delete</button>
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
</style>
