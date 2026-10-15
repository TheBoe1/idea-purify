<script setup lang="ts">
import { computed, onMounted, provide, ref, shallowRef, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElNotification } from 'element-plus'
import { authState } from '@/stores/auth'
import { getSessionGeneration } from '@/api/http'
import {
  loadTemplates,
  loadTemplate,
  saveTemplate,
  loadPageConfigs,
  loadPageConfig,
  savePageConfig,
  publishPageConfig,
} from '@/api/workbench'
import {
  createDefaultSchemaV2,
  getRuntimeSchemaError,
  getPageTargetError,
  isSchemaV2,
  DATA_SOURCE_KEYS,
  EXISTING_PAGE_REGIONS,
  type SchemaV2,
  type TypedValue,
  type WorkbenchTemplate,
  type PageConfig,
  type PageTarget,
  type RuntimeSchema,
} from '../../shared/contracts/workbench.ts'
import type { ComponentSchema } from '../../shared/contracts/component-config.ts'
import NodeListEditor from '@/components/workbench/NodeListEditor.vue'
import TypedValueEditor from '@/components/workbench/TypedValueEditor.vue'
import WorkbenchRenderer from '@/components/workbench/WorkbenchRenderer.vue'
import LegacyConfigEditor from '@/components/workbench/LegacyConfigEditor.vue'
import { declareStateKey, makeApiNode } from '@/components/workbench/editor-model'
const route = useRoute()
const isAdmin = computed(() => authState.user?.role === 'admin')
const tab = ref('workbench')
const document = ref() as Ref<SchemaV2>
document.value = createDefaultSchemaV2()
const templates = shallowRef<WorkbenchTemplate[]>([])
const pages = shallowRef<PageConfig[]>([])
const currentTemplate = shallowRef<WorkbenchTemplate>()
const currentPage = shallowRef<PageConfig>()
const preview = shallowRef<RuntimeSchema>()
const legacySchema = shallowRef<ComponentSchema>()
const editingSchema = computed<RuntimeSchema>(() => legacySchema.value ?? document.value)
const previewRevision = ref(0)
const error = ref('')
const feedback = ref('')
const busy = ref(false)
const loading = ref(false)
const stateName = ref('')
const resourceName = ref('')
const pageName = ref('新页面')
const targetKind = ref<'dynamic' | 'existing'>('dynamic')
const dynamicKey = ref('new-page')
const existingKey = ref<keyof typeof EXISTING_PAGE_REGIONS>('home')
const region = ref<string>('after-entry')
const target = computed<PageTarget>(() =>
  targetKind.value === 'dynamic'
    ? { kind: 'dynamic', pageKey: dynamicKey.value, regionKey: 'root' }
    : { kind: 'existing', pageKey: existingKey.value, regionKey: region.value },
)
const validation = computed(() => getRuntimeSchemaError(editingSchema.value))
const publishedLink = computed(() =>
  !currentPage.value
    ? undefined
    : currentPage.value.target.kind === 'dynamic'
      ? `/pages/${currentPage.value.target.pageKey}`
      : { home: '/', archive: '/archive', ideas: '/ideas', 'idea-detail': '/ideas' }[
          currentPage.value.target.pageKey
        ],
)
watch(
  existingKey,
  (key) => {
    region.value = EXISTING_PAGE_REGIONS[key][0]
  },
  { flush: 'sync' },
)
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
function newDocument() {
  document.value = createDefaultSchemaV2()
  currentTemplate.value = undefined
  currentPage.value = undefined
  legacySchema.value = undefined
  preview.value = undefined
  error.value = ''
  feedback.value = ''
}
function newPageBinding() {
  currentPage.value = undefined
  pageName.value = `${document.value.name}页面`
  error.value = ''
  feedback.value = ''
}
function addState() {
  if (
    !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(stateName.value) ||
    ['constructor', 'prototype', '__proto__'].includes(stateName.value)
  ) {
    error.value = '状态名称需使用安全标识符'
    return
  }
  document.value.state[stateName.value] = { kind: 'literal', value: '' }
  stateName.value = ''
}
function updateState(key: string, value: TypedValue) {
  document.value.state[key] = value
}
provide(declareStateKey, updateState)
function removeState(key: string) {
  delete document.value.state[key]
}
function addResource() {
  if (
    !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(resourceName.value) ||
    document.value.resources.some((item) => item.resourceId === resourceName.value)
  ) {
    error.value = '数据源名称无效或重复'
    return
  }
  document.value.resources.push({
    resourceId: resourceName.value,
    sourceKey: 'static',
    data: { kind: 'array', items: [] },
  })
  resourceName.value = ''
}
function validate() {
  error.value = validation.value ?? ''
  if (error.value) return false
  preview.value = copy(editingSchema.value)
  previewRevision.value++
  return true
}
async function refresh() {
  if (loading.value) return
  const generation = getSessionGeneration()
  loading.value = true
  error.value = ''
  try {
    const [list, bound] = await Promise.all([loadTemplates(), loadPageConfigs()])
    if (generation !== getSessionGeneration()) return
    templates.value = list
    pages.value = bound
  } catch (failure) {
    if (generation === getSessionGeneration())
      error.value = failure instanceof Error ? failure.message : '刷新失败'
  } finally {
    loading.value = false
  }
}
function edit(saved: WorkbenchTemplate | PageConfig) {
  error.value = ''
  feedback.value = ''
  tab.value = 'workbench'
  if (!isSchemaV2(saved.schema)) {
    legacySchema.value = copy(saved.schema)
    preview.value = copy(saved.schema)
    previewRevision.value++
    feedback.value =
      '当前选择V1方案，页面绑定与发布保留原有Schema；修改原配置可切换“V1兼容配置”并加载对应配置。'
    return
  }
  legacySchema.value = undefined
  document.value = copy(saved.schema)
  preview.value = copy(saved.schema)
  previewRevision.value++
}
async function openTemplate(id: string) {
  if (busy.value) return
  busy.value = true
  const generation = getSessionGeneration()
  try {
    const saved = await loadTemplate(id)
    if (generation !== getSessionGeneration()) return
    currentTemplate.value = saved
    currentPage.value = undefined
    edit(saved)
  } catch (failure) {
    if (generation === getSessionGeneration())
      error.value = failure instanceof Error ? failure.message : '加载方案失败'
  } finally {
    busy.value = false
  }
}
async function openPage(id: string) {
  if (busy.value) return
  busy.value = true
  const generation = getSessionGeneration()
  try {
    const saved = await loadPageConfig(id)
    if (generation !== getSessionGeneration()) return
    currentPage.value = saved
    currentTemplate.value = undefined
    pageName.value = saved.name
    targetKind.value = saved.target.kind
    if (saved.target.kind === 'dynamic') dynamicKey.value = saved.target.pageKey
    else {
      existingKey.value = saved.target.pageKey
      region.value = saved.target.regionKey
    }
    edit(saved)
  } catch (failure) {
    if (generation === getSessionGeneration())
      error.value = failure instanceof Error ? failure.message : '加载页面失败'
  } finally {
    busy.value = false
  }
}
async function save(kind: 'template' | 'page') {
  if (kind === 'template' && legacySchema.value) {
    error.value = 'V1方案请在兼容编辑器保存，或新建V2方案'
    return
  }
  if (busy.value || !validate()) return
  if (kind === 'page') {
    const failure = getPageTargetError(target.value)
    if (failure) {
      error.value = failure
      return
    }
  }
  busy.value = true
  const generation = getSessionGeneration()
  try {
    if (kind === 'template') {
      const saved = await saveTemplate(copy(document.value), currentTemplate.value)
      if (generation !== getSessionGeneration()) return
      currentTemplate.value = saved
      feedback.value = `方案已保存，版本 ${saved.revision}`
    } else {
      const saved = await savePageConfig(
        pageName.value.trim(),
        target.value,
        copy(editingSchema.value),
        currentPage.value,
      )
      if (generation !== getSessionGeneration()) return
      currentPage.value = saved
      feedback.value = `页面草稿已保存，版本 ${saved.draftRevision}；发布后用户可见`
    }
    await refresh()
  } catch (failure) {
    if (generation === getSessionGeneration())
      error.value = failure instanceof Error ? failure.message : '保存失败'
  } finally {
    busy.value = false
  }
}
async function publish() {
  if (busy.value || !currentPage.value) return
  if (JSON.stringify(editingSchema.value) !== JSON.stringify(currentPage.value.schema)) {
    error.value = '当前修改尚未保存，请先保存页面草稿'
    return
  }
  busy.value = true
  const generation = getSessionGeneration()
  try {
    const saved = await publishPageConfig(currentPage.value)
    if (generation !== getSessionGeneration()) return
    currentPage.value = saved
    feedback.value = `页面已发布，版本 ${saved.publishedRevision}`
    ElNotification({
      title: '发布成功',
      message: '打开目标页面或刷新即可使用冻结的发布版本',
      type: 'success',
    })
    await refresh()
  } catch (failure) {
    if (generation === getSessionGeneration())
      error.value = failure instanceof Error ? failure.message : '发布失败'
  } finally {
    busy.value = false
  }
}
onMounted(() => {
  if (!isAdmin.value) return
  void refresh()
  const key = String(route.query.apiKey ?? '')
  if (key) {
    try {
      document.value.root.push(makeApiNode(key, updateState))
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : '无法创建节点'
    }
  }
})
</script>
<template>
  <section class="workbench-page">
    <el-alert v-if="!isAdmin" title="需要管理员权限" type="warning" :closable="false" /><template
      v-else
      ><div class="page-header">
        <h1>方案工作台</h1>
        <div>
          <el-button :loading="loading" :disabled="busy" @click="refresh">刷新列表</el-button
          ><el-button :disabled="busy" @click="newDocument">新建方案</el-button>
        </div>
      </div>
      <p class="intro">
        选择官方
        API、配置属性与插槽、绑定安全策略，再保存方案或发布到项目页面。预览输入与本人业务数据不写入方案。
      </p>
      <el-alert v-if="error" :title="error" type="error" :closable="false" role="alert" /><el-alert
        v-if="feedback"
        :title="feedback"
        type="success"
        :closable="false"
        role="status"
      />
      <el-tabs v-model="tab"
        ><el-tab-pane label="Schema 工作台" name="workbench"
          ><div class="editor-layout">
            <div class="editor">
              <el-form label-position="top" :disabled="busy"
                ><el-form-item label="已保存方案"
                  ><el-select
                    :model-value="currentTemplate?.configId"
                    clearable
                    aria-label="已保存方案"
                    @change="$event && openTemplate($event)"
                    ><el-option
                      v-for="item in templates"
                      :key="item.configId"
                      :value="item.configId"
                      :label="`${item.schema.name} · V${item.schema.schemaVersion} · r${item.revision}`" /></el-select></el-form-item
                ><el-button
                  :disabled="!currentTemplate || busy"
                  @click="currentTemplate && openTemplate(currentTemplate.configId)"
                  >重新加载当前方案</el-button
                ><el-form-item v-if="!legacySchema" label="方案名称"
                  ><el-input
                    v-model="document.name"
                    maxlength="64"
                    aria-label="方案名称" /></el-form-item
              ></el-form>
              <el-alert
                v-if="legacySchema"
                :title="`V1方案：${legacySchema.name}`"
                type="info"
                :closable="false"
              />
              <el-collapse v-if="!legacySchema"
                ><el-collapse-item title="实例状态与双向绑定" name="state"
                  ><div v-for="(value, key) in document.state" :key="key" class="value-entry">
                    <TypedValueEditor
                      :model-value="value"
                      :schema="document"
                      :label="String(key)"
                      @update:model-value="updateState(String(key), $event)"
                    /><el-button @click="removeState(String(key))">删除状态</el-button>
                  </div>
                  <div class="inline">
                    <el-input
                      v-model="stateName"
                      placeholder="状态名称"
                      aria-label="新增状态名称"
                    /><el-button @click="addState">添加状态</el-button>
                  </div></el-collapse-item
                ><el-collapse-item title="登记数据源" name="resources"
                  ><div
                    v-for="(resource, index) in document.resources"
                    :key="resource.resourceId"
                    class="value-entry"
                  >
                    <strong>{{ resource.resourceId }}</strong
                    ><el-select v-model="resource.sourceKey" aria-label="数据源类型"
                      ><el-option
                        v-for="key in DATA_SOURCE_KEYS"
                        :key="key"
                        :value="key"
                        :label="key" /></el-select
                    ><TypedValueEditor
                      v-if="
                        resource.sourceKey === 'static' || resource.sourceKey === 'preview-tree'
                      "
                      :model-value="resource.data ?? { kind: 'array', items: [] }"
                      :schema="document"
                      label="数据内容"
                      @update:model-value="resource.data = $event"
                    /><TypedValueEditor
                      :model-value="{ kind: 'object', entries: resource.params ?? {} }"
                      :schema="document"
                      label="数据参数"
                      @update:model-value="
                        $event.kind === 'object' && (resource.params = $event.entries)
                      "
                    />
                    <p v-if="resource.sourceKey === 'current-user-ideas'" class="hint">
                      预览使用模拟数据；发布页面按真实会话读取本人想法，私有数据不持久化到方案。
                    </p>
                    <el-button @click="document.resources.splice(index, 1)">删除数据源</el-button>
                  </div>
                  <div class="inline">
                    <el-input
                      v-model="resourceName"
                      placeholder="数据源标识"
                      aria-label="新增数据源标识"
                    /><el-button @click="addResource">添加数据源</el-button>
                  </div></el-collapse-item
                ></el-collapse
              >
              <NodeListEditor
                v-if="!legacySchema"
                v-model="document.root"
                :schema="document"
                label="根节点"
              />
              <div class="toolbar">
                <el-button :disabled="busy" @click="validate">校验并预览</el-button
                ><el-button
                  type="primary"
                  :loading="busy"
                  :disabled="loading || Boolean(legacySchema)"
                  @click="save('template')"
                  >保存方案</el-button
                >
              </div>
              <p v-if="validation" class="validation" role="status">待修正：{{ validation }}</p>
              <el-card class="publication"
                ><template #header
                  ><div class="page-header">
                    <span>页面绑定与发布</span
                    ><el-button :disabled="busy" @click="newPageBinding">新建页面绑定</el-button>
                  </div></template
                ><el-form label-position="top" :disabled="busy"
                  ><el-form-item label="已有页面配置"
                    ><el-select
                      :model-value="currentPage?.pageConfigId"
                      clearable
                      aria-label="已有页面配置"
                      @change="$event && openPage($event)"
                      ><el-option
                        v-for="page in pages"
                        :key="page.pageConfigId"
                        :value="page.pageConfigId"
                        :label="`${page.name} · ${page.target.pageKey}/${page.target.regionKey} · ${page.status}`" /></el-select></el-form-item
                  ><el-button
                    :disabled="!currentPage || busy"
                    @click="currentPage && openPage(currentPage.pageConfigId)"
                    >重新加载页面配置</el-button
                  ><el-form-item label="页面配置名称"
                    ><el-input v-model="pageName" aria-label="页面配置名称" /></el-form-item
                  ><el-form-item label="挂载方式"
                    ><el-radio-group
                      v-model="targetKind"
                      :disabled="Boolean(currentPage)"
                      aria-label="挂载方式"
                      ><el-radio-button value="dynamic">独立配置页面</el-radio-button
                      ><el-radio-button value="existing"
                        >既有页面区域</el-radio-button
                      ></el-radio-group
                    ></el-form-item
                  ><el-form-item v-if="targetKind === 'dynamic'" label="pageKey"
                    ><el-input
                      v-model="dynamicKey"
                      :disabled="Boolean(currentPage)"
                      aria-label="独立页面标识"
                    /><span class="hint"
                      >固定入口 /pages/{{ dynamicKey }}，不能配置 import 或路由源码。</span
                    ></el-form-item
                  ><template v-else
                    ><el-form-item label="项目页面"
                      ><el-select
                        v-model="existingKey"
                        :disabled="Boolean(currentPage)"
                        aria-label="项目页面"
                        ><el-option
                          v-for="(_, key) in EXISTING_PAGE_REGIONS"
                          :key="key"
                          :value="key"
                          :label="key" /></el-select></el-form-item
                    ><el-form-item label="注册区域"
                      ><el-select
                        v-model="region"
                        :disabled="Boolean(currentPage)"
                        aria-label="注册区域"
                        ><el-option
                          v-for="key in EXISTING_PAGE_REGIONS[existingKey]"
                          :key="key"
                          :value="key"
                          :label="key" /></el-select></el-form-item></template
                ></el-form>
                <div class="toolbar">
                  <el-button :loading="busy" @click="save('page')">保存页面草稿</el-button
                  ><el-button type="primary" :disabled="!currentPage || busy" @click="publish"
                    >发布已保存版本</el-button
                  >
                </div>
                <p v-if="currentPage" class="hint">
                  草稿 r{{ currentPage.draftRevision }} · 发布
                  {{ currentPage.publishedRevision ?? '尚未发布' }} · {{ currentPage.status }}
                </p>
                <RouterLink
                  v-if="currentPage?.publishedRevision && publishedLink"
                  :to="publishedLink"
                  >打开已发布页面</RouterLink
                ></el-card
              >
            </div>
            <aside class="preview">
              <el-card
                ><template #header>运行预览</template
                ><WorkbenchRenderer
                  v-if="preview"
                  :schema="preview"
                  mode="preview"
                  :runtime-key="String(previewRevision)" /><el-empty
                  v-else
                  description="点击校验并预览"
              /></el-card>
            </aside></div></el-tab-pane
        ><el-tab-pane label="V1 兼容配置" name="legacy"
          ><LegacyConfigEditor v-if="tab === 'legacy'" /></el-tab-pane
      ></el-tabs>
    </template>
  </section>
</template>
<style scoped>
.workbench-page {
  max-width: 1500px;
  margin: 24px auto;
}
.page-header,
.toolbar,
.inline {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.page-header {
  justify-content: space-between;
}
.page-header h1 {
  margin: 0;
}
.intro,
.hint {
  color: #606266;
  line-height: 1.6;
}
.hint {
  font-size: 12px;
}
.editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(300px, 1fr);
  gap: 24px;
}
.editor {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}
.editor :deep(.el-select) {
  width: 100%;
}
.value-entry {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0;
}
.preview {
  position: sticky;
  top: 24px;
  align-self: start;
  min-width: 0;
}
.publication {
  margin-top: 20px;
}
.validation {
  color: #b25213;
  overflow-wrap: anywhere;
}
.inline {
  flex-wrap: nowrap;
}
@media (max-width: 1000px) {
  .editor-layout {
    grid-template-columns: 1fr;
  }
  .preview {
    position: static;
  }
}
</style>
