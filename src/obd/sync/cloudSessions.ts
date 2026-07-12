/**
 * Read side of cloud sync: turn the raw WebDAV listing of a Nextcloud folder into
 * session summaries, reassemble a whole drive from its per-minute interval files,
 * and delete a session's cloud folder. See {@link ./nextcloud} for the layout the
 * uploader produces and `docs/nextcloud-sync.md` for the folder/file scheme.
 */
import {
  deletePath,
  getFile,
  propfindList,
  SyncError,
  type SyncConfig,
} from './nextcloud'

/** A cloud session as seen in a folder listing, before its files are downloaded. */
export interface CloudSessionSummary {
  /** The session's cloud subfolder, e.g. `obd-2026-07-12-14-30-05-abcdef12`. */
  folderName: string
  /** First 8 chars of the recording's `syncSessionId` (from the folder name). */
  syncSessionShortId: string
  /** Recording start, parsed from the folder name (epoch ms). */
  startedAt: number
  /** Newest child mtime — an approximation of when the drive last uploaded. */
  lastActivityAt: number | null
}

/** A full drive rebuilt by concatenating a folder's interval files. */
export interface ReassembledSession {
  syncSessionId: string
  startedAt: number
  endedAt: number | null
  transportKind: string
  pidIds: string[]
  device: string
  samples: { ts: number; pidId: string; value: number }[]
}

/**
 * Inverse of {@link sessionFolderName}: `obd-YYYY-MM-DD-HH-MM-SS-<shortId>` →
 * start time (parsed as UTC, matching `sessionFileBase`) and short id. Returns
 * null for names that don't fit the scheme.
 */
export function parseFolderName(name: string): { startedAt: number; shortId: string } | null {
  if (!name.startsWith('obd-')) return null
  const parts = name.slice('obd-'.length).split('-')
  if (parts.length < 7) return null
  const [y, mo, d, h, mi, s] = parts
  const shortId = parts.slice(6).join('-')
  const startedAt = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`)
  if (Number.isNaN(startedAt) || shortId === '') return null
  return { startedAt, shortId }
}

/**
 * List every session folder in the sync target. A missing target folder (nothing
 * uploaded yet) is treated as an empty list; other failures propagate as
 * {@link SyncError}. Sorted newest-first.
 */
export async function listCloudSessions(cfg: SyncConfig): Promise<CloudSessionSummary[]> {
  let entries
  try {
    entries = await propfindList(cfg)
  } catch (err) {
    if (err instanceof SyncError && err.kind === 'notfound') return []
    throw err
  }
  const summaries: CloudSessionSummary[] = []
  for (const e of entries) {
    if (!e.isCollection) continue
    const parsed = parseFolderName(e.name)
    if (!parsed) continue
    summaries.push({
      folderName: e.name,
      syncSessionShortId: parsed.shortId,
      startedAt: parsed.startedAt,
      lastActivityAt: e.lastModified,
    })
  }
  summaries.sort((a, b) => b.startedAt - a.startedAt)
  return summaries
}

interface IntervalFile {
  syncSessionId?: unknown
  device?: unknown
  session?: {
    startedAt?: unknown
    endedAt?: unknown
    transportKind?: unknown
    pidIds?: unknown
  }
  samples?: unknown
}

function toMs(iso: unknown): number | null {
  if (typeof iso !== 'string') return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Download and merge all of a session's interval files. Files are ordered by name
 * (which encodes the upload time, so lexicographic order is chronological), their
 * `samples` concatenated with timestamps converted ISO→ms, and the session
 * metadata taken from the last (newest) file so the final `endedAt`/`pidIds` win.
 */
export async function fetchCloudSession(
  cfg: SyncConfig,
  folderName: string,
): Promise<ReassembledSession> {
  const files = (await propfindList(cfg, folderName))
    .filter((e) => !e.isCollection && e.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name))

  const result: ReassembledSession = {
    syncSessionId: '',
    startedAt: parseFolderName(folderName)?.startedAt ?? 0,
    endedAt: null,
    transportKind: '',
    pidIds: [],
    device: '',
    samples: [],
  }

  for (const file of files) {
    const text = await getFile(cfg, `${folderName}/${file.name}`)
    let parsed: IntervalFile
    try {
      parsed = JSON.parse(text) as IntervalFile
    } catch {
      continue // Skip a corrupt/partial file rather than fail the whole drive.
    }
    // Metadata from the newest file wins (last iteration), incl. the final endedAt.
    if (typeof parsed.syncSessionId === 'string') result.syncSessionId = parsed.syncSessionId
    if (typeof parsed.device === 'string') result.device = parsed.device
    const meta = parsed.session
    if (meta) {
      const started = toMs(meta.startedAt)
      if (started !== null) result.startedAt = started
      result.endedAt = toMs(meta.endedAt)
      if (typeof meta.transportKind === 'string') result.transportKind = meta.transportKind
      if (Array.isArray(meta.pidIds)) result.pidIds = meta.pidIds.filter((p): p is string => typeof p === 'string')
    }
    if (Array.isArray(parsed.samples)) {
      for (const raw of parsed.samples) {
        if (typeof raw !== 'object' || raw === null) continue
        const s = raw as { ts?: unknown; pidId?: unknown; value?: unknown }
        const ts = toMs(s.ts)
        if (ts === null || typeof s.pidId !== 'string' || typeof s.value !== 'number') continue
        result.samples.push({ ts, pidId: s.pidId, value: s.value })
      }
    }
  }
  return result
}

/** Delete a session's whole cloud folder (recursive DELETE on the collection). */
export function deleteCloudSession(cfg: SyncConfig, folderName: string): Promise<void> {
  return deletePath(cfg, folderName)
}
