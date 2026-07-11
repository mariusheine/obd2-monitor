import { TransportError } from './types'
import type { Transport, TransportState, Unsubscribe } from './types'

/**
 * A candidate serial-over-BLE GATT profile. ELM327 BLE clones vary, so we probe a
 * known list and also allow a user override (Settings). See {@link KNOWN_SERVICES}.
 */
export interface BleProfileOverride {
  service: BluetoothServiceUUID
  write?: BluetoothCharacteristicUUID
  notify?: BluetoothCharacteristicUUID
}

/** Service UUIDs used by common ELM327 BLE adapters (Vgate, HM-10, Nordic UART). */
const KNOWN_SERVICES: BluetoothServiceUUID[] = [
  0xfff0,
  0xffe0,
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
]

const WRITE_CHUNK_SIZE = 20

/**
 * Web Bluetooth transport. Browser-only: requires a secure context, a user
 * gesture to call {@link connect}, and Android Chrome / desktop Chrome (BLE only,
 * no iOS). Reassembly of the `>`-terminated stream happens in the ELM327 layer.
 */
export class BleTransport implements Transport {
  private _state: TransportState = 'disconnected'
  private _label: string | null = null
  private device: BluetoothDevice | null = null
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null
  private intentionalDisconnect = false

  private readonly dataListeners = new Set<(chunk: Uint8Array) => void>()
  private readonly disconnectListeners = new Set<() => void>()

  constructor(private readonly override?: BleProfileOverride) {}

  get state(): TransportState {
    return this._state
  }

  get label(): string | null {
    return this._label
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator
  }

  async connect(): Promise<void> {
    if (!BleTransport.isSupported()) {
      throw new TransportError('Web Bluetooth is not supported in this browser (use Android Chrome)')
    }
    this._state = 'connecting'
    this.intentionalDisconnect = false
    try {
      const optionalServices = [
        ...(this.override ? [this.override.service] : []),
        ...KNOWN_SERVICES,
      ]
      const device =
        this.device ??
        (await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices }))
      this.device = device
      device.addEventListener('gattserverdisconnected', this.handleGattDisconnected)

      const gatt = device.gatt
      if (!gatt) throw new TransportError('Selected device exposes no GATT server')
      const server = await gatt.connect()

      const { writeChar, notifyChar } = await this.discover(server)
      this.writeChar = writeChar
      this.notifyChar = notifyChar

      await notifyChar.startNotifications()
      notifyChar.addEventListener('characteristicvaluechanged', this.handleCharacteristicValue)

      this._label = device.name ?? 'BLE OBD adapter'
      this._state = 'connected'
    } catch (err) {
      this._state = 'disconnected'
      throw err
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true
    try {
      this.notifyChar?.removeEventListener(
        'characteristicvaluechanged',
        this.handleCharacteristicValue,
      )
      await this.notifyChar?.stopNotifications().catch(() => undefined)
      this.device?.gatt?.disconnect()
    } finally {
      this.writeChar = null
      this.notifyChar = null
      this._state = 'disconnected'
    }
  }

  async write(data: Uint8Array): Promise<void> {
    const ch = this.writeChar
    if (!ch || this._state !== 'connected') {
      throw new TransportError('BLE transport is not connected')
    }
    const withoutResponse = ch.properties.writeWithoutResponse
    for (let offset = 0; offset < data.length; offset += WRITE_CHUNK_SIZE) {
      // Copy into a fresh ArrayBuffer-backed view so it satisfies BufferSource.
      const chunk = new Uint8Array(data.subarray(offset, offset + WRITE_CHUNK_SIZE))
      if (withoutResponse) {
        await ch.writeValueWithoutResponse(chunk)
      } else {
        await ch.writeValue(chunk)
      }
    }
  }

  onData(listener: (chunk: Uint8Array) => void): Unsubscribe {
    this.dataListeners.add(listener)
    return () => this.dataListeners.delete(listener)
  }

  onDisconnect(listener: () => void): Unsubscribe {
    this.disconnectListeners.add(listener)
    return () => this.disconnectListeners.delete(listener)
  }

  private async discover(server: BluetoothRemoteGATTServer): Promise<{
    writeChar: BluetoothRemoteGATTCharacteristic
    notifyChar: BluetoothRemoteGATTCharacteristic
  }> {
    const serviceUuids = [
      ...(this.override ? [this.override.service] : []),
      ...KNOWN_SERVICES,
    ]
    for (const uuid of serviceUuids) {
      let service: BluetoothRemoteGATTService
      try {
        service = await server.getPrimaryService(uuid)
      } catch {
        continue
      }
      const chars = await service.getCharacteristics()
      const notifyChar =
        (this.override?.notify && chars.find((c) => c.uuid === String(this.override?.notify))) ||
        chars.find((c) => c.properties.notify || c.properties.indicate)
      const writeChar =
        (this.override?.write && chars.find((c) => c.uuid === String(this.override?.write))) ||
        chars.find((c) => c.properties.write || c.properties.writeWithoutResponse)
      if (notifyChar && writeChar) return { writeChar, notifyChar }
    }
    throw new TransportError('No compatible ELM327 BLE service found on this device')
  }

  private readonly handleCharacteristicValue = (event: Event): void => {
    const target = event.target as BluetoothRemoteGATTCharacteristic | null
    const value = target?.value
    if (!value) return
    const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
    for (const l of this.dataListeners) l(bytes)
  }

  private readonly handleGattDisconnected = (): void => {
    this.writeChar = null
    this.notifyChar = null
    this._state = 'disconnected'
    if (!this.intentionalDisconnect) {
      for (const l of this.disconnectListeners) l()
    }
  }
}
