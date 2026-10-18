import { buildTarget } from './targets.mjs';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
const { name: target, outdir } = buildTarget(process.argv[2]);
const { version } = JSON.parse(await readFile(`${outdir}/manifest.json`, 'utf8'));
const name =
  target === 'firefox'
    ? `grok-bot-clipper-firefox-${version}.zip`
    : `grok-bot-clipper-${version}.zip`;
await mkdir('artifacts', { recursive: true });
await rm(`artifacts/${name}`, { force: true });
execFileSync('zip', ['-qr', `../artifacts/${name}`, '.', '-x', '*.map', 'build-meta.json'], {
  cwd: outdir,
});
console.log(`artifacts/${name}`);

if (target === 'firefox') {
  const { copyFile } = await import('node:fs/promises');
  const xpi = `artifacts/grok-bot-clipper-firefox-${version}-unsigned.xpi`;
  await copyFile(`artifacts/${name}`, xpi);
  console.log(xpi + ' (unsigned; Mozilla signing required for permanent installation)');
}
