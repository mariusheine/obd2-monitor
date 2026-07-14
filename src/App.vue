<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink, RouterView, useRouter } from 'vue-router'

import { availableLocales, setLocale, type Locale } from '@/i18n'
import { useAlert } from '@/lib/useAlert'
import { useWakeLock } from '@/lib/useWakeLock'
import { useConfigStore } from '@/stores/config'
import { useConnectionStore } from '@/stores/connection'
import { useDtcAlertStore } from '@/stores/dtcAlert'
import { useLiveStore } from '@/stores/live'

const conn = useConnectionStore()
const live = useLiveStore()
const config = useConfigStore()
const dtcAlert = useDtcAlertStore()
const router = useRouter()
const { status } = storeToRefs(conn)
const { polling } = storeToRefs(live)
const { alerts } = storeToRefs(config)
const { lastAppeared } = storeToRefs(dtcAlert)

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

// Driving alert: when the DTC monitor reports a newly-appeared code (never on the
// seed poll), show a global banner and — per the user's prefs — vibrate/beep.
const { prime, beep, vibrate } = useAlert()
const activeAlert = ref<{ code: string; ts: number } | null>(null)
let alertTimer: ReturnType<typeof setTimeout> | undefined

watch(lastAppeared, (ev) => {
  if (!ev || !alerts.value.enabled) return
  activeAlert.value = { code: ev.code, ts: ev.ts }
  if (alerts.value.vibration) vibrate()
  if (alerts.value.sound) beep()
  if (alertTimer) clearTimeout(alertTimer)
  alertTimer = setTimeout(() => (activeAlert.value = null), 8000)
})

function dismissAlert(): void {
  if (alertTimer) clearTimeout(alertTimer)
  activeAlert.value = null
}
function openCodes(): void {
  dismissAlert()
  void router.push('/dtc')
}

// Audio needs unlocking inside a user gesture; do it on the first tap anywhere so
// the beep works regardless of which button started the drive.
function primeOnce(): void {
  prime()
  window.removeEventListener('pointerdown', primeOnce)
}
onMounted(() => window.addEventListener('pointerdown', primeOnce))
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', primeOnce)
  if (alertTimer) clearTimeout(alertTimer)
})
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
      <RouterLink to="/dtc">{{ t('app.nav.codes') }}</RouterLink>
      <RouterLink to="/dpf">{{ t('app.nav.dpf') }}</RouterLink>
      <RouterLink to="/sessions">{{ t('app.nav.sessions') }}</RouterLink>
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

  <Teleport to="body">
    <div v-if="activeAlert" class="dtc-alert" role="alert" @click="openCodes">
      <span class="dtc-alert-icon" aria-hidden="true">⚠</span>
      <span class="dtc-alert-text">{{ t('alerts.newCode', { code: activeAlert.code }) }}</span>
      <button
        type="button"
        class="dtc-alert-dismiss"
        :aria-label="t('alerts.dismiss')"
        @click.stop="dismissAlert"
      >
        ✕
      </button>
    </div>
  </Teleport>
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
.dtc-alert {
  position: fixed;
  top: 0.6rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  max-width: min(92vw, 480px);
  padding: 0.7rem 0.9rem;
  border-radius: 12px;
  background: #78350f;
  color: #fde68a;
  border: 1px solid #fbbf24;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  cursor: pointer;
  font-weight: 600;
  animation: dtc-alert-in 0.18s ease-out;
}
.dtc-alert-icon {
  font-size: 1.2rem;
  line-height: 1;
}
.dtc-alert-text {
  flex: 1;
}
.dtc-alert-dismiss {
  background: transparent;
  border: none;
  color: inherit;
  font-size: 1rem;
  line-height: 1;
  padding: 0.2rem 0.35rem;
  cursor: pointer;
  opacity: 0.8;
}
.dtc-alert-dismiss:hover {
  opacity: 1;
}
@keyframes dtc-alert-in {
  from {
    opacity: 0;
    transform: translate(-50%, -0.5rem);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .dtc-alert {
    animation: none;
  }
}
</style>
