import { mkdir, cp, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await mkdir('dist/vendor', { recursive: true });
await cp('public', 'dist', { recursive: true });
await cp('src', 'dist', { recursive: true });
await copyFile('node_modules/jszip/dist/jszip.min.js', 'dist/vendor/jszip.min.js');
await copyFile('node_modules/papaparse/papaparse.min.js', 'dist/vendor/papaparse.min.js');
await copyFile('node_modules/jszip/LICENSE.markdown', 'dist/vendor/JSZIP-LICENSE.md');
await copyFile('node_modules/papaparse/LICENSE', 'dist/vendor/PAPAPARSE-LICENSE.txt');
await copyFile('THIRD_PARTY_NOTICES.md', 'dist/THIRD_PARTY_NOTICES.md');
// A single content version keeps HTML, modules, and the import worker in sync
// when GitHub Pages or a browser still has an older JavaScript file cached.
const version = createHash('sha256');
for (const path of ['dist/index.html', 'dist/app.js', 'dist/core.js', 'dist/import-worker.js', 'dist/styles.css']) version.update(await readFile(path));
const revision = version.digest('hex').slice(0, 12);
for (const path of ['dist/index.html', 'dist/app.js', 'dist/import-worker.js']) {
  let text = await readFile(path, 'utf8');
  for (const asset of ['app.js', 'core.js', 'import-worker.js', 'styles.css', 'vendor/jszip.min.js', 'vendor/papaparse.min.js']) {
    text = text.replaceAll(`./${asset}`, `./${asset}?v=${revision}`);
  }
  await writeFile(path, text);
}
console.log('Built static site in dist/');
