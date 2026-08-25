import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // The Toy build is uploaded as a static bundle served from an unknown subpath
  // (https://www.bilibili.com/toy/<slug>/), so its assets must resolve relatively.
  base: mode === 'toy' ? './' : '/',
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
}))
