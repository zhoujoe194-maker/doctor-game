import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { runtimeSources, inspectWindowsRuntime } from './verify-package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export function buildOptions() {
  const options = {};
  for (const argument of process.argv.slice(2)) {
    const match = /^--(platform|arch|version)=(.+)$/.exec(argument);
    if (!match) throw new Error('Unknown build option: ' + argument);
    options[match[1]] = match[2];
  }
  return options;
}
export async function createRuntime(options = {}) {
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const { platform = 'win32', arch = 'x64', version = metadata.version } = options;
  if (!['win32', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported test build target');
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid build version');
  const stage = await mkdtemp(path.join(tmpdir(), 'doctorgame-package-'));
  const outputRoot = path.join(root, 'release', version);
  await mkdir(outputRoot, { recursive: true });
  try {
    // The runtime has no npm dependencies. Never copy the checkout or its modules.
    for (const entry of runtimeSources) await cp(path.join(root, entry), path.join(stage, entry), { recursive: true });
    await writeFile(path.join(stage, 'package.json'), JSON.stringify({
      name: metadata.name, productName: metadata.productName, version,
      description: metadata.description, type: metadata.type, main: metadata.main
    }, null, 2));
    const outputs = await packager({
      dir: stage, name: 'doctorgame', platform, arch,
      electronVersion: metadata.devDependencies.electron, appVersion: version,
      out: outputRoot, overwrite: true, prune: false, asar: true,
      // Optional directory of previously downloaded, trusted Electron release ZIPs.
      ...(process.env.DOCTORGAME_ELECTRON_ZIP_DIR ? { electronZipDir: path.resolve(process.env.DOCTORGAME_ELECTRON_ZIP_DIR) } : {}),
      ...(platform === 'win32' ? {
        icon: path.join(root, 'build', 'doctorgame.ico'),
        win32metadata: { CompanyName: 'doctorgame', FileDescription: 'doctorgame desktop beta', ProductName: 'doctorgame' }
      } : {})
    });
    const output = outputs[0];
    await cp(path.join(root, 'docs', 'windows.md'), path.join(output, '使用说明.md'));
    if (platform === 'win32') {
      const manifest = await inspectWindowsRuntime(output, version);
      await writeFile(path.join(outputRoot, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
      console.log('Verified Windows x64 runtime: ' + manifest.files.length + ' files, ' + manifest.totalBytes + ' bytes');
    }
    console.log('Application folder: ' + output);
    return output;
  } finally {
    // Task-owned staging directory, never user recordings or the checkout.
    await rm(stage, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await createRuntime(buildOptions());
