<script lang="ts" setup>
import { ref, onMounted } from 'vue'
import { loadIdeas } from '@/api/ideas'
import type { Idea } from '@/types/idea'
import PageRegion from '@/components/workbench/PageRegion.vue'

const activities = ref<Idea[]>([])
const loading = ref(false)
const errorMessage = ref('')

const refresh = async () => {
    if (loading.value) return
    loading.value = true
    errorMessage.value = ''
    try {
        activities.value = await loadIdeas()
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '加载想法失败，请重试'
    } finally {
        loading.value = false
    }
}

const formatTime = (time: string) => time
    ? new Date(time).toLocaleString('zh-CN', { hour12: false })
    : '创建时间未记录'

onMounted(refresh)
</script>

<template>
    <section class="archive-area">
        <div class="archive-header">
            <h1>想法归档</h1>
            <el-button :loading="loading" @click="refresh">刷新</el-button>
        </div>
        <el-alert v-if="errorMessage" title="加载失败" :description="errorMessage" type="error" show-icon :closable="false" />
        <PageRegion page-key="archive" region-key="before-list" />
        <div v-loading="loading" class="archive-list" aria-live="polite" :aria-busy="loading">
            <el-empty v-if="!loading && !errorMessage && !activities.length" description="还没有想法，去首页记录第一条吧" />
            <el-timeline v-if="activities.length">
                <el-timeline-item
                    v-for="idea in activities"
                    :key="idea.ideaId"
                    :timestamp="formatTime(idea.createdTime)"
                    placement="top"
                >
                    <RouterLink :to="{ name: 'idea-detail', params: { ideaId: idea.ideaId } }" class="idea-content">{{ idea.ideaContent }}</RouterLink>
                </el-timeline-item>
            </el-timeline>
        </div>
        <PageRegion page-key="archive" region-key="after-list" />
    </section>
</template>

<style scoped>
.archive-area { width: min(100%, 720px); margin: 24px auto; }
.archive-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.archive-header h1 { margin: 0; }
.archive-list { min-height: 160px; margin-top: 24px; }
.idea-content { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; color: #409eff; }
</style>
