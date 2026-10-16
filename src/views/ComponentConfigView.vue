<script setup lang="ts">
import {
  computed,
  onMounted,
  nextTick,
  onBeforeUnmount,
  provide,
  ref,
  shallowRef,
  watch,
  type Ref,
} from 'vue'
import { useRoute, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { ElNotification, ElMessageBox } from 'element-plus'
import { authState } from '@/stores/auth'
import { ApiError, getSessionGeneration } from '@/api/http'
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
import ComponentsView from './ComponentsView.vue'
import WorkbenchManager from '@/components/workbench/WorkbenchManager.vue'
import {
  registerWorkbenchLeaveGuard,
  saveWorkbenchRecovery,
  takeWorkbenchRecovery,
  clearWorkbenchRecovery,
} from '@/stores/workbenchRecovery'
import { simpleForm } from '@/components/workbench/starter'
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
const managerOpen = ref(false)
const catalogOpen = ref(false)
const publishOpen = ref<string[]>([])
const publicationSection = ref<{ $el: HTMLElement }>()
async function showPublication() {
  publishOpen.value = ['publish']
  await nextTick()
  publicationSection.value?.$el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'failed'>('idle')
const publishStatus = ref<'idle' | 'publishing' | 'failed'>('idle')
const conflict = ref(false)
const baselineSchema = ref(JSON.stringify(editingSchema.value))
const pageFingerprint = computed(() =>
  JSON.stringify({ name: pageName.value, target: target.value }),
)
const baselinePage = ref(pageFingerprint.value)
const schemaDirty = computed(() => JSON.stringify(editingSchema.value) !== baselineSchema.value)
const pageDirty = computed(() => pageFingerprint.value !== baselinePage.value)
const legacyDirty = ref(false)
const legacySaving = ref(false)
const recovered = ref(false)
const recoveryOwner = authState.user?.userId ?? ''
let discardRecovery = false
const dirty = computed(() => schemaDirty.value || pageDirty.value || legacyDirty.value)
const stateLabel = computed(() =>
  busy.value && saveStatus.value === 'saving'
    ? '正在保存'
    : saveStatus.value === 'failed'
      ? '保存失败，修改仍保留'
      : dirty.value
        ? '存在未保存修改'
        : saveStatus.value === 'saved'
          ? '保存成功'
          : '未修改',
)
const pageHasUnsavedChanges = computed(() =>
  Boolean(
    currentPage.value &&
    (JSON.stringify(editingSchema.value) !== JSON.stringify(currentPage.value.schema) ||
      pageName.value.trim() !== currentPage.value.name),
  ),
)
const publicationLabel = computed(() =>
  publishStatus.value === 'publishing'
    ? '正在发布'
    : publishStatus.value === 'failed'
      ? '发布失败，可重试'
      : !currentPage.value?.publishedRevision
        ? '尚未发布'
        : currentPage.value.status === 'changed' || pageHasUnsavedChanges.value
          ? '已发布 · 有待发布修改'
          : `已发布 r${currentPage.value.publishedRevision}`,
)
function markBaseline() {
  recovered.value = false
  baselineSchema.value = JSON.stringify(editingSchema.value)
  baselinePage.value = pageFingerprint.value
  saveStatus.value = 'idle'
  publishStatus.value = 'idle'
  conflict.value = false
}
async function mayReplace() {
  if (busy.value || legacySaving.value) return false
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm('当前修改尚未保存。离开后将丢失这些修改。', '保留当前编辑？', {
      confirmButtonText: '放弃修改并继续',
      cancelButtonText: '继续编辑',
      type: 'warning',
      closeOnClickModal: false,
    })
    return true
  } catch {
    return false
  }
}
async function mayLeave() {
  const allowed = await mayReplace()
  if (allowed) discardRecovery = true
  return allowed
}
onBeforeRouteLeave(mayLeave)
const unregisterLeave = registerWorkbenchLeaveGuard(recoveryOwner, mayReplace)
onBeforeRouteUpdate(
  async (to, from) => to.query.apiKey === from.query.apiKey || (await mayReplace()),
)
function beforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value && !busy.value && !legacySaving.value) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => {
  unregisterLeave()
  window.removeEventListener('beforeunload', beforeUnload)
  clearTimeout(previewTimer)
  if (dirty.value && !discardRecovery && isAdmin.value !== false)
    saveWorkbenchRecovery(recoveryOwner, recoverySnapshot())
  else if (dirty.value && !discardRecovery && !authState.user)
    saveWorkbenchRecovery(recoveryOwner, recoverySnapshot())
  else clearWorkbenchRecovery(recoveryOwner)
})
function recoverySnapshot() {
  return copy({
    tab: tab.value,
    document: document.value,
    legacySchema: legacySchema.value,
    currentTemplate: currentTemplate.value,
    currentPage: currentPage.value,
    pageName: pageName.value,
    target: target.value,
    baselineSchema: baselineSchema.value,
    baselinePage: baselinePage.value,
  })
}
function restoreRecovery() {
  const saved = takeWorkbenchRecovery<ReturnType<typeof recoverySnapshot>>(recoveryOwner)
  if (!saved) return false
  tab.value = saved.tab
  document.value = saved.document
  legacySchema.value = saved.legacySchema
  currentTemplate.value = saved.currentTemplate
  currentPage.value = saved.currentPage
  pageName.value = saved.pageName
  targetKind.value = saved.target.kind
  if (saved.target.kind === 'dynamic') dynamicKey.value = saved.target.pageKey
  else {
    existingKey.value = saved.target.pageKey
    region.value = saved.target.regionKey
  }
  baselineSchema.value = saved.baselineSchema
  baselinePage.value = saved.baselinePage
  recovered.value = true
  return true
}
async function beforeTabLeave() {
  return !legacySaving.value && (!legacyDirty.value || (await mayReplace()))
}

