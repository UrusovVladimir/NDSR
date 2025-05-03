import {fileURLToPath, URL} from 'node:url'
import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 8080,
    host: '0.0.0.0',
    proxy: {
      '/rci': {
        target: 'http://172.16.78.254:2410',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rci/, ''),
      }
    }
  }
});
