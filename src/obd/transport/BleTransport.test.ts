import { afterEach, describe, expect, it, vi } from 'vitest'

import { BleTransport } from './BleTransport'

// `availability()` decides which guidance the Connect screen shows. The three
// branches map to distinct user fixes, so pin each one down.
describe('BleTransport.availability', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports "available" when navigator.bluetooth is present', () => {
    vi.stubGlobal('navigator', { bluetooth: {} })
    expect(BleTransport.availability()).toBe('available')
    expect(BleTransport.isSupported()).toBe(true)
  })

  it('reports "unsupported" on a secure origin without the API (e.g. Linux missing the flag)', () => {
    // jsdom's default origin is http://localhost, which counts as secure — so a
    // missing API here is a browser/OS gap, not an insecure context.
    expect(BleTransport.availability()).toBe('unsupported')
    expect(BleTransport.isSupported()).toBe(false)
  })

  it('reports "insecure-context" on a plain http:// LAN origin', () => {
    vi.stubGlobal('window', { isSecureContext: false, location: { hostname: '192.168.1.20' } })
    expect(BleTransport.availability()).toBe('insecure-context')
    expect(BleTransport.isSupported()).toBe(false)
  })

  it('still treats loopback as secure even without isSecureContext', () => {
    vi.stubGlobal('window', { isSecureContext: false, location: { hostname: '127.0.0.1' } })
    expect(BleTransport.availability()).toBe('unsupported')
  })
})

/**
 * A minimal fake Web Bluetooth device whose `gatt.connect()` fails `failTimes`
 * before succeeding — the shape of the "Unknown error" flakiness we retry past.
 */
function fakeDevice({ failTimes }: { failTimes: number }) {
  const notify = {
    uuid: 'notify',
    properties: { notify: true, indicate: false, write: false, writeWithoutResponse: false },
    startNotifications: vi.fn().mockResolvedValue(undefined),
    stopNotifications: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  const write = {
    uuid: 'write',
    properties: { notify: false, indicate: false, write: true, writeWithoutResponse: false },
    addEventListener: vi.fn(),
  }
  const service = { getCharacteristics: vi.fn().mockResolvedValue([notify, write]) }
  const server = { getPrimaryService: vi.fn().mockResolvedValue(service) }
  let attempts = 0
  const gatt = {
    connect: vi.fn().mockImplementation(() => {
      attempts += 1
      if (attempts <= failTimes) throw new DOMException('Unknown error when connecting', 'NetworkError')
      return Promise.resolve(server)
    }),
    disconnect: vi.fn(),
  }
  const device = { name: 'OBDII', gatt, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  return { device, gatt }
}

// The reliability path: don't let a single flaky/half-open GATT connection wedge
// every subsequent attempt (the in-car "connect once, then always fails" bug).
describe('BleTransport.connect', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('retries a flaky gatt.connect and eventually connects', async () => {
    const { device, gatt } = fakeDevice({ failTimes: 2 })
    vi.stubGlobal('navigator', { bluetooth: { requestDevice: vi.fn().mockResolvedValue(device) } })
    vi.useFakeTimers()

    const t = new BleTransport()
    const p = t.connect()
    await vi.runAllTimersAsync()
    await p

    expect(t.state).toBe('connected')
    expect(gatt.connect).toHaveBeenCalledTimes(3)
    // The two failed attempts each release the stale link before retrying.
    expect(gatt.disconnect).toHaveBeenCalledTimes(2)
  })

  it('gives up after the retry budget and releases the link so the next attempt can connect', async () => {
    const { device, gatt } = fakeDevice({ failTimes: Number.POSITIVE_INFINITY })
    vi.stubGlobal('navigator', { bluetooth: { requestDevice: vi.fn().mockResolvedValue(device) } })
    vi.useFakeTimers()

    const t = new BleTransport()
    // Attach the rejection handler before flushing timers, or the promise settles
    // mid-flush with no catcher and trips an unhandled-rejection warning.
    const rejection = expect(t.connect()).rejects.toBeInstanceOf(DOMException)
    await vi.runAllTimersAsync()
    await rejection

    expect(t.state).toBe('disconnected')
    expect(gatt.connect).toHaveBeenCalledTimes(3)
    // Released after every failed attempt, plus once more in connect()'s catch —
    // the adapter must not be left holding a half-open link.
    expect(gatt.disconnect.mock.calls.length).toBeGreaterThanOrEqual(3)
  })
})
