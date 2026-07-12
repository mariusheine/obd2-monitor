<script setup lang="ts">
import { ref } from 'vue'

import InfoPopover from './InfoPopover.vue'

withDefaults(
  defineProps<{
    label: string
    display: string
    name?: string
    description?: string
    unit?: string
    experimental?: boolean
    highlight?: boolean
  }>(),
  { name: '', description: '', unit: '', experimental: false, highlight: false },
)

const open = ref(false)
</script>

<template>
  <div
    class="value-card"
    :class="{ experimental, highlight }"
    :title="name || label"
    role="button"
    tabindex="0"
    :aria-expanded="open"
    @click="open = !open"
    @keydown.enter.prevent="open = !open"
    @keydown.space.prevent="open = !open"
  >
    <span class="info-hint" aria-hidden="true">ⓘ</span>
    <div class="label">{{ label }}</div>
    <div class="value">
      {{ display }}<span v-if="unit" class="unit">{{ unit }}</span>
    </div>
    <InfoPopover
      v-if="open"
      :title="name || label"
      :description="description"
      @close="open = false"
    />
  </div>
</template>

<style scoped>
.value-card {
  position: relative;
  cursor: pointer;
}
.value-card.highlight {
  border-color: var(--ok);
  box-shadow: inset 0 0 0 1px var(--ok);
}
.info-hint {
  position: absolute;
  top: 0.35rem;
  right: 0.45rem;
  font-size: 0.7rem;
  color: var(--text-dim);
  opacity: 0.5;
}
</style>
