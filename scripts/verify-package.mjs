import { readFile, readdir, stat, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const asar = createRequire(require.resolve('@electron/packager'))('@electron/asar');
export const runtimeSources = ['index.html', 'src', 'assets', 'electron'];
export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export function inspectArchive(archive, version) {
  const files = asar.listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, ''));
  for (const file of files) {
    if (!['package.json', ...runtimeSources].some(entry => file === entry || file.startsWith(entry + '/'))) throw new Error(`Unexpected runtime source: ${file}`);
    if (/(^|\/)(recordings|node_modules|\.env)(\/|$)|\.(pem|key|pfx|webm|mp4)$/i.test(file)) throw new Error(`Private or development file in runtime: ${file}`);
  }
  const meta = JSON.parse(asar.extractFile(archive, 'package.json'));
  if (meta.name !== 'doctorgame' || meta.main !== 'electron/main.cjs' || meta.version !== version || meta.devDependencies || meta.scripts) throw new Error('Unexpected packaged metadata');
  for (const file of ['index.html', 'electron/main.cjs', 'electron/preload.cjs', 'src/app.js', 'src/analysis.js', 'src/media.js', 'src/storage.js', 'src/styles.css', 'assets/mark.svg']) {
    if (!files.includes(file)) throw new Error(`Missing runtime source: ${file}`);
  }
  return { metadata: meta, sources: files };
}
export async function inspectWindowsRuntime(directory, version) {
  const required = ['doctorgame.exe', 'resources/app.asar', 'icudtl.dat', 'ffmpeg.dll', 'dxcompiler.dll', 'd3dcompiler_47.dll', 'resources.pak', 'locales/zh-CN.pak'];
  for (const file of required) if (!(await stat(path.join(directory, file))).isFile()) throw new Error(`Missing runtime dependency: ${file}`);
  const exe = await open(path.join(directory, 'doctorgame.exe'));
  try {
    const header = Buffer.alloc(64); await exe.read(header, 0, 64, 0);
    if (header.toString('ascii', 0, 2) !== 'MZ') throw new Error('Launch executable is not PE');
    const pe = Buffer.alloc(6); await exe.read(pe, 0, 6, header.readUInt32LE(60));
    if (pe.toString('ascii', 0, 4) !== 'PE\0\0' || pe.readUInt16LE(4) !== 0x8664) throw new Error('Launch executable is not Windows x64');
  } finally { await exe.close(); }
  const archive = inspectArchive(path.join(directory, 'resources/app.asar'), version);
  const files = [];
  async function visit(folder, prefix = '') {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const relative = prefix + entry.name, full = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlink in Windows runtime: ${relative}`);
      if (entry.isDirectory()) await visit(full, relative + '/');
      else {
        if (/(^|\/)(node_modules|recordings|tests|\.git|\.agents)(\/|$)|\.(pem|key|pfx|webm|mp4|map|pdb)$/i.test(relative) || /setup.*\.exe$|uninstall.*\.exe$/i.test(relative)) throw new Error(`Non-runtime file: ${relative}`);
        files.push({ path: relative, bytes: (await stat(full)).size, sha256: await sha256(full) });
      }
    }
  }
  await visit(directory); files.sort((a, b) => a.path.localeCompare(b.path));
  return { version, platform: 'win32', arch: 'x64', executable: 'doctorgame.exe', sources: archive.sources, files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}
