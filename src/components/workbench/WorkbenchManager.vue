<script setup lang="ts">
import { computed, ref } from 'vue'
import type { WorkbenchTemplate, PageConfig } from '../../../shared/contracts/workbench.ts'
const props = defineProps<{ templates: WorkbenchTemplate[]; pages: PageConfig[]; busy: boolean }>()
const emit = defineEmits<{ template: [id: string]; page: [id: string] }>()
const query = ref('')
const mode = ref('all')
const entries = computed(() =>
  [
    ...props.templates.map((item) => ({
      id: item.configId,
      kind: 'template' as const,
      name: item.schema.name,
      time: item.updatedTime,
      revision: item.revision,
      status: '可复用方案',
      detail: '已保存，选择位置后发布',
    })),
    ...props.pages.map((item) => ({
      id: item.pageConfigId,
      kind: 'page' as const,
      name: item.name,
      time: item.updatedTime,
      revision: item.draftRevision,
      status:
        item.status === 'published'
          ? '已发布'
          : item.status === 'changed'
            ? '有未发布修改'
            : '尚未发布',
      detail: `${item.target.pageKey}/${item.target.regionKey} · 发布 ${item.publishedRevision ? `r${item.publishedRevision}` : '无'}`,
    })),
  ]
    .filter(
      (item) =>
        (mode.value === 'all' || mode.value === item.kind) &&
        `${item.name} ${item.detail}`.toLowerCase().includes(query.value.toLowerCase()),
    )
    .sort((a, b) => b.time.localeCompare(a.time)),
)
function time(value: string) {
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}
</script>
<template>
  <div class="manager">
    <el-input
      v-model="query"
      clearable
      placeholder="搜索方案或发布位置"
      aria-label="搜索已保存内容"
    />
    <el-radio-group v-model="mode" aria-label="已保存内容类型">
      <el-radio-button value="all">全部</el-radio-button
      ><el-radio-button value="template">组件方案</el-radio-button
      ><el-radio-button value="page">页面草稿与发布</el-radio-button>
    </el-radio-group>
    <el-empty v-if="!entries.length" description="还没有匹配的已保存内容" />
    <article v-for="item in entries" :key="item.kind + item.id" class="saved-item">
      <div>
        <h3 :title="item.name">{{ item.name }}</h3>
        <p>{{ item.status }} · 已保存 r{{ item.revision }}</p>
        <p>{{ item.detail }}</p>
        <small>最近编辑：{{ time(item.time) }}（北京时间）</small>
      </div>
      <el-button
        :disabled="busy"
        @click="item.kind === 'template' ? emit('template', item.id) : emit('page', item.id)"
        >继续编辑</el-button
      >
    </article>
  </div>
</template>
<style scoped>
.manager {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.saved-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
}
.saved-item > div {
  min-width: 0;
  overflow-wrap: anywhere;
}
h3 {
  margin: 0;
  font-size: 16px;
}
p {
  margin: 6px 0;
  color: #606266;
}
@media (max-width: 480px) {
  .saved-item {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
