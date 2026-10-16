<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElMessageBox, ElNotification } from 'element-plus'
import SchemaRenderer from '@/components/schema/SchemaRenderer.vue'
import {
  loadComponentConfig,
  loadComponentConfigs,
  loadComponentDefinitions,
  saveComponentConfig,
} from '@/api/componentConfigs'
import { authState } from '@/stores/auth'
import {
  clearWorkbenchRecovery,
  saveWorkbenchRecovery,
  takeWorkbenchRecovery,
} from '@/stores/workbenchRecovery'
import {
  createDefaultComponentSchema,
  getComponentSchemaError,
  isComponentSchema,
  type ComponentConfig,
  type ComponentDefinition,
  type ComponentKey,
  type ComponentSchema,
} from '../../../shared/contracts/component-config.ts'

const navigation = withDefaults(defineProps<{ navigationManaged?: boolean }>(), {
  navigationManaged: false,
})
const emit = defineEmits<{ 'dirty-change': [dirty: boolean]; 'saving-change': [saving: boolean] }>()

const isAdmin = computed(() => authState.user?.role === 'admin')
const definitions = ref<ComponentDefinition[]>([])
const configurations = ref<ComponentConfig[]>([])
const category = ref('all')
const componentFilter = ref('all')
const filteredDefinitions = computed(() =>
  definitions.value.filter(
    (item) =>
      (category.value === 'all' || item.category === category.value) &&
      (componentFilter.value === 'all' || item.componentKey === componentFilter.value),
  ),
)
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const validationMessage = ref('')
const configId = ref('')
const updatedTime = ref('')
const componentKey = ref<ComponentKey>('input')
const name = ref('')
const propsJson = ref('')
const field = ref('')
const validationJson = ref('{}')
const actionsJson = ref('[]')
const preview = ref<ComponentSchema | null>(null)
const baseline = ref('')
const applying = ref(false)
const failedSave = ref(false)
let session = 0
let editorOwner = authState.user?.userId ?? ''
const recovered = ref(false)
const fingerprint = computed(() =>
  JSON.stringify([
    componentKey.value,
    name.value,
    propsJson.value,
    field.value,
    validationJson.value,
    actionsJson.value,
  ]),
)
const dirty = computed(() => !applying.value && fingerprint.value !== baseline.value)
const saveLabel = computed(() =>
  saving.value
    ? '正在保存'
    : failedSave.value
      ? '保存失败，修改仍保留'
      : dirty.value
        ? '存在未保存修改'
        : configId.value
          ? '已保存'
          : '未修改',
)
let confirming: Promise<boolean> | undefined
async function mayReplace() {
  if (saving.value) return false
  if (!dirty.value) return true
  if (confirming) return confirming
  const confirmationSession = session
  confirming = ElMessageBox.confirm(
    '当前 V1 组件配置尚未保存。放弃后将丢失这些修改。',
    '保留当前编辑？',
    {
      confirmButtonText: '放弃修改并继续',
      cancelButtonText: '继续编辑',
      type: 'warning',
      closeOnClickModal: false,
    },
  )
    .then(() => confirmationSession === session)
    .catch(() => false)
    .finally(() => {
      confirming = undefined
    })
  return confirming
}
onBeforeRouteLeave(() => navigation.navigationManaged || mayReplace())
function beforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value && !saving.value) return
  event.preventDefault()
  event.returnValue = ''
}
onBeforeUnmount(() => {
  if (!authState.user) preserveRecovery()
  else if (editorOwner) clearWorkbenchRecovery(`${editorOwner}:legacy`)
  session++
  window.removeEventListener('beforeunload', beforeUnload)
  emit('dirty-change', false)
  emit('saving-change', false)
})

