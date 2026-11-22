#!/usr/bin/env node
// Prepare the pinned, offline Tesseract.js resources used by src/events.js.
// Run: node scripts/prepare-ocr-assets.mjs
// The app must never fetch OCR code, wasm or traineddata at runtime from a CDN.
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'assets', 'ocr');
const packages = [
  {
    name: 'tesseract.js', version: '7.0.0', license: 'Apache-2.0',
    url: 'https://registry.npmjs.org/tesseract.js/-/tesseract.js-7.0.0.tgz',
    sha256: '9a93bf51c3387f945d10a24bf8b3a4bf2e45c7c7161b8242aafbaf9d3c4b606a',
    files: [
      ['package/dist/tesseract.esm.min.js', 'tesseract.esm.min.js'],
      ['package/dist/worker.min.js', 'worker.min.js'],
      ['package/LICENSE.md', 'licenses/tesseract.js-LICENSE.md']
    ]
  },
  {
    name: 'tesseract.js-core', version: '7.0.0', license: 'Apache-2.0',
    url: 'https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-7.0.0.tgz',
    sha256: 'ba584355515eaff877552022853c0e71f2cb70466e759d1d6940484929718ee0',
    files: [
      ['package/tesseract-core.wasm.js', 'core/tesseract-core.wasm.js'],
      ['package/tesseract-core-simd.wasm.js', 'core/tesseract-core-simd.wasm.js'],
      ['package/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
      ['package/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
      ['package/tesseract-core-relaxedsimd.wasm.js', 'core/tesseract-core-relaxedsimd.wasm.js'],
      ['package/tesseract-core-relaxedsimd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
      ['package/LICENSE', 'licenses/tesseract.js-core-LICENSE']
    ]
  },
  {
    name: '@tesseract.js-data/eng', version: '1.0.0', license: 'MIT',
    url: 'https://registry.npmjs.org/@tesseract.js-data/eng/-/eng-1.0.0.tgz',
    sha256: 'c9bddf2e2f0a214ac7918f3f4a3caf45e09ce8674fe26662ae7787ac8927f7bb',
    files: [['package/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz']]
  },
  {
    name: '@tesseract.js-data/chi_sim', version: '1.0.0', license: 'MIT',
    url: 'https://registry.npmjs.org/@tesseract.js-data/chi_sim/-/chi_sim-1.0.0.tgz',
    sha256: '850d4a217c87808ef765385cbe5825f4ae99047a49b17e024069ceb663f01c33',
    files: [['package/4.0.0_best_int/chi_sim.traineddata.gz', 'lang/chi_sim.traineddata.gz']]
  }
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const work = await mkdtemp(path.join(tmpdir(), 'doctorgame-ocr-'));
try {
  await mkdir(path.join(out, 'core'), { recursive: true });
  await mkdir(path.join(out, 'lang'), { recursive: true });
  await mkdir(path.join(out, 'licenses'), { recursive: true });
  const entries = [];
  for (const pkg of packages) {
    const archive = path.join(work, `${pkg.name.replace(/[^a-z0-9]/gi, '-')}.tgz`);
    const response = await fetch(pkg.url);
    if (!response.ok) throw new Error(`OCR asset download failed (${response.status}): ${pkg.url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== pkg.sha256) throw new Error(`OCR asset checksum mismatch: ${pkg.url}`);
    await writeFile(archive, bytes);
    const extract = path.join(work, pkg.name.replace(/[^a-z0-9]/gi, '-'));
    await mkdir(extract, { recursive: true });
    const tar = spawnSync('tar', ['-xzf', archive, '-C', extract], { stdio: 'inherit' });
    if (tar.status !== 0) throw new Error(`Could not extract ${archive}; tar is required for preparation.`);
    for (const [from, to] of pkg.files) {
      const source = path.join(extract, from);
      const target = path.join(out, to);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      const content = await readFile(target);
      entries.push({ file: `assets/ocr/${to}`, bytes: content.byteLength, sha256: hash(content), source: pkg.url, version: `${pkg.name}@${pkg.version}`, license: pkg.license });
    }
  }
  const manifest = {
    generatedBy: 'scripts/prepare-ocr-assets.mjs',
    runtime: 'Tesseract.js 7.0.0 (OEM.LSTM_ONLY), English + Simplified Chinese 4.0.0_best_int',
    offline: true,
    note: 'All OCR code, WASM and traineddata are local files under assets/ocr. Do not replace with CDN paths.',
    packages: packages.map(({ name, version, license, url, sha256 }) => ({ name, version, license, url, sha256 })),
    files: entries.sort((a, b) => a.file.localeCompare(b.file))
  };
  await writeFile(path.join(out, 'resource-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Prepared ${entries.length} OCR files in assets/ocr`);
} finally {
  await rm(work, { recursive: true, force: true });
}
