// Maintainer-only: import minimal name fingerprints from private local exports.
// Usage: node scripts/import-history.js 2026-09 path.zip 2026-10 path.zip
import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import Papa from 'papaparse';
import { parseRows } from '../src/core.js';
import { historyFingerprint } from '../src/history.js';

const args = process.argv.slice(2);
if (!args.length || args.length % 2) throw new Error('Supply month/path pairs, e.g. 2026-09 september.zip 2026-10 october.zip');
const months = [];
for (let i = 0; i < args.length; i += 2) {
  const [id, path] = args.slice(i, i + 2);
  if (!/^2026-(09|10|11|12)$/.test(id) || months.some(month => month.id === id)) throw new Error('Use distinct Fall 2026 election months.');
  const zip = await JSZip.loadAsync(await readFile(path));
  const csvs = Object.values(zip.files).filter(entry => !entry.dir && /\.csv$/i.test(entry.name));
  if (csvs.length !== 1) throw new Error('Each history archive must contain one CSV.');
  const parsed = Papa.parse(await csvs[0].async('string'), { skipEmptyLines: 'greedy' });
  if (parsed.errors.some(error => error.code !== 'UndetectableDelimiter')) throw new Error('History CSV could not be parsed.');
  const dataset = parseRows(parsed.data, '', { mode: 'past' });
  const names = [...new Set(dataset.ballots.map(ballot => ballot.identity).filter(Boolean))];
  const voters = (await Promise.all(names.map(name => historyFingerprint(name, id)))).sort();
  months.push({ id, label: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${id}-01T00:00:00Z`)), voters });
  console.log(`${id}: ${dataset.ballots.length} submissions; ${voters.length} distinct normalized names.`);
}
months.sort((a, b) => a.id.localeCompare(b.id));
const history = { semester: 'Fall 2026', months };
await writeFile('src/semester-history.js', `// Public comparison fingerprints only; no names, rankings, attendance, or timestamps.\nexport default ${JSON.stringify(history, null, 2)};\n`);
