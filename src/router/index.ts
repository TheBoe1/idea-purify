import { createRouter, createWebHistory } from 'vue-router'

import ArchiveView from '@/views/ArchiveView.vue'
import HomeView from '@/views/HomeView.vue'
import IdeasView from '@/views/IdeasView.vue'
import IdeaDetailView from '@/views/IdeaDetailView.vue'
import AdminView from '@/views/AdminView.vue'
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
  },
  { path: '/ideas', name: 'ideas', component: IdeasView },
  { path: '/ideas/:ideaId', name: 'idea-detail', component: IdeaDetailView },
  { path: '/admin', name: 'admin', component: AdminView },
  { path: '/reset-password', name: 'reset-password', component: HomeView },
  { path: '/verify-email', name: 'verify-email', component: HomeView },
],
})

export default router
