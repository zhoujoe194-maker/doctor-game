#!/usr/bin/env python3
"""Offline-only SteamPipe mapping check. Never invokes steamcmd or logs in."""
from pathlib import Path
import argparse
import fnmatch
import hashlib
import importlib.util
import json
import sys
import tempfile

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
CHECKER_PATH = ROOT / '.agents/skills/steam-publish/scripts/check_steam_build.py'
spec = importlib.util.spec_from_file_location('doctorgame_steam_checker', CHECKER_PATH)
checker_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = checker_module
spec.loader.exec_module(checker_module)
REQUIRED = {'doctorgame.exe', 'resources/app.asar', 'icudtl.dat', 'ffmpeg.dll',
            'dxcompiler.dll', 'd3dcompiler_47.dll', 'resources.pak', 'locales/zh-CN.pak'}


def digest(file):
    result = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def render_templates(scripts, content, version):
    scripts.mkdir(parents=True)
    replacements = {'APP_ID': '99999991', 'DEPOT_ID': '99999992', 'VERSION': version,
                    'CONTENT_ROOT': content.resolve().as_posix(),
                    'BUILD_OUTPUT': (scripts.parent / 'output').resolve().as_posix()}
    for filename in ['app_build', 'depot_build_windows']:
        text = (ROOT / 'steam' / (filename + '.vdf.in')).read_text()
        if '"SetLive"' in text:
            raise AssertionError('Publishing state is outside the preparation scope')
        for key, value in replacements.items():
            if '"' in value or '\n' in value:
                raise ValueError('Unsafe template value')
            text = text.replace('{{' + key + '}}', value)
        if '{{' in text:
            raise AssertionError('Unresolved template value')
        (scripts / (filename + '.vdf')).write_text(text)


def verify(content, scripts, version):
    render_templates(scripts, content, version)
    checker = checker_module.Checker(scripts / 'app_build.vdf')
    checker.run()
    errors, warnings = checker_module.ordered_issues(checker.issues)
    if errors or warnings:
        raise AssertionError(checker_module.render_text(checker, 0))
    nodes, _ = checker_module.parse_vdf((scripts / 'depot_build_windows.vdf').read_text())
    depot = nodes[0]
    exclusions = [node.value.replace('\\', '/').lower() for node in depot.all('FileExclusion')]
    entries, excluded = [], []
    for match in checker_module.match_local_path(content, '*', True).matches:
        relative = match.path.relative_to(content).as_posix()
        if match.path.is_symlink():
            raise AssertionError('Symlink in depot: ' + relative)
        if any(fnmatch.fnmatchcase(relative.lower(), pattern) for pattern in exclusions):
            excluded.append(relative)
        else:
            entries.append({'path': relative, 'bytes': match.path.stat().st_size, 'sha256': digest(match.path)})
    entries.sort(key=lambda item: item['path'])
    paths = {item['path'] for item in entries}
    if not REQUIRED.issubset(paths):
        raise AssertionError('Missing Windows launch/runtime files: ' + str(REQUIRED - paths))
    summary = checker.depots[0]
    if len(entries) != summary['files'] or sum(item['bytes'] for item in entries) != summary['bytes']:
        raise AssertionError('Independent inventory does not match SteamPipe checker mapping')
    return {'files': entries, 'fileCount': len(entries), 'bytes': summary['bytes'],
            'excluded': sorted(excluded), 'errors': 0, 'warnings': 0, 'launchExecutable': 'doctorgame.exe'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--content', type=Path)
    parser.add_argument('--synthetic-only', action='store_true')
    args = parser.parse_args()
    version = json.loads((ROOT / 'package.json').read_text())['version']
    originals = {p.name: digest(p) for p in (ROOT / 'steam').glob('*.in')}
    with tempfile.TemporaryDirectory(prefix='doctorgame-steam-offline-') as temp:
        work = Path(temp)
        synthetic = work / 'synthetic'
        for file in REQUIRED:
            target = synthetic / file
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b'synthetic fixture, not an executable')
        forbidden = ['doctorgame-0.0.0-setup.exe', 'Uninstall doctorgame.exe', 'installer/other.exe',
                     'tests/debug.js', 'scripts/build.mjs', 'docs/private.md', '.agents/skills/private.md',
                     '.git/config', '.env.local', 'nested/.env', 'node_modules/tool/index.js',
                     'nested/node_modules/tool.js', 'recordings/private.webm', 'nested/recordings/data.json',
                     'certificate.pfx', 'nested/private.KEY', 'debug.pdb', 'resources/dev.js.map',
                     'player.mp4', 'capture.mkv', 'account/config.vdf']
        for file in forbidden:
            target = synthetic / file
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b'non-runtime synthetic fixture')
        fixture = verify(synthetic, work / 'fixture-scripts', version)
        assert {entry['path'] for entry in fixture['files']} == REQUIRED
        assert set(fixture['excluded']) == set(forbidden)
        result = {'mode': 'offline only; no Steam login, preview build or upload',
                  'synthetic': fixture, 'version': version}
        if not args.synthetic_only:
            content = (args.content or ROOT / 'release' / version / 'doctorgame-win32-x64').resolve()
            if not content.is_dir():
                raise SystemExit('Build runtime first with pnpm run pack:win, or use --synthetic-only.')
            actual = verify(content, work / 'runtime-scripts', version)
            if actual['excluded']:
                raise AssertionError('Packaged app should already contain runtime files only: ' + str(actual['excluded']))
            manifest = json.loads((content.parent / 'runtime-manifest.json').read_text())
            if {x['path']: x['sha256'] for x in actual['files']} != {x['path']: x['sha256'] for x in manifest['files']}:
                raise AssertionError('Steam inventory differs from the installer runtime manifest')
            result['runtime'] = actual
        assert originals == {p.name: digest(p) for p in (ROOT / 'steam').glob('*.in')}
        output = ROOT / 'artifacts' / 'steam-offline.json'
        output.parent.mkdir(exist_ok=True)
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(f'Synthetic mapping: {fixture["fileCount"]} runtime files; {len(forbidden)} forbidden files excluded; 0 errors / 0 warnings.')
        if 'runtime' in result:
            print(f'Packaged mapping: {result["runtime"]["fileCount"]} files; {result["runtime"]["bytes"]} bytes; matches installer runtime.')
        print(f'Report: {output}')
        print('Production templates unchanged. No Steam Preview or upload was run.')


if __name__ == '__main__':
    main()
