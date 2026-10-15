import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'
import type {
  ApiEntry,
  ApiProp,
  ApiValueKind,
  CatalogEntry,
  CatalogKind,
} from '../shared/catalog/element-plus.ts'

// Static documentation/type extraction only. No component module is executed.
const tag = 'ba62d6397a2fd27c757ef472831be2c8a35afe2d'
const sourceRoot = resolve(process.argv[2] ?? '/tmp/idea-purify-element-plus-2.14.5')
const outputPath = resolve('shared/catalog/element-plus.ts')
const publicBase = `https://github.com/element-plus/element-plus/blob/${tag}/`
const docsRoot = join(sourceRoot, 'docs/en-US/component')
const navigationPath = 'docs/.vitepress/crowdin/en-US/pages/component.json'
interface NavigationGroup {
  text: string
  children: { link: string; text: string; promotion?: string }[]
}
const navigation = JSON.parse(readFileSync(join(sourceRoot, navigationPath), 'utf8')) as Record<
  string,
  NavigationGroup
>
const declarations = new Map<string, { file: ts.SourceFile; node: ts.Node }[]>()
const files = new Map<string, ts.SourceFile>()
const availableExports = new Set<string>()
const docFacts: { apiKey: string; section: string; name: string; document: string }[] = []
const unresolved: string[] = []

function walkFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', '__tests__', 'style', '.git'].includes(entry.name)) return []
    const next = join(path, entry.name)
    return entry.isDirectory()
      ? walkFiles(next)
      : /\.(?:ts|tsx|vue)$/.test(entry.name)
        ? [next]
        : []
  })
}
function file(path: string): ts.SourceFile | undefined {
  if (!existsSync(path)) return undefined
  const cached = files.get(path)
  if (cached) return cached
  const raw = readFileSync(path, 'utf8')
  const script = path.endsWith('.vue')
    ? [...raw.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n')
    : raw
  const parsed = ts.createSourceFile(
    path,
    script,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  files.set(path, parsed)
  for (const statement of parsed.statements) {
    if (
      (ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      const name = statement.name.text
      declarations.set(name, [...(declarations.get(name) ?? []), { file: parsed, node: statement }])
    }
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isObjectBindingPattern(declaration.name))
          for (const binding of declaration.name.elements) {
            if (ts.isIdentifier(binding.name))
              declarations.set(binding.name.text, [
                ...(declarations.get(binding.name.text) ?? []),
                { file: parsed, node: declaration },
              ])
          }
        if (!ts.isIdentifier(declaration.name)) continue
        const name = declaration.name.text
        declarations.set(name, [
          ...(declarations.get(name) ?? []),
          { file: parsed, node: declaration },
        ])
        if (
          name.startsWith('El') &&
          statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
        )
          availableExports.add(name)
      }
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const item of statement.exportClause.elements)
        if (item.name.text.startsWith('El')) availableExports.add(item.name.text)
    }
  }
  return parsed
}
for (const path of walkFiles(join(sourceRoot, 'packages'))) file(path)
function resolveModule(from: ts.SourceFile, specifier: string): ts.SourceFile | undefined {
  const base = specifier.startsWith('.')
    ? resolve(dirname(from.fileName), specifier)
    : specifier.startsWith('@element-plus/')
      ? join(sourceRoot, 'packages', specifier.slice('@element-plus/'.length))
      : undefined
  if (!base) return undefined
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.vue`,
    join(base, 'index.ts'),
  ]) {
    if (existsSync(candidate) && /\.(?:ts|tsx|vue)$/.test(candidate)) return file(candidate)
  }
}
function declaration(
  name: string,
  from: ts.SourceFile,
  seen = new Set<string>(),
): { file: ts.SourceFile; node: ts.Node } | undefined {
  const key = `${from.fileName}:${name}`
  if (seen.has(key)) return undefined
  seen.add(key)
  const local = declarations.get(name)?.find((item) => item.file === from)
  if (local) return local
  for (const statement of from.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const target = resolveModule(from, statement.moduleSpecifier.text)
      if (!target) continue
      const clause = statement.importClause
      if (clause?.name?.text === name) {
        const exported = target.statements.find((item) => ts.isExportAssignment(item))
        if (exported && ts.isExportAssignment(exported) && ts.isIdentifier(exported.expression))
          return declaration(exported.expression.text, target, seen)
        return { file: target, node: target }
      }
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
        for (const binding of clause.namedBindings.elements) {
          if (binding.name.text === name)
            return declaration(binding.propertyName?.text ?? name, target, seen)
        }
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        const binding = statement.exportClause.elements.find((item) => item.name.text === name)
        if (!binding) continue
        const target = resolveModule(from, statement.moduleSpecifier.text)
        if (target) return declaration(binding.propertyName?.text ?? name, target, seen)
      } else if (!statement.exportClause) {
        const target = resolveModule(from, statement.moduleSpecifier.text)
        const found = target && declaration(name, target, seen)
        if (found) return found
      }
    }
  }
  const global = declarations.get(name)
  if (global?.length === 1) return global[0]
}
function unwrap(node: ts.Node): ts.Node {
  while (
    ts.isAsExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression
  return node
}
function text(node: ts.Node | undefined): string {
  return node?.getText().replace(/\s+/g, ' ').trim() ?? ''
}
function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
}
function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}
function clean(value: string): string {
  return value
    .replace(/\\\|/g, '|')
    .replace(/\^\[([^\]]+)\]/g, '$1 ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\^\([^)]*\)/g, '')
    .replace(/`/g, '')
    .trim()
}
function nameOf(node: ts.PropertyName | ts.BindingName | undefined, from: ts.SourceFile): string {
  if (!node) return ''
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node))
    return node.text
  if (ts.isComputedPropertyName(node) && ts.isIdentifier(node.expression)) {
    if (node.expression.text === 'UPDATE_MODEL_EVENT') return 'update:modelValue'
    const found = declaration(node.expression.text, from)
    if (found && ts.isVariableDeclaration(found.node) && found.node.initializer) {
      const value = unwrap(found.node.initializer)
      if (ts.isStringLiteral(value)) return value.text
    }
  }
  return clean(text(node)).replace(/^\[|\]$/g, '')
}
function literals(
  node: ts.Node | undefined,
  from: ts.SourceFile,
  seen = new Set<string>(),
): (string | number | boolean)[] {
  if (!node) return []
  node = unwrap(node)
  if (ts.isStringLiteral(node)) return [node.text]
  if (ts.isNumericLiteral(node)) return [Number(node.text)]
  if (node.kind === ts.SyntaxKind.TrueKeyword) return [true]
  if (node.kind === ts.SyntaxKind.FalseKeyword) return [false]
  if (ts.isArrayLiteralExpression(node))
    return node.elements.flatMap((item) =>
      literals(ts.isSpreadElement(item) ? item.expression : item, from, seen),
    )
  if (ts.isUnionTypeNode(node)) return node.types.flatMap((item) => literals(item, from, seen))
  if (ts.isParenthesizedTypeNode(node)) return literals(node.type, from, seen)
  if (ts.isTypeQueryNode(node) && ts.isIdentifier(node.exprName))
    return literals(node.exprName, from, seen)
  if (ts.isEnumDeclaration(node))
    return node.members.flatMap((member) => literals(member.initializer, from, seen))
  if (ts.isLiteralTypeNode(node)) return literals(node.literal, from, seen)
  if (ts.isIndexedAccessTypeNode(node) && ts.isParenthesizedTypeNode(node.objectType))
    return literals(node.objectType.type, from, seen)
  if (
    ts.isIndexedAccessTypeNode(node) &&
    ts.isTypeQueryNode(node.objectType) &&
    ts.isIdentifier(node.objectType.exprName)
  )
    return literals(node.objectType.exprName, from, seen)
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName))
    return literals(node.typeName, from, seen)
  if (ts.isIdentifier(node)) {
    const id = `${from.fileName}:${node.text}`
    if (seen.has(id)) return []
    seen.add(id)
    const found = declaration(node.text, from)
    if (found && ts.isTypeAliasDeclaration(found.node))
      return literals(found.node.type, found.file, seen)
    if (found && ts.isEnumDeclaration(found.node)) return literals(found.node, found.file, seen)
    if (found && ts.isVariableDeclaration(found.node))
      return literals(found.node.initializer, found.file, seen)
  }
  return []
}
function kindsFromType(
  node: ts.TypeNode | undefined,
  from?: ts.SourceFile,
  seen = new Set<string>(),
): ApiValueKind[] {
  if (!node) return ['unknown']
  if (ts.isParenthesizedTypeNode(node)) return kindsFromType(node.type, from, seen)
  if (ts.isUnionTypeNode(node))
    return [...new Set(node.types.flatMap((item) => kindsFromType(item, from, new Set(seen))))]
  if (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) return ['function']
  if (ts.isArrayTypeNode(node) || ts.isTupleTypeNode(node)) return ['array']
  if ([ts.SyntaxKind.NeverKeyword, ts.SyntaxKind.SymbolKeyword].includes(node.kind)) return []
  if (ts.isIndexedAccessTypeNode(node) && from) {
    const values = literals(node, from)
    if (values.length)
      return [...new Set(values.map((value) => typeof value as 'string' | 'number' | 'boolean'))]
  }
  if (ts.isTypeLiteralNode(node))
    return node.members.some((member) => ts.isCallSignatureDeclaration(member))
      ? ['function']
      : ['object']
  if (ts.isIntersectionTypeNode(node)) {
    const parts = [
      ...new Set(node.types.flatMap((item) => kindsFromType(item, from, new Set(seen)))),
    ]
    return parts.some((kind) => kind !== 'object' && kind !== 'unknown')
      ? parts.filter((kind) => kind !== 'object' && kind !== 'unknown')
      : ['object']
  }
  if (ts.isLiteralTypeNode(node)) {
    if (ts.isStringLiteral(node.literal)) return ['string']
    if (ts.isNumericLiteral(node.literal) || ts.isPrefixUnaryExpression(node.literal))
      return ['number']
    if (node.literal.kind === ts.SyntaxKind.NullKeyword) return ['null']
    if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(node.literal.kind))
      return ['boolean']
  }
  const primitives = new Map<ts.SyntaxKind, ApiValueKind>([
    [ts.SyntaxKind.StringKeyword, 'string'],
    [ts.SyntaxKind.NumberKeyword, 'number'],
    [ts.SyntaxKind.BooleanKeyword, 'boolean'],
    [ts.SyntaxKind.ObjectKeyword, 'object'],
    [ts.SyntaxKind.AnyKeyword, 'unknown'],
    [ts.SyntaxKind.UnknownKeyword, 'unknown'],
  ])
  const primitive = primitives.get(node.kind)
  if (primitive) return [primitive]
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text
    if (name === 'undefined') return []
    const builtins: Record<string, ApiValueKind[]> = {
      String: ['string'],
      Number: ['number'],
      Boolean: ['boolean'],
      Function: ['function'],
      Array: ['array'],
      array: ['array'],
      ReadonlyArray: ['array'],
      Record: ['object'],
      Object: ['object'],
      Date: ['date'],
      RegExp: ['regexp'],
      regex: ['regexp'],
      regexp: ['regexp'],
      VNode: ['vnode'],
      VueComponent: ['component'],
      Component: ['component'],
      CSSSelector: ['string'],
      CSSProperties: ['object'],
      StyleValue: ['string', 'array', 'object'],
      ClassValue: ['string', 'boolean', 'array', 'object'],
      IconPropType: ['string', 'component'],
    }
    if (builtins[name]) return builtins[name]
    if (/^(?:HTML\w*Element|HTMLElement|Element|LoadingParentElement)$/.test(name))
      return ['element']
    if (
      [
        'Partial',
        'Required',
        'Readonly',
        'Mutable',
        'Pick',
        'Omit',
        'Ref',
        'ComputedRef',
        'Promise',
      ].includes(name)
    )
      return ['object']
    if (name === 'Arrayable')
      return [...new Set([...kindsFromType(node.typeArguments?.[0], from, seen), 'array' as const])]
    if (name === 'MaybeRef')
      return [
        ...new Set([...kindsFromType(node.typeArguments?.[0], from, seen), 'object' as const]),
      ]
    const id = `${from?.fileName}:${name}`
    if (seen.has(id)) return ['unknown']
    seen.add(id)
    const found = from
      ? declaration(name, from)
      : declarations.get(name)?.length === 1
        ? declarations.get(name)?.[0]
        : undefined
    if (found && ts.isTypeAliasDeclaration(found.node))
      return kindsFromType(found.node.type, found.file, seen)
    if (found && ts.isEnumDeclaration(found.node))
      return [
        ...new Set(
          literals(found.node, found.file).map(
            (value) => typeof value as 'string' | 'number' | 'boolean',
          ),
        ),
      ]
    if (found && ts.isInterfaceDeclaration(found.node))
      return found.node.members.some((member) => ts.isCallSignatureDeclaration(member))
        ? ['function']
        : ['object']
  }
  return ['unknown']
}
function parseType(typeText: string): ts.TypeNode | undefined {
  const parsed = ts.createSourceFile(
    'catalog-type.ts',
    `type CatalogValue = ${typeText};`,
    ts.ScriptTarget.Latest,
    true,
  )
  const statement = parsed.statements[0]
  return statement && ts.isTypeAliasDeclaration(statement) ? statement.type : undefined
}
function openScalar(
  node: ts.TypeNode | undefined,
  from?: ts.SourceFile,
  seen = new Set<string>(),
): boolean {
  if (!node) return false
  if (
    [
      ts.SyntaxKind.StringKeyword,
      ts.SyntaxKind.NumberKeyword,
      ts.SyntaxKind.BooleanKeyword,
      ts.SyntaxKind.AnyKeyword,
      ts.SyntaxKind.UnknownKeyword,
    ].includes(node.kind)
  )
    return true
  if (ts.isParenthesizedTypeNode(node)) return openScalar(node.type, from, seen)
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node))
    return node.types.some((item) => openScalar(item, from, new Set(seen)))
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const key = `${from?.fileName}:${node.typeName.text}`
    if (seen.has(key)) return false
    seen.add(key)
    const found = from
      ? declaration(node.typeName.text, from)
      : declarations.get(node.typeName.text)?.length === 1
        ? declarations.get(node.typeName.text)?.[0]
        : undefined
    return (
      !!found &&
      ts.isTypeAliasDeclaration(found.node) &&
      openScalar(found.node.type, found.file, seen)
    )
  }
  return false
}
function makeProp(
  name: string,
  typeText: string,
  defaultText = '—',
  required?: boolean,
  version?: string,
  rawDocumentationType?: string,
): ApiProp {
  // Documentation uses " / " for outer type alternatives; quoted slashes and callback bodies remain untouched.
  const node = parseType(typeText.replace(/\s+\/\s+(?=[A-Za-z(])/g, ' | '))
  let valueKinds = kindsFromType(node)
  let enumValues = literals(node, files.values().next().value!)
  let allowCustom = openScalar(node)
  if (rawDocumentationType) {
    const markers = [...rawDocumentationType.matchAll(/\^\[([^\]]+)\](?:`([^`]*)`)?/g)]
    const kinds: ApiValueKind[] = []
    enumValues = []
    allowCustom = markers.some((marker) => marker[1]?.toLowerCase() === 'string' && !marker[2])
    for (const marker of markers) {
      const type = marker[1]!
      const payload = marker[2]?.replace(/\\\|/g, '|') ?? ''
      if (type.toLowerCase() === 'enum') {
        enumValues.push(...[...payload.matchAll(/['"]([^'"]*)['"]/g)].map((match) => match[1]!))
        if (!enumValues.length && payload)
          enumValues.push(
            ...payload
              .split('|')
              .map((value) => value.trim())
              .filter((value) => /^\w[\w-]*$/.test(value)),
          )
        kinds.push(...enumValues.map((value) => typeof value as 'string' | 'number' | 'boolean'))
        if (/\bboolean\b/.test(payload)) kinds.push('boolean')
      } else if (
        type.toLowerCase() === 'object' &&
        /^(?:Component|VNode|Date|HTMLElement)$/.test(payload)
      ) {
        kinds.push(...kindsFromType(parseType(payload)))
      } else
        kinds.push(
          ...kindsFromType(parseType(type.toLowerCase() === 'function' ? 'Function' : type)),
        )
    }
    if (markers.length) valueKinds = [...new Set(kinds.length ? kinds : ['unknown' as const])]
  }
  return {
    name,
    runtimeName: camel(name),
    typeText,
    valueKinds,
    enumValues: [...new Set(enumValues)],
    defaultText,
    ...(enumValues.length && allowCustom ? { allowCustom: true } : {}),
    ...(required ? { required: true } : {}),
    ...(version ? { version } : {}),
  }
}
function typeMembers(
  node: ts.Node | undefined,
  from: ts.SourceFile,
  seen = new Set<string>(),
): ApiProp[] {
  if (!node) return []
  if (ts.isInterfaceDeclaration(node))
    return [
      ...(node.heritageClauses?.flatMap((clause) =>
        clause.types.flatMap((item) => {
          const found = declaration(text(item.expression), from)
          return found ? typeMembers(found.node, found.file, new Set(seen)) : []
        }),
      ) ?? []),
      ...members(node.members, from),
    ]
  if (ts.isTypeAliasDeclaration(node)) return typeMembers(node.type, from, seen)
  if (ts.isTypeLiteralNode(node)) return members(node.members, from)
  if (ts.isIntersectionTypeNode(node))
    return node.types.flatMap((item) => typeMembers(item, from, new Set(seen)))
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text
    if (['Partial', 'Required', 'Readonly', 'Mutable'].includes(name)) {
      return typeMembers(node.typeArguments?.[0], from, seen).map((item) => ({
        ...item,
        required: name === 'Required' ? true : name === 'Partial' ? false : item.required,
      }))
    }
    if (['Omit', 'Pick'].includes(name)) {
      const names = literals(node.typeArguments?.[1], from)
      return typeMembers(node.typeArguments?.[0], from, seen).filter((item) =>
        name === 'Omit' ? !names.includes(item.runtimeName) : names.includes(item.runtimeName),
      )
    }
    const id = `${from.fileName}:${name}`
    if (seen.has(id)) return []
    seen.add(id)
    const found = declaration(name, from)
    return found ? typeMembers(found.node, found.file, seen) : []
  }
  return []
}
function members(nodes: ts.NodeArray<ts.TypeElement>, from: ts.SourceFile): ApiProp[] {
  return nodes.flatMap((node) => {
    if (!ts.isPropertySignature(node) && !ts.isMethodSignature(node)) return []
    const name = nameOf(node.name, from)
    const typeText = ts.isMethodSignature(node)
      ? `(${node.parameters.map((item) => text(item)).join(', ')}) => ${text(node.type) || 'unknown'}`
      : text(node.type)
    const prop = makeProp(kebab(name), typeText || 'unknown', '—', !node.questionToken)
    prop.valueKinds = ts.isMethodSignature(node) ? ['function'] : kindsFromType(node.type, from)
    if (openScalar(node.type, from)) prop.allowCustom = true
    prop.runtimeName = name
    if (node.type)
      prop.enumValues = [...new Set([...prop.enumValues, ...literals(node.type, from)])]
    if (prop.enumValues.length)
      prop.valueKinds = [
        ...new Set([
          ...prop.valueKinds.filter((item) => item !== 'unknown'),
          ...prop.enumValues.map((item) => typeof item as 'string' | 'number' | 'boolean'),
        ]),
      ]
    return [prop]
  })
}
function objectMembers(
  node: ts.Node | undefined,
  from: ts.SourceFile,
  seen = new Set<string>(),
): ApiProp[] {
  if (!node) return []
  node = unwrap(node)
  if (ts.isIdentifier(node)) {
    const id = `${from.fileName}:${node.text}`
    if (seen.has(id)) return []
    seen.add(id)
    const found = declaration(node.text, from)
    return found && ts.isVariableDeclaration(found.node)
      ? objectMembers(found.node.initializer, found.file, seen)
      : []
  }
  if (ts.isCallExpression(node)) {
    if (
      text(node.expression) === 'useAriaProps' &&
      node.arguments[0] &&
      ts.isArrayLiteralExpression(node.arguments[0])
    ) {
      return literals(node.arguments[0], from)
        .filter((item) => typeof item === 'string')
        .map((item) => makeProp(kebab(String(item)), 'string'))
    }
    return objectMembers(node.arguments[0], from, seen)
  }
  if (!ts.isObjectLiteralExpression(node)) return []
  return node.properties.flatMap((property) => {
    if (ts.isSpreadAssignment(property))
      return objectMembers(property.expression, from, new Set(seen))
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return []
    const name = nameOf(property.name, from)
    const value = ts.isPropertyAssignment(property) ? unwrap(property.initializer) : property.name
    let typeText = text(value)
    let defaultText = '—'
    let required = false
    let enumValues: (string | number | boolean)[] = []
    if (ts.isObjectLiteralExpression(value)) {
      const option = (key: string) =>
        value.properties.find(
          (item) => ts.isPropertyAssignment(item) && nameOf(item.name, from) === key,
        )
      const typeOption = option('type')
      if (typeOption && ts.isPropertyAssignment(typeOption)) {
        const initializer = unwrap(typeOption.initializer)
        typeText =
          ts.isCallExpression(initializer) && initializer.typeArguments?.length
            ? initializer.typeArguments.map((item) => text(item)).join(' | ')
            : ts.isArrayLiteralExpression(initializer)
              ? initializer.elements.map((item) => text(item)).join(' | ')
              : text(initializer)
      }
      const defaultOption = option('default')
      if (defaultOption && ts.isPropertyAssignment(defaultOption))
        defaultText = text(defaultOption.initializer)
      const requiredOption = option('required')
      required =
        !!requiredOption &&
        ts.isPropertyAssignment(requiredOption) &&
        requiredOption.initializer.kind === ts.SyntaxKind.TrueKeyword
      const valuesOption = option('values')
      if (valuesOption && ts.isPropertyAssignment(valuesOption))
        enumValues = literals(valuesOption.initializer, from)
    }
    if (typeText === 'iconPropType') typeText = 'string | Component'
    typeText = typeText
      .replace(/\bString\b/g, 'string')
      .replace(/\bNumber\b/g, 'number')
      .replace(/\bBoolean\b/g, 'boolean')
      .replace(/\bObject\b/g, 'object')
      .replace(/\bArray\b/g, 'array')
    const prop = makeProp(kebab(name), typeText || 'unknown', defaultText, required)
    prop.runtimeName = name
    prop.enumValues = [...new Set([...prop.enumValues, ...enumValues])]
    if (enumValues.length) prop.allowCustom = false
    if (enumValues.length)
      prop.valueKinds = [
        ...new Set([
          ...prop.valueKinds.filter((item) => item !== 'unknown'),
          ...enumValues.map((item) => typeof item as 'string' | 'number' | 'boolean'),
        ]),
      ]
    return [prop]
  })
}
function mergeProps(target: ApiProp[], additions: ApiProp[]) {
  for (const addition of additions) {
    const existing = target.find((item) => item.runtimeName === addition.runtimeName)
    if (!existing) {
      target.push(addition)
      continue
    }
    if (addition.required !== undefined) existing.required = addition.required
    if (existing.defaultText === '—' && addition.defaultText !== '—')
      existing.defaultText = addition.defaultText
    const inferred = addition.valueKinds.filter(
      (kind) =>
        kind !== 'unknown' ||
        /\b(?:any|unknown)\b/.test(addition.typeText) ||
        existing.valueKinds.every((value) => value === 'unknown'),
    )
    const existingKinds = existing.valueKinds.filter(
      (kind) =>
        kind !== 'unknown' ||
        /\b(?:any|unknown)\b/.test(existing.typeText) ||
        !inferred.some((kind) => kind !== 'unknown'),
    )
    existing.valueKinds = [...new Set([...existingKinds, ...inferred])]
    existing.enumValues = [...new Set([...existing.enumValues, ...addition.enumValues])]
    if (addition.allowCustom) existing.allowCustom = true
    if (
      addition.typeText &&
      !existing.typeText.includes(addition.typeText) &&
      addition.typeText !== 'unknown'
    )
      existing.typeText += `; source: ${addition.typeText}`
  }
}
function findRuntimeSource(runtimeExport: string): ts.SourceFile | undefined {
  const found = declarations
    .get(runtimeExport)
    ?.find((item) => /packages\/components\/[^/]+\/index\.ts$/.test(item.file.fileName))
  function imported(
    name: string,
    from: ts.SourceFile,
    seen = new Set<string>(),
  ): ts.SourceFile | undefined {
    const id = `${from.fileName}:${name}`
    if (seen.has(id)) return undefined
    seen.add(id)
    for (const statement of from.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
        continue
      const clause = statement.importClause
      if (
        clause?.name?.text === name ||
        (clause?.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.some((item) => item.name.text === name))
      ) {
        return resolveModule(from, statement.moduleSpecifier.text)
      }
    }
    const local = declarations.get(name)?.find((item) => item.file === from)
    if (local && ts.isVariableDeclaration(local.node) && local.node.initializer) {
      let value = unwrap(local.node.initializer)
      if (ts.isCallExpression(value) && value.arguments[0]) value = unwrap(value.arguments[0])
      if (ts.isIdentifier(value)) return imported(value.text, from, seen)
    }
  }
  if (found && ts.isVariableDeclaration(found.node)) return imported(runtimeExport, found.file)
  for (const from of files.values()) {
    if (!/packages\/components\/[^/]+\/index\.ts$/.test(from.fileName)) continue
    for (const statement of from.statements) {
      if (
        !ts.isExportDeclaration(statement) ||
        !statement.exportClause ||
        !ts.isNamedExports(statement.exportClause)
      )
        continue
      const binding = statement.exportClause.elements.find(
        (item) => item.name.text === runtimeExport,
      )
      if (binding) return imported(binding.propertyName?.text ?? binding.name.text, from)
    }
  }
}
function splitRow(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let escaped = false
  for (const char of line.trim().slice(1, -1)) {
    if (char === '|' && !escaped) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
    escaped = char === '\\' && !escaped
    if (char !== '\\') escaped = false
  }
  cells.push(current.trim())
  return cells
}
function table(lines: string[], index: number) {
  if (!lines[index]?.trim().startsWith('|') || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[index + 1] ?? ''))
    return undefined
  const headers = splitRow(lines[index]!).map((item) => item.toLowerCase())
  const rows: string[][] = []
  let end = index + 2
  while (lines[end]?.trim().startsWith('|')) rows.push(splitRow(lines[end++]!))
  return { headers, rows, end }
}
const apis = new Map<string, ApiEntry>()
const designs = new Set(['border', 'color', 'typography'])
const chineseNames: Record<string, string> = {
  button: '按钮',
  border: '边框',
  color: '色彩',
  container: '布局容器',
  icon: '图标',
  layout: '布局',
  link: '链接',
  text: '文本',
  scrollbar: '滚动条',
  space: '间距',
  splitter: '分隔面板',
  typography: '排版',
  'config-provider': '全局配置',
  autocomplete: '自动补全输入',
  cascader: '级联选择器',
  checkbox: '多选框',
  'color-picker-panel': '颜色选择面板',
  'color-picker': '颜色选择器',
  'date-picker-panel': '日期选择面板',
  'date-picker': '日期选择器',
  'datetime-picker': '日期时间选择器',
  form: '表单',
  input: '输入框',
  'input-number': '数字输入框',
  'input-tag': '标签输入框',
  'input-otp': '验证码输入框',
  mention: '提及输入',
  radio: '单选框',
  rate: '评分',
  select: '选择器',
  'select-v2': '虚拟化选择器',
  slider: '滑块',
  switch: '开关',
  'time-picker': '时间选择器',
  'time-select': '时间选择',
  transfer: '穿梭框',
  'tree-select': '树形选择器',
  upload: '上传',
  avatar: '头像',
  badge: '徽章',
  calendar: '日历',
  card: '卡片',
  carousel: '走马灯',
  collapse: '折叠面板',
  descriptions: '描述列表',
  empty: '空状态',
  image: '图片',
  'infinite-scroll': '无限滚动',
  pagination: '分页',
  progress: '进度条',
  result: '结果反馈',
  skeleton: '骨架屏',
  table: '表格',
  'table-v2': '虚拟化表格',
  tag: '标签',
  timeline: '时间线',
  tour: '漫游引导',
  tree: '树形控件',
  'tree-v2': '虚拟化树',
  statistic: '统计数值',
  segmented: '分段控制器',
  affix: '固钉',
  anchor: '锚点',
  backtop: '回到顶部',
  breadcrumb: '面包屑',
  dropdown: '下拉菜单',
  menu: '菜单',
  'page-header': '页头',
  steps: '步骤条',
  tabs: '标签页',
  alert: '警告提示',
  dialog: '对话框',
  drawer: '抽屉',
  loading: '加载反馈',
  message: '消息提示',
  'message-box': '消息弹框',
  notification: '通知',
  popconfirm: '气泡确认框',
  popover: '弹出框',
  tooltip: '文字提示',
  divider: '分割线',
  watermark: '水印',
}
const chineseCategories: Record<string, string> = {
  basic: '基础样式',
  configuration: '配置',
  form: '表单输入',
  data: '数据展示',
  navigation: '导航',
  feedback: '反馈提示',
  others: '其他',
}
// Project-authored selection notes, based on the pinned public APIs. No documentation prose or generated recommendation scores.
const selectionNotes: Record<string, [purpose: string, useWhen: string, constraint: string]> = {
  button: ['触发用户操作。', '提交、确认或工具栏操作', '异步操作需自行管理 loading 和重复提交'],
  border: [
    '配置边框、圆角和阴影设计变量。',
    '统一容器外观',
    '设计适配器使用局部 CSS 变量，不是 Vue 组件',
  ],
  color: [
    '配置主题与语义色设计变量。',
    '统一主色、文本色和背景色',
    '颜色变量需结合文字与背景检查可读性',
  ],
  container: [
    '组合页头、侧栏、内容和页脚。',
    '搭建整体页面框架',
    '通过 Header、Aside、Main、Footer 子组件组合',
  ],
  icon: ['包裹并设置图标大小和颜色。', '操作入口或状态图形', '图标内容使用登记图标或组件引用'],
  layout: [
    '以 Row 和 Col 建立响应式栅格。',
    '按列对齐的页面布局',
    '使用 24 栅格，子列需放在 Row 中',
  ],
  link: ['提供文本链接入口。', '页面跳转或文档入口', '地址应使用安全 URL'],
  text: ['呈现带主题样式的行内文本。', '文字层级、截断和强调', '文字内容通过 default 槽传入'],
  scrollbar: [
    '定制内容区域滚动条。',
    '固定高度的滚动内容',
    '需要设置高度或最大高度才能形成纵向滚动区域',
  ],
  space: ['为一组子内容设置间距。', '按钮组和短内容排列', '适合间距组织，复杂列布局使用栅格'],
  splitter: [
    '把可用空间划为可拖动面板。',
    '可调整宽高的工作区',
    '内容通过 SplitterPanel 子面板组合',
  ],
  typography: [
    '配置字号、字重、字体和行高变量。',
    '统一文字排版',
    '设计适配器使用局部 CSS 变量，不注册虚构组件',
  ],
  'config-provider': [
    '为后代组件提供语言和默认设置。',
    '统一组件默认行为',
    '配置只影响其组件后代，不替代业务状态',
  ],
  autocomplete: [
    '输入时提供可选择的建议。',
    '搜索词或已有内容补全',
    '建议回调需按公开签名返回或 resolve 建议列表',
  ],
  cascader: ['逐级选择层次选项。', '地区或分类路径选择', '选项需组织为树，字段映射放在 props 对象'],
  checkbox: [
    '选择一个或多个独立选项。',
    '多选清单和布尔开关',
    '组选择使用 CheckboxGroup 管理选中值',
  ],
  'color-picker-panel': [
    '直接展示颜色选择面板。',
    '持续可见的颜色编辑区',
    '颜色格式和透明度需与绑定值约定一致',
  ],
  'color-picker': [
    '通过弹层选择颜色。',
    '紧凑的颜色设置入口',
    '需要绑定颜色值，不自动修改页面主题',
  ],
  'date-picker-panel': [
    '直接展示日期选择面板。',
    '在页面中嵌入日历选择',
    '日期类型和范围模式决定绑定值形状',
  ],
  'date-picker': [
    '选择日期或日期范围。',
    '日期、月份或日期区间输入',
    'value-format 决定存储字符串或日期对象',
  ],
  'datetime-picker': [
    '使用 DatePicker 的日期时间模式。',
    '同时选择日期和时间',
    '与 DatePicker 共用 API，通过 datetime 变体配置',
  ],
  form: [
    '组织表单字段和验证。',
    '多个关联输入的校验与提交',
    'FormItem 的 prop 需对应表单 model 字段',
  ],
  input: [
    '输入普通文本、密码或多行内容。',
    '短文本和 textarea 录入',
    '需绑定 modelValue，业务提交和校验由页面控制',
  ],
  'input-number': [
    '输入和递增递减数字。',
    '有步长或上下限的数值',
    '精度、步长和范围需与业务数值约束一致',
  ],
  'input-tag': [
    '把输入内容管理为标签列表。',
    '关键词或多值文本录入',
    '绑定值为数组，分隔符可用字符串或安全正则',
  ],
  'input-otp': ['把短代码分格录入。', '验证码或短确认码输入', '只负责输入，不发送或验证验证码'],
  mention: ['在文本中选择触发符建议项。', '提及用户或内容标签', '候选项和触发符需由业务配置'],
  radio: ['在互斥选项中选择一项。', '少量选项的单项选择', '同组选项需要共享 RadioGroup 绑定值'],
  rate: ['选择离散评分。', '星级评分和评价展示', '显示评分与可编辑评分由 disabled 等属性区分'],
  select: [
    '在下拉选项中单选或多选。',
    '已有候选项的紧凑选择',
    '用 Option、OptionGroup 或公开 options 配置候选项',
  ],
  'select-v2': [
    '虚拟化呈现下拉候选项。',
    '较大的选择列表',
    '候选项通过 options 数据配置，留意选项字段映射',
  ],
  slider: ['在区间内拖动选择数值。', '连续数值或范围调节', '步长与 min、max 需要相容'],
  switch: ['切换两种明确状态。', '启用与停用设置', '异步切换可用 before-change 控制是否接受新值'],
  'time-picker': ['选择时间或时间范围。', '需要时分秒的时间输入', '时间格式与绑定值格式需要明确'],
  'time-select': [
    '从离散时间段中选择时间。',
    '有固定间隔的预约时间',
    '可选时间由 start、end、step 限定',
  ],
  transfer: [
    '在两侧列表之间移动选中项。',
    '分配与撤销一组已有项',
    '每项需要稳定 key；内部面板通过父引用访问',
  ],
  'tree-select': [
    '从树形下拉中选择节点。',
    '层级数据的紧凑选择',
    '组合 Tree 和 Select，复杂方法通过公开实例引用调用',
  ],
  upload: [
    '选择文件并展示上传状态。',
    '文件选择、预览和上传入口',
    '此工作台使用登记上传策略，不直接发送任意上传地址',
  ],
  avatar: ['呈现人物或对象头像。', '账号和成员标识', '图片 URL 应可信，并可配置加载失败回退'],
  badge: [
    '在内容旁显示数量或小标记。',
    '未读数和轻量状态提示',
    '提示依附于槽位内容，不替代完整通知',
  ],
  calendar: [
    '以月历组织日期内容。',
    '日期浏览与日历单元格展示',
    '自定义单元格使用公开日期作用域槽',
  ],
  card: ['将相关内容放入卡片容器。', '想法摘要或信息分组', '内容和页头页脚通过已注册槽位组合'],
  carousel: ['在同一区域轮换展示内容。', '图片或少量内容轮播', '每页需使用 CarouselItem 子组件'],
  collapse: [
    '展开或折叠一组内容面板。',
    '节省纵向空间的信息分组',
    '子项使用 CollapseItem；手风琴模式改变绑定值形状',
  ],
  descriptions: [
    '以标签和值呈现对象字段。',
    '账号资料和只读详情',
    '字段需使用 DescriptionsItem 子组件',
  ],
  empty: ['展示无数据状态。', '列表为空或尚未创建内容', '空状态内容由业务决定，不自动查询数据'],
  image: ['展示图片并提供预览能力。', '图片列表或可放大的媒体', '图片和预览地址应使用安全 URL'],
  'infinite-scroll': [
    '滚动到阈值时调用加载回调。',
    '分页追加列表',
    '是指令；需自行管理加载中、结束和禁用条件',
  ],
  pagination: [
    '选择当前页和每页数量。',
    '分段浏览较多记录',
    '仅提供分页状态，业务仍需请求对应数据',
  ],
  progress: ['显示任务完成进度。', '可量化任务状态', '百分比和任务状态由业务更新'],
  result: [
    '呈现操作结果的完整反馈。',
    '成功、失败或处理中结果页',
    '说明文字与后续操作通过属性和槽位组合',
  ],
  skeleton: [
    '在等待内容时展示占位结构。',
    '首次加载或请求等待',
    '真实内容与占位模板应保持相近布局',
  ],
  table: [
    '以列展示结构化记录。',
    '有表头、选择和排序的数据列表',
    '通过 TableColumn 定义列，服务端排序需业务接通',
  ],
  'table-v2': [
    '虚拟化渲染大表格可见行。',
    '大量记录的表格展示',
    '需设置尺寸和 columns；AutoResizer 提供可用宽高',
  ],
  tag: ['显示简短分类或状态标签。', '关键词和可移除状态标记', '关闭事件需由业务更新标签数据'],
  timeline: [
    '按顺序展示一系列事件。',
    '想法归档或操作历史',
    '通过 TimelineItem 提供事件和时间，排序由数据决定',
  ],
  tour: ['引导用户逐步查看页面目标。', '首次使用说明', 'TourStep 目标应引用当前页面登记 DOM'],
  tree: [
    '展示可展开的层级节点。',
    '分类导航和树状数据管理',
    '节点 key 需稳定，懒加载按公开回调签名完成',
  ],
  'tree-v2': ['虚拟化展示树形可见节点。', '较大规模的层级列表', '需提供容器高度和稳定节点字段映射'],
  statistic: [
    '展示统计数值或倒计时。',
    '指标摘要和剩余时间',
    '倒计时使用 Countdown 子 API，数值计算仍由业务负责',
  ],
  segmented: [
    '用分段按钮切换单一选项。',
    '少量视图或状态切换',
    '选项以 options 配置，不承担路由或数据加载',
  ],
  affix: ['在滚动时固定区域位置。', '持续可见的工具栏', '目标和偏移需与实际滚动容器匹配'],
  anchor: ['连接并定位页面内的内容锚点。', '长页面目录', 'AnchorLink 地址需对应实际内容锚点'],
  backtop: ['将滚动区域返回顶部。', '长列表或长页面浏览', 'target 需指向实际可滚动容器'],
  breadcrumb: [
    '显示页面所处层级。',
    '层级导航和返回入口',
    '通过 BreadcrumbItem 组合，跳转地址由业务提供',
  ],
  dropdown: [
    '在触发内容旁展示操作菜单。',
    '账号菜单或更多操作',
    '菜单通过 DropdownMenu 和 DropdownItem 槽组合',
  ],
  menu: ['展示应用导航菜单。', '侧栏和顶栏导航', '路由和角色授权仍由应用及服务端处理'],
  'page-header': ['组合返回入口与页面标题。', '详情或子页面页头', '返回事件需接通业务导航'],
  steps: ['展示流程中的当前步骤。', '多步骤表单或处理流程', '使用 Step 子组件，步骤推进由业务控制'],
  tabs: ['在多个内容面板之间切换。', '同页内容分组', '面板用 TabPane，内部导航引用通过 Tabs 暴露'],
  alert: ['在页面内持续展示状态说明。', '错误、警告和操作说明', '提示不会自动恢复失败业务'],
  dialog: [
    '以模态对话框呈现内容。',
    '确认、编辑或登录表单',
    '需要绑定可见状态；关闭回调应按签名处理 done',
  ],
  drawer: [
    '从页面边缘展开内容面板。',
    '保留页面上下文的编辑或详情',
    '需要绑定可见状态并管理关闭前检查',
  ],
  loading: [
    '通过服务或指令覆盖加载反馈。',
    '区域加载与异步等待',
    '服务目标仅引用当前页面登记 DOM，结束后需关闭',
  ],
  message: [
    '短暂显示轻量操作反馈。',
    '保存成功或简短错误提示',
    '是服务 API，消息内容保持文本或安全排版',
  ],
  'message-box': [
    '通过服务打开确认、提示或输入弹框。',
    '确认动作和短文本输入',
    '异步结果需处理确认、取消和关闭',
  ],
  notification: [
    '显示可保留较久的通知。',
    '操作完成或需要关注的事件',
    '是服务 API；组件销毁时需清理所属通知',
  ],
  popconfirm: ['在触发内容旁要求确认。', '简短且局部的操作确认', '确认事件仍需接通业务动作'],
  popover: [
    '在触发内容旁展示浮层。',
    '补充说明和轻量交互',
    '含 Popper 辅助 API；指令需关联真实 Popover 引用',
  ],
  tooltip: [
    '在悬停或聚焦时显示简短说明。',
    '图标含义和补充提示',
    '交互内容较多时更适合使用 Popover',
  ],
  divider: ['分隔相邻内容区域。', '章节或行内操作分组', '只表达视觉分隔，不提供页面布局'],
  watermark: [
    '为内容区域添加水印。',
    '展示文字或图片标记',
    '水印是展示能力，不替代数据访问权限或防复制措施',
  ],
}
const specials: Record<
  string,
  { runtimeExport: string; parentApiKey?: string; propPath?: string; kind?: CatalogKind }
> = {
  'datetime-picker': { runtimeExport: 'ElDatePicker' },
  treev2: { runtimeExport: 'ElTreeV2' },
  tablev2: { runtimeExport: 'ElTableV2' },
  'tab-nav': {
    runtimeExport: 'ElTabs',
    parentApiKey: 'tabs',
    propPath: 'tabNavRef',
    kind: 'composite',
  },
  'tab-bar': {
    runtimeExport: 'ElTabs',
    parentApiKey: 'tabs',
    propPath: 'tabNavRef.tabBarRef',
    kind: 'composite',
  },
  'transfer-panel': {
    runtimeExport: 'ElTransfer',
    parentApiKey: 'transfer',
    propPath: 'leftPanel|rightPanel',
    kind: 'composite',
  },
  column: {
    runtimeExport: 'ElTableV2',
    parentApiKey: 'table-v2',
    propPath: 'columns[]',
    kind: 'composite',
  },
  'loading-service': { runtimeExport: 'ElLoadingService', kind: 'service' },
  'loading-directive': { runtimeExport: 'ElLoadingDirective', kind: 'directive' },
  'infinite-scroll': { runtimeExport: 'ElInfiniteScroll', kind: 'directive' },
  'popover-directive': { runtimeExport: 'ElPopoverDirective', kind: 'directive' },
  message: { runtimeExport: 'ElMessage', kind: 'service' },
  'message-box': { runtimeExport: 'ElMessageBox', kind: 'service' },
  notification: { runtimeExport: 'ElNotification', kind: 'service' },
}
function getApi(owner: string, docKey: string): ApiEntry {
  const ownerKey = kebab(owner.replace(/\s+/g, '-'))
  const normalized = ownerKey.replace(/-/g, '')
  const special = specials[ownerKey] ?? specials[normalized]
  const runtimeExport =
    special?.runtimeExport ??
    [...availableExports].find((name) => name.slice(2).toLowerCase() === normalized)
  if (!runtimeExport) throw new Error(`Unmapped API owner ${owner} in ${docKey}`)
  const apiKey = special?.parentApiKey
    ? ownerKey === 'column'
      ? 'table-v2-column'
      : ownerKey
    : ownerKey === 'loading-service' || ownerKey === 'loading-directive'
      ? ownerKey
      : kebab(runtimeExport.slice(2))
  let api = apis.get(apiKey)
  if (!api) {
    api = {
      apiKey,
      runtimeExport,
      kind: special?.kind ?? 'component',
      props: [],
      events: [],
      slots: [],
      exposes: [],
      sources: [],
      ...(special?.parentApiKey
        ? { parentApiKey: special.parentApiKey, propPath: special.propPath }
        : {}),
    }
    apis.set(apiKey, api)
  }
  const document = `${publicBase}docs/en-US/component/${docKey}.md`
  if (!api.sources.includes(document)) api.sources.push(document)
  return api
}
function collectEmits(
  api: ApiEntry,
  node: ts.Node | undefined,
  from: ts.SourceFile,
  seen = new Set<string>(),
) {
  if (!node) return
  node = unwrap(node)
  if (ts.isIdentifier(node) || (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName))) {
    const name = ts.isIdentifier(node) ? node.text : (node.typeName as ts.Identifier).text
    const id = `${from.fileName}:${name}`
    if (seen.has(id)) return
    seen.add(id)
    const found = declaration(name, from)
    if (found) {
      const url = publicBase + relative(sourceRoot, found.file.fileName)
      if (!api.sources.includes(url)) api.sources.push(url)
      collectEmits(
        api,
        ts.isVariableDeclaration(found.node) ? found.node.initializer : found.node,
        found.file,
        seen,
      )
    }
    return
  }
  if (ts.isTypeAliasDeclaration(node)) {
    collectEmits(api, node.type, from, seen)
    return
  }
  function add(name: string, signature: string) {
    if (!api.events.some((event) => event.name === name)) api.events.push({ name, signature })
  }
  if (
    ts.isCallExpression(node) &&
    text(node.expression) === 'createModelToggleComposable' &&
    node.arguments[0]
  ) {
    const name = literals(node.arguments[0], from)[0]
    if (typeof name === 'string') add(`update:${name}`, '(value: boolean) => void')
    return
  }
  if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
    for (const member of node.members) {
      if (ts.isCallSignatureDeclaration(member)) {
        const eventType = member.parameters[0]?.type
        for (const name of literals(eventType, from))
          if (typeof name === 'string')
            add(
              name,
              `(${member.parameters
                .slice(1)
                .map((parameter) => text(parameter))
                .join(', ')}) => void`,
            )
      } else if (ts.isPropertySignature(member) && member.type && ts.isTupleTypeNode(member.type)) {
        add(
          nameOf(member.name, from),
          `(${member.type.elements.map((element, index) => (ts.isNamedTupleMember(element) ? text(element) : `arg${index}: ${text(element)}`)).join(', ')}) => void`,
        )
      }
    }
    return
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) collectEmits(api, element.expression, from, new Set(seen))
      else
        for (const name of literals(element, from))
          if (typeof name === 'string') add(name, '(...args: unknown[]) => void')
    }
    return
  }
  for (const event of objectMembers(node, from)) {
    const type = parseType(event.typeText)
    const signature =
      type && ts.isFunctionTypeNode(type)
        ? `(${type.parameters.map((parameter) => text(parameter)).join(', ')}) => void`
        : '(...args: unknown[]) => void'
    add(event.runtimeName, signature)
  }
}
function version(name: string) {
  return name.match(/\^\((\d+\.\d+\.\d+)\)/)?.[1]
}
function documentedName(name: string) {
  return clean(name)
    .split(/\s*\/\s*v-model/)[0]!
    .trim()
}
const catalog: (Omit<CatalogEntry, 'apis'> & { apiKeys: string[] })[] = []
for (const [category, group] of Object.entries(navigation)) {
  if (category === 'overview') continue
  for (const item of group.children) {
    const key = item.link.slice(1)
    const lines = readFileSync(join(docsRoot, `${key}.md`), 'utf8').split('\n')
    const used = new Set<string>()
    let active = false
    let owner = key
    let current: ApiEntry | undefined
    let section = ''
    let nestedProp = ''
    for (let index = 0; index < lines.length; index++) {
      const heading = lines[index]!.match(/^#{2,6}\s+(.+)$/)?.[1]
      if (heading) {
        const title = clean(heading)
          .replace(/\{#[^}]+\}/g, '')
          .trim()
        if (/\bAPI$/.test(title) || (key === 'infinite-scroll' && title === 'Directives')) {
          active = true
          owner = key === 'infinite-scroll' ? key : title.replace(/\s*API$/, '') || key
          section = ''
          current = undefined
        }
        if (!active) continue
        const match = title.match(
          /^(.*?)\s*(Attributes?|Props|Events?|Slots?|Exposes|Methods?|Options|Directives)$/i,
        )
        if (title === 'CascaderProps' || title === 'FormItemRule') {
          current = getApi(title === 'CascaderProps' ? 'cascader-panel' : 'form-item', key)
          section = 'members'
          nestedProp = title === 'CascaderProps' ? 'props' : 'rules'
          used.add(current.apiKey)
        } else if (match) {
          const prefix = match[1]?.trim()
          if (prefix && prefix !== 'Own') owner = prefix
          section = /^(?:Attributes?|Props|Options|Directives)$/i.test(match[2]!)
            ? 'props'
            : /^Events?$/i.test(match[2]!)
              ? 'events'
              : /^Slots?$/i.test(match[2]!)
                ? 'slots'
                : 'exposes'
          if (key === 'loading')
            owner = /^Directives$/i.test(match[2]!) ? 'loading-directive' : 'loading-service'
          // Lowercase `props` documents a nested object, not the component's own attributes.
          if (
            key === 'config-provider' &&
            prefix &&
            prefix !== 'Config Provider' &&
            /^Attributes?$/i.test(match[2]!)
          ) {
            current = getApi('config-provider', key)
            section = 'members'
            nestedProp = camel(kebab(prefix))
            if (!current.props.some((prop) => prop.runtimeName === nestedProp))
              current.props.push(makeProp(nestedProp, 'object'))
          } else if (title === 'props' && current) {
            section = 'members'
            nestedProp = 'props'
          } else current = getApi(owner, key)
          if (current) used.add(current.apiKey)
        } else if (
          current &&
          current.props.some(
            (prop) =>
              prop.name.toLowerCase() === title.toLowerCase() ||
              prop.runtimeName.toLowerCase() === camel(title).toLowerCase(),
          )
        ) {
          section = 'members'
          nestedProp = camel(title).replace(/^./, (letter) => letter.toLowerCase())
        }
      }
      if (!active || !current || !section) continue
      const parsed = table(lines, index)
      if (
        !parsed ||
        !/^(?:name|attribute|attributes|property|parameter|method)$/.test(parsed.headers[0] ?? '')
      )
        continue
      index = parsed.end - 1
      // TreeSelect's four-column table links inherited APIs; its cells are not literal prop names.
      if (
        parsed.headers.includes('exposes') &&
        parsed.headers.includes('events') &&
        parsed.headers.includes('slots')
      )
        continue
      const typeIndex = parsed.headers.findIndex((name) => name === 'type')
      const defaultIndex = parsed.headers.findIndex((name) => name === 'default')
      const membersList: ApiProp[] = []
      for (const row of parsed.rows) {
        const name = documentedName(row[0] ?? '')
        if (!name) continue
        if (/\[(?:input props|tooltip)\]\(/.test(row[0] ?? '')) continue
        const typeText = clean(typeIndex >= 0 ? (row[typeIndex] ?? 'unknown') : 'unknown')
        const since = version(row[0] ?? '')
        if (section === 'props' || section === 'members') {
          const prop = makeProp(
            name,
            typeText,
            defaultIndex >= 0 ? clean(row[defaultIndex] ?? '—') : '—',
            /\^\(required\)/.test(row[0] ?? '') || undefined,
            since,
            typeIndex >= 0 ? row[typeIndex] : undefined,
          )
          if (section === 'members') membersList.push(prop)
          else mergeProps(current.props, [prop])
        } else if (section === 'events') {
          const signature =
            typeIndex >= 0
              ? typeText
              : clean(
                  row[parsed.headers.findIndex((header) => /parameter|argument/.test(header))] ??
                    '(...args: unknown[]) => void',
                )
          if (!current.events.some((event) => event.name === name))
            current.events.push({ name, signature, ...(since ? { version: since } : {}) })
        } else if (section === 'slots') {
          const scopeIndex = parsed.headers.findIndex((header) => /scope|subtags/.test(header))
          const scopeText =
            typeIndex >= 0 ? typeText : scopeIndex >= 0 ? clean(row[scopeIndex] ?? '—') : '—'
          if (!current.slots.some((slot) => slot.name === name))
            current.slots.push({ name, scopeText, ...(since ? { version: since } : {}) })
        } else if (!current.exposes.some((expose) => expose.name === name)) {
          const direct = typeIndex >= 0 ? typeText : 'unknown'
          const signature =
            /^\(|Function|Ref<|ComputedRef<|^object|^string|^number|^boolean|^—|^unknown/.test(
              direct,
            )
              ? direct
              : direct.match(/^\([^)]*\)/)?.[0]
                ? `${direct.match(/^\([^)]*\)/)![0]} => unknown`
                : 'unknown'
          current.exposes.push({ name, signature, ...(since ? { version: since } : {}) })
        }
        docFacts.push({
          apiKey: current.apiKey,
          section: section === 'members' ? `props.${camel(nestedProp)}.members` : section,
          name,
          document: key,
        })
      }
      if (section === 'members') {
        const parent = current.props.find((prop) => prop.runtimeName === camel(nestedProp))
        if (parent) {
          parent.members ??= []
          mergeProps(parent.members, membersList)
        }
      }
    }
    const keys = [...used]
    const rootApiKeys =
      key === 'layout'
        ? ['row', 'col']
        : key === 'loading'
          ? ['loading-service', 'loading-directive']
          : designs.has(key)
            ? []
            : [key === 'datetime-picker' ? 'date-picker' : key].filter((apiKey) => apis.has(apiKey))
    if (!designs.has(key) && !rootApiKeys.length) unresolved.push(`root:${key}`)
    catalog.push({
      key,
      title: item.text,
      name: chineseNames[key] ?? item.text,
      category,
      kind: designs.has(key)
        ? 'design'
        : key === 'layout' || key === 'loading'
          ? 'composite'
          : (apis.get(rootApiKeys[0] ?? '')?.kind ?? 'component'),
      docsUrl: `https://element-plus.org/en-US/component/${key}.html`,
      rootApiKeys,
      apiKeys: keys,
      version: '2.14.5',
      purpose: selectionNotes[key]![0],
      useWhen: [selectionNotes[key]![1]],
      constraints: [selectionNotes[key]![2]],
      tags: [
        category,
        chineseCategories[category] ?? category,
        chineseNames[key] ?? item.text,
        item.text,
        key,
        ...(item.promotion ? [`since:${item.promotion}`] : []),
        ...(key === 'input' ? ['textarea', 'password', 'text', '多行输入', '密码输入'] : []),
        ...(key === 'datetime-picker' ? ['variant:datetime', 'variant:datetimerange'] : []),
      ],
    })
  }
}

