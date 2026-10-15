<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { authState } from '@/stores/auth'
import { getAdminMenuRoutes } from '@/router/routes'

const route = useRoute()
const isAdmin = computed(() => authState.user?.role === 'admin')
const links = getAdminMenuRoutes()
</script>

<template>
  <el-alert v-if="!isAdmin" title="仅管理员可以访问管理区域" type="error" :closable="false" />
  <section v-else class="admin-layout">
    <aside class="admin-sidebar">
      <h1>管理区域</h1>
      <nav aria-label="管理导航">
        <RouterLink
          v-for="item in links"
          :key="item.path"
          :to="`/admin/${item.path}`"
          :class="{ active: route.path === `/admin/${item.path}` }"
          >{{ item.meta?.title }}</RouterLink
        >
      </nav>
    </aside>
    <div class="admin-content"><RouterView /></div>
  </section>
</template>

<style scoped>
.admin-layout {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 24px;
  max-width: 1440px;
  margin: 0 auto;
}
.admin-sidebar {
  background: #f5f7fa;
  padding: 20px;
  border-radius: 8px;
}
.admin-sidebar h1 {
  margin: 0 0 24px;
  font-size: 20px;
}
.admin-sidebar nav {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.admin-sidebar a {
  color: #303133;
  text-decoration: none;
  padding: 10px;
  border-radius: 4px;
}
.admin-sidebar a.active {
  color: #409eff;
  background: #ecf5ff;
}
.admin-content {
  min-width: 0;
}
@media (max-width: 760px) {
  .admin-layout {
    grid-template-columns: 1fr;
  }
  .admin-sidebar nav {
    flex-direction: row;
    flex-wrap: wrap;
  }
  .admin-sidebar h1 {
    margin-bottom: 12px;
  }
}
</style>
