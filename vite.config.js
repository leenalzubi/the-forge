import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  appType: 'spa',
  server: {
    // Client-side routes (/findings, /about): SPA-style fallback to index.html in dev.
    historyApiFallback: true,
  },
})
