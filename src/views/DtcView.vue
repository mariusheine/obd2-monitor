<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterLink } from 'vue-router'

import { SYSTEM_LABELS, type Dtc } from '@/obd/dtc/decode'
import { useConnectionStore } from '@/stores/connection'
import { useDtcStore } from '@/stores/dtc'

const conn = useConnectionStore()
const dtc = useDtcStore()
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
    title: 'Stored (confirmed)',
    codes: stored.value,
    note: 'Confirmed faults — these turn on the check-engine light.',
  },
  {
    key: 'pending',
    title: 'Pending',
    codes: pending.value,
    note: 'Detected once but not yet confirmed. May clear on their own.',
  },
  {
    key: 'permanent',
    title: 'Permanent',
    codes: permanent.value,
    note: 'Set by the ECU and NOT clearable with Mode 04 — they clear only after the fault is fixed and enough drive cycles pass.',
  },
])

function readCodes(): void {
  if (elm.value) void dtc.readAll(elm.value)
}

function clearCodes(): void {
  if (!elm.value) return
  const ok = confirm(
    'Clear stored trouble codes?\n\nThis erases the check-engine light, the stored freeze-frame data, and resets emissions readiness monitors. Note the codes first. Permanent codes are not affected.',
  )
  if (ok) void dtc.clear(elm.value)
}
</script>

<template>
  <div class="stack">
    <div v-if="!connected" class="banner warn">
      Not connected. Go to <RouterLink to="/connect">Connect</RouterLink> first (or start the
      simulator there).
    </div>

    <template v-else>
      <div class="row">
        <button class="primary" :disabled="loading" @click="readCodes">
          {{ loading ? 'Reading…' : 'Read codes' }}
        </button>
        <button v-if="hasRead" class="rec-btn" :disabled="clearing" @click="clearCodes">
          {{ clearing ? 'Clearing…' : 'Clear codes' }}
        </button>
        <span v-if="lastReadAt" class="muted">
          {{ total }} code{{ total === 1 ? '' : 's' }} · read
          {{ new Date(lastReadAt).toLocaleTimeString() }}
        </span>
      </div>

      <div v-if="error" class="banner danger">{{ error }}</div>

      <div v-if="!hasRead" class="card muted">
        Read the ECU for stored, pending, and permanent diagnostic trouble codes. Descriptions are
        shown for common generic (SAE) codes; manufacturer-specific codes are flagged.
      </div>

      <section v-for="s in sections" v-else :key="s.key" class="card stack">
        <div class="row" style="justify-content: space-between">
          <strong>{{ s.title }}</strong>
          <span class="muted">{{ s.codes.length }}</span>
        </div>
        <p class="muted section-note">{{ s.note }}</p>

        <p v-if="s.codes.length === 0" class="muted">No codes.</p>
        <ul v-else class="dtc-list">
          <li v-for="d in s.codes" :key="d.code" class="dtc-row">
            <span class="dtc-code" :class="`sys-${d.system}`">{{ d.code }}</span>
            <div class="dtc-info">
              <div>{{ d.description ?? 'No generic description available' }}</div>
              <div class="muted dtc-tags">
                {{ SYSTEM_LABELS[d.system] }}<template v-if="d.manufacturerSpecific">
                  · manufacturer-specific (needs Fiat data)</template>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <div class="banner warn">
        Reading codes is safe. <strong>Clearing</strong> only turns off the light — it does not fix
        the fault, and it wipes freeze-frame data useful for diagnosis. If the cause remains, the
        code returns.
      </div>
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