// This publicly exported Table V2 companion is documented in examples rather than an API table.
getApi('auto-resizer', 'table-v2')
catalog.find((entry) => entry.key === 'table-v2')!.apiKeys.push('auto-resizer')
for (const [owner, document] of [
  ['collapse-transition', 'collapse'],
  ['overlay', 'dialog'],
  ['popper', 'popover'],
  ['popper-arrow', 'popover'],
  ['popper-content', 'popover'],
  ['popper-trigger', 'popover'],
  ['popover-directive', 'popover'],
]) {
  const api = getApi(owner!, document!)
  catalog.find((entry) => entry.key === document)!.apiKeys.push(api.apiKey)
}
const columnSource = file(join(sourceRoot, 'packages/components/table-v2/src/types.ts'))!
const columnDeclaration = declaration('Column', columnSource)!
mergeProps(
  apis.get('table-v2-column')!.props,
  typeMembers(columnDeclaration.node, columnDeclaration.file),
)
apis.get('table-v2-column')!.sources.push(publicBase + relative(sourceRoot, columnSource.fileName))
// v-popover consumes the public Popover instance as its binding.value (not executable code).
apis.get('popover-directive')!.props.push(makeProp('value', 'object PopoverInstance'))

for (const api of apis.values()) {
  if (api.parentApiKey || api.kind === 'directive') continue
  const foundSource = findRuntimeSource(api.runtimeExport)
  if (!foundSource) {
    unresolved.push(`source:${api.runtimeExport}`)
    continue
  }
  const source: ts.SourceFile = foundSource
  const sourceUrl = publicBase + relative(sourceRoot, source.fileName)
  if (!api.sources.includes(sourceUrl)) api.sources.push(sourceUrl)
  const props: ApiProp[] = []
  const defaults = new Map<string, string>()
  const explicitType =
    api.kind === 'service'
      ? (
          {
            message: 'MessageOptions',
            notification: 'NotificationOptions',
            'message-box': 'ElMessageBoxOptions',
            'loading-service': 'LoadingOptions',
          } as Record<string, string>
        )[api.apiKey]
      : undefined
  if (explicitType) {
    const found = declaration(explicitType, source)
    if (found) props.push(...typeMembers(found.node, found.file))
  }
  function sourceSlot(name: string, argument?: ts.Expression) {
    if (!name || !['component', 'composite'].includes(api.kind)) return
    const fields =
      argument && ts.isObjectLiteralExpression(argument)
        ? argument.properties.flatMap((property) =>
            ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)
              ? [nameOf(property.name, source)]
              : [],
          )
        : []
    const existing = api.slots.find((slot) => slot.name === name)
    if (existing) {
      if (fields.length && !existing.scopeFields?.length) existing.scopeFields = fields
    } else
      api.slots.push({
        name,
        scopeText: fields.length ? `{ ${fields.join(', ')} }` : '—',
        ...(fields.length ? { scopeFields: fields } : {}),
      })
  }
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const name = text(node.expression)
      if (name === 'defineProps' && api.kind === 'component') {
        props.push(
          ...(node.typeArguments?.[0]
            ? typeMembers(node.typeArguments[0], source)
            : objectMembers(node.arguments[0], source)),
        )
      }
      if (name === 'defineComponent' && api.kind === 'component') {
        const options = node.arguments[0] && unwrap(node.arguments[0])
        if (options && ts.isObjectLiteralExpression(options))
          for (const option of options.properties) {
            if (ts.isPropertyAssignment(option) && nameOf(option.name, source) === 'props')
              props.push(...objectMembers(option.initializer, source))
            if (ts.isPropertyAssignment(option) && nameOf(option.name, source) === 'emits')
              collectEmits(api, option.initializer, source)
          }
      }
      if (name === 'withDefaults' && node.arguments[1]) {
        const defaultObject = unwrap(node.arguments[1])
        if (ts.isObjectLiteralExpression(defaultObject))
          for (const value of defaultObject.properties) {
            if (!ts.isPropertyAssignment(value)) continue
            defaults.set(nameOf(value.name, source), text(value.initializer))
          }
      }
      if (name === 'defineEmits' && api.kind === 'component')
        collectEmits(api, node.typeArguments?.[0] ?? node.arguments[0], source)
      if (name === 'renderSlot' && node.arguments[1] && ts.isStringLiteral(node.arguments[1]))
        sourceSlot(node.arguments[1].text, node.arguments[2])
      if (name === 'defineExpose' || name === 'expose' || name.endsWith('.expose')) {
        const object = node.arguments[0] && unwrap(node.arguments[0])
        if (object && ts.isObjectLiteralExpression(object))
          for (const member of object.properties) {
            if (!ts.isShorthandPropertyAssignment(member) && !ts.isPropertyAssignment(member))
              continue
            const exposeName = nameOf(member.name, source)
            const comment = source.text.slice(member.getFullStart(), member.getStart())
            if (
              !api.exposes.some((item) => item.name === exposeName) &&
              comment.includes('@description') &&
              !comment.includes('@internal')
            )
              api.exposes.push({ name: exposeName, signature: 'unknown' })
          }
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const receiver = text(node.expression)
      if (['slots', 'ctx.slots', 'context.slots', '$slots'].includes(receiver)) {
        const name = ts.isPropertyAccessExpression(node)
          ? node.name.text
          : node.argumentExpression && ts.isStringLiteral(node.argumentExpression)
            ? node.argumentExpression.text
            : ''
        sourceSlot(
          name,
          ts.isCallExpression(node.parent) && node.parent.expression === node
            ? node.parent.arguments[0]
            : undefined,
        )
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (api.kind === 'component' && !props.length) {
    const name = api.runtimeExport.slice(2)
    for (const candidate of [`${name}Props`, `${name[0]!.toLowerCase()}${name.slice(1)}Props`]) {
      const found = declaration(candidate, source)
      if (found)
        props.push(
          ...(ts.isVariableDeclaration(found.node)
            ? objectMembers(found.node.initializer, found.file)
            : typeMembers(found.node, found.file)),
        )
    }
  }
  for (const prop of props)
    if (defaults.has(prop.runtimeName)) {
      prop.defaultText = defaults.get(prop.runtimeName)!
      prop.required = false
    }
  mergeProps(api.props, props)
  // Public VueUse model wrappers may live in an imported composable instead of a defineEmits call.
  const modelSources = [source]
  for (const statement of source.statements)
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      /(?:^|\/)use-[\w-]+$/.test(statement.moduleSpecifier.text)
    ) {
      const target = resolveModule(source, statement.moduleSpecifier.text)
      if (target) modelSources.push(target)
    }
  for (const modelSource of modelSources) {
    function collectModels(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        text(node.expression) === 'useVModel' &&
        node.arguments[1] &&
        ts.isStringLiteral(node.arguments[1])
      ) {
        const name = node.arguments[1].text
        const prop = api.props.find((prop) => prop.runtimeName === name)
        if (prop && !api.events.some((event) => event.name === `update:${name}`)) {
          api.events.push({
            name: `update:${name}`,
            signature: `(value: ${prop.typeText}) => void`,
            parameterCount: 1,
          })
          const url = publicBase + relative(sourceRoot, modelSource.fileName)
          if (!api.sources.includes(url)) api.sources.push(url)
        }
      }
      ts.forEachChild(node, collectModels)
    }
    collectModels(modelSource)
  }
  if (source.fileName.endsWith('.vue')) {
    const raw = readFileSync(source.fileName, 'utf8').split('<script')[0]!
    for (const match of raw.matchAll(/<slot(?:\s[^>]*?)?(?:\sname=["']([^"']+)["'])?[^>]*>/g)) {
      const explicit = match[0].match(/\bname=["']([^"']+)["']/)?.[1]
      if (/\s:name=/.test(match[0])) continue
      const name = explicit ?? 'default'
      if (!api.slots.some((slot) => slot.name === name)) api.slots.push({ name, scopeText: '—' })
    }
  }
}
for (const [target, parent, exclusions] of [
  ['autocomplete', 'input', []],
  ['mention', 'input', []],
  ['popover', 'tooltip', []],
  ['popconfirm', 'tooltip', ['popperClass', 'popperStyle', 'fallbackPlacements']],
] as [string, string, string[]][]) {
  const child = apis.get(target)!
  const inherited = apis.get(parent)!
  mergeProps(
    child.props,
    inherited.props.filter((prop) => !exclusions.includes(prop.runtimeName)),
  )
  child.sources.push(...inherited.sources.filter((source) => !child.sources.includes(source)))
}
// These documented compositions inherit their parent capabilities.
const treeSelect = apis.get('tree-select')
if (treeSelect)
  for (const sourceKey of ['select', 'tree']) {
    const inherited = apis.get(sourceKey)!
    mergeProps(treeSelect.props, inherited.props)
    for (const field of ['events', 'slots'] as const)
      for (const value of inherited[field]) {
        if (!treeSelect[field].some((item) => item.name === value.name))
          (treeSelect[field] as { name: string; signature?: string; scopeText?: string }[]).push(
            value,
          )
      }
    treeSelect.sources.push(
      ...inherited.sources.filter((source) => !treeSelect.sources.includes(source)),
    )
  }
