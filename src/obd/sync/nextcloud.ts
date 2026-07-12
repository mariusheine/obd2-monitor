/**
 * Minimal WebDAV client for uploading session data to a Nextcloud folder,
 * driven straight from the browser. Uploads go to the **authenticated** endpoint
 * (`/remote.php/dav/files/<user>/…`) with an app password, because that is the
 * endpoint the `webapppassword` Nextcloud app can CORS-enable — the public-share
 * endpoint cannot be reached cross-origin on a managed Nextcloud. The app only
 * ever creates files/folders (append-only). See `docs/nextcloud-sync.md`.
 */
import type { SampleRow, SessionRow } from '@/storage/db'
import { sessionFileBase } from '@/storage/export'

/** Everything needed to talk to one Nextcloud folder. */
export interface SyncConfig {
  /** Server origin without trailing slash, e.g. `https://cloud.example.com`. */
  baseUrl: string
  /** Nextcloud username the app password belongs to. */
  username: string
  /** A Nextcloud app password (Settings → Security → Devices & sessions). */
  appPassword: string
  /** Target folder path within that user's files, e.g. `obd-sessions` or `van/obd`. */
  folder: string
}

export type SyncErrorKind = 'cors' | 'auth' | 'forbidden' | 'notfound' | 'offline' | 'server'

/** A network/upload failure, classified so the UI can guide the user. */
export class SyncError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'SyncError'
  }
}

/**
 * Normalise whatever the user pastes as their server address into a bare origin
 * (`https://host[:port]`). Accepts a full server URL or even a share/app link —
 * any path, query, and hash are dropped. Returns `null` if it isn't a URL.
 */
export function normalizeBaseUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}

function encodePath(folder: string): string {
  return folder
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
}

/** The authenticated DAV URL of the user's files root. */
export function userRootUrl(cfg: SyncConfig): string {
  return `${cfg.baseUrl}/remote.php/dav/files/${encodeURIComponent(cfg.username)}/`
}

/** The authenticated DAV URL of the target folder (trailing slash). */
export function folderUrl(cfg: SyncConfig): string {
  const p = encodePath(cfg.folder)
  return userRootUrl(cfg) + (p ? `${p}/` : '')
}

/**
 * The authenticated DAV URL of a file within the target folder. `relPath` may
 * contain sub-folder segments (e.g. `session-folder/part-0000.json`); each
 * segment is encoded but the slashes are preserved.
 */
export function davFileUrl(cfg: SyncConfig, relPath: string): string {
  const encoded = relPath.split('/').filter(Boolean).map(encodeURIComponent).join('/')
  return folderUrl(cfg) + encoded
}

// btoa handles only latin1; utf8-encode first so unicode survives.
function base64(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)))
}

function headers(cfg: SyncConfig, extra: Record<string, string>): Record<string, string> {
  return {
    // Marks the request as an XHR (webapppassword allows this header) and carries
    // the app-password credentials.
    'X-Requested-With': 'XMLHttpRequest',
    Authorization: `Basic ${base64(`${cfg.username}:${cfg.appPassword}`)}`,
    ...extra,
  }
}

// fetch() rejects with a TypeError on network failure or a CORS block — the two
// are indistinguishable from JS, so lean on navigator.onLine to tell them apart.
function fetchError(): SyncError {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new SyncError('offline', 'Device is offline')
  }
  return new SyncError('cors', 'Request blocked — check the webapppassword CORS setup or your network')
}

function statusError(status: number): SyncError {
  if (status === 401) return new SyncError('auth', 'Not authorized — check the username and app password', status)
  if (status === 403 || status === 507)
    return new SyncError('forbidden', 'Upload rejected — check folder permissions and quota', status)
  if (status === 404) return new SyncError('notfound', 'Not found — check the server URL and username', status)
  return new SyncError('server', `Nextcloud returned ${status}`, status)
}

/** Upload one file (creating or overwriting). Throws {@link SyncError} on failure. */
export async function putFile(
  cfg: SyncConfig,
  name: string,
  mime: string,
  body: string,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(davFileUrl(cfg, name), {
      method: 'PUT',
      headers: headers(cfg, { 'Content-Type': mime }),
      body,
    })
  } catch {
    throw fetchError()
  }
  if (!res.ok) throw statusError(res.status)
}

/**
 * Create the target folder (and any parent segments) if missing. `MKCOL`
 * returns 201 when created and 405 when it already exists — both are success.
 */
export async function ensureFolder(cfg: SyncConfig): Promise<void> {
  const segs = cfg.folder.split('/').filter(Boolean)
  let prefix = ''
  for (const seg of segs) {
    prefix += `${encodeURIComponent(seg)}/`
    let res: Response
    try {
      res = await fetch(userRootUrl(cfg) + prefix, { method: 'MKCOL', headers: headers(cfg, {}) })
    } catch {
      throw fetchError()
    }
    if (res.status !== 201 && res.status !== 405 && !res.ok) throw statusError(res.status)
  }
}

/**
 * Validate the credentials by listing the user's files root (`PROPFIND` Depth 0).
 * `207 Multi-Status` means success. Throws {@link SyncError} otherwise so
 * "Test connection" can explain what's wrong.
 */
export async function probe(cfg: SyncConfig): Promise<void> {
  let res: Response
  try {
    res = await fetch(userRootUrl(cfg), {
      method: 'PROPFIND',
      headers: headers(cfg, { Depth: '0', 'Content-Type': 'application/xml' }),
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
    })
  } catch {
    throw fetchError()
  }
  if (res.status !== 207 && !res.ok) throw statusError(res.status)
}

