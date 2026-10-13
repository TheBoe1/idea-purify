import { ElButton, ElInput, ElMessage } from 'element-plus'
import type { Component } from 'vue'
import { COMPONENT_DEFINITIONS, type ComponentDefinition, type ComponentKey, type ComponentSchema, type ShowMessageAction } from '../../../shared/contracts/component-config.ts'

interface Registration { component: Component; definition: ComponentDefinition }
function definitionFor(key: ComponentKey): ComponentDefinition {
    const definition = COMPONENT_DEFINITIONS.find(item => item.componentKey === key)
    if (!definition) throw new Error(`组件定义缺失：${key}`)
    return definition
}
export const componentRegistry: Readonly<Record<ComponentKey, Registration>> = {
    input: { component: ElInput, definition: definitionFor('input') },
    textarea: { component: ElInput, definition: definitionFor('textarea') },
    button: { component: ElButton, definition: definitionFor('button') },
}

// 显式映射经过校验的属性，不透传数据库 JSON，也不开放 onClick 或任意 HTML。
export function getRegisteredProps(schema: ComponentSchema): Record<string, string | boolean | number | undefined> {
    if (schema.componentKey === 'button') return {
        nativeType: 'button',
        type: schema.props.type === 'default' ? undefined : schema.props.type,
        disabled: schema.props.disabled,
    }
    if (schema.componentKey === 'textarea') return {
        type: 'textarea', placeholder: schema.props.placeholder, disabled: schema.props.disabled,
        maxlength: schema.props.maxlength, rows: schema.props.rows,
    }
    return {
        type: 'text', placeholder: schema.props.placeholder, clearable: schema.props.clearable,
        disabled: schema.props.disabled, maxlength: schema.props.maxlength,
    }
}

const actionAdapters: Readonly<Record<ShowMessageAction['actionKey'], (action: ShowMessageAction) => void>> = {
    'show-message': action => { ElMessage({ message: action.message, dangerouslyUseHTMLString: false }) },
}
export function runRegisteredAction(action: ShowMessageAction) { actionAdapters[action.actionKey](action) }
