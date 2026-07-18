import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/connect' },
    {
      path: '/connect',
      name: 'connect',
      component: () => import('@/views/ConnectView.vue'),
      meta: { title: 'Connect' },
    },
    {
      path: '/live',
      name: 'live',
      component: () => import('@/views/LiveView.vue'),
      meta: { title: 'Live' },
    },
    {
      path: '/sessions',
      name: 'sessions',
      component: () => import('@/views/SessionsView.vue'),
      meta: { title: 'Sessions' },
    },
    {
      path: '/sessions/:folderName',
      name: 'review',
      component: () => import('@/views/ReviewView.vue'),
      meta: { title: 'Review' },
    },
    {
      path: '/dtc',
      name: 'dtc',
      component: () => import('@/views/DtcView.vue'),
      meta: { title: 'Codes' },
    },
    {
      path: '/dpf',
      name: 'dpf',
      component: () => import('@/views/DpfAnalysisView.vue'),
      meta: { title: 'DPF' },
    },
    {
      path: '/discovery',
      name: 'discovery',
      component: () => import('@/views/DiscoveryView.vue'),
      meta: { title: 'Discover PIDs' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: { title: 'Settings' },
    },
  ],
})
