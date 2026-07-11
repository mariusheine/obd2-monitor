import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import Dexie from 'dexie'

import { db, type SampleRow } from '@/storage/db'
import {
  buildIntervalFile,
  ensureFolder,
  intervalFilePath,
  normalizeBaseUrl,
  probe,
  putFile,
  sessionFolderName,
  SyncError,
  type SyncConfig,
  type SyncErrorKind,
} from '@/obd/sync/nextcloud'

const STORAGE_KEY = 'obd.sync.v1'
const INTERVAL_MS = 60_000

/** Persisted cloud-sync settings. */
interface SyncSettings {
  enabled: boolean
  /** Nextcloud server URL, e.g. https://cloud.example.com. */
  serverUrl: string
  username: string
  /** A Nextcloud app password (not the login password). */
  appPassword: string
  /** Target folder path within that user's files. */
  folder: string
  /** Free-text label embedded in each file for human context (e.g. "Marius' phone"). */
  deviceLabel: string
}

function defaultSettings(): SyncSettings {
  return { enabled: false, serverUrl: '', username: '', appPassword: '', folder: 'obd-sessions', deviceLabel: '' }
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function loadSettings(): SyncSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const p = parsed as Record<string, unknown>
    return {
      enabled: typeof p.enabled === 'boolean' ? p.enabled : false,
      serverUrl: str(p.serverUrl),
      username: str(p.username),
      appPassword: str(p.appPassword),
      folder: str(p.folder, 'obd-sessions'),
      deviceLabel: str(p.deviceLabel),
    }
  } catch {
    return null
  }
}

/** Samples of a session with `id` strictly greater than `afterId`, oldest first. */
function newSamples(sessionId: number, afterId: number): Promise<SampleRow[]> {
  return db.samples
    .where('[sessionId+id]')
    .between([sessionId, afterId], [sessionId, Dexie.maxKey], false, true)
    .toArray()
}

function countPending(sessionId: number, afterId: number): Promise<number> {
  return db.samples
    .where('[sessionId+id]')
    .between([sessionId, afterId], [sessionId, Dexie.maxKey], false, true)
    .count()
}

/** The result of a "Test connection" attempt, for the Settings UI. */
export interface TestResult {
  ok: boolean
  kind?: SyncErrorKind
  message?: string
}

/**
 * Cloud-sync engine: once a minute, every sample recorded since the last upload
 * is written to Nextcloud as a single self-describing JSON file (grouped by
 * session), then reclaimed from IndexedDB. If the upload fails, cursors don't
 * advance and nothing is deleted, so that data rolls into the next file.
 */
export const useSyncStore = defineStore('sync', () => {
  const settings = ref<SyncSettings>(loadSettings() ?? defaultSettings())

  watch(
    settings,
    (value) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      } catch {
        // Storage may be unavailable (private mode); non-fatal.
      }
    },
    { deep: true },
  )

  const baseUrl = computed(() => normalizeBaseUrl(settings.value.serverUrl))
  /** True when the server, credentials, and folder are all filled in. */
  const configured = computed(
    () =>
      baseUrl.value !== null &&
      settings.value.username.trim() !== '' &&
      settings.value.appPassword !== '' &&
      settings.value.folder.trim() !== '',
  )
  /** True when fully configured and sync is switched on. */
  const active = computed(() => settings.value.enabled && configured.value)

  const running = ref(false)
  const lastSyncAt = ref<number | null>(null)
  const lastError = ref<{ kind: SyncErrorKind; message: string } | null>(null)
  const pendingIds = ref<number[]>([])
  const pendingCount = computed(() => pendingIds.value.length)

  let timer: ReturnType<typeof setInterval> | undefined

  function syncConfig(): SyncConfig | null {
    const base = baseUrl.value
    if (!base || !configured.value) return null
    return {
      baseUrl: base,
      username: settings.value.username.trim(),
      appPassword: settings.value.appPassword,
      folder: settings.value.folder.trim(),
    }
  }

  /** Recompute which sessions still have un-uploaded samples. */
  async function refreshPending(): Promise<void> {
    const sessions = await db.sessions.toArray()
    const pending: number[] = []
    for (const s of sessions) {
      if ((await countPending(s.id, s.syncCursorId ?? 0)) > 0) pending.push(s.id)
    }
    pendingIds.value = pending
  }

  /**
   * For each session with un-uploaded samples, write this interval's samples to
   * one file inside that session's own timestamped folder. On success the
   * session's cursor advances and the uploaded rows are reclaimed locally; on
   * failure nothing changes, so the data rolls into the next interval's file.
   */
  async function uploadInterval(cfg: SyncConfig): Promise<boolean> {
    const sessions = await db.sessions.orderBy('startedAt').toArray()
    const uploadedAt = Date.now()
    let uploaded = false
    for (const s of sessions) {
      const rows = await newSamples(s.id, s.syncCursorId ?? 0)
      if (rows.length === 0) continue
      // All of a session's interval files live in its own subfolder.
      await ensureFolder({ ...cfg, folder: `${cfg.folder}/${sessionFolderName(s)}` })
      await putFile(
        cfg,
        intervalFilePath(s, uploadedAt),
        'application/json',
        buildIntervalFile(s, rows, settings.value.deviceLabel, uploadedAt),
      )
      // Safely in the cloud — advance the cursor and reclaim the rows. The
      // session row (and its total sampleCount) stays for history and badges.
      await db.sessions.update(s.id, { syncCursorId: rows[rows.length - 1]!.id })
      await db.samples.bulkDelete(rows.map((r) => r.id))
      uploaded = true
    }
    return uploaded
  }

  async function tick(): Promise<void> {
    const cfg = syncConfig()
    if (running.value || !settings.value.enabled || !cfg) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    running.value = true
    try {
      if (await uploadInterval(cfg)) lastSyncAt.value = Date.now()
      lastError.value = null
    } catch (err) {
      if (err instanceof SyncError) lastError.value = { kind: err.kind, message: err.message }
      else lastError.value = { kind: 'server', message: err instanceof Error ? err.message : String(err) }
    } finally {
      running.value = false
      await refreshPending()
    }
  }

  /** Reachability + credential check for the Settings screen; also creates the folder. */
  async function testConnection(): Promise<TestResult> {
    const cfg = syncConfig()
    if (!cfg) return { ok: false, kind: 'notfound', message: 'Fill in the server, credentials, and folder first' }
    try {
      await probe(cfg)
      await ensureFolder(cfg)
      return { ok: true }
    } catch (err) {
      if (err instanceof SyncError) return { ok: false, kind: err.kind, message: err.message }
      return { ok: false, kind: 'server', message: err instanceof Error ? err.message : String(err) }
    }
  }

  function onOnline(): void {
    void tick()
  }

  function ensureEngine(): void {
    if (timer !== undefined) return
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline)
    timer = setInterval(() => void tick(), INTERVAL_MS)
    void tick()
  }

  function stopEngine(): void {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline)
  }

  watch(active, (on) => (on ? ensureEngine() : stopEngine()), { immediate: true })
  void refreshPending()

  return {
    settings,
    baseUrl,
    configured,
    active,
    running,
    lastSyncAt,
    lastError,
    pendingIds,
    pendingCount,
    tick,
    testConnection,
    refreshPending,
  }
})
