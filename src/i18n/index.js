import english from './locales/en.json' with { type: 'json' };
import chinese from './locales/zh_CN.json' with { type: 'json' };
import { supportedLocales } from './locales.js';
export { supportedLocales } from './locales.js';
const catalogs = new Map([
  ['en', english],
  ['zh_CN', chinese],
]);
const listeners = new Set(),
  documents = new Set();
let current = 'zh_CN',
  initialization = 0;
const codes = new Set(supportedLocales.map((l) => l.code));
function browserLocale(api) {
  return (
    api?.i18n?.getUILanguage?.() ||
    globalThis.navigator?.languages?.[0] ||
    globalThis.navigator?.language ||
    'en'
  );
}
export function resolveLocale(input, api = globalThis.browser || globalThis.chrome) {
  let language = String(!input || input === 'auto' ? browserLocale(api) : input).replaceAll(
    '-',
    '_',
  );
  const lower = language.toLowerCase();
  if (/^zh(?:_|$)/.test(lower)) return /(?:tw|hk|mo|hant)/.test(lower) ? 'zh_TW' : 'zh_CN';
  if (/^(?:iw|he)(?:_|$)/.test(lower)) return 'he';
  if (/^(?:nb|nn|no)(?:_|$)/.test(lower)) return 'no';
  if (/^pt(?:_|$)/.test(lower)) return lower.includes('_pt') ? 'pt_PT' : 'pt_BR';
  if (/^es_/.test(lower)) return /_(?:es)$/.test(lower) ? 'es' : 'es_419';
  language =
    [...codes].find((c) => c.toLowerCase() === lower) || language.split('_')[0].toLowerCase();
  return codes.has(language) ? language : 'en';
}
export function getLocale() {
  return current;
}
export function getCatalog() {
  return catalogs.get(current) || english;
}
export function t(source, values = {}) {
  const message = getCatalog()[source] ?? english[source] ?? source;
  return String(message).replace(/\{([A-Za-z0-9_]+)\}/g, (token, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : token,
  );
}
function updateDocument(document) {
  if (!document?.documentElement) return;
  document.documentElement.lang = current.replaceAll('_', '-');
  document.documentElement.dir = supportedLocales.find((l) => l.code === current)?.dir || 'ltr';
}
function applyLocale(locale, api) {
  const resolved = resolveLocale(locale, api);
  const next = catalogs.has(resolved) ? resolved : 'en',
    changed = next !== current;
  current = next;
  for (const doc of documents) updateDocument(doc);
  if (changed)
    for (const listener of listeners) {
      try {
        listener(next);
      } catch {}
    }
  return current;
}
export function setLocale(locale, api) {
  initialization++;
  return applyLocale(locale, api);
}
export function onLocaleChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export async function initI18n({
  api = globalThis.browser || globalThis.chrome,
  locale,
  document = globalThis.document,
} = {}) {
  const request = ++initialization;
  let remote;
  // Content scripts get only locale strings, never account settings or credentials.
  if (locale === undefined && api?.runtime?.sendMessage) {
    try {
      const response = await api.runtime.sendMessage({ type: 'i18n.locale' });
      remote = response?.ok ? response.value : null;
      if (remote?.language) locale = remote.language;
    } catch {}
  }
  if (locale === undefined && api?.storage?.local?.get) {
    try {
      const stored = await api.storage.local.get('settings');
      locale = stored.settings?.language;
    } catch {}
  }
  let code = resolveLocale(locale || 'auto', api);
  if (remote?.catalog && resolveLocale(remote.resolvedLanguage || remote.language, api) === code) {
    catalogs.set(code, {
      ...(catalogs.get(code) || {}),
      ...Object.fromEntries(
        Object.entries(remote.catalog).filter(([, v]) => typeof v === 'string'),
      ),
    });
  }
  if (!catalogs.has(code)) {
    try {
      const url = api?.runtime?.getURL?.(`locales/${code}.json`);
      if (url) {
        const response = await fetch(url);
        if (!response.ok) throw Error('LOCALE_LOAD_FAILED');
        catalogs.set(code, await response.json());
      } else if (api?.runtime?.sendMessage) {
        const response = await api.runtime.sendMessage({ type: 'i18n.locale', language: code });
        const value = response?.ok ? response.value : null;
        if (value?.catalog) catalogs.set(code, value.catalog);
      }
    } catch {}
  }
  if (!catalogs.has(code)) code = 'en';
  if (request !== initialization) return current;
  const isNewDocument = document?.documentElement && !documents.has(document);
  if (isNewDocument) documents.add(document);
  applyLocale(code, api);
  if (isNewDocument && document?.defaultView)
    document.defaultView.addEventListener('pagehide', () => documents.delete(document), {
      once: true,
    });
  return code;
}
export function formatDate(value, options = {}) {
  if (value === undefined || value === null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat(current.replaceAll('_', '-'), options).format(date);
}
export function formatNumber(value, options = {}) {
  return new Intl.NumberFormat(current.replaceAll('_', '-'), options).format(value);
}