function editSchema(schema: ComponentSchema, saved?: ComponentConfig) {
  applying.value = true
  componentKey.value = schema.componentKey
  name.value = schema.name
  propsJson.value = JSON.stringify(schema.props, null, 2)
  field.value = schema.componentKey === 'button' ? '' : (schema.field ?? '')
  validationJson.value = JSON.stringify(
    schema.componentKey === 'button' ? {} : (schema.validation ?? {}),
    null,
    2,
  )
  actionsJson.value = JSON.stringify(schema.actions ?? [], null, 2)
  configId.value = saved?.configId ?? ''
  updatedTime.value = saved?.updatedTime ?? ''
  preview.value = schema
  validationMessage.value = ''
  errorMessage.value = ''
  failedSave.value = false
  baseline.value = fingerprint.value
  applying.value = false
}
async function newConfiguration(key: ComponentKey = 'input') {
  const requestSession = session
  if (loading.value || !(await mayReplace()) || requestSession !== session) return
  editSchema(createDefaultComponentSchema(key))
}
editSchema(createDefaultComponentSchema('input'))
function recoverySnapshot() {
  return {
    componentKey: componentKey.value,
    name: name.value,
    propsJson: propsJson.value,
    field: field.value,
    validationJson: validationJson.value,
    actionsJson: actionsJson.value,
    configId: configId.value,
    updatedTime: updatedTime.value,
    baseline: baseline.value,
  }
}
function preserveRecovery() {
  if (editorOwner && dirty.value) saveWorkbenchRecovery(`${editorOwner}:legacy`, recoverySnapshot())
}
function restoreRecovery() {
  if (!editorOwner) return
  const saved = takeWorkbenchRecovery<ReturnType<typeof recoverySnapshot>>(`${editorOwner}:legacy`)
  if (!saved) return
  componentKey.value = saved.componentKey
  name.value = saved.name
  propsJson.value = saved.propsJson
  field.value = saved.field
  validationJson.value = saved.validationJson
  actionsJson.value = saved.actionsJson
  configId.value = saved.configId
  updatedTime.value = saved.updatedTime
  baseline.value = saved.baseline
  preview.value = null
  recovered.value = true
}
restoreRecovery()
watch(dirty, (value) => emit('dirty-change', value), { immediate: true, flush: 'sync' })
watch(saving, (value) => emit('saving-change', value), { immediate: true, flush: 'sync' })
watch(
  [name, propsJson, field, validationJson, actionsJson],
  () => {
    preview.value = null
    validationMessage.value = ''
  },
  { flush: 'sync' },
)

function validateConfiguration(): ComponentSchema | null {
  try {
    const props: unknown = JSON.parse(propsJson.value)
    const actions: unknown = JSON.parse(actionsJson.value)
    const candidate: unknown = {
      schemaVersion: 1,
      libraryKey: 'element-plus',
      componentKey: componentKey.value,
      name: name.value.trim(),
      props,
      children: [],
      actions,
      ...(componentKey.value === 'button'
        ? {}
        : {
            ...(field.value.trim() ? { field: field.value.trim() } : {}),
            validation: JSON.parse(validationJson.value) as unknown,
          }),
    }
    validationMessage.value = getComponentSchemaError(candidate) ?? ''
    if (!isComponentSchema(candidate)) {
      preview.value = null
      return null
    }
    preview.value = candidate
    return candidate
  } catch {
    validationMessage.value = '属性、校验规则和动作必须使用有效 JSON；请检查引号、逗号和括号。'
    preview.value = null
    return null
  }
}
async function refresh() {
  if (loading.value || saving.value || !isAdmin.value) return
  loading.value = true
  errorMessage.value = ''
  const requestSession = session
  try {
    const [available, stored] = await Promise.all([
      loadComponentDefinitions(),
      loadComponentConfigs(),
    ])
    if (requestSession !== session) return
    definitions.value = available
    configurations.value = stored
  } catch (error) {
    if (requestSession !== session) return
    errorMessage.value = error instanceof Error ? error.message : '加载组件配置失败'
  } finally {
    if (requestSession === session) loading.value = false
  }
}
async function openConfiguration(id: string) {
  if (loading.value || saving.value || !id || !isAdmin.value) return
  const requestSession = session
  if (!(await mayReplace()) || requestSession !== session) return
  loading.value = true
  errorMessage.value = ''
  try {
    const configuration = await loadComponentConfig(id)
    if (requestSession !== session) return
    editSchema(configuration.schema, configuration)
  } catch (error) {
    if (requestSession !== session) return
    errorMessage.value = error instanceof Error ? error.message : '加载组件配置失败'
  } finally {
    if (requestSession === session) loading.value = false
  }
}
async function save() {
  if (loading.value || saving.value || !isAdmin.value) return
  const schema = validateConfiguration()
  if (!schema) return
  saving.value = true
  errorMessage.value = ''
  failedSave.value = false
  const requestSession = session
  try {
    const saved = await saveComponentConfig(schema, configId.value || undefined)
    if (requestSession !== session) return
    configurations.value = [
      saved,
      ...configurations.value.filter((item) => item.configId !== saved.configId),
    ]
    editSchema(saved.schema, saved)
    ElNotification({
      title: '保存成功',
      message: '配置已保存，可以在组件展示页面读取并复用。',
      type: 'success',
    })
  } catch (error) {
    if (requestSession !== session) return
    failedSave.value = true
    errorMessage.value = error instanceof Error ? error.message : '保存组件配置失败'
  } finally {
    if (requestSession === session) saving.value = false
  }
}
const jsonEditorDisabled = computed(() => loading.value || saving.value)
const propsHint = computed(
  () =>
    definitions.value
      .find((item) => item.componentKey === componentKey.value)
      ?.configurableProps.join('、') ?? '',
)
watch(
  () => [authState.user?.userId, authState.user?.role],
  () => {
    if (!authState.user) preserveRecovery()
    else if (editorOwner && editorOwner !== authState.user.userId)
      clearWorkbenchRecovery(`${editorOwner}:legacy`)
    session++
    loading.value = false
    saving.value = false
    definitions.value = []
    configurations.value = []
    editSchema(createDefaultComponentSchema('input'))
    editorOwner = authState.user?.userId ?? ''
    recovered.value = false
    restoreRecovery()
    if (isAdmin.value) void refresh()
  },
)
onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
  void refresh()
})
</script>

