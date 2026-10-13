import { isComponentConfig, isComponentDefinition, type ComponentConfig, type ComponentDefinition, type ComponentSchema } from '../../shared/contracts/component-config.ts'
import { requestJson } from './http'

export async function loadComponentDefinitions(): Promise<ComponentDefinition[]> {
    const data = await requestJson('/component-definitions')
    if (!Array.isArray(data) || !data.every(isComponentDefinition)) throw new Error('组件定义的数据格式不正确')
    return data
}
export async function loadComponentConfigs(): Promise<ComponentConfig[]> {
    const data = await requestJson('/component-configs')
    if (!Array.isArray(data) || !data.every(isComponentConfig)) throw new Error('组件配置列表的数据格式不正确')
    return data
}
export async function loadComponentConfig(configId: string): Promise<ComponentConfig> {
    const data = await requestJson(`/component-configs/${encodeURIComponent(configId)}`)
    if (!isComponentConfig(data)) throw new Error('组件配置的数据格式不正确')
    return data
}
export async function saveComponentConfig(schema: ComponentSchema, configId?: string): Promise<ComponentConfig> {
    const data = await requestJson(configId ? `/admin/component-configs/${encodeURIComponent(configId)}` : '/admin/component-configs', {
        method: configId ? 'PUT' : 'POST',
        body: JSON.stringify({ schema }),
    })
    if (!isComponentConfig(data)) throw new Error('保存后的组件配置数据格式不正确')
    return data
}
