<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    display: string
    unit?: string
    experimental?: boolean
    highlight?: boolean
  }>(),
  { unit: '', experimental: false, highlight: false },
)
</script>

<template>
  <div class="value-card" :class="{ experimental, highlight }" :title="label">
    <div class="label">{{ label }}</div>
    <div class="value">
      {{ display }}<span v-if="unit" class="unit">{{ unit }}</span>
    </div>
  </div>
</template>

<style scoped>
.value-card.highlight {
  border-color: var(--ok);
  box-shadow: inset 0 0 0 1px var(--ok);
}
</style>
