/**
 * Copy the Expo web export (app/dist) into desktop/web, which is what Electron serves and what
 * electron-builder packs. Run it after `npm run build:web`; the packaging scripts do both.
 *
 * The desktop build must be exported WITHOUT EXPO_WEB_BASE_URL: the bundle is then referenced by
 * root-absolute paths, which resolve against the app's qubitos:// origin.
 */
import { cp, rm, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '..', '..', 'app', 'dist');
const target = path.resolve(here, '..', 'web');

if (!existsSync(path.join(source, 'index.html'))) {
  console.error(`No web build at ${source}\nRun:  npm run build:web   (or: npm --prefix ../app run export:web)`);
  process.exit(1);
}

const bundle = path.join(source, '_expo');
if (!existsSync(bundle)) {
  console.error(`The export at ${source} has no _expo bundle — export it again.`);
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });

const files = await readdir(target);
const { size } = await stat(path.join(target, 'index.html'));
console.log(`web/: ${files.length} entries from app/dist (index.html ${size} bytes)`);
