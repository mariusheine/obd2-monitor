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
