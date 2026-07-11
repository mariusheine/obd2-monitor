import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWakeLock } from './useWakeLock'

type Api = ReturnType<typeof useWakeLock>

function mockWakeLock() {
  let releaseHandler: (() => void) | null = null
  const sentinel = {
    release: vi.fn(async () => {
      releaseHandler?.()
    }),
    addEventListener: (type: string, handler: () => void) => {
      if (type === 'release') releaseHandler = handler
    },
  }
  const request = vi.fn(async () => sentinel)
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true })
  return { sentinel, request, fireRelease: () => releaseHandler?.() }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock')
})

describe('useWakeLock', () => {
  it('reports unsupported and does nothing when the API is absent', async () => {
    const scope = effectScope()
    let api!: Api
    scope.run(() => {
      api = useWakeLock()
    })
    expect(api.isSupported).toBe(false)
    await api.setWanted(true)
    expect(api.active.value).toBe(false)
    scope.stop()
  })

  it('acquires and releases the screen lock', async () => {
    const { request, sentinel } = mockWakeLock()
    const scope = effectScope()
    let api!: Api
    scope.run(() => {
      api = useWakeLock()
    })
    expect(api.isSupported).toBe(true)

    await api.setWanted(true)
    expect(request).toHaveBeenCalledTimes(1)
    expect(api.active.value).toBe(true)

    await api.setWanted(false)
    expect(sentinel.release).toHaveBeenCalled()
    expect(api.active.value).toBe(false)
    scope.stop()
  })

  it('re-acquires after the OS releases it while still wanted', async () => {
    const { request, fireRelease } = mockWakeLock()
    const scope = effectScope()
    let api!: Api
    scope.run(() => {
      api = useWakeLock()
    })

    await api.setWanted(true)
    expect(request).toHaveBeenCalledTimes(1)

    fireRelease() // browser dropped the lock (tab hidden)
    expect(api.active.value).toBe(false)

    document.dispatchEvent(new Event('visibilitychange'))
    await tick()
    expect(request).toHaveBeenCalledTimes(2)
    expect(api.active.value).toBe(true)
    scope.stop()
  })
})
