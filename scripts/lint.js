import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const banned = [
  'openpf.fenbeitong.com',
  'access-token: real',
  'real-fenbeitong-token',
  'real-kingdee-password'
];

const files = collectFiles('.', ['.js', '.json', '.md', '.html', '.css']);
const failures = [];

for (const file of files) {
  if (file.endsWith('scripts\\lint.js') || file.endsWith('scripts/lint.js')) {
    continue;
  }
  const text = readFileSync(file, 'utf8');
  for (const marker of banned) {
    if (text.includes(marker)) {
      failures.push(`${file} contains banned marker ${marker}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`lint ok: ${files.length} files checked`);

function collectFiles(root, extensions) {
  const result = [];
for (const name of readdirSync(root)) {
    if (['node_modules', '.git', 'dist', 'runtime-data', 'data'].includes(name)) continue;
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      result.push(...collectFiles(path, extensions));
    } else if (extensions.some((extension) => path.endsWith(extension))) {
      result.push(path);
    }
  }
  return result;
}
