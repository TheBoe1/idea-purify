import { createRouter, createWebHistory } from 'vue-router'

import ArchiveView from '@/views/ArchiveView.vue'
import HomeView from '@/views/home.vue'
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/archive',
      name: 'archive',
      component: ArchiveView,
  },
  {
    path: '/',
    name: 'home',
    component: HomeView
  }
],
})

export default router
