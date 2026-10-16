<script setup lang="ts">
import { inject, ref, watch } from 'vue'
import { findElementPlusApi } from '../../../shared/catalog/element-plus.ts'
import type { SchemaV2, WorkbenchNode } from '../../../shared/contracts/workbench.ts'
import { declareStateKey, makeApiNode, nodeId, renderableApis } from './editor-model'
import NodeEditor from './NodeEditor.vue'
const props = withDefaults(
  defineProps<{
    modelValue: WorkbenchNode[]
    schema: SchemaV2
    scopeNames?: string[]
    label?: string
  }>(),
  { scopeNames: () => [], label: '节点' },
)
const emit = defineEmits<{ 'update:modelValue': [value: WorkbenchNode[]] }>()
const selected = ref('input')
const expandedNodeId = ref<string>()
watch(
  () => props.modelValue.map((node) => node.nodeId),
  (ids, previous) => {
    const added = ids.filter((id) => !previous?.includes(id))
    if (!previous) expandedNodeId.value = ids[0]
    else if (added.length) expandedNodeId.value = added.at(-1)
    else if (expandedNodeId.value && !ids.includes(expandedNodeId.value))
      expandedNodeId.value = ids[0]
  },
  { immediate: true },
)
function nodeLabel(node: WorkbenchNode) {
  if (node.kind === 'text')
    return node.value.kind === 'literal' ? `文本：${String(node.value.value)}` : '文本内容'
  if (node.kind === 'business') return '想法录入表单'
  if (node.kind === 'for') return '循环内容'
  if (node.kind === 'if') return '条件内容'
  return findElementPlusApi(node.apiKey)?.runtimeExport ?? node.apiKey
}
const declareState = inject(declareStateKey, undefined)
function add() {
  let node: WorkbenchNode
  if (selected.value === 'text')
    node = { kind: 'text', nodeId: nodeId('text'), value: { kind: 'literal', value: '内容' } }
  else if (selected.value === 'for')
    node = {
      kind: 'for',
      nodeId: nodeId('for'),
      items: { kind: 'array', items: [] },
      itemName: 'item',
      indexName: 'index',
      children: [],
    }
  else if (selected.value === 'if')
    node = {
      kind: 'if',
      nodeId: nodeId('if'),
      test: { kind: 'literal', value: true },
      children: [],
    }
  else if (selected.value === 'business:idea-entry')
    node = { kind: 'business', nodeId: nodeId('idea-entry'), apiKey: 'business:idea-entry' }
  else node = makeApiNode(selected.value, declareState)
  emit('update:modelValue', [...props.modelValue, node])
}
function move(index: number, delta: number) {
  const nodes = [...props.modelValue]
  const target = index + delta
  if (target < 0 || target >= nodes.length) return
  ;[nodes[index], nodes[target]] = [nodes[target]!, nodes[index]!]
  emit('update:modelValue', nodes)
}
</script>
<template>
  <div class="node-list">
    <div
      v-for="(node, index) in modelValue"
      :key="node.nodeId"
      class="node-item"
      :class="{ active: expandedNodeId === node.nodeId }"
      :data-node-id="node.nodeId"
    >
      <div class="node-toolbar">
        <button
          class="node-select"
          type="button"
          :title="`${nodeLabel(node)} · ${node.nodeId}`"
          :aria-expanded="expandedNodeId === node.nodeId"
          @click="expandedNodeId = expandedNodeId === node.nodeId ? undefined : node.nodeId"
        >
          <span class="node-name">{{ index + 1 }}. {{ nodeLabel(node) }}</span
          ><span>{{ expandedNodeId === node.nodeId ? '收起' : '编辑' }}</span></button
        ><el-button size="small" :disabled="index === 0" @click="move(index, -1)">上移</el-button
        ><el-button size="small" :disabled="index === modelValue.length - 1" @click="move(index, 1)"
          >下移</el-button
        ><el-button
          size="small"
          @click="
            emit(
              'update:modelValue',
              modelValue.filter((_, i) => i !== index),
            )
          "
          >删除节点</el-button
        >
      </div>
      <NodeEditor
        v-if="expandedNodeId === node.nodeId"
        :model-value="node"
        :schema="schema"
        :scope-names="scopeNames"
        @update:model-value="
          emit(
            'update:modelValue',
            modelValue.map((entry, i) => (i === index ? $event : entry)),
          )
        "
      />
    </div>
    <div class="node-toolbar">
      <el-select v-model="selected" filterable :aria-label="`${label} 类型`"
        ><el-option value="text" label="文本节点" /><el-option
          value="for"
          label="循环节点" /><el-option value="if" label="条件节点" /><el-option
          value="business:idea-entry"
          label="业务：想法录入" /><el-option
          v-for="api in renderableApis"
          :key="api.apiKey"
          :value="api.apiKey"
          :label="`${api.runtimeExport} · ${api.apiKey}`" /></el-select
      ><el-button @click="add">添加{{ label }}</el-button>
    </div>
  </div>
</template>
<style scoped>
.node-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  max-width: 100%;
}
.node-item {
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 12px;
  min-width: 0;
}
.node-item.active {
  border-color: #409eff;
}
.node-list .node-list .node-list .node-item {
  padding-inline: 4px;
}
.node-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
.node-toolbar :deep(.el-select) {
  flex: 1 1 160px;
  min-width: 0;
  max-width: 100%;
}
.node-select {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  width: 100%;
  border: 0;
  background: transparent;
  color: #303133;
  cursor: pointer;
  text-align: left;
  padding: 5px 0;
}
.node-select:focus-visible {
  outline: 2px solid #409eff;
  outline-offset: 3px;
}
.node-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