for (const key of ['message', 'notification', 'message-box', 'loading-service']) {
  const api = apis.get(key)
  if (!api) continue
  const typeName = (
    {
      message: 'Message',
      notification: 'Notify',
      'message-box': 'IElMessageBox',
      'loading-service': 'LoadingInstance',
    } as Record<string, string>
  )[key]!
  const found = declarations.get(typeName)?.[0]
  if (found)
    for (const member of typeMembers(found.node, found.file)) {
      if (member.runtimeName.startsWith('_') || member.runtimeName === 'install') continue
      if (!api.exposes.some((item) => item.name === member.runtimeName))
        api.exposes.push({ name: member.runtimeName, signature: member.typeText })
    }
  if (!api.exposes.some((item) => item.name === 'invoke'))
    api.exposes.unshift({
      name: 'invoke',
      signature:
        key === 'message-box'
          ? '(options: ElMessageBoxOptions, appContext?: AppContext) => Promise<MessageBoxData>'
          : key === 'loading-service'
            ? '(options?: LoadingOptions, appContext?: AppContext) => LoadingInstance'
            : `(options?: ${key === 'message' ? 'MessageParams' : 'NotificationParams'}, appContext?: AppContext) => ${key === 'message' ? 'MessageHandler' : 'NotificationHandle'}`,
    })
  if (key !== 'message-box' && !api.exposes.some((item) => item.name === 'close'))
    api.exposes.push({ name: 'close', signature: '() => void' })
}

