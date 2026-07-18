import type { PidDefinition } from './types'

/**
 * Standard SAE J1979 Mode 01 PIDs with well-known, verified decode formulas.
 * `A`, `B` below refer to data bytes 0 and 1.
 */
export const STANDARD_PIDS: readonly PidDefinition[] = [
  {
    id: 'std.engineLoad',
    mode: 0x01,
    pid: 0x04,
    name: 'Calculated engine load',
    shortName: 'Load',
    unit: '%',
    category: 'engine',
    min: 0,
    max: 100,
    decode: (d) => {
      const a = d[0]
      return a === undefined ? null : (a * 100) / 255
    },
  },
  {
    id: 'std.coolantTemp',
    mode: 0x01,
    pid: 0x05,
    name: 'Engine coolant temperature',
    shortName: 'Coolant',
    unit: '°C',
    category: 'temperature',
    min: -40,
    max: 215,
    decode: (d) => {
      const a = d[0]
      return a === undefined ? null : a - 40
    },
  },
  {
    id: 'std.intakeManifoldPressure',
    mode: 0x01,
    pid: 0x0b,
    name: 'Intake manifold absolute pressure',
    shortName: 'MAP',
    unit: 'kPa',
    category: 'pressure',
    min: 0,
    max: 255,
    decode: (d) => {
      const a = d[0]
      return a === undefined ? null : a
    },
  },
  {
    id: 'std.rpm',
    mode: 0x01,
    pid: 0x0c,
    name: 'Engine RPM',
    shortName: 'RPM',
    unit: 'rpm',
    category: 'engine',
    min: 0,
    max: 8000,
    decode: (d) => {
      const a = d[0]
      const b = d[1]
      return a === undefined || b === undefined ? null : (a * 256 + b) / 4
    },
  },
  {
    id: 'std.speed',
    mode: 0x01,
    pid: 0x0d,
    name: 'Vehicle speed',
    shortName: 'Speed',
    unit: 'km/h',
    category: 'speed',
    min: 0,
    max: 255,
    decode: (d) => {
      const a = d[0]
      return a === undefined ? null : a
    },
  },
  {
    id: 'std.intakeTemp',
    mode: 0x01,
    pid: 0x0f,
    name: 'Intake air temperature',
    shortName: 'IAT',
    unit: '°C',
    category: 'temperature',
    min: -40,
    max: 215,
    decode: (d) => {
      const a = d[0]
      return a === undefined ? null : a - 40
    },
  },
  {
    id: 'std.maf',
    mode: 0x01,
    pid: 0x10,
    name: 'Mass air flow rate',
    shortName: 'MAF',
    unit: 'g/s',
    category: 'engine',
    min: 0,
    max: 655,
    decode: (d) => {
      const a = d[0]
      const b = d[1]
      return a === undefined || b === undefined ? null : (a * 256 + b) / 100
    },
  },
  {
    id: 'std.throttle',
    mode: 0x01,
    pid: 0x11,
    name: 'Throttle position',
    shortName: 'Throttle',
    unit: '%',
    category: 'engine',
    min: 0,
    max: 100,
    decode: (d) => {
      const a = d[0]
      return a === undefined ? null : (a * 100) / 255
    },
  },
  {
    id: 'std.fuelLevel',
    mode: 0x01,
    pid: 0x2f,
    name: 'Fuel tank level',
    shortName: 'Fuel',
    unit: '%',
    category: 'fuel',
    min: 0,
    max: 100,
    decode: (d) => {
      const a = d[0]
      return a === undefined ? null : (a * 100) / 255
    },
  },
  {
    id: 'std.moduleVoltage',
    mode: 0x01,
    pid: 0x42,
    name: 'Control module voltage',
    shortName: 'Voltage',
    unit: 'V',
    category: 'electrical',
    min: 0,
    max: 20,
    decode: (d) => {
      const a = d[0]
      const b = d[1]
      return a === undefined || b === undefined ? null : (a * 256 + b) / 1000
    },
  },
  {
    id: 'std.ambientTemp',
    mode: 0x01,
    pid: 0x46,
    name: 'Ambient air temperature',
    shortName: 'Ambient',
    unit: '°C',
    category: 'temperature',
    min: -40,
    max: 215,
    decode: (d) => {
      const a = d[0]
      return a === undefined ? null : a - 40
    },
  },
  {
    id: 'std.oilTemp',
    mode: 0x01,
    pid: 0x5c,
    name: 'Engine oil temperature',
    shortName: 'Oil',
    unit: '°C',
    category: 'temperature',
    min: -40,
    max: 215,
    decode: (d) => {
      const a = d[0]
      return a === undefined ? null : a - 40
    },
  },
  // --- Standardised diesel/DPF PIDs (SAE J1979) ---------------------------------
  // These are part of the OBD-II standard (not manufacturer-specific), so a diesel
  // Ducato is likely to answer them — real, verifiable DPF data without guessing.
  // Whether the ECU actually supports each one is confirmed by the PID scan
  // (Discovery view); if unsupported the value simply stays null.
  {
    id: 'std.egt1',
    mode: 0x01,
    pid: 0x78,
    name: 'Exhaust gas temperature (Bank 1, sensor 1)',
    shortName: 'EGT',
    unit: '°C',
    category: 'temperature',
    min: 0,
    max: 1000,
    source: 'SAE J1979 PID 0x78 — byte A is a sensor-support bitmap; sensor 1 in bytes B,C',
    decode: (d) => {
      // Byte A (data[0]) is a bitmap of which of the up-to-4 EGT sensors are
      // present; the first sensor's temperature is the next two bytes.
      const b = d[1]
      const c = d[2]
      return b === undefined || c === undefined ? null : (b * 256 + c) / 10 - 40
    },
  },
  {
    id: 'std.dpfTemp',
    mode: 0x01,
    pid: 0x7c,
    name: 'DPF temperature',
    shortName: 'DPF temp',
    unit: '°C',
    category: 'temperature',
    min: 0,
    max: 1000,
    source: 'SAE J1979 PID 0x7C — scale 0.1, offset −40 on bytes A,B (per CSS Electronics J1979 table)',
    decode: (d) => {
      const a = d[0]
      const b = d[1]
      return a === undefined || b === undefined ? null : (a * 256 + b) / 10 - 40
    },
  },
]
