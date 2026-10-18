import { parse } from 'acorn';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromeMessages } from './i18n-build.mjs';
const chinese = /[\u3400-\u9fff]/;
const variables = (text) =>
  [...new Set([...text.matchAll(/\{([\w]+)\}/g)].map((m) => m[1]))].sort();
export function checkCatalogs(catalogs) {
  const errors = [];
  const base = catalogs.en || {};
  for (const [locale, catalog] of Object.entries(catalogs)) {
    for (const [key, value] of Object.entries(base)) {
      if (typeof catalog[key] !== 'string' || !catalog[key].trim())
        errors.push(`${locale}: missing ${key}`);
      else if (JSON.stringify(variables(value)) !== JSON.stringify(variables(catalog[key])))
        errors.push(`${locale}: placeholder mismatch ${key}`);
    }
    for (const key of Object.keys(catalog))
      if (!(key in base)) errors.push(`${locale}: unknown key ${key}`);
    if (!['zh_CN', 'zh_TW', 'ja'].includes(locale)) {
      for (const [key, value] of Object.entries(catalog)) {
        if (typeof value === 'string' && chinese.test(value.replace(/铁柱(?:AGI)?/g, '')))
          errors.push(`${locale}: untranslated Chinese ${key}`);
      }
    }
  }
  return errors;
}
function translated(node, ancestors) {
  return ancestors.some(
    (parent) =>
      parent.type === 'CallExpression' &&
      ['t', 'translate'].includes(parent.callee?.name) &&
      parent.arguments[0]?.start <= node.start &&
      parent.arguments[0]?.end >= node.end,
  );
}
export function inspectSource(source) {
  const lines = source.split('\n');
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const findings = [];
  const visit = (node, ancestors = []) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Literal' && node.regex) return;
    const value =
      node.type === 'Literal' && typeof node.value === 'string'
        ? node.value
        : node.type === 'TemplateElement'
          ? node.value.cooked
          : null;
    if (value && chinese.test(value) && !translated(node, ancestors)) {
      const parent = ancestors.at(-1);
      // Selectors and site-native labels are inputs used for recognition, not extension copy.
      const call = ancestors.findLast((item) => item.type === 'CallExpression');
      const method = call?.callee?.property?.name;
      const selector = ['querySelector', 'querySelectorAll', 'closest', 'matches'].includes(method);
      const regexp =
        call?.callee?.name === 'RegExp' ||
        ancestors.some((a) => a.type === 'NewExpression' && a.callee.name === 'RegExp');
      const propertyKey = parent?.type === 'Property' && parent.key === node && !parent.computed;
      if (
        !selector &&
        !regexp &&
        !propertyKey &&
        !/i18n-exempt:\s*\S/.test(lines[node.loc.start.line - 1])
      )
        findings.push({ line: node.loc.start.line, text: value });
    }
    for (const [key, child] of Object.entries(node)) {
      if (['loc', 'start', 'end'].includes(key)) continue;
      if (Array.isArray(child)) child.forEach((item) => visit(item, [...ancestors, node]));
      else if (child && typeof child === 'object') visit(child, [...ancestors, node]);
    }
  };
  visit(tree);
  return findings;
}
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? files(path.join(dir, entry.name)) : path.join(dir, entry.name),
      ),
    )
  ).flat();
}
export async function audit(root = process.cwd()) {
  const errors = [];
  const localeDir = path.join(root, 'src/i18n/locales');
  const catalogs = {};
  for (const file of await readdir(localeDir))
    if (file.endsWith('.json'))
      catalogs[file.slice(0, -5)] = JSON.parse(await readFile(path.join(localeDir, file), 'utf8'));
  errors.push(...checkCatalogs(catalogs));
  const { supportedLocales } = await import(path.join(root, 'src/i18n/locales.js'));
  if (
    supportedLocales.length !== 55 ||
    new Set(supportedLocales.map((locale) => locale.code)).size !== 55
  )
    errors.push('Locale registry must contain 55 unique supported locales');
  for (const [code, catalog] of Object.entries(catalogs)) {
    try {
      chromeMessages(catalog);
    } catch (error) {
      errors.push(`${code}: ${error.message}`);
    }
  }
  for (const { code } of supportedLocales)
    if (!catalogs[code]) errors.push(`${code}: missing locale catalog`);
  for (const code of Object.keys(catalogs))
    if (!supportedLocales.some((locale) => locale.code === code))
      errors.push(`${code}: locale absent from registry`);
  const translatedKeys = new Set();
  for (const file of await files(path.join(root, 'src'))) {
    if (!file.endsWith('.js') || file.includes(`${path.sep}i18n${path.sep}`)) continue;
    const source = await readFile(file, 'utf8');
    const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
    const sourceLines = source.split('\n');
    const collect = (node) => {
      if (!node || typeof node !== 'object') return;
      if (
        node.type === 'Literal' &&
        typeof node.value === 'string' &&
        chinese.test(node.value) &&
        /i18n-exempt: stable source key translated at runtime/.test(
          sourceLines[node.loc.start.line - 1],
        )
      )
        translatedKeys.add(node.value);
      if (
        node.type === 'CallExpression' &&
        node.callee?.name === 't' &&
        typeof node.arguments[0]?.value === 'string'
      )
        translatedKeys.add(node.arguments[0].value);
      for (const value of Object.values(node))
        if (Array.isArray(value)) value.forEach(collect);
        else if (value && typeof value === 'object') collect(value);
    };
    collect(tree);
    for (const finding of inspectSource(source))
      errors.push(
        `${path.relative(root, file)}:${finding.line}: untranslated ${JSON.stringify(finding.text)}`,
      );
  }
  for (const key of translatedKeys)
    if (!(key in (catalogs.en || {}))) errors.push(`en: source key absent ${key}`);
  return errors;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = await audit();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log('Internationalization coverage and catalog parity passed.');
}