const require = createRequire(import.meta.url)
const iconEntry = require.resolve('@element-plus/icons-vue')
const iconTypes = readFileSync(join(dirname(iconEntry), 'types/components/index.d.ts'), 'utf8')
const iconKeys = [...iconTypes.matchAll(/export\s*\{\s*default\s+as\s+(\w+)\s*\}/g)]
  .map((match) => match[1]!)
  .sort()
if (!iconKeys.length) throw new Error('No static icon exports found')
const installedEntry = require.resolve('element-plus')
const themeCss = readFileSync(
  join(dirname(dirname(installedEntry)), 'theme-chalk/index.css'),
  'utf8',
)
const themeVariables = new Map<string, string>()
for (const match of themeCss.matchAll(/(--el-[\w-]+):([^;}]+)(?:;|})/g))
  if (!themeVariables.has(match[1]!)) themeVariables.set(match[1]!, match[2]!.trim())
const designTokens: Record<string, (name: string) => boolean> = {
  border: (name) => /^--el-(?:border-(?:width|style|radius|color)|box-shadow)/.test(name),
  color: (name) =>
    /^--el-(?:color-|text-color|bg-color|fill-color|mask-color|border-color)/.test(name),
  typography: (name) => /^--el-font-(?:size|family|line-height|weight)/.test(name),
}
for (const key of designs) {
  const props = [...themeVariables]
    .filter(([name]) => designTokens[key]!(name))
    .map(([name, value]) => ({ ...makeProp(name, 'string', value), runtimeName: name }))
  if (!props.length) throw new Error(`No documented theme variables for ${key}`)
  const api: ApiEntry = {
    apiKey: key,
    runtimeExport: `design:${key}`,
    kind: 'design',
    props,
    events: [],
    slots: [],
    exposes: [],
    sources: [
      `${publicBase}docs/en-US/component/${key}.md`,
      `${publicBase}packages/theme-chalk/src/common/var.scss`,
      `${publicBase}packages/theme-chalk/src/var.scss`,
    ],
  }
  apis.set(key, api)
  const entry = catalog.find((item) => item.key === key)!
  entry.rootApiKeys = [key]
  entry.apiKeys = [key]
}
const installedDeclarations = readFileSync(join(dirname(installedEntry), 'index.d.ts'), 'utf8')
if (!installedDeclarations.includes('components'))
  throw new Error('Installed declaration export tree unavailable')
