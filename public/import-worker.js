/* Parsing happens off the main thread so a malformed file cannot freeze controls. */
importScripts('./vendor/jszip.min.js', './vendor/papaparse.min.js');
const MAX = 20 * 1024 * 1024;
self.onmessage = async ({ data }) => {
  try {
    let text, label = data.filename;
    if (/\.zip$/i.test(data.filename)) {
      const zip = await JSZip.loadAsync(data.buffer);
      const entries = Object.values(zip.files).filter(entry => !entry.dir);
      if (entries.length > 100) throw new Error('This archive has too many files. Export just the response CSV.');
      // Check declared sizes before extraction; also check actual output below.
      const declaredSize = entries.reduce((sum, entry) => sum + (entry._data?.uncompressedSize ?? MAX + 1), 0);
      if (declaredSize > MAX) throw new Error('The expanded archive exceeds 20 MB. Export a smaller response sheet.');
      const csvs = entries.filter(entry => /\.csv$/i.test(entry.name) && !entry.name.startsWith('__MACOSX/') && !entry.name.split('/').at(-1).startsWith('.'));
      if (!csvs.length) throw new Error('No CSV found in this ZIP. Export the response sheet as a CSV and try again.');
      if (csvs.length > 1 && !data.entry) { postMessage({ entries: csvs.map(entry => entry.name) }); return; }
      const entry = data.entry ? csvs.find(entry => entry.name === data.entry) : csvs[0];
      if (!entry) throw new Error('That CSV is no longer available. Choose the ZIP again.');
      const bytes = await new Promise((resolve, reject) => {
        const chunks = []; let size = 0;
        const stream = entry.internalStream('uint8array');
        stream.on('data', chunk => {
          size += chunk.byteLength;
          if (size > MAX) { stream.pause(); reject(new Error('The expanded CSV exceeds 20 MB.')); }
          else chunks.push(chunk);
        });
        stream.on('error', reject);
        stream.on('end', () => {
          const result = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
          resolve(result);
        });
        stream.resume();
      });
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      label = entry.name;
    } else if (/\.csv$/i.test(data.filename)) {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data.buffer);
    } else throw new Error('Choose a .zip or .csv file.');
    const parsed = Papa.parse(text, { skipEmptyLines: 'greedy', dynamicTyping: false });
    const error = parsed.errors.find(item => item.code !== 'UndetectableDelimiter');
    if (error) throw new Error(`CSV could not be read: ${error.message}${error.row === undefined ? '' : ` (data row ${error.row + 1})`}.`);
    const { parseRows, nameColumns } = await import('./core.js');
    if (data.kind === 'past' && data.nameColumn === undefined && nameColumns(parsed.data[0]).length !== 1) {
      postMessage({ nameColumns: parsed.data[0], entry: label }); return;
    }
    postMessage({ dataset: parseRows(parsed.data, label, { mode: data.kind, nameColumn: data.nameColumn }) });
  } catch (error) { postMessage({ error: error.message || 'Could not read this file. Please export a fresh CSV.' }); }
};
