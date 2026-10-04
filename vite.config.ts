import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  server: {
    // Reached through `tailscale serve` (https://<pc>.<tailnet>.ts.net → localhost:5173).
    allowedHosts: ['.ts.net'],
  },
  preview: {
    allowedHosts: ['.ts.net'],
  },
})
