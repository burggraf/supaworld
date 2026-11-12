import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { manager } from './lib/projects/manager';
// Compile-time test hook; absent from normal development and production builds.
if (import.meta.env.VITE_TEST_API === '1') {
  Object.defineProperty(window, '__SUPAWORLD_TEST__', { value: manager, configurable: true });
}
mount(App, { target: document.getElementById('app')! });