const installedTypes = join(dirname(installedEntry), 'index.d.ts')
const declarationProgram = ts.createProgram([installedTypes], {
  noEmit: true,
  skipLibCheck: true,
  types: [],
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.Latest,
})
const checker = declarationProgram.getTypeChecker()
const publicModule = declarationProgram.getSourceFile(installedTypes)
const moduleSymbol = publicModule && checker.getSymbolAtLocation(publicModule)
if (!moduleSymbol) throw new Error('Installed public module symbol unavailable')
const runtimeExports = checker
  .getExportsOfModule(moduleSymbol)
  .filter((symbol) => {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    return symbol.name.startsWith('El') && Boolean(target.flags & ts.SymbolFlags.Value)
  })
  .map((symbol) => symbol.name)
  .sort()
const publicSymbols = new Map(
  checker.getExportsOfModule(moduleSymbol).map((symbol) => [symbol.name, symbol]),
)
function publicInstance(api: ApiEntry): ts.Type | undefined {
  const instanceSymbol = publicSymbols.get(`${api.runtimeExport.slice(2)}Instance`)
  if (instanceSymbol && !api.parentApiKey) {
    const target =
      instanceSymbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(instanceSymbol)
        : instanceSymbol
    const declared = checker.getDeclaredTypeOfSymbol(target)
    if (!(declared.flags & ts.TypeFlags.Any)) return declared
  }
  const symbol = publicSymbols.get(api.runtimeExport)
  if (!symbol) return undefined
  const exported = checker.getTypeOfSymbolAtLocation(symbol, publicModule!)
  let instance =
    api.kind === 'service'
      ? checker.getReturnTypeOfSignature(exported.getCallSignatures()[0]!)
      : exported.getConstructSignatures()[0]
        ? checker.getReturnTypeOfSignature(exported.getConstructSignatures()[0]!)
        : undefined
  if (!instance) return undefined
  if (api.parentApiKey && api.propPath && !api.propPath.includes('[]'))
    for (const part of api.propPath.split('|')[0]!.split('.')) {
      const property = checker.getPropertyOfType(checker.getNonNullableType(instance), part)
      if (!property) return undefined
      instance = checker.getTypeOfSymbolAtLocation(
        property,
        property.valueDeclaration ?? publicModule!,
      )
    }
  return checker.getNonNullableType(instance)
}
function arity(
  signature: string,
  from?: ts.SourceFile,
  seen = new Set<string>(),
): number | undefined {
  const node = parseType(signature.replace(/(?:^|(?<=\|))\s*Function\s+(?=\()/g, ''))
  const candidates = node && ts.isUnionTypeNode(node) ? node.types : node ? [node] : []
  const fn = candidates.find((item) => ts.isFunctionTypeNode(item))
  if (
    fn &&
    ts.isFunctionTypeNode(fn) &&
    !fn.parameters.some((parameter) => parameter.dotDotDotToken)
  )
    return fn.parameters.length
  if (from)
    for (const candidate of candidates) {
      const name =
        ts.isTypeReferenceNode(candidate) && ts.isIdentifier(candidate.typeName)
          ? candidate.typeName.text
          : ts.isTypeQueryNode(candidate) && ts.isIdentifier(candidate.exprName)
            ? candidate.exprName.text
            : ''
      const id = `${from.fileName}:${name}`
      if (!name || seen.has(id)) continue
      seen.add(id)
      const found = declaration(name, from)
      if (!found) continue
      if (ts.isTypeAliasDeclaration(found.node)) {
        const count = arity(text(found.node.type), found.file, seen)
        if (count !== undefined) return count
      }
      const initializer = ts.isVariableDeclaration(found.node) ? found.node.initializer : found.node
      if (
        initializer &&
        (ts.isArrowFunction(initializer) ||
          ts.isFunctionDeclaration(initializer) ||
          ts.isFunctionExpression(initializer)) &&
        !initializer.parameters.some((parameter) => parameter.dotDotDotToken)
      )
        return initializer.parameters.length
    }
}
for (const api of apis.values()) {
  if (api.kind === 'design') continue
  const instance = publicInstance(api)
  const from = findRuntimeSource(api.runtimeExport)
  const sourceInstance = from && declaration(`${api.runtimeExport.slice(2)}Instance`, from)
  const sourceExposes = sourceInstance ? typeMembers(sourceInstance.node, sourceInstance.file) : []
  for (const expose of api.exposes) {
    const symbol = instance && checker.getPropertyOfType(instance, expose.name)
    if (symbol && expose.signature === 'unknown')
      expose.signature = checker.typeToString(
        checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? publicModule!),
        undefined,
        ts.TypeFormatFlags.NoTruncation,
      )
    const sourceExpose = sourceExposes.find((member) => member.runtimeName === expose.name)
    if (expose.signature === 'unknown' && sourceExpose) expose.signature = sourceExpose.typeText
    if (expose.signature === 'unknown') {
      const prop = api.props.find((member) => member.runtimeName === expose.name)
      if (prop) expose.signature = prop.typeText
    }
  }
  for (const event of api.events) {
    const count = arity(event.signature, from)
    if (count !== undefined) event.parameterCount = count
  }
  for (const prop of api.props) {
    if (prop.valueKinds.includes('function')) {
      for (const signature of prop.typeText.split('; source: ')) {
        const count = arity(signature, api.apiKey === 'table-v2-column' ? columnSource : from)
        if (count !== undefined) {
          prop.parameterCount = count
          break
        }
      }
    }
  }
  for (const slot of api.slots) {
    const scope = slot.scopeText.replace(/^object\s+/, '').trim()
    const scopeNode = parseType(scope)
    if (scopeNode && from) {
      const scopeProps = typeMembers(scopeNode, from)
      if (scopeProps.length)
        slot.scopeFields = [...new Set(scopeProps.map((prop) => prop.runtimeName))]
    }
    if (!slot.scopeFields?.length && /^\{[^}]+\}/.test(scope))
      slot.scopeFields = [...scope.matchAll(/(?:^\{|[,;])\s*(\w+)\s*:/g)].map((match) => match[1]!)
    if (from) {
      const slotsDeclaration = declaration(`${api.runtimeExport.slice(2)}Slots`, from)
      const slotTypes = slotsDeclaration
        ? typeMembers(slotsDeclaration.node, slotsDeclaration.file)
        : []
      const sourceSlot = slotTypes.find((member) => member.runtimeName === slot.name)
      const fn = sourceSlot && parseType(sourceSlot.typeText)
      if (fn && ts.isFunctionTypeNode(fn)) {
        const parameter = fn.parameters[0]?.type
        const fields = parameter
          ? typeMembers(parameter, slotsDeclaration!.file).map((prop) => prop.runtimeName)
          : []
        slot.scopeText = parameter ? text(parameter) : '—'
        if (fields.length) slot.scopeFields = [...new Set(fields)]
      }
    }
  }
}
// TreeSelect forwards the public methods of its documented Tree and Select parents.
if (treeSelect)
  for (const expose of treeSelect.exposes) {
    if (expose.signature !== 'unknown') continue
    const inherited = ['tree', 'select']
      .flatMap((key) => apis.get(key)!.exposes)
      .find((item) => item.name === expose.name)
    if (inherited) expose.signature = inherited.signature
  }
