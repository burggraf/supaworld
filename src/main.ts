import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { manager } from './lib/projects/manager';
import { prepareIsolation } from './lib/platform/pwa';
// Compile-time test hook; absent from normal development and production builds.
if (import.meta.env.VITE_TEST_API === '1') {
  Object.defineProperty(window, '__SUPAWORLD_TEST__', { value: manager, configurable: true });
}
const target = document.getElementById('app')!;
target.textContent = 'Preparing your browser workspace…';
if (await prepareIsolation()) {
  target.textContent = '';
  mount(App, { target });
}
