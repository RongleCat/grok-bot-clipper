import { readFile, mkdir, writeFile, cp } from 'node:fs/promises';

const metadata = [
  'manifest_description',
  'command_capture_region',
  'command_send_page',
  'command_quick_command',
];
export function chromeMessages(catalog) {
  const messages = { extension_name: { message: 'Grok Bot Clipper' } };
  for (const key of metadata) {
    if (typeof catalog[key] !== 'string' || !catalog[key].trim())
      throw Error(`Missing localized metadata: ${key}`);
    if (key === 'manifest_description' && catalog[key].length > 132)
      throw Error('Store description exceeds 132 characters');
    messages[key] = { message: catalog[key] };
  }
  return messages;
}
export async function writeChromeLocales(outdir) {
  await cp(new URL('../src/i18n/locales', import.meta.url), `${outdir}/locales`, {
    recursive: true,
  });
  const { supportedLocales } = await import('../src/i18n/locales.js');
  for (const { code } of supportedLocales) {
    const catalog = JSON.parse(
      await readFile(new URL(`../src/i18n/locales/${code}.json`, import.meta.url), 'utf8'),
    );
    const dir = `${outdir}/_locales/${code}`;
    await mkdir(dir, { recursive: true });
    await writeFile(
      `${dir}/messages.json`,
      JSON.stringify(chromeMessages(catalog), null, 2) + '\n',
    );
  }
}