// The public AutoResizer slot passes these exact keys in its TSX call expression.
const autoResizer = apis.get('auto-resizer')!
const autoSource = findRuntimeSource(autoResizer.runtimeExport)!
function collectSlotCalls(node: ts.Node) {
  if (
    ts.isCallExpression(node) &&
    (ts.isPropertyAccessExpression(node.expression) ||
      ts.isElementAccessExpression(node.expression))
  ) {
    const receiver = text(node.expression.expression)
    const name = ts.isPropertyAccessExpression(node.expression)
      ? node.expression.name.text
      : clean(text(node.expression.argumentExpression))
    const argument = node.arguments[0]
    if (receiver === 'slots' && argument && ts.isObjectLiteralExpression(argument)) {
      const fields = argument.properties.flatMap((property) =>
        ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)
          ? [nameOf(property.name, autoSource)]
          : [],
      )
      if (fields.length && !autoResizer.slots.some((slot) => slot.name === name))
        autoResizer.slots.push({ name, scopeText: `{ ${fields.join(', ')} }`, scopeFields: fields })
    }
  }
  ts.forEachChild(node, collectSlotCalls)
}
collectSlotCalls(autoSource)
// Both Cascader and CascaderPanel accept the same public CascaderProps object.
const panelProps = apis.get('cascader-panel')?.props.find((prop) => prop.runtimeName === 'props')
const cascaderProps = apis.get('cascader')?.props.find((prop) => prop.runtimeName === 'props')
if (panelProps?.members && cascaderProps) cascaderProps.members = panelProps.members
for (const api of apis.values())
  if (api.kind !== 'design' && !runtimeExports.includes(api.runtimeExport))
    throw new Error(`API has no public runtime export: ${api.apiKey}/${api.runtimeExport}`)
