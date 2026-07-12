<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'

defineProps<{
  title: string
  description: string
}>()

const emit = defineEmits<{ close: [] }>()

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <!-- Transparent full-viewport backdrop: reliable outside-tap dismiss on touch.
       .stop keeps the dismiss tap from bubbling to the tile's own toggle handler. -->
  <div class="info-backdrop" @click.stop="emit('close')"></div>
  <div class="info-popover" role="tooltip" @click.stop>
    <div class="info-title">{{ title }}</div>
    <div v-if="description" class="info-desc">{{ description }}</div>
  </div>
</template>

<style scoped>
.info-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}
.info-popover {
  position: absolute;
  z-index: 21;
  left: 0.5rem;
  right: 0.5rem;
  bottom: calc(100% + 0.25rem);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.6rem 0.7rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  text-align: left;
  text-transform: none;
  letter-spacing: normal;
  cursor: auto;
}
.info-title {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text);
  line-height: 1.25;
}
.info-desc {
  margin-top: 0.25rem;
  font-size: 0.78rem;
  font-weight: 400;
  color: var(--text-dim);
  line-height: 1.35;
}
</style>
