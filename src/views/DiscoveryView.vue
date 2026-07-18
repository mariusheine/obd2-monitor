<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { pidName } from '@/i18n/labels'
import { findPidByModePid } from '@/obd/pids/catalog'
import { downloadText } from '@/storage/export'
import { useConnectionStore } from '@/stores/connection'
import { useDiscoveryStore } from '@/stores/discovery'

const conn = useConnectionStore()
const discovery = useDiscoveryStore()
const { t, locale } = useI18n({ useScope: 'global' })
const { status } = storeToRefs(conn)
const { running, error, supportedMode01, mode22Hits, log, progress, hasResults } =
  storeToRefs(discovery)

const connected = computed(() => status.value === 'connected')

// Diesel/DPF-relevant standard PIDs to spotlight in the scan result.
const DIESEL_PIDS = new Set([0x78, 0x79, 0x7a, 0x7b, 0x7c, 0x86])

const rangeStart = ref('1800')
const rangeEnd = ref('18FF')
const rawCommand = ref('')
const rawReply = ref<string | null>(null)

const toHex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0')
const toHex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0')

interface SupportedRow {
  pid: number
  hex: string
  known: string | null
  diesel: boolean
}
const supportedRows = computed<SupportedRow[]>(() =>
  supportedMode01.value.map((pid) => {
    const def = findPidByModePid(0x01, pid)
    return { pid, hex: toHex2(pid), known: def ? pidName(def) : null, diesel: DIESEL_PIDS.has(pid) }
  }),
)

async function runScan(): Promise<void> {
  await discovery.scanMode01()
}

async function runProbe(): Promise<void> {
  const start = parseInt(rangeStart.value.trim(), 16)
  const end = parseInt(rangeEnd.value.trim(), 16)
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return
  await discovery.probe(0x22, start, end)
}

async function runRaw(): Promise<void> {
  const cmd = rawCommand.value.trim()
  if (!cmd) return
  const result = await discovery.sendRaw(cmd)
  rawReply.value = typeof result === 'string' ? result : (result?.raw ?? null)
}

function exportCapture(): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  downloadText(`obd-pid-discovery-${stamp}.txt`, 'text/plain', discovery.exportText())
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(locale.value)
}
</script>

