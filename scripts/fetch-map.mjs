import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'config/dust2-source-assets.json')));
const exec = promisify(execFile);
let cursor = 0, done = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (cursor < manifest.files.length) {
    const entry = manifest.files[cursor++];
    const target = path.join(root, '.cache/dust2', entry.path);
    const valid = async name => {
      try { const bytes = await fs.readFile(name); return bytes.length === entry.bytes && createHash('sha256').update(bytes).digest('hex') === entry.sha256; }
      catch { return false; }
    };
    if (!await valid(target)) {
      if (process.argv.includes('--check')) throw new Error(`Missing or damaged map asset: ${entry.path}`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const partial = target + '.part';
      try {
        await exec('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '4', '--retry-all-errors', '--max-time', '180', new URL(entry.path, manifest.baseURL).href, '-o', partial]);
        if (!await valid(partial)) throw new Error(`Checksum mismatch: ${entry.path}`);
        await fs.rename(partial, target);
      } finally { await fs.rm(partial, { force: true }); }
    }
    done++;
    if (done % 50 === 0 || done === manifest.files.length) console.log(`Dust II assets: ${done}/${manifest.files.length} verified`);
  }
}));
