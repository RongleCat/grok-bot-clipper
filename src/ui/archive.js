import { t, initI18n, onLocaleChange } from '../i18n/index.js';
import { get, put } from '../core/db.js';
const q = new URLSearchParams(location.search),
  materialId = q.get('material'),
  tabId = Number(q.get('tab'));
try {
  await initI18n({ api: chrome });
  document.title = t('正在保存网页');
  const stopTitleLocale = onLocaleChange(() => {
    document.title = t('正在保存网页');
  });
  window.addEventListener('pagehide', stopTitleLocale, { once: true });
  const blob = await chrome.pageCapture.saveAsMHTML({ tabId });
  if (!blob) throw Error('ARCHIVE_EMPTY');
  const item = await get('materials', materialId);
  if (!item) throw Error('MATERIAL_UNAVAILABLE');
  item.attachments.push({ name: 'page.mhtml', blob });
  item.warnings ??= [];
  item.warnings.push(t('MHTML 是当前页面快照；未加载内容、视频及交互状态可能未包含'));
  await put('materials', item);
  await chrome.runtime.sendMessage({ type: 'archive.done', materialId });
} catch {
  await chrome.runtime.sendMessage({ type: 'archive.done', materialId, error: 'ARCHIVE_FAILED' });
} finally {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id) await chrome.tabs.remove(tab.id);
}
