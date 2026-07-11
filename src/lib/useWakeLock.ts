import { onScopeDispose, ref, type Ref } from 'vue'

/**
 * Screen Wake Lock composable — keeps the phone screen on while monitoring in the
 * car. The lock is dropped by the browser when the tab is hidden, so it is
 * re-acquired on `visibilitychange` whenever it is still wanted.
 */
export function useWakeLock(): {
  isSupported: boolean
  active: Ref<boolean>
  setWanted: (wanted: boolean) => Promise<void>
} {
  const isSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator
  const active = ref(false)
  let wanted = false
  let sentinel: WakeLockSentinel | null = null

  async function acquire(): Promise<void> {
    if (!isSupported || sentinel) return
    try {
      sentinel = await navigator.wakeLock.request('screen')
      sentinel.addEventListener('release', handleRelease)
      active.value = true
    } catch {
      active.value = false
    }
  }

  function handleRelease(): void {
    active.value = false
    sentinel = null
  }

  async function releaseLock(): Promise<void> {
    const current = sentinel
    sentinel = null
    active.value = false
    if (current) {
      try {
        await current.release()
      } catch {
        // Already released.
      }
    }
  }

  async function setWanted(next: boolean): Promise<void> {
    wanted = next
    if (next) await acquire()
    else await releaseLock()
  }

  function handleVisibility(): void {
    if (wanted && typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void acquire()
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility)
  }

  onScopeDispose(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
    void releaseLock()
  })

  return { isSupported, active, setWanted }
}
