// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ELEMENT_PLUS_APIS,
  ELEMENT_PLUS_CATALOG,
  ELEMENT_PLUS_ICON_KEYS,
  ELEMENT_PLUS_RUNTIME_EXPORTS,
  ELEMENT_PLUS_VERSION,
  findCatalogEntry,
  findElementPlusApi,
} from '../shared/catalog/element-plus.ts'
import type { ApiEntry } from '../shared/catalog/element-plus.ts'

const source = process.env.ELEMENT_PLUS_SOURCE_DIR ?? '/tmp/idea-purify-element-plus-2.14.5'
const normalize = (value: string) => value.replace(/[^a-z0-9]/gi, '').toLowerCase()
const api = (key: string) => {
  const found = findElementPlusApi(key)
  assert.ok(found, `Missing API ${key}`)
  return found
}
const prop = (key: string, name: string) => {
  const found = api(key).props.find((value) => value.runtimeName === name)
  assert.ok(found, `Missing prop ${key}.${name}`)
  return found
}

describe('versioned public Element Plus catalog', () => {
  it('has unique searchable entries and resolves every declared root/API', () => {
    expect(ELEMENT_PLUS_VERSION).toBe('2.14.5')
    expect(new Set(ELEMENT_PLUS_CATALOG.map((entry) => entry.key)).size).toBe(
      ELEMENT_PLUS_CATALOG.length,
    )
    expect(new Set(ELEMENT_PLUS_APIS.map((entry) => entry.apiKey)).size).toBe(
      ELEMENT_PLUS_APIS.length,
    )
    for (const entry of ELEMENT_PLUS_CATALOG) {
      expect(entry.version).toBe(ELEMENT_PLUS_VERSION)
      expect(entry.name).toMatch(/[\u3400-\u9fff]/)
      expect(entry.tags.some((tag) => /[\u3400-\u9fff]/.test(tag))).toBe(true)
      expect(entry.purpose).toMatch(/[\u3400-\u9fff]/)
      expect(entry.useWhen.length).toBeGreaterThan(0)
      expect(entry.constraints.length).toBeGreaterThan(0)
      expect(
        [entry.purpose, ...entry.useWhen, ...entry.constraints].every(
          (text) => text.length > 3 && text.length < 90 && !/TODO|待实现|高级未开放/i.test(text),
        ),
      ).toBe(true)
      for (const key of entry.rootApiKeys) {
        expect(entry.apis.map((api) => api.apiKey)).toContain(key)
        expect(api(key).parentApiKey).toBeUndefined()
      }
      for (const entryApi of entry.apis) expect(findElementPlusApi(entryApi.apiKey)).toBe(entryApi)
    }
  })

  it('distinguishes actual Vue exports, service/directive adapters and non-Vue design tokens', () => {
    const realExports = new Set(ELEMENT_PLUS_RUNTIME_EXPORTS)
    for (const entry of ELEMENT_PLUS_APIS.filter((entry) => entry.kind === 'design')) {
      expect(entry.runtimeExport).toBe(`design:${entry.apiKey}`)
      expect(entry.events).toEqual([])
      expect(entry.slots).toEqual([])
      expect(entry.exposes).toEqual([])
      expect(entry.props.length).toBeGreaterThan(0)
      expect(entry.props.every((prop) => prop.runtimeName.startsWith('--el-'))).toBe(true)
    }
    for (const entry of ELEMENT_PLUS_APIS.filter((entry) => entry.kind !== 'design')) {
      assert.ok(realExports.has(entry.runtimeExport), `Unregistered public export: ${entry.apiKey}`)
    }
    // ElLoading is an install namespace whose actual public service/directive are catalogued separately.
    expect(
      ELEMENT_PLUS_RUNTIME_EXPORTS.filter(
        (name) => !ELEMENT_PLUS_APIS.some((api) => api.runtimeExport === name),
      ),
    ).toEqual(['ElLoading'])
    expect(api('loading-service').kind).toBe('service')
    expect(api('loading-directive').kind).toBe('directive')
    expect(api('popover-directive').kind).toBe('directive')
    expect(api('message-box').exposes.map((value) => value.name)).toEqual(
      expect.arrayContaining(['alert', 'confirm', 'prompt', 'close']),
    )
  })

  it('keeps internal ref/object APIs attached to their real public parents', () => {
    expect(api('tab-nav')).toMatchObject({
      parentApiKey: 'tabs',
      propPath: 'tabNavRef',
      runtimeExport: 'ElTabs',
    })
    expect(api('tab-bar')).toMatchObject({ parentApiKey: 'tabs', propPath: 'tabNavRef.tabBarRef' })
    expect(api('transfer-panel')).toMatchObject({
      parentApiKey: 'transfer',
      propPath: 'leftPanel|rightPanel',
    })
    expect(api('table-v2-column')).toMatchObject({
      parentApiKey: 'table-v2',
      propPath: 'columns[]',
    })
    expect(findCatalogEntry('layout')!.rootApiKeys).toEqual(['row', 'col'])
    expect(findCatalogEntry('input')!.tags).toContain('textarea')
    expect(findCatalogEntry('datetime-picker')!.rootApiKeys).toEqual(['date-picker'])
  })

  it('retains complex outer types without leaking callback arguments or object members into allowed scalars', () => {
    expect(prop('date-picker', 'disabledDate').valueKinds).toEqual(['function'])
    expect(prop('date-picker', 'disabledDate').parameterCount).toBe(1)
    expect(prop('autocomplete', 'fetchSuggestions').valueKinds).toEqual(
      expect.arrayContaining(['array', 'function']),
    )
    expect(prop('table-v2', 'columns').valueKinds).toEqual(['array'])
    expect(prop('table-v2-column', 'cellRenderer').valueKinds).toEqual(
      expect.arrayContaining(['component', 'function']),
    )
    expect(prop('table-v2-column', 'cellRenderer').valueKinds).not.toContain('string')
    expect(prop('table-v2-column', 'width')).toMatchObject({
      valueKinds: ['number'],
      required: true,
    })
    expect(prop('table-v2-column', 'align').enumValues).toEqual(
      expect.arrayContaining(['left', 'center', 'right']),
    )
    expect(prop('loading-service', 'target').valueKinds).toEqual(
      expect.arrayContaining(['string', 'element']),
    )
    expect(prop('input-tag', 'delimiter').valueKinds).toEqual(
      expect.arrayContaining(['string', 'regexp']),
    )
  })

  it('keeps true enum values separate from function argument literals and open string suggestions', () => {
    expect(prop('input', 'type')).toMatchObject({ valueKinds: ['string'], allowCustom: true })
    expect(prop('input', 'type').enumValues).toContain('textarea')
    expect(prop('button', 'type').enumValues).toContain('primary')
    expect(prop('table-column', 'formatter').enumValues).toEqual([])
    expect(prop('form', 'validateOnRuleChange').valueKinds).toEqual(['boolean'])
  })

  it('includes nested object properties in their object rather than the owning component', () => {
    expect(prop('config-provider', 'button').members?.map((member) => member.runtimeName)).toEqual(
      expect.arrayContaining(['autoInsertSpace', 'plain', 'round']),
    )
    expect(
      api('config-provider').props.some((member) => member.runtimeName === 'autoInsertSpace'),
    ).toBe(false)
    expect(prop('cascader', 'props').members?.map((member) => member.runtimeName)).toEqual(
      expect.arrayContaining(['lazy', 'lazyLoad', 'emitPath']),
    )
    expect(prop('cascader-panel', 'props').members?.map((member) => member.runtimeName)).toEqual(
      expect.arrayContaining(['lazy', 'lazyLoad', 'emitPath']),
    )
    expect(prop('watermark', 'font').members?.map((member) => member.runtimeName)).toContain(
      'fontFamily',
    )
    expect(api('watermark').props.some((member) => member.runtimeName === 'fontFamily')).toBe(false)
  })

  it('resolves real source slot scopes and callable expose signatures', () => {
    expect(api('table-v2').slots.find((slot) => slot.name === 'cell')!.scopeFields).toEqual(
      expect.arrayContaining(['rowData', 'rowIndex', 'column', 'columnIndex']),
    )
    expect(api('table-v2').slots.find((slot) => slot.name === 'header')!.scopeFields).toEqual([
      'cells',
      'columns',
      'headerIndex',
    ])
    expect(api('auto-resizer').slots.find((slot) => slot.name === 'default')!.scopeFields).toEqual([
      'height',
      'width',
    ])
    expect(
      api('table-v2').exposes.find((expose) => expose.name === 'scrollToRow')!.signature,
    ).toMatch(/row: number/)
    expect(
      api('tree-select').exposes.find((expose) => expose.name === 'filter')!.signature,
    ).not.toBe('unknown')
    for (const entry of ELEMENT_PLUS_APIS)
      for (const expose of entry.exposes)
        assert.notEqual(expose.signature, 'unknown', `${entry.apiKey}.${expose.name}`)
    expect(ELEMENT_PLUS_ICON_KEYS).toEqual(expect.arrayContaining(['ArrowDown', 'Search', 'User']))
  })
})

