import { execFileSync } from 'node:child_process';
execFileSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, SUPAWORLD_BASE: '/supaworld/', VITE_PAGES: '1' },
});
