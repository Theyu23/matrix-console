import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [
    vue({
      template: {
        // <webview> 是 Electron 自带标签，不是 Vue 组件
        compilerOptions: { isCustomElement: (tag) => tag === 'webview' }
      }
    })
  ],
  build: { outDir: 'dist' }
})
