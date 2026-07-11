<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { dtcDescription, dtcSystemLabel } from '@/i18n/labels'
import type { Dtc } from '@/obd/dtc/decode'
import { useConnectionStore } from '@/stores/connection'
import { useDtcStore } from '@/stores/dtc'

const conn = useConnectionStore()
const dtc = useDtcStore()
const { t, locale } = useI18n({ useScope: 'global' })
const { status, elm } = storeToRefs(conn)
const { stored, pending, permanent, loading, clearing, error, hasRead, lastReadAt, total } =
  storeToRefs(dtc)

const connected = computed(() => status.value === 'connected')

interface Section {
  key: string
  title: string
  codes: Dtc[]
  note: string
}
const sections = computed<Section[]>(() => [
  {
    key: 'stored',
    title: t('dtc.sections.storedTitle'),
    codes: stored.value,
    note: t('dtc.sections.storedNote'),
  },
  {
    key: 'pending',
    title: t('dtc.sections.pendingTitle'),
    codes: pending.value,
    note: t('dtc.sections.pendingNote'),
  },
  {
    key: 'permanent',
    title: t('dtc.sections.permanentTitle'),
    codes: permanent.value,
    note: t('dtc.sections.permanentNote'),
  },
])

function readCodes(): void {
  if (elm.value) void dtc.readAll(elm.value)
}

function clearCodes(): void {
  if (!elm.value) return
  if (confirm(t('dtc.clearConfirm'))) void dtc.clear(elm.value)
}
</script>

<template>
  <div class="stack">
    <i18n-t v-if="!connected" keypath="dtc.notConnected" scope="global" tag="div" class="banner warn">
      <template #link>
        <RouterLink to="/connect">{{ t('dtc.connectLink') }}</RouterLink>
      </template>
    </i18n-t>

    <template v-else>
      <div class="row">
        <button class="primary" :disabled="loading" @click="readCodes">
          {{ loading ? t('dtc.reading') : t('dtc.readCodes') }}
        </button>
        <button v-if="hasRead" class="rec-btn" :disabled="clearing" @click="clearCodes">
          {{ clearing ? t('dtc.clearing') : t('dtc.clearCodes') }}
        </button>
        <span v-if="lastReadAt" class="muted">
          {{ t('dtc.codeCount', total) }} ·
          {{ t('dtc.readAt', { time: new Date(lastReadAt).toLocaleTimeString(locale) }) }}
        </span>
      </div>

      <div v-if="error" class="banner danger">{{ error }}</div>

      <div v-if="!hasRead" class="card muted">
        {{ t('dtc.intro') }}
      </div>

      <section v-for="s in sections" v-else :key="s.key" class="card stack">
        <div class="row" style="justify-content: space-between">
          <strong>{{ s.title }}</strong>
          <span class="muted">{{ s.codes.length }}</span>
        </div>
        <p class="muted section-note">{{ s.note }}</p>

        <p v-if="s.codes.length === 0" class="muted">{{ t('dtc.noCodes') }}</p>
        <ul v-else class="dtc-list">
          <li v-for="d in s.codes" :key="d.code" class="dtc-row">
            <span class="dtc-code" :class="`sys-${d.system}`">{{ d.code }}</span>
            <div class="dtc-info">
              <div>{{ dtcDescription(d.code, d.description) }}</div>
              <div class="muted dtc-tags">
                {{ dtcSystemLabel(d.system)
                }}<template v-if="d.manufacturerSpecific">
                  {{ t('dtc.manufacturerSpecific') }}</template>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <i18n-t keypath="dtc.safe" scope="global" tag="div" class="banner warn">
        <template #clearing>
          <strong>{{ t('dtc.safeTerm') }}</strong>
        </template>
      </i18n-t>
    </template>
  </div>
</template>

<style scoped>
.section-note {
  margin: 0;
  font-size: 0.85rem;
}
.dtc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.dtc-row {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}
.dtc-code {
  font-family: ui-monospace, monospace;
  font-weight: 700;
  padding: 0.25rem 0.5rem;
  border-radius: 8px;
  background: var(--surface-2);
  border-left: 3px solid var(--accent);
  white-space: nowrap;
}
.dtc-code.sys-chassis {
  border-left-color: #9085e9;
}
.dtc-code.sys-body {
  border-left-color: #d55181;
}
.dtc-code.sys-network {
  border-left-color: #d95926;
}
.dtc-info {
  flex: 1;
}
.dtc-tags {
  font-size: 0.8rem;
  margin-top: 0.15rem;
}
.rec-btn {
  border-color: var(--danger);
  color: #fca5a5;
}
</style>
