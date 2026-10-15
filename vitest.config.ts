import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default defineConfig((environment) =>
  mergeConfig(
    viteConfig(environment),
    defineConfig({
      test: {
        environment: 'jsdom',
        // Element Plus 的 Form 在浏览器中使用 async-validator 的 ESM 入口。
        // SSR 外置加载其 CJS 双 default 会使构造器报错并丢失字段错误。
        server: { deps: { inline: ['element-plus', 'async-validator'] } },
        exclude: [...configDefaults.exclude, 'e2e/**'],
        root: fileURLToPath(new URL('./', import.meta.url)),
      },
    }),
  ),
)
