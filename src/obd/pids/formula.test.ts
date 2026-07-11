import { describe, expect, it } from 'vitest'
import { compileFormula, evalFormula } from './formula'

describe('formula evaluator', () => {
  it('evaluates basic arithmetic with precedence', () => {
    expect(evalFormula('2 + 3 * 4', [])).toBe(14)
    expect(evalFormula('(2 + 3) * 4', [])).toBe(20)
    expect(evalFormula('10 / 4', [])).toBe(2.5)
    expect(evalFormula('10 % 3', [])).toBe(1)
  })

  it('binds byte variables A, B, C ... to data indices', () => {
    expect(evalFormula('A', [42])).toBe(42)
    expect(evalFormula('(A*256)+B', [0x1a, 0xf8])).toBe(6904)
    expect(evalFormula('((A*256)+B)/4', [0x1a, 0xf8])).toBe(1726)
    expect(evalFormula('C', [1, 2, 9])).toBe(9)
  })

  it('supports unary minus and offsets', () => {
    expect(evalFormula('A-40', [90])).toBe(50)
    expect(evalFormula('-A', [5])).toBe(-5)
    expect(evalFormula('-(A+B)', [2, 3])).toBe(-5)
  })

  it('supports hex literals and bitwise operators', () => {
    expect(evalFormula('A & 0x0F', [0xab])).toBe(0x0b)
    expect(evalFormula('A << 8 | B', [0x12, 0x34])).toBe(0x1234)
    expect(evalFormula('A >> 4', [0xf0])).toBe(0x0f)
  })

  it('compiles once and reuses', () => {
    const rpm = compileFormula('((A*256)+B)/4')
    expect(rpm([0x0f, 0xa0])).toBe(1000)
    expect(rpm([0x00, 0x04])).toBe(1)
  })

  it('throws when a referenced byte is missing', () => {
    expect(() => evalFormula('(A*256)+B', [0x1a])).toThrow(/byte B/)
  })

  it('rejects unsafe input instead of executing it (no eval)', () => {
    // A stray ';' is an invalid character — it never reaches any interpreter.
    expect(() => evalFormula('A; process.exit()', [1])).toThrow(/Invalid character/)
    // Bare identifiers are treated as byte variables, so this cannot call anything;
    // with too few bytes it simply throws a decode error.
    expect(() => evalFormula('exit(1)', [1])).toThrow()
  })
})
