<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterLink } from 'vue-router'

import { useConnectionStore, type ConnStatus } from '@/stores/connection'

const conn = useConnectionStore()
const { status, label, protocol, error, bleSupported } = storeToRefs(conn)

const STATUS_TEXT: Record<ConnStatus, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  error: 'Error',
}

const busy = computed(() =>
  ['connecting', 'connected', 'reconnecting'].includes(status.value),
)
const isConnected = computed(() => status.value === 'connected')
const canDisconnect = computed(
  () => status.value === 'connected' || status.value === 'reconnecting',
)
const statusText = computed(() => STATUS_TEXT[status.value])
</script>

<template>
  <div class="stack">
    <div v-if="!bleSupported" class="banner warn">
      Web Bluetooth isn't available in this browser. Use <strong>Chrome on Android</strong> or
      desktop Chrome/Edge to connect a real adapter. You can still explore everything with the
      built-in simulator.
    </div>

    <div class="card stack">
      <div class="row">
        <span class="status-dot" :class="status"></span>
        <strong>{{ statusText }}</strong>
        <span v-if="label" class="muted">· {{ label }}</span>
      </div>
      <div v-if="protocol" class="muted">Protocol: {{ protocol }}</div>
      <div v-if="status === 'reconnecting'" class="banner warn">
        Lost the adapter — reconnecting automatically. Recording (if active) resumes on its own.
      </div>
      <div v-if="error" class="banner danger">{{ error }}</div>

      <div class="row">
        <button class="primary" :disabled="!bleSupported || busy" @click="conn.connect('ble')">
          Connect BLE adapter
        </button>
        <button :disabled="busy" @click="conn.connect('mock')">Use simulator</button>
        <button v-if="canDisconnect" @click="conn.disconnect()">Disconnect</button>
      </div>

      <RouterLink v-if="isConnected" to="/live">
        <button class="primary">Open live dashboard →</button>
      </RouterLink>
    </div>

    <div class="card muted">
      <p style="margin-top: 0">
        This app talks to a Bluetooth <strong>Low Energy</strong> ELM327 adapter directly from the
        browser — no backend, no install. On the road, add it to your Android home screen (PWA).
      </p>
      <p style="margin-bottom: 0">
        Tip: pair the adapter in Android settings first, start the engine, then tap
        <em>Connect BLE adapter</em> and pick your device.
      </p>
    </div>
  </div>
</template>
