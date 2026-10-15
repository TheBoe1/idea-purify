<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { loadPublishedPage } from '@/api/workbench'
import { getSessionGeneration } from '@/api/http'
import { authState } from '@/stores/auth'
import type { PublishedPage } from '../../shared/contracts/workbench.ts'
import WorkbenchRenderer from '@/components/workbench/WorkbenchRenderer.vue'
const route = useRoute(),
  page = ref<PublishedPage>(),
  loading = ref(false),
  error = ref('')
let requestId = 0
watch(
  [() => route.params.pageKey, () => authState.user?.userId],
  async () => {
    const request = ++requestId,
      generation = getSessionGeneration()
    loading.value = true
    page.value = undefined
    error.value = ''
    try {
      const saved = await loadPublishedPage(String(route.params.pageKey ?? ''))
      if (request === requestId && generation === getSessionGeneration()) page.value = saved
    } catch (failure) {
      if (request === requestId && generation === getSessionGeneration())
        error.value = failure instanceof Error ? failure.message : '加载页面失败'
    } finally {
      if (request === requestId) loading.value = false
    }
  },
  { immediate: true },
)
</script>
<template>
  <section v-loading="loading" class="dynamic-page">
    <h1>{{ page?.name ?? '配置页面' }}</h1>
    <el-alert v-if="error" :title="error" type="error" :closable="false" /><WorkbenchRenderer
      v-if="page"
      :schema="page.schema"
      mode="published"
      :runtime-key="`${page.pageConfigId}-${page.publishedRevision}`"
    />
  </section>
</template>
<style scoped>
.dynamic-page {
  max-width: 1200px;
  margin: 24px auto;
  min-height: 160px;
}
</style>
