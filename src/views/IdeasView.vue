<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { loadIdeas } from '@/api/ideas'
import type { Idea } from '@/types/idea'

const ideas = ref<Idea[]>([])
const loading = ref(false)
const errorMessage = ref('')
async function refresh() {
    if (loading.value) return
    loading.value = true
    errorMessage.value = ''
    try { ideas.value = await loadIdeas() }
    catch (error) { errorMessage.value = error instanceof Error ? error.message : '加载失败，请重试' }
    finally { loading.value = false }
}
const formatTime = (time: string) => time ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '创建时间未记录'
onMounted(refresh)
</script>

<template>
    <section class="ideas-area">
        <div class="page-header"><h1>我的想法</h1><el-button :loading="loading" @click="refresh">刷新</el-button></div>
        <el-alert v-if="errorMessage" title="加载失败" :description="errorMessage" type="error" show-icon :closable="false" />
        <div v-loading="loading" class="cards-area" :aria-busy="loading" aria-live="polite">
            <el-empty v-if="!loading && !errorMessage && !ideas.length" description="还没有想法，去首页记录第一条吧" />
            <div v-if="ideas.length" class="ideas-grid">
                <RouterLink v-for="idea in ideas" :key="idea.ideaId" :to="{ name: 'idea-detail', params: { ideaId: idea.ideaId } }" class="idea-link">
                    <el-card shadow="hover" class="idea-card">
                        <p class="idea-content">{{ idea.ideaContent }}</p>
                        <time class="idea-time" :datetime="idea.createdTime || undefined">{{ formatTime(idea.createdTime) }}</time>
                    </el-card>
                </RouterLink>
            </div>
        </div>
    </section>
</template>

<style scoped>
.ideas-area { max-width: 1100px; margin: 24px auto; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.page-header h1 { margin: 0; }
.cards-area { min-height: 160px; margin-top: 24px; }
.ideas-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 20px; }
.idea-link { text-decoration: none; color: inherit; }
.idea-link:focus-visible { outline: 3px solid #409eff; outline-offset: 4px; }
.idea-card { height: 100%; }
.idea-card :deep(.el-card__body) { display: flex; flex-direction: column; gap: 20px; height: 100%; box-sizing: border-box; }
.idea-content { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; flex: 1; }
.idea-time { color: #606266; font-size: 13px; }
</style>