<template>
  <section class="configuration-page">
    <el-alert v-if="!isAdmin" title="仅管理员可以配置组件" type="error" :closable="false" />
    <template v-else>
      <el-alert
        v-if="recovered"
        title="已恢复此账号在当前标签页中未保存的 V1 配置"
        type="info"
        :closable="true"
        @close="recovered = false"
      />
      <div class="page-header">
        <h1>组件配置</h1>
        <RouterLink to="/components">查看已保存的组件</RouterLink>
      </div>
      <p class="intro">
        选择现有组件，填写属性并预览，再保存为可复用的配置。输入预览仅在本页使用。
      </p>
      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        :closable="false"
        role="alert"
      />
      <el-card class="library-panel">
        <template #header>可用组件</template>
        <div class="filters">
          <label
            >组件库<el-select model-value="element-plus" aria-label="组件库" disabled
              ><el-option value="element-plus" label="Element Plus" /></el-select
          ></label>
          <label
            >需求类别<el-select v-model="category" aria-label="需求类别"
              ><el-option value="all" label="全部类别" /><el-option
                value="input"
                label="文字输入" /><el-option value="action" label="交互动作" /></el-select
          ></label>
          <label
            >组件类型<el-select v-model="componentFilter" aria-label="组件类型"
              ><el-option value="all" label="全部组件" /><el-option
                v-for="definition in definitions"
                :key="definition.componentKey"
                :value="definition.componentKey"
                :label="definition.name" /></el-select
          ></label>
        </div>
        <div class="definition-list">
          <el-card
            v-for="definition in filteredDefinitions"
            :key="definition.componentKey"
            shadow="never"
            class="definition-card"
          >
            <h2>{{ definition.name }}</h2>
            <p>{{ definition.description }}</p>
            <el-button
              :disabled="jsonEditorDisabled"
              @click="newConfiguration(definition.componentKey)"
              >使用{{ definition.name }}创建</el-button
            >
          </el-card>
          <p v-if="!loading && !filteredDefinitions.length">此类别暂无可用组件。</p>
        </div>
      </el-card>
      <div class="editor-layout">
        <el-card class="editor-panel">
          <template #header
            ><div class="section-header">
              <span>{{ configId ? '修改已保存配置' : '新建组件配置' }}</span
              ><el-tag :type="failedSave ? 'danger' : dirty ? 'warning' : 'info'" role="status">{{
                saveLabel
              }}</el-tag
              ><el-button :disabled="jsonEditorDisabled" @click="newConfiguration()"
                >新建配置</el-button
              >
            </div></template
          >
          <el-form label-position="top" :disabled="jsonEditorDisabled">
            <el-form-item label="已有配置">
              <el-select
                :model-value="configId || undefined"
                placeholder="选择并加载已保存的配置"
                aria-label="已有配置"
                @change="openConfiguration"
              >
                <el-option
                  v-for="configuration in configurations"
                  :key="configuration.configId"
                  :value="configuration.configId"
                  :label="`${configuration.schema.name}（${configuration.schema.componentKey}）`"
                />
              </el-select>
            </el-form-item>
            <div class="editor-toolbar">
              <el-button :loading="loading" :disabled="saving" @click="refresh">刷新列表</el-button
              ><el-button
                :disabled="!configId || jsonEditorDisabled"
                @click="openConfiguration(configId)"
                >重新加载当前配置</el-button
              >
            </div>
            <el-form-item
              label="配置名称"
              :error="
                name.length > 64 ? `最多 64 字符，当前 ${name.length}；内容已保留，请缩短。` : ''
              "
              ><el-input v-model="name" aria-label="配置名称"
            /></el-form-item>
            <p class="hint">组件：{{ componentKey }} · 允许的属性：{{ propsHint }}</p>
            <el-form-item label="组件属性（JSON）"
              ><el-input v-model="propsJson" type="textarea" :rows="7" aria-label="组件属性 JSON"
            /></el-form-item>
            <template v-if="componentKey !== 'button'">
              <el-form-item
                label="字段名（可选）"
                :error="
                  field.length > 32
                    ? `最多 32 字符，当前 ${field.length}；内容已保留，请缩短。`
                    : ''
                "
                ><el-input
                  v-model="field"
                  placeholder="字母开头，例如 ideaTitle"
                  aria-label="字段名"
              /></el-form-item>
              <el-form-item label="输入校验（JSON）"
                ><el-input
                  v-model="validationJson"
                  type="textarea"
                  :rows="4"
                  aria-label="输入校验 JSON"
              /></el-form-item>
              <p class="hint">
                例如：{"required": true, "minLength": 2, "maxLength": 100}，长度需与 maxlength
                一致。
              </p>
            </template>
            <template v-else>
              <el-form-item label="点击动作（JSON）"
                ><el-input
                  v-model="actionsJson"
                  type="textarea"
                  :rows="5"
                  aria-label="点击动作 JSON"
              /></el-form-item>
              <p class="hint">
                例如：[{"event":"click","actionKey":"show-message","message":"你好"}]；只支持已注册的消息提示动作。
              </p>
            </template>
          </el-form>
          <el-alert
            v-if="validationMessage"
            :title="validationMessage"
            type="error"
            :closable="false"
            role="alert"
          />
          <div class="editor-toolbar">
            <el-button :disabled="jsonEditorDisabled" @click="validateConfiguration"
              >校验并预览</el-button
            ><el-button type="primary" :loading="saving" :disabled="loading || saving" @click="save"
              >保存配置</el-button
            >
          </div>
          <p v-if="updatedTime" class="hint">
            上次保存：{{ new Date(updatedTime).toLocaleString() }}
          </p>
        </el-card>
        <el-card class="preview-panel"
          ><template #header>组件预览</template
          ><SchemaRenderer v-if="preview" :schema="preview" /><el-empty
            v-else
            description="修改后点击“校验并预览”查看效果"
        /></el-card>
      </div>
    </template>
  </section>
