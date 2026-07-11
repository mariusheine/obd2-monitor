<script setup lang="ts">
import { watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink, RouterView } from 'vue-router'

import { availableLocales, setLocale, type Locale } from '@/i18n'
import { useWakeLock } from '@/lib/useWakeLock'
import { useConnectionStore } from '@/stores/connection'
import { useLiveStore } from '@/stores/live'

const conn = useConnectionStore()
const live = useLiveStore()
const { status } = storeToRefs(conn)
const { polling } = storeToRefs(live)

const { t, locale } = useI18n({ useScope: 'global' })

function onLocaleChange(event: Event): void {
  setLocale((event.target as HTMLSelectElement).value as Locale)
}

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
    <h1>{{ t('app.title') }}</h1>
    <span class="status-dot" :class="status" :title="t(`status.${status}`)"></span>
    <span v-if="status === 'reconnecting'" class="muted reconnecting-text">{{
      t('app.reconnecting')
    }}</span>
    <span v-if="wakeActive" class="wake-chip" :title="t('app.screenOnTitle')">{{
      t('app.screenOn')
    }}</span>
    <nav class="app-nav">
      <RouterLink to="/connect">{{ t('app.nav.connect') }}</RouterLink>
      <RouterLink to="/live">{{ t('app.nav.live') }}</RouterLink>
      <RouterLink to="/sessions">{{ t('app.nav.sessions') }}</RouterLink>
      <RouterLink to="/dtc">{{ t('app.nav.codes') }}</RouterLink>
      <RouterLink to="/settings">{{ t('app.nav.settings') }}</RouterLink>
    </nav>
    <select
      class="lang-select"
      :value="locale"
      :aria-label="t('language.label')"
      @change="onLocaleChange"
    >
      <option v-for="l in availableLocales" :key="l.value" :value="l.value">{{ l.label }}</option>
    </select>
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
.lang-select {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.2rem 0.4rem;
  font-size: 0.8rem;
}
</style>
