import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

// Docker builds have no .git, so CI passes the commit as APP_VERSION.
function gitSha(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION.slice(0, 7);
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return 'dev';
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(gitSha()),
    __APP_BUILT__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    // The Mastra server (mastra dev) hosts the /quiz/* API routes.
    proxy: {
      '/quiz': 'http://localhost:4111',
    },
  },
});