</template>

<style scoped>
.configuration-page {
  max-width: 1100px;
  margin: 24px auto;
}
.configuration-page,
.editor-panel,
.preview-panel,
.definition-card {
  min-width: 0;
  max-width: 100%;
}
.hint,
.configuration-page :deep(.el-alert__content) {
  overflow-wrap: anywhere;
}
.configuration-page :deep(.el-textarea__inner) {
  overflow-wrap: anywhere;
  word-break: break-word;
}
.configuration-page :deep(.el-form-item__error) {
  position: static;
  overflow-wrap: anywhere;
}
.page-header,
.section-header,
.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
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
  font-size: 13px;
  margin: 0 0 12px;
}
.library-panel {
  margin: 24px 0;
}
.filters,
.definition-list {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.filters {
  margin-bottom: 20px;
}
.filters label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 200px;
}
.definition-card {
  flex: 1 1 220px;
}
.definition-card h2 {
  font-size: 17px;
  margin: 0;
}
.editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  align-items: start;
  gap: 24px;
}
.editor-toolbar {
  justify-content: flex-start;
  margin: 16px 0;
}
.editor-panel :deep(.el-select) {
  width: 100%;
}
@media (max-width: 760px) {
  .editor-layout {
    grid-template-columns: 1fr;
  }
}
</style>
