import { mkdirSync, copyFileSync, cpSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('frontend/src', 'dist/frontend', { recursive: true });
cpSync('backend/src', 'dist/backend', { recursive: true });
copyFileSync('README.md', 'dist/README.md');
console.log('build ok: dist created');
