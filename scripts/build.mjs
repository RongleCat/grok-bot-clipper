import { writeChromeLocales } from './i18n-build.mjs';
import { buildTarget, manifestFor } from './targets.mjs';
import { icon } from '../src/ui/icons.js';
import { build } from 'esbuild';
import { mkdir, rm, copyFile, writeFile, readFile, cp } from 'node:fs/promises';
import { renderStill, toBody } from '../vendor/desktop-avatar/engine.js';
import sharp from 'sharp';
const { name: browserTarget, outdir, esbuildTarget } = buildTarget(process.argv[2]);
const defines = {
  'process.env.NODE_ENV': '"production"',
  __BROWSER_TARGET__: JSON.stringify(browserTarget),
};
await rm(outdir, { recursive: true, force: true });
await mkdir(`${outdir}/icons`, { recursive: true });
await writeFile(
  `${outdir}/icons/chevron-down.svg`,
  icon('chevron', 16)
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replace('currentColor', '#777777'),
);
await build({
  entryPoints: {
    background: 'src/background.js',
    app: 'src/ui/app.js',
    share: 'src/ui/share.js',
    ...(browserTarget === 'chrome'
      ? { offscreen: 'src/offscreen/index.js', archive: 'src/ui/archive.js' }
      : {}),
  },
  outdir,
  bundle: true,
  format: 'esm',
  splitting: true,
  target: esbuildTarget,
  minify: false,
  sourcemap: true,
  metafile: true,
  logLevel: 'warning',
  define: defines,
}).then((r) => writeFile(`${outdir}/build-meta.json`, JSON.stringify(r.metafile, null, 2)));
await build({
  entryPoints: ['src/content/index.js'],
  outfile: `${outdir}/content.js`,
  bundle: true,
  format: 'iife',
  target: esbuildTarget,
  minify: false,
  sourcemap: true,
  define: defines,
  logLevel: 'warning',
});
await build({
  entryPoints: {
    'social-network': 'src/social/network-entry.js',
    'social-ui': 'src/social/ui-entry.js',
  },
  define: defines,
  outdir,
  bundle: true,
  format: 'iife',
  target: esbuildTarget,
  sourcemap: true,
  logLevel: 'warning',
});
await writeFile(
  `${outdir}/manifest.json`,
  JSON.stringify(
    manifestFor(JSON.parse(await readFile('manifest.json', 'utf8')), browserTarget),
    null,
    2,
  ) + '\n',
);
await writeChromeLocales(outdir);
await copyFile('public/style.css', `${outdir}/style.css`);
await copyFile('public/components.css', `${outdir}/components.css`);
await copyFile('public/share.css', `${outdir}/share.css`);
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', `${outdir}/pdf.worker.min.mjs`);
for (const [file, entry, title] of [
  ['popup', 'app', 'Grok Bot Clipper'],
  ['app', 'app', 'Grok Bot Clipper'],
  ['sidepanel', 'app', 'Grok Bot Clipper'],
  ...(browserTarget === 'chrome'
    ? [
        ['offscreen', 'offscreen', 'Grok Bot Clipper image processing'],
        ['archive', 'archive', 'Saving web page'],
      ]
    : [['background', 'background', 'Grok Bot Clipper background']]),
  ['share', 'share', 'Select BOT'],
])
  await writeFile(
    `${outdir}/${file}.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${entry === 'app' ? '<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="components.css">' : entry === 'share' ? '<link rel="stylesheet" href="share.css">' : ''}</head><body><div id="app"></div><script type="module" src="${entry}.js"></script></body></html>`,
  );
for (const size of [16, 32, 48, 128])
  await sharp(Buffer.from(renderStill({ body: toBody('blob'), ink: '#000000', size })))
    .resize(size, size)
    .png()
    .toFile(`${outdir}/icons/${size}.png`);
await mkdir(`${outdir}/licenses`, { recursive: true });
for (const [from, to] of [
  ['src/sdk/LICENSE', 'SDK-LICENSE'],
  ['vendor/desktop-avatar/PROVENANCE.md', 'DESKTOP-AVATAR-PROVENANCE.md'],
  ['vendor/desktop-avatar/provenance.json', 'DESKTOP-AVATAR-PROVENANCE.json'],
  ['node_modules/lucide/LICENSE', 'LUCIDE-LICENSE'],
  ['node_modules/pinyin-pro/LICENSE', 'PINYIN-PRO-LICENSE'],
  ['vendor/reui/LICENSE.md', 'REUI-LICENSE.md'],
  ['node_modules/marked/LICENSE', 'MARKED-LICENSE.md'],
  ['node_modules/dompurify/LICENSE', 'DOMPURIFY-LICENSE'],
  ['node_modules/highlight.js/LICENSE', 'HIGHLIGHTJS-LICENSE'],
  ['node_modules/react/LICENSE', 'REACT-LICENSE'],
  ['node_modules/react-dom/LICENSE', 'REACT-DOM-LICENSE'],
  ['node_modules/@mozilla/readability/LICENSE.md', 'READABILITY-LICENSE'],
  ['node_modules/turndown/LICENSE', 'TURNDOWN-LICENSE'],
  ['node_modules/pdfjs-dist/LICENSE', 'PDFJS-LICENSE'],
])
  await copyFile(from, `${outdir}/licenses/` + to);
const manifest = JSON.parse(await readFile(`${outdir}/manifest.json`, 'utf8'));
console.log(`Built ${manifest.name} ${manifest.version} → ${outdir}/`);
