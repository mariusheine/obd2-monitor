import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DtcEventRow, SampleRow, SessionRow } from '@/storage/db'
import {
  buildIntervalFile,
  davFileUrl,
  deletePath,
  ensureFolder,
  folderUrl,
  getFile,
  intervalFilePath,
  normalizeBaseUrl,
  parseMultistatus,
  probe,
  propfindList,
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
  syncDtcCursorId: 0,
}

const samples: SampleRow[] = [
  { id: 1, sessionId: 1, ts: 10, pidId: 'std.rpm', value: 800 },
  { id: 2, sessionId: 1, ts: 20, pidId: 'std.speed', value: 30 },
]

const dtcEvents: DtcEventRow[] = [
  {
    id: 1,
    sessionId: 1,
    ts: 15,
    kind: 'appeared',
    code: 'P2463',
    status: 'pending',
    system: 'powertrain',
    manufacturerSpecific: false,
  },
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
    expect(buildIntervalFile(session, samples, [], '', session.startedAt)).toContain(
      '\n  "uploadedAt"',
    )
  })

  it('is self-describing with ISO-string timestamps (one session per file)', () => {
    const parsed = JSON.parse(
      buildIntervalFile(session, samples, dtcEvents, 'My phone', Date.parse('2026-07-12T14:31:00Z')),
    )
    expect(parsed.uploadedAt).toBe('2026-07-12T14:31:00.000Z')
    expect(parsed.syncSessionId).toBe(session.syncSessionId)
    expect(parsed.device).toBe('My phone')
    expect(parsed.session).toMatchObject({
      startedAt: new Date(session.startedAt).toISOString(),
      pidIds: ['std.rpm', 'std.speed'],
    })
    expect(parsed.samples).toEqual([
      { ts: '1970-01-01T00:00:00.010Z', pidId: 'std.rpm', value: 800 },
      { ts: '1970-01-01T00:00:00.020Z', pidId: 'std.speed', value: 30 },
    ])
    expect(parsed.dtcEvents).toEqual([
      {
        ts: '1970-01-01T00:00:00.015Z',
        kind: 'appeared',
        code: 'P2463',
        status: 'pending',
        system: 'powertrain',
        manufacturerSpecific: false,
      },
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

const LISTING_XML = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:nc="http://nextcloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/files/van-obd/obd-sessions/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:getlastmodified>Sun, 12 Jul 2026 16:05:11 GMT</d:getlastmodified>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/van-obd/obd-sessions/obd-2026-07-12-14-30-05-abcdef12/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:getlastmodified>Sun, 12 Jul 2026 14:32:05 GMT</d:getlastmodified>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/van-obd/obd-sessions/obd-2026-07-12-14-31-05-123.json</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype/>
        <d:getlastmodified>Sun, 12 Jul 2026 14:31:05 GMT</d:getlastmodified>
        <d:getcontentlength>512</d:getcontentlength>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

describe('parseMultistatus', () => {
  it('parses collections and files with mtime + size', () => {
    const entries = parseMultistatus(LISTING_XML)
    expect(entries).toHaveLength(3)
    const folder = entries.find((e) => e.name === 'obd-2026-07-12-14-30-05-abcdef12')!
    expect(folder.isCollection).toBe(true)
    expect(folder.size).toBeNull()
    expect(folder.lastModified).toBe(Date.parse('Sun, 12 Jul 2026 14:32:05 GMT'))
    const file = entries.find((e) => e.name === 'obd-2026-07-12-14-31-05-123.json')!
    expect(file.isCollection).toBe(false)
    expect(file.size).toBe(512)
  })
})

describe('propfindList / getFile / deletePath', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists children with PROPFIND Depth 1 and drops the folder itself', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(LISTING_XML, { status: 207 }))
    vi.stubGlobal('fetch', fetchMock)
    const entries = await propfindList(cfg)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://cloud.example.com/remote.php/dav/files/van-obd/obd-sessions/')
    expect(init.method).toBe('PROPFIND')
    expect(init.headers.Depth).toBe('1')
    // The queried folder (obd-sessions) is filtered out; only its children remain.
    expect(entries.map((e) => e.name)).toEqual([
      'obd-2026-07-12-14-30-05-abcdef12',
      'obd-2026-07-12-14-31-05-123.json',
    ])
  })

  it('lists a sub-folder path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<d:multistatus xmlns:d="DAV:"/>', { status: 207 }))
    vi.stubGlobal('fetch', fetchMock)
    await propfindList(cfg, 'obd-2026-07-12-14-30-05-abcdef12')
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://cloud.example.com/remote.php/dav/files/van-obd/obd-sessions/obd-2026-07-12-14-30-05-abcdef12',
    )
  })

  it('maps a 404 PROPFIND to a notfound SyncError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
    await expect(propfindList(cfg, 'missing')).rejects.toMatchObject({ kind: 'notfound' })
  })

  it('GETs a file and returns its text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getFile(cfg, 'folder/a.json')).resolves.toBe('{"ok":true}')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toContain('/obd-sessions/folder/a.json')
    expect(init.method).toBe('GET')
  })

  it('DELETEs a path and tolerates 404 (already gone)', async () => {
    const del = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', del)
    await expect(deletePath(cfg, 'folder')).resolves.toBeUndefined()
    expect(del.mock.calls[0]![1].method).toBe('DELETE')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
    await expect(deletePath(cfg, 'gone')).resolves.toBeUndefined()
  })

  it('throws on a DELETE server error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    await expect(deletePath(cfg, 'folder')).rejects.toBeInstanceOf(SyncError)
  })
})
