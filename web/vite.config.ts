import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  server: {
    // The Mastra server (mastra dev) hosts the /quiz/* API routes.
    proxy: {
      '/quiz': 'http://localhost:4111',
    },
  },
});
