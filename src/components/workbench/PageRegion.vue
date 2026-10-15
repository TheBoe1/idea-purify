<script setup lang="ts">
import { ref, watch } from 'vue'
import { ApiError, getSessionGeneration } from '@/api/http'
import { loadPublishedPage } from '@/api/workbench'
import { authState } from '@/stores/auth'
import type { PublishedPage } from '../../../shared/contracts/workbench.ts'
import WorkbenchRenderer from './WorkbenchRenderer.vue'
const props = defineProps<{ pageKey: string; regionKey: string }>()
const page = ref<PublishedPage>()
const error = ref('')
let requestId = 0
watch(
  [() => props.pageKey, () => props.regionKey, () => authState.user?.userId],
  async () => {
    const request = ++requestId,
      generation = getSessionGeneration()
    page.value = undefined
    error.value = ''
    if (!authState.user) return
    try {
      const saved = await loadPublishedPage(props.pageKey, props.regionKey)
      if (request === requestId && generation === getSessionGeneration()) page.value = saved
    } catch (failure) {
      if (
        request !== requestId ||
        generation !== getSessionGeneration() ||
        (failure instanceof ApiError && failure.status === 404)
      )
        return
      error.value = failure instanceof Error ? failure.message : '加载页面区域失败'
    }
  },
  { immediate: true },
)
</script>
<template>
  <section
    v-if="page || error"
    class="page-region"
    :aria-label="`${pageKey} ${regionKey} 配置区域`"
  >
    <el-alert v-if="error" :title="error" type="error" :closable="false" /><WorkbenchRenderer
      v-else-if="page"
      :schema="page.schema"
      mode="published"
      :runtime-key="`${page.pageConfigId}-${page.publishedRevision}`"
    />
  </section>
</template>
<style scoped>
.page-region {
  margin: 24px auto;
  max-width: 1100px;
}
</style>
