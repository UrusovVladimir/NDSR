import {fileURLToPath, URL} from 'node:url'
import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  envPrefix: 'VITE_',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Вторая страница — окно RDP к тестовой VM в браузере (src/rdp/main.js)
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        rdp: fileURLToPath(new URL('./rdp.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 8080,
    host: '0.0.0.0'
  }
});