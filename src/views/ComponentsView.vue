<script setup lang="ts">
import { onMounted, ref } from 'vue'
import SchemaRenderer from '@/components/schema/SchemaRenderer.vue'
import { loadComponentConfigs } from '@/api/componentConfigs'
import type { ComponentConfig } from '../../shared/contracts/component-config.ts'

const configurations = ref<ComponentConfig[]>([])
const loading = ref(false)
const errorMessage = ref('')
async function refresh() {
    if (loading.value) return
    loading.value = true
    errorMessage.value = ''
    try { configurations.value = await loadComponentConfigs() }
    catch (error) { errorMessage.value = error instanceof Error ? error.message : '加载组件失败' }
    finally { loading.value = false }
}
onMounted(refresh)
</script>

<template>
    <section class="components-page">
        <div class="page-header"><h1>组件展示</h1><el-button :loading="loading" @click="refresh">刷新组件</el-button></div>
        <p class="hint">这些组件来自管理员保存的配置。可以试用输入与按钮；输入值仅在当前页面保留，不会保存到服务端。</p>
        <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" role="alert" />
        <p v-if="loading" role="status">正在加载组件…</p>
        <el-empty v-else-if="!errorMessage && !configurations.length" description="暂无已保存的组件配置" />
        <div class="component-grid" :aria-busy="loading">
            <el-card v-for="configuration in configurations" :key="configuration.configId">
                <template #header><div class="card-header"><span>{{ configuration.schema.name }}</span><el-tag size="small">{{ configuration.schema.componentKey }}</el-tag></div></template>
                <SchemaRenderer :schema="configuration.schema" />
            </el-card>
        </div>
    </section>
</template>

<style scoped>
.components-page { max-width: 1100px; margin: 24px auto; }
.page-header, .card-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.page-header h1 { margin: 0; }
.hint { color: #606266; line-height: 1.6; margin-bottom: 24px; }
.component-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 24px; margin-top: 24px; }
</style>
