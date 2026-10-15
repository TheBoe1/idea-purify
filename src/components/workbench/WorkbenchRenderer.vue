<script setup lang="ts">
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  nextTick,
} from 'vue'
import { getRuntimeSchemaError, isSchemaV2 } from '../../../shared/contracts/workbench.ts'
import { authState } from '@/stores/auth'
import SchemaRenderer from '@/components/schema/SchemaRenderer.vue'
import { isComponentSchema } from '../../../shared/contracts/component-config.ts'
import { createWorkbenchRuntime } from './runtime'
const props = withDefaults(
  defineProps<{ schema: unknown; mode?: 'preview' | 'published'; runtimeKey?: string }>(),
  { mode: 'preview', runtimeKey: '' },
)
const root = ref<HTMLElement>()
const runtime = shallowRef<ReturnType<typeof createWorkbenchRuntime>>()
const initializationError = ref('')
const error = computed(() => getRuntimeSchemaError(props.schema))
const RenderNodes = defineComponent({
  setup: () => () =>
    runtime.value
      ? h(
          'div',
          { class: 'runtime-nodes' },
          runtime.value.renderNodes(isSchemaV2(props.schema) ? props.schema.root : []),
        )
      : null,
})
let revision = 0
watch(
  [() => props.schema, () => props.mode, () => props.runtimeKey, () => authState.user?.userId],
  async () => {
    const request = ++revision
    runtime.value?.dispose()
    runtime.value = undefined
    initializationError.value = ''
    if (!isSchemaV2(props.schema)) return
    try {
      const engine = createWorkbenchRuntime(props.schema, props.mode)
      runtime.value = engine
      await nextTick()
      if (request !== revision) return
      if (root.value) engine.setTarget('root', root.value)
      await engine.initialize()
    } catch (failure) {
      if (request === revision)
        initializationError.value = failure instanceof Error ? failure.message : '初始化数据失败'
    }
  },
  { immediate: true, deep: true },
)
onBeforeUnmount(() => {
  revision++
  runtime.value?.dispose()
})
defineExpose({ runtime })
</script>
<template>
  <div ref="root" class="workbench-runtime">
    <el-alert v-if="error" :title="error" type="error" :closable="false" role="alert" /><el-alert
      v-else-if="initializationError"
      :title="initializationError"
      type="error"
      :closable="false"
      role="alert"
    /><SchemaRenderer v-else-if="isComponentSchema(schema)" :schema="schema" /><RenderNodes
      v-else
    />
  </div>
</template>
<style scoped>
.workbench-runtime {
  min-height: 80px;
  overflow-wrap: anywhere;
}
.workbench-runtime :deep(.runtime-nodes) {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.workbench-runtime :deep(.design-preview) {
  padding: 20px;
}
</style>
