import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionRow } from '@/storage/db'
import {
  deletePath,
  getFile,
  propfindList,
  sessionFolderName,
  SyncError,
  type DavEntry,
  type SyncConfig,
} from './nextcloud'
import {
  deleteCloudSession,
  fetchCloudSession,
  listCloudSessions,
  parseFolderName,
} from './cloudSessions'

// Exercise the orchestration; the WebDAV/XML layer is covered in nextcloud.test.ts.
vi.mock('./nextcloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./nextcloud')>()
  return {
    ...actual,
    propfindList: vi.fn(),
    getFile: vi.fn(),
    deletePath: vi.fn(() => Promise.resolve()),
  }
})

const propfindListMock = vi.mocked(propfindList)
const getFileMock = vi.mocked(getFile)
const deletePathMock = vi.mocked(deletePath)

const cfg: SyncConfig = {
  baseUrl: 'https://cloud.example.com',
  username: 'van-obd',
  appPassword: 'pw',
  folder: 'obd-sessions',
}

function folder(name: string, lastModified: number | null): DavEntry {
  return { name, isCollection: true, lastModified, size: null }
}
function file(name: string): DavEntry {
  return { name, isCollection: false, lastModified: null, size: 100 }
}

beforeEach(() => {
  propfindListMock.mockReset()
  getFileMock.mockReset()
  deletePathMock.mockReset()
  deletePathMock.mockResolvedValue(undefined)
})

describe('parseFolderName', () => {
  it('round-trips with sessionFolderName', () => {
    const session = {
      startedAt: Date.parse('2026-07-12T14:30:05Z'),
      syncSessionId: 'abcdef12-3456-7890-abcd-ef1234567890',
    } as SessionRow
    const name = sessionFolderName(session)
    expect(name).toBe('obd-2026-07-12-14-30-05-abcdef12')
    expect(parseFolderName(name)).toEqual({
      startedAt: Date.parse('2026-07-12T14:30:05Z'),
      shortId: 'abcdef12',
    })
  })

  it('rejects names that do not fit the scheme', () => {
    expect(parseFolderName('random')).toBeNull()
    expect(parseFolderName('obd-not-a-date')).toBeNull()
  })
})

describe('listCloudSessions', () => {
  it('returns parseable session folders, newest first', async () => {
    propfindListMock.mockResolvedValue([
      folder('obd-2026-07-12-14-30-05-abcdef12', Date.parse('2026-07-12T14:32:05Z')),
      folder('obd-2026-07-12-16-05-11-bbbbbbbb', Date.parse('2026-07-12T16:06:10Z')),
      folder('not-a-session-folder', 0),
      file('stray.json'),
    ])
    const list = await listCloudSessions(cfg)
    expect(list.map((s) => s.folderName)).toEqual([
      'obd-2026-07-12-16-05-11-bbbbbbbb',
      'obd-2026-07-12-14-30-05-abcdef12',
    ])
    expect(list[0]).toMatchObject({
      syncSessionShortId: 'bbbbbbbb',
      startedAt: Date.parse('2026-07-12T16:05:11Z'),
      lastActivityAt: Date.parse('2026-07-12T16:06:10Z'),
    })
  })

  it('treats a missing folder (notfound) as an empty list', async () => {
    propfindListMock.mockRejectedValue(new SyncError('notfound', 'nope'))
    expect(await listCloudSessions(cfg)).toEqual([])
  })

  it('propagates other errors', async () => {
    propfindListMock.mockRejectedValue(new SyncError('auth', 'bad creds'))
    await expect(listCloudSessions(cfg)).rejects.toMatchObject({ kind: 'auth' })
  })
})

