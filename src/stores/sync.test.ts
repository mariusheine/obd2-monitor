import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { db, type NewSession } from '@/storage/db'
import { ensureFolder, putFile, SyncError } from '@/obd/sync/nextcloud'
import { useSessionStore } from './session'
import { useSyncStore } from './sync'

// Keep everything real except the calls that hit the network.
vi.mock('@/obd/sync/nextcloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/obd/sync/nextcloud')>()
  return {
    ...actual,
    putFile: vi.fn(() => Promise.resolve()),
    ensureFolder: vi.fn(() => Promise.resolve()),
  }
})

const putFileMock = vi.mocked(putFile)
const ensureFolderMock = vi.mocked(ensureFolder)

function configure(sync: ReturnType<typeof useSyncStore>): void {
  sync.settings.serverUrl = 'https://cloud.example.com'
  sync.settings.username = 'van-obd'
  sync.settings.appPassword = 'pw'
  sync.settings.folder = 'obd'
  sync.settings.enabled = true
}

let seq = 0
function makeSession(over: Partial<NewSession> = {}): NewSession {
  return {
    note: '',
    startedAt: Date.now() + seq++,
    endedAt: Date.now(),
    transportKind: 'mock',
    pidIds: ['std.rpm'],
    sampleCount: 0,
    syncSessionId: `sid-${seq}`,
    syncCursorId: 0,
    ...over,
  }
}

// fake-indexeddb autoincrement ids are global and survive clear(), so tests must
// use the real ids rather than assuming a session's samples start at 1.
async function seed(count: number, over: Partial<NewSession> = {}): Promise<{ id: number; lastId: number }> {
  const id = await db.sessions.add(makeSession(over))
  const lastId = await db.samples.bulkAdd(
    Array.from({ length: count }, (_, i) => ({ sessionId: id, ts: i, pidId: 'std.rpm', value: i })),
  )
  await db.sessions.update(id, { sampleCount: count })
  return { id, lastId }
}

/** Paths passed to putFile, in call order. */
const uploadedNames = (): string[] => putFileMock.mock.calls.map((c) => c[1])
/** The parsed body of the i-th upload. */
const uploadedBody = (i = 0): { syncSessionId: string; samples: unknown[] } =>
  JSON.parse(putFileMock.mock.calls[i]![3] as string)

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.samples.clear()
  await db.sessions.clear()
  localStorage.clear()
  putFileMock.mockReset()
  putFileMock.mockResolvedValue(undefined)
  ensureFolderMock.mockReset()
  ensureFolderMock.mockResolvedValue(undefined)
  seq = 0
})

describe('sync engine', () => {
  it('uploads new samples into the session folder, then reclaims them locally', async () => {
    const { id, lastId } = await seed(3)
    const sync = useSyncStore()
    configure(sync)

    await sync.tick()
    await vi.waitFor(() => expect(sync.lastSyncAt).not.toBeNull())

    // One file this interval, inside the session's own folder.
    expect(uploadedNames()).toHaveLength(1)
    expect(uploadedNames()[0]).toMatch(/^obd-.+\/obd-.+\.json$/)
    expect(uploadedBody().samples).toHaveLength(3)

    const row = await db.sessions.get(id)
    expect(row?.syncCursorId).toBe(lastId)
    expect(row?.sampleCount).toBe(3) // total preserved
    expect(await db.samples.where('sessionId').equals(id).count()).toBe(0) // reclaimed
    expect(sync.pendingCount).toBe(0)
  })

  it('writes one file per session, each in its own folder', async () => {
    const a = await seed(2, { syncSessionId: 'aaaaaaaa-1' })
    const b = await seed(3, { syncSessionId: 'bbbbbbbb-2' })
    const sync = useSyncStore()
    configure(sync)

    await sync.tick()
    await vi.waitFor(() => expect(sync.lastSyncAt).not.toBeNull())

    const names = uploadedNames()
    expect(names).toHaveLength(2)
    expect(names.some((n) => n.startsWith('obd-') && n.includes('-aaaaaaaa/'))).toBe(true)
    expect(names.some((n) => n.startsWith('obd-') && n.includes('-bbbbbbbb/'))).toBe(true)
    expect((await db.sessions.get(a.id))?.syncCursorId).toBe(a.lastId)
    expect((await db.sessions.get(b.id))?.syncCursorId).toBe(b.lastId)
  })

  it('retries next interval after a failure (no cursor advance, no reclaim)', async () => {
    const { id, lastId } = await seed(3)
    putFileMock.mockRejectedValue(new SyncError('server', 'boom'))
    const sync = useSyncStore()
    configure(sync)

    await sync.tick()
    await vi.waitFor(() => expect(sync.lastError?.kind).toBe('server'))
    expect((await db.sessions.get(id))?.syncCursorId).toBe(0)
    expect(await db.samples.where('sessionId').equals(id).count()).toBe(3) // kept
    expect(sync.lastSyncAt).toBeNull()

    putFileMock.mockResolvedValue(undefined)
    await sync.tick()
    await vi.waitFor(() => expect(sync.lastSyncAt).not.toBeNull())
    expect((await db.sessions.get(id))?.syncCursorId).toBe(lastId)
    expect(await db.samples.where('sessionId').equals(id).count()).toBe(0)
  })

  it('uploads nothing when there is no new data', async () => {
    const { id, lastId } = await seed(3)
    await db.sessions.update(id, { syncCursorId: lastId }) // already uploaded
    const sync = useSyncStore()
    configure(sync)

    await sync.tick()
    await vi.waitFor(() => !sync.running)
    expect(putFileMock).not.toHaveBeenCalled()
    expect(sync.pendingCount).toBe(0)
  })

  it('does nothing while disabled', async () => {
    await seed(3)
    const sync = useSyncStore()
    sync.settings.serverUrl = 'https://cloud.example.com'
    sync.settings.username = 'van-obd'
    sync.settings.appPassword = 'pw'
    sync.settings.folder = 'obd'
    // enabled stays false
    await sync.tick()
    expect(putFileMock).not.toHaveBeenCalled()
  })

  it('starts syncing as soon as a recording starts (not only when a tab opens)', async () => {
    // Pending data from an earlier drive, with sync already configured + enabled.
    await seed(3)
    localStorage.setItem(
      'obd.sync.v1',
      JSON.stringify({
        enabled: true,
        serverUrl: 'https://cloud.example.com',
        username: 'van-obd',
        appPassword: 'pw',
        folder: 'obd',
        deviceLabel: '',
      }),
    )

    // Begin a new recording without ever touching the sync store or a view.
    const session = useSessionStore()
    await session.start()

    // Starting the recording brought the engine up and uploaded the backlog.
    await vi.waitFor(() => expect(putFileMock).toHaveBeenCalled())
    await session.stop()
  })
})
