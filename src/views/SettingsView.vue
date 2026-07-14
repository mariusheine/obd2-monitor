<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import type { SyncErrorKind } from '@/obd/sync/nextcloud'
import { useConfigStore } from '@/stores/config'
import { useSyncStore, type TestResult } from '@/stores/sync'

const sync = useSyncStore()
const config = useConfigStore()
const { settings, baseUrl, configured, lastSyncAt, lastError, pendingCount, running } =
  storeToRefs(sync)
const { alerts } = storeToRefs(config)
const { t, locale } = useI18n({ useScope: 'global' })

const testing = ref(false)
const testResult = ref<TestResult | null>(null)

const host = computed(() => baseUrl.value?.replace(/^https?:\/\//, '') ?? '')
const urlInvalid = computed(
  () => settings.value.serverUrl.trim() !== '' && baseUrl.value === null,
)
const lastSyncText = computed(() =>
  lastSyncAt.value ? new Date(lastSyncAt.value).toLocaleString(locale.value) : t('settings.never'),
)

const ERROR_KEYS = {
  cors: 'sync.error.cors',
  auth: 'sync.error.auth',
  forbidden: 'sync.error.forbidden',
  notfound: 'sync.error.notfound',
  offline: 'sync.error.offline',
  server: 'sync.error.server',
} as const

const errorText = (kind: SyncErrorKind): string => t(ERROR_KEYS[kind])

async function runTest(): Promise<void> {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await sync.testConnection()
  } finally {
    testing.value = false
  }
}

onMounted(() => void sync.refreshPending())
</script>

<template>
  <div class="stack">
    <div class="card stack">
      <div>
        <strong>{{ t('alerts.title') }}</strong>
        <p class="muted" style="margin: 0.3rem 0 0">{{ t('alerts.intro') }}</p>
      </div>
      <label class="toggle">
        <input v-model="alerts.enabled" type="checkbox" />
        <span>{{ t('alerts.enable') }}</span>
      </label>
      <label class="toggle">
        <input v-model="alerts.sound" type="checkbox" :disabled="!alerts.enabled" />
        <span>{{ t('alerts.sound') }}</span>
      </label>
      <label class="toggle">
        <input v-model="alerts.vibration" type="checkbox" :disabled="!alerts.enabled" />
        <span>{{ t('alerts.vibration') }}</span>
      </label>
    </div>

    <div class="card stack">
      <div>
        <strong>{{ t('settings.title') }}</strong>
        <p class="muted" style="margin: 0.3rem 0 0">{{ t('settings.intro') }}</p>
      </div>

      <label class="field">
        <span>{{ t('settings.serverUrl') }}</span>
        <input
          v-model="settings.serverUrl"
          type="url"
          inputmode="url"
          autocomplete="off"
          :placeholder="t('settings.serverUrlPlaceholder')"
        />
        <small v-if="urlInvalid" class="err">{{ t('settings.invalidUrl') }}</small>
        <small v-else-if="host" class="ok">{{ t('settings.urlOk', { host }) }}</small>
        <small v-else class="muted">{{ t('settings.serverUrlHelp') }}</small>
      </label>

      <label class="field">
        <span>{{ t('settings.username') }}</span>
        <input
          v-model="settings.username"
          type="text"
          autocomplete="username"
          :placeholder="t('settings.usernamePlaceholder')"
        />
      </label>

      <label class="field">
        <span>{{ t('settings.appPassword') }}</span>
        <input
          v-model="settings.appPassword"
          type="password"
          autocomplete="off"
          :placeholder="t('settings.appPasswordPlaceholder')"
        />
        <small class="muted">{{ t('settings.appPasswordHelp') }}</small>
      </label>

      <label class="field">
        <span>{{ t('settings.folder') }}</span>
        <input
          v-model="settings.folder"
          type="text"
          autocomplete="off"
          :placeholder="t('settings.folderPlaceholder')"
        />
        <small class="muted">{{ t('settings.folderHelp') }}</small>
      </label>

      <label class="field">
        <span>{{ t('settings.deviceLabel') }}</span>
        <input
          v-model="settings.deviceLabel"
          type="text"
          :placeholder="t('settings.deviceLabelPlaceholder')"
        />
        <small class="muted">{{ t('settings.deviceLabelHelp') }}</small>
      </label>

      <label class="toggle">
        <input v-model="settings.enabled" type="checkbox" />
        <span>{{ t('settings.enable') }}</span>
      </label>

      <div class="row">
        <button :disabled="testing || !configured" @click="runTest">
          {{ testing ? t('settings.testing') : t('settings.test') }}
        </button>
      </div>

      <div v-if="testResult?.ok" class="banner ok-banner">{{ t('settings.testOk') }}</div>
      <div v-else-if="testResult && testResult.kind" class="banner danger">
        {{ errorText(testResult.kind) }}
      </div>

      <i18n-t keypath="settings.setupNote" scope="global" tag="p" class="muted setup">
        <template #link>
          <strong>{{ t('settings.setupLink') }}</strong>
        </template>
      </i18n-t>
    </div>

    <div class="card stack">
      <div class="row" style="justify-content: space-between">
        <strong>{{ t('settings.statusTitle') }}</strong>
        <button :disabled="running || !settings.enabled || !configured" @click="sync.tick()">
          {{ running ? t('sessions.syncing') : t('sessions.syncNow') }}
        </button>
      </div>
      <div class="muted">{{ t('settings.lastSync', { when: lastSyncText }) }}</div>
      <div v-if="pendingCount === 0" class="muted">{{ t('settings.allSynced') }}</div>
      <div v-else class="muted">{{ t('settings.pending', { count: pendingCount }) }}</div>
      <div v-if="lastError" class="banner warn">{{ errorText(lastError.kind) }}</div>
    </div>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.field > span {
  font-weight: 600;
  font-size: 0.9rem;
}
.field input {
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.5rem 0.6rem;
  font-size: 1rem;
}
.field small {
  font-size: 0.8rem;
}
.field small.err {
  color: #fca5a5;
}
.field small.ok {
  color: var(--accent);
}
.toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
}
.ok-banner {
  background: rgba(34, 197, 94, 0.15);
  color: #86efac;
}
.setup {
  font-size: 0.85rem;
  margin: 0;
}
</style>
