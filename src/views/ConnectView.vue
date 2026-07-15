<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { useConnectionStore } from '@/stores/connection'

const conn = useConnectionStore()
const { status, label, protocol, error } = storeToRefs(conn)
// Static capability flags — read directly (they never change after store init).
const bleSupported = conn.bleSupported
const bleAvailability = conn.bleAvailability

const { t } = useI18n({ useScope: 'global' })

const busy = computed(() =>
  ['connecting', 'connected', 'reconnecting'].includes(status.value),
)
const isConnected = computed(() => status.value === 'connected')
const canDisconnect = computed(
  () => status.value === 'connected' || status.value === 'reconnecting',
)
const statusText = computed(() => t(`status.${status.value}`))
</script>

<template>
  <div class="stack">
    <i18n-t
      v-if="bleAvailability === 'unsupported'"
      keypath="connect.bleUnsupported"
      scope="global"
      tag="div"
      class="banner warn"
    >
      <template #chrome>
        <strong>{{ t('connect.bleUnsupportedChrome') }}</strong>
      </template>
      <template #flag>
        <code>edge://flags/#enable-experimental-web-platform-features</code>
      </template>
    </i18n-t>
    <div v-else-if="bleAvailability === 'insecure-context'" class="banner warn">
      {{ t('connect.bleInsecure') }}
    </div>

    <div class="card stack">
      <div class="row">
        <span class="status-dot" :class="status"></span>
        <strong>{{ statusText }}</strong>
        <span v-if="label" class="muted">· {{ label }}</span>
      </div>
      <div v-if="protocol" class="muted">{{ t('connect.protocol', { name: protocol }) }}</div>
      <div v-if="status === 'reconnecting'" class="banner warn">
        {{ t('connect.lost') }}
      </div>
      <div v-if="error" class="banner danger">{{ error }}</div>

      <div class="row">
        <button class="primary" :disabled="!bleSupported || busy" @click="conn.connect('ble')">
          {{ t('connect.connectBle') }}
        </button>
        <button :disabled="busy" @click="conn.connect('mock')">
          {{ t('connect.useSimulator') }}
        </button>
        <button v-if="canDisconnect" @click="conn.disconnect()">
          {{ t('connect.disconnect') }}
        </button>
      </div>

      <RouterLink v-if="isConnected" to="/live">
        <button class="primary">{{ t('connect.openLive') }}</button>
      </RouterLink>
    </div>

    <div class="card muted">
      <i18n-t keypath="connect.intro" scope="global" tag="p" style="margin-top: 0">
        <template #lowEnergy>
          <strong>{{ t('connect.introLowEnergy') }}</strong>
        </template>
      </i18n-t>
      <i18n-t keypath="connect.tip" scope="global" tag="p" style="margin-bottom: 0">
        <template #connect>
          <em>{{ t('connect.tipConnect') }}</em>
        </template>
      </i18n-t>
    </div>
  </div>
</template>

<style scoped>
/* The unsupported-BLE banner embeds a long edge://flags URL — let it wrap
   instead of forcing the mobile layout to scroll sideways. */
.banner code {
  word-break: break-all;
}
</style>