const allApiKeys = new Set(apis.keys())
const manifestKeys = Object.entries(navigation)
  .filter(([key]) => key !== 'overview')
  .flatMap(([, group]) => group.children.map((item) => item.link.slice(1)))
const actualKeys = catalog.map((item) => item.key)
const missingCatalog = manifestKeys.filter((key) => !actualKeys.includes(key))
const extraCatalog = actualKeys.filter((key) => !manifestKeys.includes(key))
const missingFacts = docFacts.filter((fact) => {
  const api = apis.get(fact.apiKey)
  const nested = fact.section.match(/^props\.(.+)\.members$/)?.[1]
  const values = nested
    ? api?.props.find((prop) => prop.runtimeName === nested)?.members
    : api?.[fact.section as 'props' | 'events' | 'slots' | 'exposes']
  return !values?.some(
    (item) =>
      item.name === fact.name || ('runtimeName' in item && item.runtimeName === camel(fact.name)),
  )
})
if (missingCatalog.length || extraCatalog.length || missingFacts.length)
  throw new Error(JSON.stringify({ missingCatalog, extraCatalog, missingFacts }))
for (const entry of catalog)
  if (entry.apiKeys.some((key) => !allApiKeys.has(key)))
    throw new Error(`Missing API for ${entry.key}`)
const header = readFileSync(outputPath, 'utf8').split(
  /export const ELEMENT_PLUS_(?:CATALOG|APIS)/,
)[0]!
const output =
  `${header}export const ELEMENT_PLUS_APIS: ApiEntry[] = ${JSON.stringify([...apis.values()], null, 2)}\n\n` +
  `const apiByKey = new Map(ELEMENT_PLUS_APIS.map(api => [api.apiKey, api]))\n` +
  `const catalogData = ${JSON.stringify(catalog, null, 2)}\n` +
  `export const ELEMENT_PLUS_CATALOG: CatalogEntry[] = catalogData.map(({ apiKeys, ...entry }) => ({ ...entry, kind: entry.kind as CatalogKind, apis: apiKeys.map(key => apiByKey.get(key)!) }))\n` +
  `export const ELEMENT_PLUS_ICON_KEYS: readonly string[] = ${JSON.stringify(iconKeys)}\n` +
  `export const ELEMENT_PLUS_RUNTIME_EXPORTS: readonly string[] = ${JSON.stringify(runtimeExports)}\n` +
  `export function findCatalogEntry(key: string) { return ELEMENT_PLUS_CATALOG.find(entry => entry.key === key) }\n` +
  `export function findElementPlusApi(apiKey: string) { return apiByKey.get(apiKey) }\n` +
  `export const ELEMENT_PLUS_DOCUMENTED_API_FACTS = ${JSON.stringify(docFacts, null, 2)}\n`
writeFileSync(outputPath, output)
mkdirSync(resolve('docs'), { recursive: true })
const counts = [...apis.values()].reduce(
  (total, api) => ({
    props: total.props + api.props.length,
    events: total.events + api.events.length,
    slots: total.slots + api.slots.length,
    exposes: total.exposes + api.exposes.length,
  }),
  { props: 0, events: 0, slots: 0, exposes: 0 },
)
const rows = catalog
  .map((entry) => {
    const entries = entry.apiKeys.map((key) => apis.get(key)!)
    return `| ${entry.key} | ${entry.kind} | ${entry.apiKeys.join(', ') || '不适用：设计规范'} | ${entries.reduce((count, api) => count + api.props.length, 0)} | ${entries.reduce((count, api) => count + api.events.length, 0)} | ${entries.reduce((count, api) => count + api.slots.length, 0)} | ${entries.reduce((count, api) => count + api.exposes.length, 0)} |`
  })
  .join('\n')
writeFileSync(
  resolve('docs/element-plus-api-coverage.md'),
  `# Element Plus 2.14.5 API 目录审计\n\n来源：[官方精确发布源码](https://github.com/element-plus/element-plus/tree/${tag})（MIT）、版本仓库的总览 sidebar 和 docs/en-US/component，以及已安装的公开声明。数据只保存类型、默认值、事件/槽/方法等事实，不复制示例正文。\n\n官方82条目与生成目录采用集合比较：missing=${missingCatalog.length}、extra=${extraCatalog.length}。文档 API 行逐项比较：missing=${missingFacts.length}。目录含 ${apis.size} 个 API 组，${counts.props} Props、${counts.events} Events、${counts.slots} Slots、${counts.exposes} Exposes；数量仅摘要，不能抵消缺项。\n\n生成：\n\n\`\`\`sh\nnode scripts/generate-element-catalog.ts /path/to/element-plus-2.14.5\n\`\`\`\n\n复杂值保留 function/component/vnode/date/element/regexp 等类型，配置与行为验收由 V2 引用系统负责；目录生成通过不等于所有运行时行为已验收。内部 ref/对象 API 标 parentApiKey/propPath，不伪造公开组件。\n\n| 条目 | 性质 | API组 | Props | Events | Slots | Exposes |\n| --- | --- | --- | ---: | ---: | ---: | ---: |\n${rows}\n\n待继续核查：${unresolved.length ? unresolved.join(', ') : '无未映射根条目或源码入口'}。\n`,
)
console.log(
  JSON.stringify({
    catalogEntries: catalog.length,
    apiEntries: apis.size,
    ...counts,
    icons: iconKeys.length,
    missingCatalog,
    extraCatalog,
    missingFacts: missingFacts.length,
    unresolved,
  }),
)
