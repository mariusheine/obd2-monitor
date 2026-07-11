/**
 * A tiny, safe arithmetic evaluator for Torque-style PID formulas.
 *
 * Variables `A`, `B`, `C`, ... map to data bytes 0, 1, 2, ... Supports `+ - * /
 * %`, bitwise `& | ^ << >>`, unary minus, parentheses, decimal/float and `0x`
 * hex literals. It is a real parser (shunting-yard) — it never calls `eval`, so
 * imported/community PID formulas cannot execute arbitrary code.
 */

type Token =
  | { t: 'num'; v: number }
  | { t: 'var'; v: number }
  | { t: 'op'; v: string }
  | { t: 'uminus' }
  | { t: 'lp' }
  | { t: 'rp' }

// C-like precedence; higher binds tighter.
const BINARY_PRECEDENCE: Record<string, number> = {
  '|': 1,
  '^': 2,
  '&': 3,
  '<<': 4,
  '>>': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
}
const UNARY_PRECEDENCE = 7

const isDigit = (c: string): boolean => c >= '0' && c <= '9'
const isHex = (c: string): boolean => /[0-9a-fA-F]/.test(c)
const isAlpha = (c: string): boolean => /[A-Za-z]/.test(c)

function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const c = expr.charAt(i)
    if (c === ' ' || c === '\t') {
      i++
      continue
    }
    if (isDigit(c) || (c === '.' && isDigit(expr.charAt(i + 1)))) {
      if (c === '0' && (expr.charAt(i + 1) === 'x' || expr.charAt(i + 1) === 'X')) {
        let j = i + 2
        while (j < expr.length && isHex(expr.charAt(j))) j++
        tokens.push({ t: 'num', v: parseInt(expr.slice(i + 2, j), 16) })
        i = j
      } else {
        let j = i
        while (j < expr.length && (isDigit(expr.charAt(j)) || expr.charAt(j) === '.')) j++
        tokens.push({ t: 'num', v: parseFloat(expr.slice(i, j)) })
        i = j
      }
      continue
    }
    if (isAlpha(c)) {
      tokens.push({ t: 'var', v: c.toUpperCase().charCodeAt(0) - 65 })
      i++
      continue
    }
    if (c === '<' || c === '>') {
      const two = expr.slice(i, i + 2)
      if (two === '<<' || two === '>>') {
        tokens.push({ t: 'op', v: two })
        i += 2
        continue
      }
      throw new Error(`Unexpected '${c}' in formula`)
    }
    if ('+-*/%&|^'.includes(c)) {
      const prev = tokens[tokens.length - 1]
      const unaryContext = !prev || prev.t === 'op' || prev.t === 'lp' || prev.t === 'uminus'
      if (c === '-' && unaryContext) tokens.push({ t: 'uminus' })
      else tokens.push({ t: 'op', v: c })
      i++
      continue
    }
    if (c === '(') {
      tokens.push({ t: 'lp' })
      i++
      continue
    }
    if (c === ')') {
      tokens.push({ t: 'rp' })
      i++
      continue
    }
    throw new Error(`Invalid character '${c}' in formula`)
  }
  return tokens
}

function toRpn(tokens: Token[]): Token[] {
  const out: Token[] = []
  const ops: Token[] = []
  const topPrecedence = (): number => {
    const top = ops[ops.length - 1]
    if (!top) return -1
    if (top.t === 'uminus') return UNARY_PRECEDENCE
    if (top.t === 'op') return BINARY_PRECEDENCE[top.v] ?? -1
    return -1
  }
  for (const tok of tokens) {
    switch (tok.t) {
      case 'num':
      case 'var':
        out.push(tok)
        break
      case 'uminus':
        ops.push(tok)
        break
      case 'op': {
        const prec = BINARY_PRECEDENCE[tok.v] ?? 0
        while (ops.length > 0 && ops[ops.length - 1]?.t !== 'lp' && topPrecedence() >= prec) {
          const popped = ops.pop()
          if (popped) out.push(popped)
        }
        ops.push(tok)
        break
      }
      case 'lp':
        ops.push(tok)
        break
      case 'rp': {
        while (ops.length > 0 && ops[ops.length - 1]?.t !== 'lp') {
          const popped = ops.pop()
          if (popped) out.push(popped)
        }
        if (ops.pop()?.t !== 'lp') throw new Error('Mismatched parentheses')
        break
      }
    }
  }
  while (ops.length > 0) {
    const top = ops.pop()
    if (!top) break
    if (top.t === 'lp') throw new Error('Mismatched parentheses')
    out.push(top)
  }
  return out
}

function applyOp(op: string, a: number, b: number): number {
  switch (op) {
    case '+':
      return a + b
    case '-':
      return a - b
    case '*':
      return a * b
    case '/':
      return a / b
    case '%':
      return a % b
    case '&':
      return (a | 0) & (b | 0)
    case '|':
      return (a | 0) | (b | 0)
    case '^':
      return (a | 0) ^ (b | 0)
    case '<<':
      return (a | 0) << (b | 0)
    case '>>':
      return (a | 0) >> (b | 0)
    default:
      throw new Error(`Unknown operator '${op}'`)
  }
}

function evalRpn(rpn: Token[], bytes: readonly number[]): number {
  const stack: number[] = []
  for (const tok of rpn) {
    if (tok.t === 'num') {
      stack.push(tok.v)
    } else if (tok.t === 'var') {
      const b = bytes[tok.v]
      if (b === undefined) {
        throw new Error(
          `Formula references byte ${String.fromCharCode(65 + tok.v)} but only ${bytes.length} present`,
        )
      }
      stack.push(b)
    } else if (tok.t === 'uminus') {
      const a = stack.pop()
      if (a === undefined) throw new Error('Malformed formula')
      stack.push(-a)
    } else if (tok.t === 'op') {
      const b = stack.pop()
      const a = stack.pop()
      if (a === undefined || b === undefined) throw new Error('Malformed formula')
      stack.push(applyOp(tok.v, a, b))
    }
  }
  if (stack.length !== 1 || stack[0] === undefined) throw new Error('Malformed formula')
  return stack[0]
}

/** Compile a formula once into a reusable decode function. Throws on syntax errors. */
export function compileFormula(expr: string): (bytes: readonly number[]) => number {
  const rpn = toRpn(tokenize(expr))
  return (bytes) => evalRpn(rpn, bytes)
}

/** Convenience one-shot evaluation. */
export function evalFormula(expr: string, bytes: readonly number[]): number {
  return compileFormula(expr)(bytes)
}
