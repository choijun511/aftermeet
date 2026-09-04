// 仅用于在浏览器中预览 renderer UI(非 Electron)。生产构建仍走 electron.vite.config.ts。
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  server: { port: 5199 }
})
