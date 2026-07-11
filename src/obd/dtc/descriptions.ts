/**
 * Descriptions for common generic OBD-II DTCs, weighted toward the diesel / DPF /
 * EGR / turbo codes most relevant to a Fiat Ducato. Manufacturer-specific codes
 * (P1xxx and many P3xxx) are not in the generic standard and need Fiat data — the
 * UI flags those separately.
 */
export const DTC_DESCRIPTIONS: Readonly<Record<string, string>> = {
  // DPF / particulate filter
  P2002: 'Diesel Particulate Filter efficiency below threshold (Bank 1)',
  P2003: 'Diesel Particulate Filter efficiency below threshold (Bank 2)',
  P242F: 'Diesel Particulate Filter restricted — ash accumulation',
  P2452: 'DPF differential pressure sensor A circuit',
  P2453: 'DPF differential pressure sensor A range/performance',
  P2454: 'DPF differential pressure sensor A circuit low',
  P2455: 'DPF differential pressure sensor A circuit high',
  P2458: 'Diesel Particulate Filter regeneration duration',
  P2459: 'Diesel Particulate Filter regeneration frequency',
  P2463: 'Diesel Particulate Filter — soot accumulation',
  P244A: 'DPF differential pressure too low (Bank 1)',
  P244B: 'DPF differential pressure too high (Bank 1)',
  // EGR
  P0401: 'Exhaust Gas Recirculation flow insufficient',
  P0402: 'Exhaust Gas Recirculation flow excessive',
  P0404: 'Exhaust Gas Recirculation control circuit range/performance',
  P0405: 'EGR sensor A circuit low',
  P046C: 'EGR position sensor performance',
  // Turbo / boost
  P0299: 'Turbocharger/supercharger underboost',
  P0234: 'Turbocharger/supercharger overboost',
  P2563: 'Turbocharger boost control position sensor circuit range/performance',
  P0045: 'Turbo/super boost control solenoid circuit',
  // Fuel / rail
  P0087: 'Fuel rail/system pressure too low',
  P0088: 'Fuel rail/system pressure too high',
  P0093: 'Fuel system large leak detected',
  P0089: 'Fuel pressure regulator performance',
  // Air / sensors
  P0100: 'Mass or Volume Air Flow circuit',
  P0101: 'Mass or Volume Air Flow circuit range/performance',
  P0102: 'Mass or Volume Air Flow circuit low',
  P0113: 'Intake Air Temperature sensor 1 circuit high',
  P0335: 'Crankshaft position sensor A circuit',
  P0340: 'Camshaft position sensor A circuit',
  // Glow plugs / cold start (diesel)
  P0380: 'Glow plug/heater circuit A',
  P0381: 'Glow plug/heater indicator circuit',
  // Emissions / misc
  P0420: 'Catalyst system efficiency below threshold (Bank 1)',
  P0471: 'Exhaust pressure sensor range/performance',
  P0546: 'Exhaust gas temperature sensor circuit high (Bank 1 Sensor 1)',
  P2033: 'Exhaust gas temperature sensor circuit high (Bank 1 Sensor 2)',
  P0128: 'Coolant thermostat — temperature below regulating temperature',
}

export function describeDtc(code: string): string | undefined {
  return DTC_DESCRIPTIONS[code.toUpperCase()]
}
