import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = collectFiles('.', ['.js', '.json', '.md', '.html', '.css']);
const failures = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (text.includes('\t')) {
    failures.push(`${file} contains tab indentation`);
  }
  if (!text.endsWith('\n')) {
    failures.push(`${file} must end with a newline`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`format ok: ${files.length} files checked`);

function collectFiles(root, extensions) {
  const result = [];
  for (const name of readdirSync(root)) {
    if (name === 'node_modules' || name === '.git') continue;
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
