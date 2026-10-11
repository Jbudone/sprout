import { mount } from 'svelte';
import 'katex/dist/katex.min.css';
import './app.css';
import App from './App.svelte';
import { applyTheme, loadTheme } from './lib/theme';

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app element in index.html');

applyTheme(loadTheme());
// The classic theme follows the OS light/dark setting live.
window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => applyTheme(loadTheme()));

const app = mount(App, { target });

export default app;
