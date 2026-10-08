import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharedFiles = [
  'background.js',
  'extract.js',
  'sites/youtube.js',
  'popup/popup.js',
  'popup/popup.html',
  'popup/popup.css',
];

for (const browser of ['Chrome', 'Firefox']) {
  for (const relativePath of sharedFiles) {
    const source = resolve(root, 'extension-shared', relativePath);
    const destination = resolve(root, browser, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

console.log(`Gemeinsame Browser-Dateien nach Chrome und Firefox kopiert (${sharedFiles.length} Dateien).`);