// This collector deliberately reads the primary Markdown tables, not generator docFacts or a count snapshot.
// The optional checkout is not bundled into the app; CI can provide ELEMENT_PLUS_SOURCE_DIR at the pinned tag.
describe.skipIf(!existsSync(join(source, 'docs/.vitepress/crowdin/en-US/pages/component.json')))(
  'official 2.14.5 source differential audit',
  () => {
    it('matches the full official overview set, with zero missing or extra primary entries', () => {
      const navigation = JSON.parse(
        readFileSync(join(source, 'docs/.vitepress/crowdin/en-US/pages/component.json'), 'utf8'),
      ) as Record<string, { children: { link: string }[] }>
      const expected = Object.entries(navigation)
        .filter(([key]) => key !== 'overview')
        .flatMap(([, group]) => group.children.map((entry) => entry.link.slice(1)))
        .sort()
      expect(expected).toHaveLength(82)
      expect(ELEMENT_PLUS_CATALOG.map((entry) => entry.key).sort()).toEqual(expected)
    })

    it('contains every official Props, Events, Slots, Exposes and nested-object table row', () => {
      const missing: string[] = []
      const unsupportedTables: string[] = []
      let checkedRows = 0
      for (const catalog of ELEMENT_PLUS_CATALOG.filter((entry) => entry.kind !== 'design')) {
        const markdown = readFileSync(
          join(source, `docs/en-US/component/${catalog.key}.md`),
          'utf8',
        )
        const blocks = markdown.split(/\n(?=#{2,6}\s)/)
        let inApi = false
        let owner = catalog.rootApiKeys[0]
        for (const block of blocks) {
          const heading =
            block
              .match(/^#{2,6}\s+([^\n]+)/)?.[1]
              ?.replace(/\^\([^)]*\)|\{#[^}]+\}/g, '')
              .trim() ?? ''
          if (
            /\bAPI$/.test(heading) ||
            (catalog.key === 'infinite-scroll' && heading === 'Directives')
          ) {
            inApi = true
            const prefix = heading.replace(/\s*API$/, '')
            if (prefix)
              owner =
                catalog.apis.find(
                  (api) =>
                    normalize(api.apiKey) === normalize(prefix) ||
                    normalize(api.runtimeExport.slice(2)) === normalize(prefix),
                )?.apiKey ?? owner
          }
          const table = block.match(
            /\n(\|[^\n]+\|)\r?\n\|[- :|]+\|\r?\n((?:\|[^\n]*\|(?:\r?\n|$))+)/,
          )
          if (!inApi || !table) continue
          const nameHeader = table[1]!.split('|')[1]!.trim().toLowerCase()
          if (
            !['name', 'attribute', 'attributes', 'property', 'parameter', 'method'].includes(
              nameHeader,
            )
          ) {
            unsupportedTables.push(`${catalog.key}:${heading}:${nameHeader}`)
            continue
          }
          if (/\|\s*Exposes\s*\|\s*Events\s*\|\s*Slots\s*\|/i.test(table[1]!)) {
            for (const inheritedKey of ['tree', 'select']) {
              for (const section of ['props', 'events', 'slots'] as const)
                for (const entry of api(inheritedKey)[section]) {
                  if (
                    !api('tree-select')[section].some(
                      (item) => normalize(item.name) === normalize(entry.name),
                    )
                  )
                    missing.push(`tree-select:inherit:${inheritedKey}.${section}.${entry.name}`)
                  checkedRows++
                }
            }
            continue
          }
          let candidates: ApiEntry[] = []
          let nested: string | undefined
          let section: 'props' | 'events' | 'slots' | 'exposes' = 'props'
          const suffix = heading.match(
            /^(.*?)\s*(Attributes?|Props|Events?|Slots?|Exposes|Methods?|Options|Directives)$/i,
          )
          if (catalog.key === 'loading')
            candidates = [api(heading === 'Directives' ? 'loading-directive' : 'loading-service')]
          else if (
            catalog.key === 'config-provider' &&
            suffix?.[1] &&
            !/Config Provider/i.test(suffix[1])
          ) {
            candidates = [api('config-provider')]
            nested = suffix[1].toLowerCase()
          } else if (heading === 'CascaderProps') {
            candidates = [api('cascader'), api('cascader-panel')]
            nested = 'props'
          } else if (heading === 'FormItemRule') {
            candidates = [api('form-item')]
            nested = 'rules'
          } else if (
            heading === 'props' ||
            (catalog.key === 'watermark' && heading === 'Font') ||
            heading === 'tag-tooltip'
          ) {
            candidates = [api(owner!)]
            nested = heading.toLowerCase()
          } else if (suffix) {
            const prefix = suffix[1]?.trim()
            if (prefix && prefix !== 'Own')
              owner = catalog.apis.find(
                (api) =>
                  normalize(api.apiKey) === normalize(prefix) ||
                  normalize(api.runtimeExport.slice(2)) === normalize(prefix) ||
                  (prefix === 'Column' && api.apiKey === 'table-v2-column'),
              )?.apiKey
            candidates = owner ? [api(owner)] : []
            section = /^events?$/i.test(suffix[2]!)
              ? 'events'
              : /^slots?$/i.test(suffix[2]!)
                ? 'slots'
                : /^(exposes|methods?)$/i.test(suffix[2]!)
                  ? 'exposes'
                  : 'props'
          }
          if (!candidates.length) {
            unsupportedTables.push(`${catalog.key}:${heading}`)
            continue
          }
          for (const row of table[2]!.trim().split('\n')) {
            const rawName = row.match(/^\|\s*((?:\\\||[^|])*)\|/)?.[1] ?? ''
            if (/\[(input props|tooltip)\]\(/.test(rawName)) {
              const inheritedKey = rawName.includes('input props') ? 'input' : 'tooltip'
              const excluded =
                catalog.key === 'popconfirm'
                  ? ['popperClass', 'popperStyle', 'fallbackPlacements']
                  : []
              for (const inherited of api(inheritedKey).props.filter(
                (prop) => !excluded.includes(prop.runtimeName),
              )) {
                if (!api(owner!).props.some((item) => item.runtimeName === inherited.runtimeName))
                  missing.push(`${catalog.key}:inherit:${inheritedKey}.${inherited.runtimeName}`)
                checkedRows++
              }
              continue
            }
            const name = rawName
              .replace(/\^\([^)]*\)/g, '')
              .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
              .replace(/`/g, '')
              .replace(/\s*\/\s*v-model.*$/, '')
              .trim()
            for (const candidate of candidates) {
              const members = nested
                ? candidate.props.find((prop) => normalize(prop.runtimeName) === normalize(nested!))
                    ?.members
                : candidate[section]
              if (
                !members?.some(
                  (member) =>
                    normalize(member.name) === normalize(name) ||
                    ('runtimeName' in member && normalize(member.runtimeName) === normalize(name)),
                )
              )
                missing.push(
                  `${catalog.key}:${heading}:${candidate.apiKey}.${nested ? `${nested}.` : ''}${name}`,
                )
              if (
                !nested &&
                section === 'props' &&
                /v-model/.test(rawName) &&
                !candidate.events.some(
                  (event) => normalize(event.name) === normalize(`update:${name}`),
                )
              )
                missing.push(`${catalog.key}:model-event:${candidate.apiKey}.update:${name}`)
              checkedRows++
            }
          }
        }
      }
      expect(checkedRows).toBeGreaterThan(1700)
      expect(unsupportedTables).toEqual([])
      expect(missing).toEqual([])
    })
  },
)