let previewTimer: ReturnType<typeof setTimeout>
watch(
  editingSchema,
  () => {
    feedback.value = ''
    clearTimeout(previewTimer)
    previewTimer = setTimeout(() => {
      if (validation.value) return
      preview.value = copy(editingSchema.value)
      previewRevision.value++
    }, 250)
  },
  { deep: true, immediate: true },
)
watch(pageFingerprint, () => {
  feedback.value = ''
})
function addComponent(key: string) {
  if (busy.value || legacySchema.value) return
  try {
    document.value.root.push(makeApiNode(key, updateState))
    catalogOpen.value = false
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '添加失败'
  }
}
async function startForm() {
  if (!(await mayReplace())) return
  resetDocument()
  document.value = simpleForm()
}

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
function resetDocument() {
  tab.value = 'workbench'
  legacyDirty.value = false
  document.value = createDefaultSchemaV2()
  currentTemplate.value = undefined
  currentPage.value = undefined
  legacySchema.value = undefined
  preview.value = undefined
  error.value = ''
  feedback.value = ''
  pageName.value = '新页面'
  targetKind.value = 'dynamic'
  dynamicKey.value = 'new-page'
  markBaseline()
}
async function newDocument() {
  if (await mayReplace()) resetDocument()
}
async function newPageBinding() {
  if (!(await mayReplace()) || busy.value) return
  currentPage.value = undefined
  pageName.value = `${editingSchema.value.name}页面`
  publishOpen.value = ['publish']
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
  if (Object.hasOwn(document.value.state, stateName.value)) {
    error.value = '状态名称已存在，请更换名称，原值已保留'
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
  if (!(await mayReplace()) || busy.value) return
  busy.value = true
  const generation = getSessionGeneration()
  try {
    const saved = await loadTemplate(id)
    if (generation !== getSessionGeneration()) return
    currentTemplate.value = saved
    currentPage.value = undefined
    edit(saved)
    markBaseline()
    managerOpen.value = false
  } catch (failure) {
    if (generation === getSessionGeneration())
      error.value = failure instanceof Error ? failure.message : '加载方案失败'
  } finally {
    busy.value = false
  }
}
async function openPage(id: string) {
  if (!(await mayReplace()) || busy.value) return
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
    markBaseline()
    managerOpen.value = false
  } catch (failure) {
    if (generation === getSessionGeneration())
      error.value = failure instanceof Error ? failure.message : '加载页面失败'
  } finally {
    busy.value = false
  }
}
async function save(kind: 'template' | 'page', asCopy = false) {
  if (kind === 'template' && legacySchema.value) {
    error.value = 'V1方案请在兼容编辑器保存，或新建V2方案'
    return
  }
  if (busy.value || !validate()) return
  if (kind === 'page') {
    const failure =
      !pageName.value.trim() || Array.from(pageName.value).length > 64
        ? '页面配置名称需为1–64个字符'
        : getPageTargetError(target.value)
    if (failure) {
      error.value = failure
      return
    }
  }
  busy.value = true
  saveStatus.value = 'saving'
  feedback.value = ''
  error.value = ''
  conflict.value = false
  const submitted = copy(editingSchema.value)
  const submittedPage = pageFingerprint.value
  const generation = getSessionGeneration()
  try {
    if (kind === 'template') {
      const saved = await saveTemplate(
        submitted as SchemaV2,
        asCopy ? undefined : currentTemplate.value,
      )
      if (generation !== getSessionGeneration()) return
      currentTemplate.value = saved
      if (asCopy) {
        currentPage.value = undefined
        baselinePage.value = submittedPage
      }
      feedback.value = `方案已保存，版本 ${saved.revision}`
    } else {
      const saved = await savePageConfig(
        pageName.value.trim(),
        target.value,
        submitted,
        currentPage.value,
      )
      if (generation !== getSessionGeneration()) return
      currentPage.value = saved
      feedback.value = `页面草稿已保存，版本 ${saved.draftRevision}；发布后用户可见`
    }
    if (kind === 'page' || !currentPage.value) baselineSchema.value = JSON.stringify(submitted)
    if (kind === 'page') baselinePage.value = submittedPage
    recovered.value = false
    saveStatus.value = 'saved'
    await refresh()
  } catch (failure) {
    if (generation === getSessionGeneration()) {
      error.value = failure instanceof Error ? failure.message : '保存失败，检查网络后重试'
      saveStatus.value = 'failed'
      conflict.value = failure instanceof ApiError && failure.status === 409
    }
  } finally {
    busy.value = false
  }
}
async function saveCopy() {
  await save('template', true)
}
async function publish() {
  if (busy.value || !currentPage.value) return
  if (pageHasUnsavedChanges.value) {
    error.value = '当前修改尚未保存，请先保存页面草稿'
    return
  }
  busy.value = true
  publishStatus.value = 'publishing'
  error.value = ''
  feedback.value = ''
  const generation = getSessionGeneration()
  try {
    const saved = await publishPageConfig(currentPage.value)
    if (generation !== getSessionGeneration()) return
    currentPage.value = saved
    publishStatus.value = 'idle'
    conflict.value = false
    feedback.value = `页面已发布，版本 ${saved.publishedRevision}`
    ElNotification({
      title: '发布成功',
      message: '打开目标页面或刷新即可使用冻结的发布版本',
      type: 'success',
    })
    await refresh()
  } catch (failure) {
    if (generation === getSessionGeneration()) {
      error.value = failure instanceof Error ? failure.message : '发布失败，检查网络后重试'
      publishStatus.value = 'failed'
      conflict.value = failure instanceof ApiError && failure.status === 409
    }
  } finally {
    busy.value = false
  }
}
watch(
  () => route.query.apiKey,
  (key, old) => {
    if (key && key !== old && isAdmin.value) addComponent(String(key))
  },
)
onMounted(() => {
  if (!isAdmin.value) return
  const didRestore = restoreRecovery()
  void refresh()
  const key = String(route.query.apiKey ?? '')
  if (key && !didRestore) {
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
        <div class="workflow-actions">
          <el-button
            type="primary"
            :loading="saveStatus === 'saving'"
            :disabled="busy || Boolean(legacySchema)"
            @click="save(currentPage ? 'page' : 'template')"
            >保存草稿</el-button
          ><el-button :disabled="busy" @click="managerOpen = true">方案管理</el-button
          ><el-button :disabled="busy || Boolean(legacySchema)" @click="catalogOpen = true"
            >添加组件</el-button
          ><el-button :disabled="busy" @click="showPublication">选择发布位置</el-button>
        </div>
        <div>
          <el-button :loading="loading" :disabled="busy" @click="refresh">刷新列表</el-button
          ><el-button :disabled="busy" @click="newDocument">新建方案</el-button>
        </div>
      </div>
      <el-alert
        v-if="recovered"
        title="已恢复本账号中断前的编辑，修改尚未保存到服务器"
        type="warning"
        :closable="true"
        @close="recovered = false"
      />
      <div class="work-status" role="status" aria-live="polite">
        <el-tag :type="saveStatus === 'failed' ? 'danger' : dirty ? 'warning' : 'info'">{{
          stateLabel
        }}</el-tag
        ><el-tag>{{ publicationLabel }}</el-tag
        ><span v-if="currentTemplate">组件方案 r{{ currentTemplate.revision }}</span
        ><span v-if="currentPage">页面草稿 r{{ currentPage.draftRevision }}</span>
      </div>
      <div v-if="conflict" class="toolbar">
        <el-button v-if="!currentPage && !currentTemplate" @click="managerOpen = true"
          >查看已占用位置与已有草稿</el-button
        ><el-button
          v-if="currentPage || currentTemplate"
          :disabled="busy"
          @click="
            currentPage
              ? openPage(currentPage.pageConfigId)
              : currentTemplate && openTemplate(currentTemplate.configId)
          "
          >重新加载最新版本</el-button
        ><el-button :disabled="busy || Boolean(legacySchema)" @click="saveCopy"
          >保留修改，另存为新方案</el-button
        >
      </div>
      <el-alert v-if="error" :title="error" type="error" :closable="false" role="alert" /><el-alert
        v-if="feedback"
        :title="feedback"
        :type="dirty ? 'info' : 'success'"
        :closable="false"
        role="status"
      />
      <el-tabs v-model="tab" :before-leave="beforeTabLeave"
        ><el-tab-pane label="可视化编辑" name="workbench"
          ><div class="editor-layout">
            <div class="editor" :inert="busy">
              <div v-if="!legacySchema && !document.root.length" class="quick-start">
                <h2>从哪里开始？</h2>
                <el-button type="primary" @click="startForm">从简单表单开始</el-button
                ><el-button @click="catalogOpen = true">选择第一个组件</el-button
                ><el-button
                  text
                  @click="
                    document.root.push({
                      kind: 'text',
                      nodeId: 'text-' + Date.now(),
                      value: { kind: 'literal', value: '内容' },
                    })
                  "
                  >空白方案，直接编辑</el-button
                >
              </div>
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
                ><el-form-item
                  v-if="!legacySchema"
                  label="方案名称"
                  :error="
                    Array.from(document.name).length > 64
                      ? `方案名称最多64个字符，已输入${Array.from(document.name).length}个；内容未截断`
                      : undefined
                  "
                  ><el-input
                    v-model="document.name"
                    :class="{ 'is-invalid': Array.from(document.name).length > 64 }"
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
              <el-collapse ref="publicationSection" v-model="publishOpen"
                ><el-collapse-item title="选择发布位置与页面草稿" name="publish"
                  ><el-card class="publication"
                    ><template #header
                      ><div class="page-header">
                        <span>页面绑定与发布</span
                        ><el-button :disabled="busy" @click="newPageBinding"
                          >新建页面绑定</el-button
                        >
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
                      ><el-form-item
                        label="页面配置名称"
                        :error="
                          Array.from(pageName).length > 64
                            ? '页面配置名称最多64个字符，内容未截断'
                            : undefined
                        "
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
                      ><el-form-item
                        v-if="targetKind === 'dynamic'"
                        label="pageKey"
                        :error="getPageTargetError(target)"
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
                  ></el-collapse-item
                ></el-collapse
              >
            </div>
            <aside class="preview">
              <el-card
                ><template #header
                  >实时预览
                  <el-tag v-if="validation" type="warning"
                    >待修正，保留上次有效预览</el-tag
                  ></template
                ><WorkbenchRenderer
                  v-if="preview"
                  :schema="preview"
                  mode="preview"
                  :runtime-key="String(previewRevision)" /><el-empty
                  v-else
                  description="添加组件后自动预览"
              /></el-card>
            </aside></div></el-tab-pane
        ><el-tab-pane label="V1 兼容配置" name="legacy"
          ><LegacyConfigEditor
            v-if="tab === 'legacy'"
            navigation-managed
            @dirty-change="legacyDirty = $event"
            @saving-change="legacySaving = $event" /></el-tab-pane
      ></el-tabs>
      <el-drawer
        v-model="catalogOpen"
        title="添加组件到当前方案"
        size="min(900px, 100vw)"
        :destroy-on-close="true"
        ><ComponentsView embedded @select="addComponent"
      /></el-drawer>
      <el-drawer v-model="managerOpen" title="方案管理" size="min(760px, 100vw)"
        ><WorkbenchManager
          :templates="templates"
          :pages="pages"
          :busy="busy"
          @template="openTemplate"
          @page="openPage"
      /></el-drawer>
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
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
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
  flex-wrap: wrap;
}
@media (max-width: 1000px) {
  .editor-layout {
    grid-template-columns: 1fr;
  }
  .preview {
    position: static;
  }
}
.work-status,
.workflow-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  margin: 12px 0;
}
.quick-start {
  padding: 16px;
  border: 1px dashed #a0cfff;
  border-radius: 8px;
  background: #f0f7ff;
}
.quick-start h2 {
  font-size: 16px;
}
.workbench-page,
.value-entry,
.publication {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.editor :deep(.el-form-item__content) {
  min-width: 0;
}
.editor :deep(.el-input),
.editor :deep(.el-select) {
  min-width: 0;
  max-width: 100%;
}
.preview :deep(.el-card__body) {
  min-width: 0;
  overflow: auto;
  max-height: 75vh;
}
@media (max-width: 600px) {
  .editor-layout {
    display: flex;
    flex-direction: column;
  }
  .preview {
    order: -1;
  }
  .inline > :deep(.el-input) {
    flex: 1 1 160px;
  }
}
</style>
