import { t, getLocale } from '../i18n/index.js';
import { cleanURL } from '../core/context.js';
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
export function bodyArchive(item) {
  const html = `<!doctype html><html lang="${getLocale().replace('_', '-')}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(item.title)}</title><style>body{max-width:900px;margin:40px auto;padding:0 24px;font:16px/1.7 system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><h1>${escape(item.title)}</h1><p>${escape(t('来源：'))}${escape(cleanURL(item.url))}</p><p>${escape(t('正文归档，不包含原网页布局和未加载的媒体。'))}</p><pre>${escape(item.markdown)}</pre></body></html>`;
  return { name: 'page.html', blob: new Blob([html], { type: 'text/html;charset=utf-8' }) };
}