/** One entry (file or folder) from a `PROPFIND` multistatus listing. */
export interface DavEntry {
  /** Last path segment, percent-decoded (e.g. a session folder or `obd-….json`). */
  name: string
  isCollection: boolean
  /** `getlastmodified` as epoch ms, or null if the server omitted it. */
  lastModified: number | null
  /** `getcontentlength` in bytes, or null (collections have no length). */
  size: number | null
}

/** Last path segment of a DAV href, percent-decoded and de-slashed. */
function hrefName(href: string): string {
  const segs = href.split('/').filter(Boolean)
  const last = segs[segs.length - 1] ?? ''
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/**
 * Parse a WebDAV `207 Multi-Status` body into flat entries. Uses `DOMParser`,
 * which exists both in the browser and in the jsdom test environment. Namespace
 * lookups (`DAV:`) tolerate whatever prefix the server uses.
 */
export function parseMultistatus(xml: string): DavEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const responses = doc.getElementsByTagNameNS('DAV:', 'response')
  const entries: DavEntry[] = []
  for (const res of Array.from(responses)) {
    const href = res.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent ?? ''
    if (!href) continue
    const isCollection =
      res.getElementsByTagNameNS('DAV:', 'collection').length > 0
    const modText = res.getElementsByTagNameNS('DAV:', 'getlastmodified')[0]?.textContent ?? ''
    const parsedMod = Date.parse(modText)
    const sizeText = res.getElementsByTagNameNS('DAV:', 'getcontentlength')[0]?.textContent ?? ''
    const parsedSize = Number.parseInt(sizeText, 10)
    entries.push({
      name: hrefName(href),
      isCollection,
      lastModified: Number.isNaN(parsedMod) ? null : parsedMod,
      size: Number.isNaN(parsedSize) ? null : parsedSize,
    })
  }
  return entries
}

/**
 * List the immediate children of the target folder (or a sub-path within it) via
 * `PROPFIND` Depth 1. The listing includes the queried folder itself, which is
 * dropped so only children are returned. Throws {@link SyncError} on failure
 * (notably `notfound` when the folder doesn't exist yet).
 */
export async function propfindList(cfg: SyncConfig, relPath = ''): Promise<DavEntry[]> {
  const url = relPath ? davFileUrl(cfg, relPath) : folderUrl(cfg)
  let res: Response
  try {
    res = await fetch(url, {
      method: 'PROPFIND',
      headers: headers(cfg, { Depth: '1', 'Content-Type': 'application/xml' }),
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>',
    })
  } catch {
    throw fetchError()
  }
  if (res.status !== 207 && !res.ok) throw statusError(res.status)
  const self = hrefName(url)
  return parseMultistatus(await res.text()).filter((e) => e.name !== self)
}

/** Download one file's text content. Throws {@link SyncError} on failure. */
export async function getFile(cfg: SyncConfig, relPath: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(davFileUrl(cfg, relPath), { method: 'GET', headers: headers(cfg, {}) })
  } catch {
    throw fetchError()
  }
  if (!res.ok) throw statusError(res.status)
  return res.text()
}

/**
 * Delete a file or folder. A `DELETE` on a collection removes it and everything
 * inside recursively, so one call clears a whole session folder. `204`/`200` and
 * `404` (already gone) are all treated as success.
 */
export async function deletePath(cfg: SyncConfig, relPath: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(davFileUrl(cfg, relPath), { method: 'DELETE', headers: headers(cfg, {}) })
  } catch {
    throw fetchError()
  }
  if (!res.ok && res.status !== 404) throw statusError(res.status)
}

/**
 * One interval file for a single session: its metadata plus the samples recorded
 * during this interval. Pretty-printed so it's readable straight from Nextcloud.
 */
export function buildIntervalFile(
  session: SessionRow,
  samples: readonly SampleRow[],
  device: string,
  uploadedAt: number,
): string {
  // All timestamps are written as ISO strings so the files read easily.
  const iso = (ms: number): string => new Date(ms).toISOString()
  return JSON.stringify(
    {
      app: 'obd2-monitor',
      uploadedAt: iso(uploadedAt),
      syncSessionId: session.syncSessionId,
      device,
      session: {
        startedAt: iso(session.startedAt),
        endedAt: session.endedAt === null ? null : iso(session.endedAt),
        transportKind: session.transportKind,
        pidIds: session.pidIds,
      },
      samples: samples.map((s) => ({ ts: iso(s.ts), pidId: s.pidId, value: s.value })),
    },
    null,
    2,
  )
}

/**
 * Per-session subfolder, named from the recording's start time (from
 * {@link sessionFileBase}) plus a short id so recordings from different devices
 * never collide. All of a session's interval files live here.
 */
export function sessionFolderName(session: SessionRow): string {
  const shortId = session.syncSessionId.replace(/-/g, '').slice(0, 8)
  return `${sessionFileBase(session)}-${shortId}`
}

/** Interval filename within a session folder, from the moment it was uploaded. */
export function intervalFileName(uploadedAt: number): string {
  const stamp = new Date(uploadedAt).toISOString().slice(0, 23).replace(/[:T.]/g, '-')
  return `obd-${stamp}.json`
}

/** Path of an interval file relative to the target folder. */
export function intervalFilePath(session: SessionRow, uploadedAt: number): string {
  return `${sessionFolderName(session)}/${intervalFileName(uploadedAt)}`
}
