import type { ActiveDtc } from '@/obd/dtc/monitor'

/**
 * Root-cause interpretation of the DPF signals — turns the raw soot/EGT/regen
 * numbers plus any active trouble codes into a ranked list of plain-language
 * findings (rendered via i18n in DpfAnalysisView). Pure and unit-tested.
 *
 * ⚠️ The thresholds below are APPROXIMATE and tuned to the simulator's placeholder
 * Mode-22 PIDs (see src/obd/pids/fiatDpf.ts). They must be re-checked once the real
 * Fiat Ducato PID scaling is verified on the vehicle.
 */

export type DpfSeverity = 'ok' | 'info' | 'warn' | 'crit'

export interface DpfFinding {
  /** Stable identifier for the finding kind (also used as a list key). */
  id: string
  severity: DpfSeverity
  /** i18n key under `dpf.finding.*`. */
  messageKey: string
  params?: Record<string, string | number>
}

/** Latest DPF-relevant values keyed by catalog PID id (undefined = not yet read). */
export type DpfLatest = Readonly<Record<string, number | undefined>>

export const DPF_THRESHOLDS = {
  /** g/L — soot is building; matches the sim's pending-DTC threshold. */
  sootElevated: 15,
  /** g/L — a regeneration is due. */
  sootHigh: 24,
  /** g/L — high enough to risk a reduced-power (limp) condition. */
  sootCritical: 30,
  /** km — overdue for a regeneration. */
  kmSinceRegenOverdue: 300,
  /** °C — abnormally hot exhaust. */
  egtHigh: 700,
  /** disrupted / successful ratio above which interrupted regens are a concern. */
  disruptedRatioWarn: 0.05,
} as const

const PID = {
  soot: 'fiat.dpf.soot',
  egt: 'fiat.dpf.egt',
  regenActive: 'fiat.dpf.regenActive',
  kmSinceRegen: 'fiat.dpf.kmSinceRegen',
  regenOk: 'fiat.dpf.regenOk',
  regenDisrupted: 'fiat.dpf.regenDisrupted',
  regenRetried: 'fiat.dpf.regenRetried',
} as const

/** DPF / exhaust trouble codes worth correlating with the live signals. */
const DPF_RELATED_CODES: ReadonlySet<string> = new Set([
  'P2002', 'P2003', 'P242F', 'P2452', 'P2453', 'P2454', 'P2455',
  'P2458', 'P2459', 'P2463', 'P244A', 'P244B', 'P0401', 'P0402',
])

const SEVERITY_RANK: Record<DpfSeverity, number> = { crit: 3, warn: 2, info: 1, ok: 0 }

const round1 = (n: number): number => Math.round(n * 10) / 10

/**
 * Interpret the current DPF state. Returns findings ordered most-severe first;
 * an empty array means nothing DPF-relevant has been read yet.
 */
export function analyseDpf(latest: DpfLatest, activeDtcs: readonly ActiveDtc[] = []): DpfFinding[] {
  const findings: DpfFinding[] = []

  // Active DPF-related codes — the strongest signal for a limp condition.
  const dpfCodes = [...new Set(activeDtcs.map((d) => d.code))].filter((c) => DPF_RELATED_CODES.has(c))
  if (dpfCodes.length > 0) {
    findings.push({
      id: 'dpfFault',
      severity: 'crit',
      messageKey: 'dpf.finding.dpfFault',
      params: { codes: dpfCodes.join(', ') },
    })
  }

  // Soot load — exactly one band when known.
  const soot = latest[PID.soot]
  if (soot !== undefined) {
    if (soot >= DPF_THRESHOLDS.sootCritical) {
      findings.push({ id: 'soot', severity: 'crit', messageKey: 'dpf.finding.sootCritical', params: { value: round1(soot) } })
    } else if (soot >= DPF_THRESHOLDS.sootHigh) {
      findings.push({ id: 'soot', severity: 'warn', messageKey: 'dpf.finding.sootHigh', params: { value: round1(soot) } })
    } else if (soot >= DPF_THRESHOLDS.sootElevated) {
      findings.push({ id: 'soot', severity: 'info', messageKey: 'dpf.finding.sootElevated', params: { value: round1(soot) } })
    } else {
      findings.push({ id: 'soot', severity: 'ok', messageKey: 'dpf.finding.sootOk', params: { value: round1(soot) } })
    }
  }

  // A regeneration in progress — reassure the driver not to switch off.
  const regenActive = latest[PID.regenActive]
  if (regenActive !== undefined && regenActive >= 0.5) {
    findings.push({ id: 'regenActive', severity: 'info', messageKey: 'dpf.finding.regenActive' })
  }

  // Regen completion health — the classic short-trip limp cause.
  const ok = latest[PID.regenOk]
  const disrupted = latest[PID.regenDisrupted]
  const retried = latest[PID.regenRetried]
  if (ok !== undefined && disrupted !== undefined) {
    const ratio = disrupted / Math.max(ok, 1)
    if (disrupted > 0 && ratio >= DPF_THRESHOLDS.disruptedRatioWarn) {
      findings.push({
        id: 'regenHealth',
        severity: 'warn',
        messageKey: 'dpf.finding.regensDisrupted',
        params: { disrupted, retried: retried ?? 0 },
      })
    } else {
      findings.push({ id: 'regenHealth', severity: 'ok', messageKey: 'dpf.finding.regensHealthy' })
    }
  }

  // Distance since the last completed regen.
  const km = latest[PID.kmSinceRegen]
  if (km !== undefined && km >= DPF_THRESHOLDS.kmSinceRegenOverdue) {
    findings.push({
      id: 'kmSinceRegen',
      severity: 'warn',
      messageKey: 'dpf.finding.kmSinceRegenOverdue',
      params: { km: Math.round(km) },
    })
  }

  // Exhaust gas temperature abnormally high (outside a regen).
  const egt = latest[PID.egt]
  if (egt !== undefined && egt >= DPF_THRESHOLDS.egtHigh) {
    findings.push({ id: 'egt', severity: 'warn', messageKey: 'dpf.finding.egtHigh', params: { value: Math.round(egt) } })
  }

  return findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
}

/** The worst severity among findings, for an overall status badge. `ok` if none. */
export function worstSeverity(findings: readonly DpfFinding[]): DpfSeverity {
  return findings.reduce<DpfSeverity>(
    (worst, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst] ? f.severity : worst),
    'ok',
  )
}
