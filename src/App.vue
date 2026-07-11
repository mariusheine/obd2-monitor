<script setup lang="ts">
import { watch } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterLink, RouterView } from 'vue-router'

import { useWakeLock } from '@/lib/useWakeLock'
import { useConnectionStore } from '@/stores/connection'
import { useLiveStore } from '@/stores/live'

const conn = useConnectionStore()
const live = useLiveStore()
const { status } = storeToRefs(conn)
const { polling } = storeToRefs(live)

// Keep the screen on while polling. Recording always implies polling, and the
// Live view stops recording when polling stops, so `polling` is the right signal.
// (Basing this on `polling` alone also keeps the Dexie/session code out of the
// initial bundle.)
const { active: wakeActive, setWanted } = useWakeLock()
watch(polling, (wanted) => void setWanted(wanted), { immediate: true })
</script>

<template>
  <header class="app-header">
    <img src="/icon.svg" alt="" width="26" height="26" />
    <h1>OBD-II Monitor</h1>
    <span class="status-dot" :class="status" :title="status"></span>
    <span v-if="status === 'reconnecting'" class="muted reconnecting-text">Reconnecting…</span>
    <span v-if="wakeActive" class="wake-chip" title="Screen kept on while monitoring">screen on</span>
    <nav class="app-nav">
      <RouterLink to="/connect">Connect</RouterLink>
      <RouterLink to="/live">Live</RouterLink>
      <RouterLink to="/sessions">Sessions</RouterLink>
      <RouterLink to="/dtc">Codes</RouterLink>
    </nav>
  </header>
  <main>
    <RouterView />
  </main>
</template>

<style scoped>
.reconnecting-text {
  font-size: 0.85rem;
}
.wake-chip {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--accent);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
}
</style>
