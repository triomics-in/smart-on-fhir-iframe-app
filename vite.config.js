import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { BASE_URL } from './src/config.ts'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // needed for ngrok
    port: 5174,
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '.ngrok-free.app', // allows all ngrok-free.app subdomains
      BASE_URL, // specific ngrok host
      'developerportalio.interopio.ontada.com' // Ontada developer portal
    ],
    cors: true
  }
}) 