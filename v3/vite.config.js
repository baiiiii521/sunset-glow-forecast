import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

/* algo.js / api.js 是仓库根的原生算法文件（api.js 为 CommonJS），
 * 用别名 + 预打包让 ESM 直接引用同一份源码——不复制、不修改。 */
const root = (p) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@core/algo': root('../algo.js'),
      '@core/api': root('../api.js'),
    },
  },
  optimizeDeps: {
    include: ['@core/algo', '@core/api'],
  },
  server: { port: 5180, host: true },
})
