<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ELEMENT_PLUS_CATALOG,
  ELEMENT_PLUS_VERSION,
  type CatalogEntry,
} from '../../shared/catalog/element-plus.ts'
import { authState } from '@/stores/auth'

const props = defineProps<{ embedded?: boolean }>()
const emit = defineEmits<{ select: [apiKey: string] }>()
const query = ref('')
const category = ref('all')
const purpose = ref('all')
const categories = computed(() => [...new Set(ELEMENT_PLUS_CATALOG.map((entry) => entry.category))])
const purposeRules: Record<string, { label: string; keys: string[] }> = {
  'remote-search': {
    label: '输入并检索',
    keys: ['autocomplete', 'select', 'select-v2', 'mention', 'tree-select'],
  },
  'large-data': {
    label: '大量数据展示',
    keys: ['table-v2', 'tree-v2', 'select-v2', 'infinite-scroll', 'pagination'],
  },
  'form-validation': {
    label: '表单与校验',
    keys: [
      'form',
      'input',
      'input-number',
      'input-otp',
      'select',
      'checkbox',
      'radio',
      'date-picker',
    ],
  },
  feedback: {
    label: '操作反馈',
    keys: [
      'alert',
      'message',
      'message-box',
      'notification',
      'loading',
      'dialog',
      'drawer',
      'popconfirm',
    ],
  },
}
const entries = computed(() =>
  ELEMENT_PLUS_CATALOG.filter((entry) => {
    if (category.value !== 'all' && entry.category !== category.value) return false
    if (purpose.value !== 'all' && !purposeRules[purpose.value]?.keys.includes(entry.key))
      return false
    const searchable = [
      entry.title,
      entry.name,
      entry.key,
      entry.category,
      entry.purpose,
      ...entry.useWhen,
      ...entry.constraints,
      ...entry.tags,
    ]
      .join(' ')
      .toLowerCase()
    return query.value
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .every((term) => searchable.includes(term))
  }),
)
function counts(entry: CatalogEntry) {
  return entry.apis.reduce(
    (count, api) => ({
      props: count.props + api.props.length,
      events: count.events + api.events.length,
      slots: count.slots + api.slots.length,
    }),
    { props: 0, events: 0, slots: 0 },
  )
}
const kindLabels: Record<string, string> = {
  component: '组件',
  composite: '组合能力',
  service: '服务调用',
  directive: '指令',
  design: '设计规范',
}
</script>

<template>
  <section class="catalog-page">
    <el-alert
      v-if="authState.user?.role !== 'admin'"
      title="仅管理员可以使用组件目录"
      type="error"
      :closable="false"
    />
    <template v-else>
      <h1 v-if="!props.embedded">组件目录</h1>
      <p class="hint">
        Element Plus {{ ELEMENT_PLUS_VERSION }} ·
        {{ ELEMENT_PLUS_CATALOG.length }} 个官方条目。按用途查找，直接添加到当前方案。
      </p>
      <div class="catalog-filters">
        <el-input
          v-model="query"
          clearable
          placeholder="搜索名称、用途或组件标识"
          aria-label="搜索组件"
        />
        <el-select v-model="category" aria-label="组件分类"
          ><el-option value="all" label="全部分类" /><el-option
            v-for="item in categories"
            :key="item"
            :value="item"
            :label="item"
        /></el-select>
        <el-select v-model="purpose" aria-label="功能需求"
          ><el-option value="all" label="全部用途" /><el-option
            v-for="(rule, key) in purposeRules"
            :key="key"
            :value="key"
            :label="rule.label"
        /></el-select>
      </div>
      <p role="status">找到 {{ entries.length }} 个条目</p>
      <el-empty v-if="!entries.length" description="没有匹配条目，试试其他关键词或用途" />
      <div class="catalog-grid">
        <el-card v-for="entry in entries" :key="entry.key" class="catalog-card">
          <template #header
            ><div class="card-header">
              <h2>
                {{ entry.name }}<small>{{ entry.title }}</small>
              </h2>
              <el-tag size="small">{{ kindLabels[entry.kind] }}</el-tag>
            </div></template
          >
          <p>{{ entry.category }} · {{ entry.key }}</p>
          <p>{{ entry.purpose }}</p>
          <p class="selection-note"><strong>适用：</strong>{{ entry.useWhen.join('；') }}</p>
          <p class="selection-note"><strong>约束：</strong>{{ entry.constraints.join('；') }}</p>
          <p v-if="entry.kind !== 'design'">
            {{ counts(entry).props }} 个属性 · {{ counts(entry).events }} 个事件 ·
            {{ counts(entry).slots }} 个插槽
          </p>
          <p v-else>设计参数与样式预览，组件事件和插槽不适用。</p>
          <div class="card-actions">
            <el-button
              v-if="props.embedded"
              type="primary"
              @click="emit('select', entry.rootApiKeys[0]!)"
              >添加{{ entry.name }}</el-button
            >
            <RouterLink
              v-else
              :to="{
                path: '/admin/workbench',
                query: { component: entry.key, apiKey: entry.rootApiKeys[0] },
              }"
              >选择并配置</RouterLink
            ><a :href="entry.docsUrl" target="_blank" rel="noopener noreferrer">官方文档</a>
          </div>
        </el-card>
      </div>
    </template>
  </section>
</template>

<style scoped>
.catalog-page {
  margin: 24px 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.hint {
  color: #606266;
  line-height: 1.6;
}
.catalog-filters {
  display: grid;
  grid-template-columns: minmax(220px, 2fr) minmax(140px, 1fr) minmax(160px, 1fr);
  gap: 16px;
}
.catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  gap: 16px;
}
.card-header,
.card-actions {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}
.card-header h2 {
  margin: 0;
  font-size: 18px;
}
.card-header small {
  display: block;
  font-size: 12px;
  font-weight: normal;
  color: #606266;
  margin-top: 4px;
}
.selection-note {
  font-size: 13px;
  line-height: 1.6;
}
.card-actions a {
  color: #409eff;
}
@media (max-width: 760px) {
  .catalog-filters {
    grid-template-columns: 1fr;
  }
}
</style>
