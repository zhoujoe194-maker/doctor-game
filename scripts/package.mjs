import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const stage = await mkdtemp(path.join(tmpdir(), 'doctorgame-package-'));
try {
  // The application has no runtime npm dependencies. Stage only runtime
  // sources so pnpm's development symlinks never enter the distributable.
  for (const entry of ['index.html', 'src', 'assets', 'electron']) {
    await cp(path.join(root, entry), path.join(stage, entry), { recursive: true });
  }
  await writeFile(path.join(stage, 'package.json'), JSON.stringify({
    name: metadata.name, productName: metadata.productName, version: metadata.version,
    description: metadata.description, type: metadata.type, main: metadata.main
  }, null, 2));
  const outputs = await packager({
    dir: stage, name: 'doctorgame', platform: 'win32', arch: 'x64',
    electronVersion: metadata.devDependencies.electron, appVersion: metadata.version,
    out: path.join(root, 'release'), overwrite: true, prune: false, asar: true,
    win32metadata: { CompanyName: 'doctorgame', FileDescription: 'doctorgame sensitivity lab prototype' }
  });
  for (const output of outputs) {
    await cp(path.join(root, 'docs', 'windows.md'), path.join(output, '使用说明.md'));
    console.log(`Windows application: ${output}`);
  }
} finally {
  // stage is a fresh, task-owned directory returned by mkdtemp above.
  await rm(stage, { recursive: true, force: true });
}
