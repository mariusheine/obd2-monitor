import { describe, expect, it } from 'vitest'

import { MockTransport } from '../transport/MockTransport'
import { Elm327 } from '../elm327/Elm327'
import { decodeSupportBitmap, probePid, probeRange, scanSupportedMode01 } from './discovery'

async function connectedElm(): Promise<Elm327> {
  const transport = new MockTransport(0)
  await transport.connect()
  const elm = new Elm327(transport)
  await elm.init()
  return elm
}

describe('decodeSupportBitmap', () => {
  it('maps MSB-first bits to PID numbers relative to the base', () => {
    // 0x80000000 → only bit A7 set → base+1.
    expect(decodeSupportBitmap(0x00, [0x80, 0x00, 0x00, 0x00])).toEqual([0x01])
    // 0x00000001 → only bit D0 set → base+0x20.
    expect(decodeSupportBitmap(0x00, [0x00, 0x00, 0x00, 0x01])).toEqual([0x20])
  })

  it('offsets by the range base', () => {
    // Bit A7 set on the 0x20 range → PID 0x21.
    expect(decodeSupportBitmap(0x20, [0x80, 0x00, 0x00, 0x00])).toEqual([0x21])
  })

  it('decodes a realistic multi-bit bitmap', () => {
    // 0xE8: bits A7,A6,A5,A3 → PIDs 0x01,0x02,0x03,0x05.
    expect(decodeSupportBitmap(0x00, [0xe8, 0x00, 0x00, 0x00])).toEqual([0x01, 0x02, 0x03, 0x05])
  })

  it('treats missing trailing bytes as unsupported', () => {
    expect(decodeSupportBitmap(0x00, [0x80])).toEqual([0x01])
  })
})

describe('scanSupportedMode01 over the simulator', () => {
  it('walks the support ranges and finds the standard diesel PIDs', async () => {
    const elm = await connectedElm()
    const result = await scanSupportedMode01(elm)
    // The simulated ECU answers these Mode 01 PIDs, including the new diesel ones.
    for (const pid of [0x04, 0x05, 0x0c, 0x0d, 0x78, 0x7c]) {
      expect(result.supported).toContain(pid)
    }
    // The 0x20-range continuation markers must not be reported as data PIDs.
    expect(result.supported).not.toContain(0x20)
    expect(result.supported).not.toContain(0x40)
    // Raw responses are captured for the export log.
    expect(result.ranges.length).toBeGreaterThan(0)
    expect(result.ranges[0]?.raw).toMatch(/41 00/)
  })
})

describe('probePid / probeRange', () => {
  it('captures a positive Mode 22 response with decoded data bytes', async () => {
    const elm = await connectedElm()
    const res = await probePid(elm, 0x22, 0x18f0)
    expect(res.ok).toBe(true)
    expect(res.data?.length).toBe(2)
    expect(res.raw).toMatch(/62 18 F0/)
  })

  it('records NO DATA as a non-fatal miss (still capturing raw)', async () => {
    const elm = await connectedElm()
    const res = await probePid(elm, 0x22, 0x9999)
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
    expect(res.raw).toMatch(/NO DATA/)
  })

  it('probes a range and returns only the PIDs that answered with data', async () => {
    const elm = await connectedElm()
    const hits = await probeRange(elm, 0x22, 0x18f0, 0x18f6)
    expect(hits.map((h) => h.pid)).toEqual([0x18f0, 0x18f1, 0x18f2, 0x18f3, 0x18f4, 0x18f5, 0x18f6])
  })

  it('stops early when shouldStop returns true', async () => {
    const elm = await connectedElm()
    let probed = 0
    const hits = await probeRange(elm, 0x22, 0x18f0, 0x18ff, {
      onResult: () => (probed += 1),
      shouldStop: () => probed >= 2,
    })
    expect(probed).toBe(2)
    expect(hits.length).toBeLessThanOrEqual(2)
  })
})
