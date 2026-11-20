import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import builder from 'electron-builder';
import config from '../electron-builder.config.cjs';
import { createRuntime, buildOptions } from './package.mjs';
import { inspectWindowsRuntime, sha256 } from './verify-package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const { version = metadata.version } = buildOptions();
const runtime = await createRuntime({ platform: 'win32', arch: 'x64', version });
const before = await inspectWindowsRuntime(runtime, version);
const output = path.join(root, 'release', version, 'installer');
await mkdir(output, { recursive: true });
const artifacts = await builder.build({
  projectDir: root,
  prepackaged: runtime,
  targets: builder.Platform.WINDOWS.createTarget('nsis', builder.Arch.x64),
  publish: 'never',
  config: { ...config, extraMetadata: { version }, directories: { ...config.directories, output } }
});
const after = await inspectWindowsRuntime(runtime, version);
if (JSON.stringify(before.files) !== JSON.stringify(after.files)) throw new Error('Installer build changed the shared Steam runtime');
const installers = artifacts.filter(file => file.endsWith('.exe'));
if (installers.length !== 1) throw new Error('Expected one Windows x64 NSIS installer');
for (const file of installers) {
  const digest = await sha256(file);
  await writeFile(file + '.sha256', `${digest}  ${path.basename(file)}\n`);
  console.log(`Installer: ${file}\nSHA-256: ${digest}\nSignature: unsigned beta`);
}
await writeFile(path.join(output, 'runtime-manifest.json'), JSON.stringify(after, null, 2) + '\n');
