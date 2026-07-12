import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SampleRow, SessionRow } from '@/storage/db'
import {
  buildIntervalFile,
  davFileUrl,
  ensureFolder,
  folderUrl,
  intervalFilePath,
  normalizeBaseUrl,
  probe,
  putFile,
  sessionFolderName,
  SyncError,
  type SyncConfig,
} from './nextcloud'

const cfg: SyncConfig = {
  baseUrl: 'https://cloud.example.com',
  username: 'van-obd',
  appPassword: 'secret-pw',
  folder: 'obd-sessions',
}

const session: SessionRow = {
  id: 1,
  note: '',
  startedAt: Date.parse('2026-07-12T14:30:05Z'),
  endedAt: null,
  transportKind: 'mock',
  pidIds: ['std.rpm', 'std.speed'],
  sampleCount: 3,
  syncSessionId: 'abcdef12-3456-7890-abcd-ef1234567890',
  syncCursorId: 0,
}

const samples: SampleRow[] = [
  { id: 1, sessionId: 1, ts: 10, pidId: 'std.rpm', value: 800 },
  { id: 2, sessionId: 1, ts: 20, pidId: 'std.speed', value: 30 },
]

describe('normalizeBaseUrl', () => {
  it.each([
    ['https://cloud.example.com', 'https://cloud.example.com'],
    ['https://cloud.example.com/', 'https://cloud.example.com'],
    ['https://cloud.example.com/index.php/apps/files?dir=/x', 'https://cloud.example.com'],
    ['http://localhost:5173/', 'http://localhost:5173'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected)
  })

  it.each(['', '   ', 'not a url', 'ftp://host'])('rejects %s', (input) => {
    expect(normalizeBaseUrl(input)).toBeNull()
  })
})

describe('URL + filename building', () => {
  it('builds the authenticated folder and file URLs', () => {
    expect(folderUrl(cfg)).toBe(
      'https://cloud.example.com/remote.php/dav/files/van-obd/obd-sessions/',
    )
    expect(davFileUrl(cfg, 'a.json')).toBe(
      'https://cloud.example.com/remote.php/dav/files/van-obd/obd-sessions/a.json',
    )
  })

  it('encodes each folder path segment but keeps the slashes', () => {
    expect(folderUrl({ ...cfg, folder: 'van log/obd' })).toBe(
      'https://cloud.example.com/remote.php/dav/files/van-obd/van%20log/obd/',
    )
  })

  it('encodes sub-folder segments in a file path but keeps the slashes', () => {
    expect(davFileUrl(cfg, 'my session/part-0000.json')).toBe(
      'https://cloud.example.com/remote.php/dav/files/van-obd/obd-sessions/my%20session/part-0000.json',
    )
  })

  it('places a session’s interval files in its own start-timestamped folder', () => {
    expect(sessionFolderName(session)).toBe('obd-2026-07-12-14-30-05-abcdef12')
    expect(intervalFilePath(session, Date.parse('2026-07-12T14:31:05.123Z'))).toBe(
      'obd-2026-07-12-14-30-05-abcdef12/obd-2026-07-12-14-31-05-123.json',
    )
  })
})

describe('buildIntervalFile', () => {
  it('is pretty-printed (2-space indent)', () => {
    expect(buildIntervalFile(session, samples, '', session.startedAt)).toContain('\n  "uploadedAt"')
  })

  it('is self-describing with ISO-string timestamps (one session per file)', () => {
    const parsed = JSON.parse(
      buildIntervalFile(session, samples, 'Marius phone', Date.parse('2026-07-12T14:31:00Z')),
    )
    expect(parsed.uploadedAt).toBe('2026-07-12T14:31:00.000Z')
    expect(parsed.syncSessionId).toBe(session.syncSessionId)
    expect(parsed.device).toBe('Marius phone')
    expect(parsed.session).toMatchObject({
      startedAt: new Date(session.startedAt).toISOString(),
      pidIds: ['std.rpm', 'std.speed'],
    })
    expect(parsed.samples).toEqual([
      { ts: '1970-01-01T00:00:00.010Z', pidId: 'std.rpm', value: 800 },
      { ts: '1970-01-01T00:00:00.020Z', pidId: 'std.speed', value: 30 },
    ])
  })
})

describe('putFile / probe / ensureFolder', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs with the app-password basic-auth and X-Requested-With headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(putFile(cfg, 'a.json', 'application/json', '{}')).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toContain('/remote.php/dav/files/van-obd/obd-sessions/a.json')
    expect(init.method).toBe('PUT')
    expect(init.headers['X-Requested-With']).toBe('XMLHttpRequest')
    expect(init.headers.Authorization).toBe(`Basic ${btoa('van-obd:secret-pw')}`)
  })

  it('creates each folder segment and tolerates “already exists” (405)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 201 })) // van
      .mockResolvedValueOnce(new Response(null, { status: 405 })) // obd (exists)
    vi.stubGlobal('fetch', fetchMock)
    await expect(ensureFolder({ ...cfg, folder: 'van/obd' })).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]![1].method).toBe('MKCOL')
    expect(fetchMock.mock.calls[0]![0]).toContain('/files/van-obd/van/')
    expect(fetchMock.mock.calls[1]![0]).toContain('/files/van-obd/van/obd/')
  })

  it.each([
    [401, 'auth'],
    [403, 'forbidden'],
    [404, 'notfound'],
    [500, 'server'],
  ])('maps HTTP %i to SyncError kind %s', async (status, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))
    await expect(putFile(cfg, 'a.json', 'application/json', '{}')).rejects.toMatchObject({ kind })
  })

  it('maps a fetch TypeError (CORS/network) to a cors SyncError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(putFile(cfg, 'a.json', 'application/json', '{}')).rejects.toBeInstanceOf(SyncError)
    await expect(putFile(cfg, 'a.json', 'application/json', '{}')).rejects.toMatchObject({
      kind: 'cors',
    })
  })

  it('treats a 207 Multi-Status PROPFIND as a successful probe', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<xml/>', { status: 207 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(probe(cfg)).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://cloud.example.com/remote.php/dav/files/van-obd/',
    )
  })
})