<template>
  <div class="stack">
    <i18n-t
      v-if="!connected"
      keypath="discovery.notConnected"
      scope="global"
      tag="div"
      class="banner warn"
    >
      <template #link>
        <RouterLink to="/connect">{{ t('discovery.connectLink') }}</RouterLink>
      </template>
    </i18n-t>

    <template v-else>
      <div class="card stack">
        <div>
          <strong>{{ t('discovery.title') }}</strong>
          <p class="muted intro">{{ t('discovery.intro') }}</p>
        </div>
      </div>

      <!-- 1. Standard supported-PID scan -->
      <div class="card stack">
        <div class="row spread">
          <strong>{{ t('discovery.supportedTitle') }}</strong>
          <button class="primary" :disabled="running" @click="runScan">
            {{ running ? t('discovery.scanning') : t('discovery.scanStandard') }}
          </button>
        </div>
        <p class="muted small">{{ t('discovery.supportedIntro') }}</p>
        <div v-if="supportedRows.length" class="pid-grid">
          <span
            v-for="row in supportedRows"
            :key="row.pid"
            class="pid-chip"
            :class="{ diesel: row.diesel }"
            :title="row.known ?? t('discovery.unknownPid')"
          >
            <code>{{ row.hex }}</code>
            <small v-if="row.known">{{ row.known }}</small>
          </span>
        </div>
        <p v-else-if="hasResults" class="muted small">{{ t('discovery.supportedNone') }}</p>
        <p class="muted small diesel-hint">{{ t('discovery.dieselHint') }}</p>
      </div>

      <!-- 2. Mode 22 range probe (Fiat DPF DIDs) -->
      <div class="card stack">
        <strong>{{ t('discovery.probeTitle') }}</strong>
        <p class="muted small">{{ t('discovery.probeIntro') }}</p>
        <div class="row wrap">
          <label class="field">
            <span>{{ t('discovery.rangeStart') }}</span>
            <input v-model="rangeStart" inputmode="text" autocapitalize="characters" spellcheck="false" />
          </label>
          <label class="field">
            <span>{{ t('discovery.rangeEnd') }}</span>
            <input v-model="rangeEnd" inputmode="text" autocapitalize="characters" spellcheck="false" />
          </label>
          <button v-if="!running" class="primary probe-btn" @click="runProbe">
            {{ t('discovery.probeBtn') }}
          </button>
          <button v-else class="rec-btn probe-btn" @click="discovery.cancel()">
            {{ t('discovery.cancel') }}
          </button>
        </div>
        <div v-if="progress" class="progress">
          <div class="progress-bar" :style="{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }"></div>
          <span class="progress-label">{{
            t('discovery.progressLabel', { done: progress.done, total: progress.total })
          }}</span>
        </div>
        <div v-if="mode22Hits.length" class="hits">
          <div v-for="hit in mode22Hits" :key="hit.pid" class="hit">
            <code class="hit-pid">22{{ toHex4(hit.pid) }}</code>
            <code class="hit-data">{{ (hit.data ?? []).map(toHex2).join(' ') }}</code>
          </div>
        </div>
        <p v-else-if="hasResults && !running" class="muted small">{{ t('discovery.hitsNone') }}</p>
      </div>

      <!-- 3. Raw command -->
      <div class="card stack">
        <strong>{{ t('discovery.rawTitle') }}</strong>
        <p class="muted small">{{ t('discovery.rawIntro') }}</p>
        <div class="row wrap">
          <input
            v-model="rawCommand"
            class="raw-input"
            :placeholder="t('discovery.rawPlaceholder')"
            autocapitalize="characters"
            spellcheck="false"
            @keyup.enter="runRaw"
          />
          <button class="primary" :disabled="running" @click="runRaw">{{ t('discovery.send') }}</button>
        </div>
        <code v-if="rawReply !== null" class="raw-reply">{{ rawReply || '—' }}</code>
      </div>

      <div v-if="error" class="banner danger">{{ error }}</div>

      <!-- 4. Capture log + export -->
      <div v-if="log.length" class="card stack">
        <div class="row spread">
          <strong>{{ t('discovery.logTitle') }}</strong>
          <div class="row">
            <button @click="exportCapture">{{ t('discovery.export') }}</button>
            <button class="rec-btn" @click="discovery.clear()">{{ t('discovery.clear') }}</button>
          </div>
        </div>
        <div class="log">
          <div v-for="(entry, i) in log.slice().reverse()" :key="i" class="log-row">
            <span class="log-time muted">{{ fmtTime(entry.at) }}</span>
            <code class="log-cmd">{{ entry.command }}</code>
            <code class="log-raw">{{ entry.raw }}</code>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.intro,
.small {
  font-size: 0.85rem;
  margin: 0.3rem 0 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.row.spread {
  justify-content: space-between;
}
.row.wrap {
  flex-wrap: wrap;
}
.pid-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.pid-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.25rem 0.6rem;
  background: var(--surface-2);
}
.pid-chip code {
  font-weight: 700;
}
.pid-chip small {
  color: var(--muted);
  font-size: 0.75rem;
}
.pid-chip.diesel {
  border-color: var(--accent);
  background: rgba(34, 197, 94, 0.12);
}
.diesel-hint {
  font-style: italic;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.field > span {
  font-weight: 600;
  font-size: 0.8rem;
}
.field input,
.raw-input {
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.5rem 0.6rem;
  font-family: ui-monospace, monospace;
  font-size: 1rem;
  text-transform: uppercase;
  width: 6rem;
}
.raw-input {
  width: auto;
  flex: 1;
  min-width: 8rem;
}
.probe-btn {
  align-self: flex-end;
}
.progress {
  position: relative;
  height: 1.4rem;
  background: var(--surface-2);
  border-radius: 8px;
  overflow: hidden;
}
.progress-bar {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--accent);
  opacity: 0.35;
  transition: width 0.1s linear;
}
.progress-label {
  position: relative;
  display: block;
  text-align: center;
  font-size: 0.8rem;
  line-height: 1.4rem;
}
.hits,
.log {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.hit,
.log-row {
  display: flex;
  gap: 0.6rem;
  align-items: baseline;
  font-size: 0.85rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.3rem;
}
.hit-pid,
.log-cmd {
  color: var(--accent);
  font-weight: 700;
  flex: 0 0 auto;
}
.hit-data,
.log-raw {
  word-break: break-all;
}
.log-time {
  flex: 0 0 auto;
  font-size: 0.75rem;
}
.raw-reply {
  display: block;
  background: var(--surface-2);
  border-radius: 8px;
  padding: 0.5rem 0.6rem;
  word-break: break-all;
}
</style>
