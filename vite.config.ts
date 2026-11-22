import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  assetsInclude: ['**/*.mpeg'],
  server: { port: 5173, strictPort: true },
})
