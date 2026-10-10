<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { loadIdea } from '@/api/ideas'
import type { Idea } from '@/types/idea'

const route = useRoute()
const idea = ref<Idea | null>(null)
const loading = ref(false)
const errorMessage = ref('')
let requestId = 0
async function refresh() {
    const currentRequest = ++requestId
    idea.value = null
    errorMessage.value = ''
    loading.value = true
    try {
        const result = await loadIdea(String(route.params.ideaId ?? ''))
        if (currentRequest === requestId) idea.value = result
    } catch (error) {
        if (currentRequest === requestId) errorMessage.value = error instanceof Error ? error.message : '加载想法失败'
    } finally {
        if (currentRequest === requestId) loading.value = false
    }
}
const formatTime = (time: string) => time ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '创建时间未记录'
watch(() => route.params.ideaId, refresh, { immediate: true })
</script>

<template>
    <section class="detail-area">
        <div class="page-header"><h1>想法详情</h1><RouterLink to="/ideas">返回想法列表</RouterLink></div>
        <el-alert v-if="errorMessage" title="无法查看想法" :description="errorMessage" type="error" show-icon :closable="false" />
        <div v-loading="loading" class="detail-content" :aria-busy="loading">
            <el-card v-if="idea">
                <time :datetime="idea.createdTime || undefined">{{ formatTime(idea.createdTime) }}</time>
                <p class="idea-content">{{ idea.ideaContent }}</p>
            </el-card>
        </div>
    </section>
</template>

<style scoped>
.detail-area { max-width: 800px; margin: 24px auto; }
.page-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
.page-header h1 { margin: 0; }
.page-header a { color: #409eff; }
.detail-content { min-height: 160px; }
time { color: #606266; font-size: 14px; }
.idea-content { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; }
</style>