describe('fetchCloudSession', () => {
  it('merges interval files in chronological order and takes the last file’s metadata', async () => {
    const folderName = 'obd-2026-07-12-14-30-05-abcdef12'
    // Returned out of order to prove sorting by name (= upload time).
    propfindListMock.mockResolvedValue([
      file('obd-2026-07-12-14-32-00-000.json'),
      file('obd-2026-07-12-14-31-00-000.json'),
      file('notes.txt'),
    ])
    getFileMock.mockImplementation((_cfg, relPath) => {
      if (relPath.endsWith('14-31-00-000.json')) {
        return Promise.resolve(
          JSON.stringify({
            syncSessionId: 'sid-1',
            device: 'phone',
            session: {
              startedAt: '2026-07-12T14:30:05.000Z',
              endedAt: null,
              transportKind: 'ble',
              pidIds: ['std.rpm'],
            },
            samples: [{ ts: '2026-07-12T14:31:05.000Z', pidId: 'std.rpm', value: 820 }],
          }),
        )
      }
      return Promise.resolve(
        JSON.stringify({
          syncSessionId: 'sid-1',
          device: 'phone',
          session: {
            startedAt: '2026-07-12T14:30:05.000Z',
            endedAt: '2026-07-12T14:32:10.000Z',
            transportKind: 'ble',
            pidIds: ['std.rpm', 'std.speed'],
          },
          samples: [{ ts: '2026-07-12T14:32:05.000Z', pidId: 'std.speed', value: 30 }],
        }),
      )
    })

    const r = await fetchCloudSession(cfg, folderName)
    expect(r.syncSessionId).toBe('sid-1')
    expect(r.device).toBe('phone')
    expect(r.endedAt).toBe(Date.parse('2026-07-12T14:32:10Z')) // final file wins
    expect(r.pidIds).toEqual(['std.rpm', 'std.speed'])
    expect(r.samples).toEqual([
      { ts: Date.parse('2026-07-12T14:31:05Z'), pidId: 'std.rpm', value: 820 },
      { ts: Date.parse('2026-07-12T14:32:05Z'), pidId: 'std.speed', value: 30 },
    ])
  })

  it('reassembles DTC events (ISO→ms) and drops malformed ones', async () => {
    propfindListMock.mockResolvedValue([file('obd-2026-07-12-14-31-00-000.json')])
    getFileMock.mockResolvedValue(
      JSON.stringify({
        syncSessionId: 'sid-1',
        session: { startedAt: '2026-07-12T14:30:05Z', endedAt: null, transportKind: 'ble', pidIds: [] },
        samples: [],
        dtcEvents: [
          {
            ts: '2026-07-12T14:31:05.000Z',
            kind: 'appeared',
            code: 'P2463',
            status: 'pending',
            system: 'powertrain',
            manufacturerSpecific: false,
          },
          { ts: '2026-07-12T14:31:10.000Z', kind: 'bogus', code: 'P0001', status: 'pending', system: 'powertrain' },
        ],
      }),
    )
    const r = await fetchCloudSession(cfg, 'obd-2026-07-12-14-30-05-abcdef12')
    expect(r.dtcEvents).toEqual([
      {
        ts: Date.parse('2026-07-12T14:31:05Z'),
        kind: 'appeared',
        code: 'P2463',
        status: 'pending',
        system: 'powertrain',
        manufacturerSpecific: false,
      },
    ])
  })

  it('skips a corrupt interval file without failing the whole drive', async () => {
    propfindListMock.mockResolvedValue([
      file('obd-2026-07-12-14-31-00-000.json'),
      file('obd-2026-07-12-14-32-00-000.json'),
    ])
    getFileMock.mockImplementation((_cfg, relPath) =>
      relPath.endsWith('14-31-00-000.json')
        ? Promise.resolve('{ this is not json')
        : Promise.resolve(
            JSON.stringify({
              syncSessionId: 'sid-1',
              session: { startedAt: '2026-07-12T14:30:05Z', endedAt: null, transportKind: 'ble', pidIds: [] },
              samples: [{ ts: '2026-07-12T14:32:05Z', pidId: 'std.rpm', value: 900 }],
            }),
          ),
    )
    const r = await fetchCloudSession(cfg, 'obd-2026-07-12-14-30-05-abcdef12')
    expect(r.samples).toHaveLength(1)
    expect(r.samples[0]!.value).toBe(900)
  })
})

describe('deleteCloudSession', () => {
  it('deletes the session folder', async () => {
    await deleteCloudSession(cfg, 'obd-2026-07-12-14-30-05-abcdef12')
    expect(deletePathMock).toHaveBeenCalledWith(cfg, 'obd-2026-07-12-14-30-05-abcdef12')
  })
})
