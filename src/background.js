import { t, initI18n, getLocale, getCatalog, supportedLocales } from './i18n/index.js';
import { bodyArchive } from './platform/archive.js';
import { platformForURL, validateSocialRecord } from './social/records.js';
import { assembleSocialMaterial } from './social/material.js';
import { createSocialService } from './social/service.js';
import { closeLoginTab } from './core/login.js';
import { pixelRegion } from './core/region.js';
import { GrokBotClient, createLogin, pollLoginOnce } from './sdk/index.js';
import { DEFAULT_SETTINGS, resolveBot, packContext, cleanURL, safeName } from './core/context.js';
import { get, put, all, remove, prune, claimDraftJob } from './core/db.js';
import { deliveryState } from './core/outbox.js';
import { api, isFirefox, openSidePanel, protectStorage } from './platform/browser.js';
let documentProcessor;
async function hasProcessingDocument() {
  return isFirefox ? Boolean(documentProcessor) : api.offscreen.hasDocument();
}
async function processingDocument() {
  documentProcessor ??= import('./offscreen/tasks.js').then(({ createTaskProcessor }) =>
    createTaskProcessor({ api, authorize: contextAllowed, notify }),
  );
  return documentProcessor;
}
let processing = false,
  queueControl,
  offscreenPending,
  loginPolling = false;
let authTransition = false,
  generationPending;
async function authGeneration() {
  generationPending ??= (async () => {
    let value = (await api.storage.session.get('authGeneration')).authGeneration;
    if (!value) {
      value = crypto.randomUUID();
      await api.storage.session.set({ authGeneration: value });
    }
    return value;
  })();
  return generationPending;
}
async function invalidateAuth() {
  queueControl?.abort();
  for (const w of watchers.values()) w.abort();
  watchers.clear();
  const generation = crypto.randomUUID();
  generationPending = Promise.resolve(generation);
  await api.storage.session.set({ authGeneration: generation });
  if (await hasProcessingDocument()) await offscreen({ action: 'auth.invalidate', generation });
}
async function contextAllowed({ generation, accountId: owner, workspaceId: workspace }) {
  return (
    !authTransition &&
    generation === (await authGeneration()) &&
    !!(await credentials())?.accessToken &&
    owner === (await accountId()) &&
    workspace === (await workspaceId())
  );
}
const draftSends = new Map();
const captures = new Map(),
  archiveWaiters = new Map(),
  watchers = new Map();
const extensionURL = (path) => api.runtime.getURL(path);
const errorCode = (e) =>
  String(e?.code ?? e?.message ?? 'UNKNOWN_ERROR')
    .replace(/https?:\/\/\S+/g, '[url]')
    .slice(0, 140);
async function settings() {
  return { ...DEFAULT_SETTINGS, ...(await api.storage.local.get('settings')).settings };
}
async function credentials() {
  return (
    (await api.storage.session.get('credentials')).credentials ??
    (await api.storage.local.get('credentials')).credentials
  );
}
async function client() {
  const c = await credentials();
  if (!c?.accessToken) throw Error('LOGIN_REQUIRED');
  return new GrokBotClient({ accessToken: c.accessToken, teamId: c.selectedTeamId });
}
async function notify() {
  api.runtime.sendMessage({ type: 'state.changed' }).catch(() => {});
}
async function saveJob(j) {
  await put('jobs', j);
  await notify();
}
async function ensureOffscreen() {
  if (isFirefox) return;
  if (await hasProcessingDocument()) return;
  if (!offscreenPending)
    offscreenPending = api.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: t('处理截图像素、网页附件和 PDF 文字'),
      })
      .finally(() => {
        offscreenPending = null;
      });
  await offscreenPending;
}
async function offscreen(message) {
  await ensureOffscreen();
  if (message.action === 'job.run' && !(await contextAllowed(message)))
    throw Error('ACCOUNT_CHANGED');
  if (isFirefox) {
    const fn = (await processingDocument())[message.action];
    if (!fn) throw Error('UNKNOWN_OFFSCREEN_ACTION');
    return fn(message);
  }
  const r = await api.runtime.sendMessage({
    target: 'offscreen',
    language: (await settings()).language,
    ...message,
  });
  if (!r?.ok) throw Error(r?.error ?? 'IMAGE_PROCESSING_FAILED');
  return r.value;
}
async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab && !tab.url?.startsWith(extensionURL(''))) return tab;
  const candidates = (await api.tabs.query({ active: true }))
    .filter((tabOrTable) => /^https?:/.test(tabOrTable.url ?? ''))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  if (candidates[0]) return candidates[0];
  throw Error('TAB_UNAVAILABLE');
}
async function workspaceId() {
  return String((await credentials())?.selectedTeamId ?? 'personal');
}
async function accountId() {
  return (await api.storage.local.get('account')).account?.id;
}
async function botList() {
  return (await api.storage.local.get('bots')).bots ?? [];
}
async function route({ explicitBotId, url, kind } = {}) {
  return resolveBot({
    bots: await botList(),
    settings: await settings(),
    explicitBotId,
    url,
    kind,
  });
}
async function refreshBots() {
  const generation = await authGeneration(),
    workspace = await workspaceId();
  const c = await client();
  const [me, roster, teams] = await Promise.all([
    c.getMe(),
    c.listBots(),
    c.listTeams().catch(() => []),
  ]);
  if (generation !== (await authGeneration()) || workspace !== (await workspaceId()))
    throw Error('ACCOUNT_CHANGED');
  await api.storage.local.set({
    teams,
    bots: roster.bots,
    rosterTruncated: roster.truncated,
    account: {
      id: String(me.authId ?? me.userId),
      name: [me.firstName, me.lastName].filter(Boolean).join(' ') || me.email || '',
      email: me.email ?? '',
      teamId: me.teamId,
      teamName: me.teamName,
    },
  });
  let s = await settings();
  if (!s.defaultBotId && roster.bots[0]) {
    s.defaultBotId = roster.bots[0].id;
    await api.storage.local.set({ settings: s });
  }
  await menus();
  await toolbar();
  await notify();
  return roster;
}
async function toolbar(tab) {
  try {
    tab ??= await activeTab();
    const bot = await route({ url: tab.url, kind: 'page' });
    await api.action.setTitle({
      tabId: tab.id,
      title: t('发送给 {name}', { name: bot.name || 'BOT' }),
    });
  } catch {
    await api.action.setTitle({ title: 'Grok Bot Clipper' });
  }
}
let menuChain = Promise.resolve();
function menus() {
  menuChain = menuChain.catch(() => {}).then(rebuildMenus);
  return menuChain;
}
async function rebuildMenus() {
  await api.contextMenus.removeAll();
  const bots = await botList(),
    s = await settings();
  let target;
  try {
    const tabOrTable = await activeTab();
    target = await route({ url: tabOrTable.url, kind: 'page' });
  } catch {}
  api.contextMenus.create({
    id: 'send-default',
    title: target ? t('发送给 {name}', { name: target.name || 'BOT' }) : t('发送给 Grok Bot'),
    contexts: ['selection', 'image', 'link', 'page', 'video', 'audio'],
  });
  for (const bot of bots.filter((b) => s.favorites.includes(b.id)).slice(0, 5))
    api.contextMenus.create({
      id: 'bot:' + bot.id,
      title: bot.name || 'BOT',
      contexts: ['selection', 'image', 'link', 'page'],
    });
  api.contextMenus.create({
    id: 'choose-bot',
    title: t('选择 BOT…'),
    contexts: ['selection', 'image', 'link', 'page'],
  });
  api.contextMenus.create({
    id: 'add-basket',
    title: t('加入材料篮'),
    contexts: ['selection', 'image', 'link', 'page', 'video'],
  });
  api.contextMenus.create({
    id: 'send-note',
    title: t('添加说明后发送…'),
    contexts: ['selection', 'image', 'link', 'page'],
  });
}
async function content(tabId, action, options = {}) {
  try {
    await api.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    throw Error('PAGE_ACCESS_REQUIRED');
  }
  const r = await api.tabs.sendMessage(tabId, {
    target: 'content',
    language: (await settings()).language,
    action,
    ...(action === 'capture' ? { options } : options),
  });
  if (!r?.ok) throw Error(r?.error ?? 'CAPTURE_FAILED');
  return r.value;
}
async function fetchBlob(url, { maxBytes = 128 * 1024 * 1024, tabId } = {}) {
  const u = new URL(url);
  if (!['https:', 'http:', 'data:', 'blob:'].includes(u.protocol))
    throw Error('RESOURCE_URL_UNSUPPORTED');
  if (u.protocol === 'blob:' && tabId) {
    const [r] = await api.scripting.executeScript({
      target: { tabId },
      func: async (value, max) => {
        try {
          const r = await fetch(value),
            b = await r.blob();
          if (b.size > max) return null;
          return await new Promise((resolve) => {
            const f = new FileReader();
            f.onload = () => resolve(f.result);
            f.readAsDataURL(b);
          });
        } catch {
          return null;
        }
      },
      args: [url, maxBytes],
    });
    if (!r.result) throw Error('IMAGE_UNAVAILABLE');
    return (await fetch(r.result)).blob();
  }
  const r = await fetch(url, {
    credentials: 'omit',
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error('RESOURCE_DOWNLOAD_FAILED');
  if (Number(r.headers.get('content-length')) > maxBytes) {
    await r.body?.cancel();
    throw Error('ATTACHMENT_TOO_LARGE');
  }
  const reader = r.body.getReader(),
    parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw Error('ATTACHMENT_TOO_LARGE');
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(parts, {
    type: r.headers.get('content-type')?.split(';')[0] || 'application/octet-stream',
  });
}
async function capturePage(tab, { kind = 'page', ...options } = {}) {
  const s = await settings(),
    captureOwner = await accountId(),
    captureWorkspace = await workspaceId();
  let item;
  try {
    item = await content(tab.id, 'capture', {
      kind,
      includeNearby: s.includeNearby,
      includePageContext: s.includePageContext,
      ...options,
    });
  } catch (error) {
    item = {
      id: crypto.randomUUID(),
      kind,
      title: tab.title || t('网页'),
      url: cleanURL(tab.url),
      capturedAt: new Date().toISOString(),
      createdAt: Date.now(),
      markdown: cleanURL(options.linkUrl || tab.url),
      attachments: [],
      warnings: [errorCode(error) + t('：未能读取页面正文')],
    };
  }
  item.sourceWindowId = tab.windowId;
  if (item.pageContext) {
    item.markdown += t('\n\n## 页面背景\n\n') + item.pageContext;
    delete item.pageContext;
  }
  for (const tabOrTable of item.tables ?? [])
    item.attachments.push({
      name: tabOrTable.name,
      blob: new Blob([tabOrTable.csv], { type: 'text/csv;charset=utf-8' }),
    });
  if (kind === 'image' && item.image?.url) {
    try {
      const blob = await fetchBlob(item.image.url, {
        tabId: tab.id,
        maxBytes: s.maxAttachmentBytes,
      });
      item.attachments.push({
        name:
          'image.' +
          ({
            'image/svg+xml': 'svg',
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif',
            'image/avif': 'avif',
          }[blob.type] || 'bin'),
        blob,
      });
    } catch {
      item.warnings.push(t('无法获取原图文件，已保留图片出处；可以用截图补充'));
    }
  }
  if (kind === 'page' && (/\.pdf(?:[?#]|$)/i.test(tab.url ?? '') || options.pdf)) {
    try {
      const blob = await fetchBlob(tab.url, { maxBytes: s.maxAttachmentBytes });
      if (blob.type === 'application/pdf') {
        item.attachments.push({ name: safeName(tab.title) + '.pdf', blob });
      }
    } catch {
      item.warnings.push(t('PDF 原文件无法下载，已保留来源链接'));
    }
  }
  if (captureOwner !== (await accountId()) || captureWorkspace !== (await workspaceId()))
    throw Error('ACCOUNT_CHANGED');
  item.accountId = captureOwner;
  await put('materials', item);
  if (kind === 'page' && s.archiveMHTML && !/\.pdf(?:[?#]|$)/i.test(tab.url ?? '')) {
    try {
      await archive(tab.id, item.id);
    } catch {
      item = await get('materials', item.id);
      item.warnings.push(
        isFirefox
          ? t('HTML 正文归档失败，已保留正文和结构化材料')
          : t('MHTML 归档失败，已保留正文和结构化材料'),
      );
      await put('materials', item);
    }
  }
  item = await get('materials', item.id);
  if (kind === 'video') {
    if (item.videoRect)
      try {
        item = await attachRegionImage(item, tab, item.videoRect, item.viewport, 'video-frame.png');
      } catch {
        item.warnings.push('VIDEO_FRAME_UNAVAILABLE');
        await put('materials', item);
      }
    else {
      item.warnings.push('VIDEO_NOT_FOUND');
      await put('materials', item);
    }
  }
  const pdfIndex = item.attachments.findIndex((a) => a.blob.type === 'application/pdf');
  if (pdfIndex >= 0)
    try {
      await offscreen({ action: 'pdf', materialId: item.id, index: pdfIndex });
    } catch {
      item.warnings.push(t('PDF 文字提取失败，原文件仍包含在附件中'));
      await put('materials', item);
    }
  return await get('materials', item.id);
}
async function archive(tabId, materialId) {
  if (isFirefox) {
    const item = await get('materials', materialId);
    if (!item) throw Error('MATERIAL_UNAVAILABLE');
    item.attachments.push(bodyArchive(item));
    item.warnings ??= [];
    item.warnings.push(t('HTML 归档仅保留正文，不包含原网页布局、未加载媒体及完整视频'));
    await put('materials', item);
    return true;
  }
  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => {
      archiveWaiters.delete(materialId);
      reject(Error('ARCHIVE_TIMEOUT'));
    }, 60000);
    archiveWaiters.set(materialId, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    try {
      await api.tabs.create({
        url: extensionURL(`archive.html?tab=${tabId}&material=${encodeURIComponent(materialId)}`),
        active: false,
      });
    } catch (e) {
      clearTimeout(timer);
      archiveWaiters.delete(materialId);
      reject(e);
    }
  });
}
async function openComposer(draftId, windowId) {
  windowId ??= (await activeTab()).windowId;
  if ((await settings()).composerSurface === 'window') {
    await api.windows.create({
      url: extensionURL('app.html?view=compose&draft=' + encodeURIComponent(draftId)),
      type: 'popup',
      width: 660,
      height: 800,
    });
    return { draftId };
  }
  await api.storage.session.set({
    ['composerDraft:' + windowId]: draftId,
    ['sidepanelView:' + windowId]: 'compose',
  });
  await api.runtime.sendMessage({ type: 'compose.ready', draftId, windowId }).catch(() => {});
  try {
    await openSidePanel({ windowId });
    return { draftId };
  } catch {
    await api.windows.create({
      url: extensionURL('app.html?view=compose&draft=' + encodeURIComponent(draftId)),
      type: 'popup',
      width: 660,
      height: 800,
    });
    return { draftId, surface: 'window' };
  }
}
async function createDraft(
  items,
  {
    explicitBotId,
    forcePrompt = false,
    basket = false,
    screenshotEdit = false,
    chooseBot = false,
    sendNow = false,
    expectedScope,
    instruction = '',
    draftId,
    windowId,
  } = {},
) {
  const s = await settings(),
    owner = await accountId();
  if (items.some((i) => i.accountId !== owner)) throw Error('ACCOUNT_CHANGED');
  if (expectedScope && !(await contextAllowed(expectedScope))) throw Error('ACCOUNT_CHANGED');
  if (draftId) {
    const previous = await get('drafts', draftId);
    if (
      previous &&
      (previous.accountId !== owner || previous.workspaceId !== (await workspaceId()))
    )
      throw Error('ACCOUNT_CHANGED');
    if (previous?.jobId) return { jobId: previous.jobId };
  }
  let bot;
  try {
    bot = await route({ explicitBotId, url: items[0]?.url, kind: items[0]?.kind });
  } catch (error) {
    if (explicitBotId) throw error;
  }
  const draft = {
    id: draftId || crypto.randomUUID(),
    accountId: expectedScope?.accountId ?? (await accountId()),
    workspaceId: expectedScope?.workspaceId ?? (await workspaceId()),
    authGeneration: expectedScope?.generation,
    itemIds: items.map((i) => i.id),
    botId: bot?.id || '',
    explicitBot: Boolean(explicitBotId),
    instruction,
    preset: s.taskPreset,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    screenshotEdit,
    chooseBot,
  };
  if (expectedScope && !(await contextAllowed(expectedScope))) throw Error('ACCOUNT_CHANGED');
  await put('drafts', draft);
  if (basket) {
    for (const item of items) {
      item.inBasket = true;
      await put('materials', item);
    }
    await notify();
    return { basket: true, count: items.length };
  }
  if (bot && (sendNow || (!screenshotEdit && !forcePrompt && !s.askBeforeSend)))
    return { jobId: await enqueue(draft) };
  return openComposer(draft.id, windowId ?? items[0]?.sourceWindowId);
}
async function enqueue(draft) {
  if (authTransition) throw Error('ACCOUNT_CHANGED');
  const owner = await accountId(),
    generation = await authGeneration();
  if (draft.authGeneration && draft.authGeneration !== generation) throw Error('ACCOUNT_CHANGED');
  if (draft.accountId !== owner || draft.workspaceId !== (await workspaceId()))
    throw Error('ACCOUNT_CHANGED');
  const s = await settings(),
    items = await Promise.all(draft.itemIds.map((id) => get('materials', id)));
  if (items.some((x) => x && x.accountId !== owner)) throw Error('ACCOUNT_CHANGED');
  if (items.some((x) => !x)) throw Error('MATERIAL_UNAVAILABLE');
  const bot = await route({ explicitBotId: draft.botId, url: items[0]?.url, kind: items[0]?.kind });
  const packet = await packContext({
    items,
    instruction: draft.instruction,
    preset: draft.preset,
    maxTextBytes: s.maxTextBytes,
    includeSource: s.includeSource,
    maxAttachmentBytes: s.maxAttachmentBytes,
  });
  const creds = await credentials();
  if (!creds) throw Error('LOGIN_REQUIRED');
  if (!(await contextAllowed({ generation, accountId: owner, workspaceId: draft.workspaceId })))
    throw Error('ACCOUNT_CHANGED');
  const job = {
    id: draft.id,
    messageId: draft.id,
    botId: bot.id,
    botName: bot.name,
    sessionId: bot.sessionId,
    teamId: bot.teamId,
    workspaceId: draft.workspaceId,
    accountId: owner,
    title: items[0]?.title || draft.instruction?.slice(0, 80) || t('消息'),
    itemIds: draft.itemIds,
    packet,
    uploaded: [],
    state: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const claimed = await claimDraftJob(draft.id, job);
  draft.jobId = claimed;
  await notify();
  for (const item of items) {
    if (item.inBasket) {
      item.inBasket = false;
      await put('materials', item);
    }
  }
  processQueue().catch(() => {});
  return claimed;
}
async function processQueue() {
  if (processing || authTransition) return;
  processing = true;
  queueControl = new AbortController();
  const signal = queueControl.signal;
  try {
    const generation = await authGeneration();
    const account = (await api.storage.local.get('account')).account;
    for (const job of (await all('jobs')).sort((a, b) => a.createdAt - b.createdAt)) {
      signal.throwIfAborted();
      if (!['queued', 'uploading'].includes(job.state) || job.workspaceId !== (await workspaceId()))
        continue;
      if (job.accountId !== account?.id) {
        job.state = 'failed';
        job.error = 'ACCOUNT_CHANGED';
        await saveJob(job);
        continue;
      }
      await api.action.setBadgeText({ text: '…' });
      const token = await credentials();
      if (!token) throw Error('LOGIN_REQUIRED');
      await offscreen({
        action: 'job.run',
        jobId: job.id,
        credentials: token,
        accountId: account.id,
        workspaceId: job.workspaceId,
        generation,
      });
      const finished = await get('jobs', job.id);
      job.state = finished?.state ?? job.state;
      await api.action.setBadgeText({ text: job.state === 'accepted' ? '' : '!' });
    }
  } finally {
    processing = false;
  }
}
async function assertCaptureTab(tab) {
  const [active] = await api.tabs.query({ active: true, windowId: tab.windowId });
  const current = await api.tabs.get(tab.id);
  if (active?.id !== tab.id || current.windowId !== tab.windowId || current.url !== tab.url)
    throw Error('CAPTURE_TAB_CHANGED');
}
async function captureVisible(tab) {
  await assertCaptureTab(tab);
  const data = await api.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  await assertCaptureTab(tab);
  return data;
}
async function screenshot(tab, mode, options = {}) {
  const s = await settings();
  if (mode === 'region' && !options.rect) {
    captures.set(tab.id, {
      ...options,
      kind: 'region',
      accountId: await accountId(),
      workspaceId: await workspaceId(),
      url: tab.url,
    });
    await content(tab.id, 'region.picker');
    return { picking: true };
  }
  const item = {
    id: crypto.randomUUID(),
    kind: 'screenshot',
    sourceWindowId: tab.windowId,
    title: tab.title || t('截图'),
    url: cleanURL(tab.url),
    createdAt: Date.now(),
    capturedAt: new Date().toISOString(),
    markdown: t('网页截图'),
    accountId: await accountId(),
    warnings: [],
    attachments: [],
  };
  try {
    const meta = await content(tab.id, 'capture', {
      kind: s.includePageContext ? 'page' : 'selection',
      includeNearby: s.includeNearby,
    });
    item.markdown += '\n' + (meta.markdown || meta.selection || meta.description || '');
    item.headings = meta.headings;
    item.language = meta.language;
    item.description = meta.description;
  } catch {}
  if (mode === 'full') {
    const info = await content(tab.id, 'scroll.prepare'),
      height = Math.min(info.total, s.maxScrollHeight),
      frames = [];
    if (info.total > height)
      item.warnings.push(t('长截图限制为 {height} 像素，页面剩余部分未采集', { height }));
    try {
      for (let y = 0; y < height; y += info.height) {
        const position = await content(tab.id, 'scroll.to', { y });
        await new Promise((r) => setTimeout(r, 600));
        const current = await api.tabs.get(tab.id);
        const active = await activeTab();
        if (active.id !== tab.id || active.windowId !== tab.windowId || current.url !== tab.url)
          throw Error('CAPTURE_TAB_CHANGED');
        frames.push({
          y: position.y,
          data: await captureVisible(tab),
        });
        if (position.y + info.height >= height) break;
      }
    } finally {
      await content(tab.id, 'scroll.restore').catch(() => {});
    }
    await put('materials', item);
    await offscreen({
      action: 'stitch',
      materialId: item.id,
      frames,
      width: info.width,
      height,
      scale: (await imageSize(frames[0].data)).width / info.width,
    });
    item.warnings.push(t('长截图为滚动采集，固定元素和动态内容可能重复'));
    await put('materials', {
      ...(await get('materials', item.id)),
      warnings: [...new Set([...(await get('materials', item.id)).warnings, ...item.warnings])],
    });
  } else {
    const active = await activeTab();
    if (active.id !== tab.id) throw Error('CAPTURE_TAB_CHANGED');
    if (mode === 'region') {
      const current = await content(tab.id, 'viewport');
      if (['width', 'height', 'scrollX', 'scrollY'].some((k) => current[k] !== options.viewport[k]))
        throw Error('CAPTURE_VIEWPORT_CHANGED');
    }
    const data = await captureVisible(tab);
    if ((await activeTab()).id !== tab.id) throw Error('CAPTURE_TAB_CHANGED');
    const blob = await (await fetch(data)).blob();
    item.attachments.push({ name: 'screenshot.png', blob });
    await put('materials', item);
    if (mode === 'region') {
      const rect = pixelRegion(options.rect, options.viewport, await imageSize(data));
      await offscreen({ action: 'transform', materialId: item.id, index: 0, rect });
    }
  }
  return createDraft([await get('materials', item.id)], {
    ...options,
    screenshotEdit: false,
  });
}
async function imageSize(data) {
  const b = await createImageBitmap(await (await fetch(data)).blob());
  const size = { width: b.width, height: b.height };
  b.close();
  return size;
}
async function state() {
  const owner = await accountId();
  const s = await settings(),
    local = await api.storage.local.get([
      'account',
      'bots',
      'teams',
      'rosterTruncated',
      'loginError',
    ]),
    flow = (await api.storage.session.get('loginFlow')).loginFlow;
  return {
    settings: s,
    account: local.account,
    teams: local.teams ?? [],
    workspaceId: await workspaceId(),
    bots: local.bots ?? [],
    rosterTruncated: local.rosterTruncated,
    authenticated: Boolean((await credentials())?.accessToken),
    loginPending: Boolean(flow),
    loginError: local.loginError ?? '',
    lastError: (await get('meta', 'lastError'))?.error,
    basket: (await all('materials'))
      .filter((i) => i.inBasket && i.accountId === owner)
      .map(({ attachments, markdown, ...rest }) => ({
        ...rest,
        preview: markdown?.slice(0, 160),
        attachmentCount: attachments?.length ?? 0,
      })),
    jobs: (await all('jobs'))
      .filter((j) => j.accountId === owner)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .map(({ packet, checkpoints, uploaded, ...j }) => ({
        ...j,
        attachmentCount: packet?.attachments?.length ?? 0,
      })),
  };
}
async function startLogin() {
  const flow = await createLogin();
  flow.createdAt = Date.now();
  await api.storage.session.set({ loginFlow: flow });
  await api.storage.local.remove('loginError');
  const tab = await api.tabs.create({ url: flow.loginUrl });
  if ((await api.storage.session.get('loginFlow')).loginFlow?.uuid !== flow.uuid)
    return { pending: false };
  flow.tabId = tab.id;
  await api.storage.session.set({ loginFlow: flow });
  await api.alarms.create('login', { periodInMinutes: 0.5 });
  pollLogin().catch(() => {});
  return { pending: true };
}
async function pollLogin() {
  if (loginPolling) return;
  loginPolling = true;
  try {
    let flow = (await api.storage.session.get('loginFlow')).loginFlow;
    if (!flow) return;
    if (Date.now() - flow.createdAt > 10 * 60 * 1000) throw Error('LOGIN_TIMED_OUT');
    // tabs.create is asynchronous; do not finalize before its tab id is persisted.
    if (!Number.isInteger(flow.tabId)) return;
    for (let i = 0; i < 12; i++) {
      if (Date.now() - flow.createdAt > 10 * 60 * 1000) throw Error('LOGIN_TIMED_OUT');
      const token = await pollLoginOnce(flow);
      if (token) {
        const current = (await api.storage.session.get('loginFlow')).loginFlow;
        if (current?.uuid !== flow.uuid || !Number.isInteger(current.tabId)) return;
        const c = {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          selectedTeamId: token.selectedTeamId,
        };
        await api.storage.session.set({ credentials: c });
        if ((await settings()).persistLogin) await api.storage.local.set({ credentials: c });
        await api.storage.session.remove('loginFlow');
        await api.alarms.clear('login');
        await closeLoginTab(api.tabs, current);
        await refreshBots();
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
      flow = (await api.storage.session.get('loginFlow')).loginFlow;
      if (!flow) return;
    }
  } catch (e) {
    await api.storage.local.set({ loginError: errorCode(e) });
    await api.storage.session.remove('loginFlow');
    await api.alarms.clear('login');
    await notify();
  } finally {
    loginPolling = false;
  }
}
async function changeSettings(patch) {
  const old = await settings(),
    s = { ...old };
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (Object.hasOwn(patch, k)) s[k] = patch[k];
  s.language =
    s.language === 'auto' || supportedLocales.some((locale) => locale.code === s.language)
      ? s.language
      : 'auto';
  await initI18n({ api, locale: s.language, document: null });
  s.maxTextBytes = Math.min(120000, Math.max(4096, Number(s.maxTextBytes) || 48000));
  s.maxAttachmentBytes = Math.min(
    128 * 1024 * 1024,
    Math.max(1024 * 1024, Number(s.maxAttachmentBytes) || 128 * 1024 * 1024),
  );
  s.maxScrollHeight = Math.min(30000, Math.max(1000, Number(s.maxScrollHeight) || 16000));
  s.retentionDays = Math.min(90, Math.max(1, Number(s.retentionDays) || 7));
  s.favorites = Array.isArray(s.favorites)
    ? s.favorites.filter((x) => typeof x === 'string').slice(0, 100)
    : [];
  s.rules = Array.isArray(s.rules)
    ? s.rules
        .filter(
          (r) =>
            r &&
            typeof r.host === 'string' &&
            /^[a-z0-9.-]+$/i.test(r.host) &&
            typeof r.botId === 'string',
        )
        .slice(0, 100)
    : [];
  s.actionBots = s.actionBots && typeof s.actionBots === 'object' ? s.actionBots : {};
  await api.storage.local.set({ settings: s });
  if (s.persistLogin) {
    const c = await credentials();
    if (c) await api.storage.local.set({ credentials: c });
  } else await api.storage.local.remove('credentials');
  await menus();
  await toolbar();
  await notify();
  return s;
}
async function attachRegionImage(item, tab, rect, viewport, name) {
  if ((await activeTab()).id !== tab.id) throw Error('CAPTURE_TAB_CHANGED');
  const data = await captureVisible(tab);
  if ((await activeTab()).id !== tab.id) throw Error('CAPTURE_TAB_CHANGED');
  const blob = await (await fetch(data)).blob(),
    image = await createImageBitmap(blob),
    scale = image.width / viewport.width;
  image.close();
  const x = Math.max(0, rect.x),
    y = Math.max(0, rect.y),
    width = Math.min(rect.width - (x - rect.x), viewport.width - x),
    height = Math.min(rect.height - (y - rect.y), viewport.height - y);
  if (width <= 0 || height <= 0) throw Error('ELEMENT_OUTSIDE_VIEWPORT');
  const index = item.attachments.length;
  item.attachments.push({ name, blob });
  await put('materials', item);
  await offscreen({
    action: 'transform',
    materialId: item.id,
    index,
    rect: { x: x * scale, y: y * scale, width: width * scale, height: height * scale },
  });
  return get('materials', item.id);
}
async function finishElementCapture(item, tab, options) {
  if (item.rect && item.viewport) {
    try {
      if ((await activeTab()).id !== tab.id) throw Error('CAPTURE_TAB_CHANGED');
      const data = await captureVisible(tab);
      if ((await activeTab()).id !== tab.id) throw Error('CAPTURE_TAB_CHANGED');
      const blob = await (await fetch(data)).blob(),
        image = await createImageBitmap(blob),
        scale = image.width / item.viewport.width;
      image.close();
      const r = item.rect,
        x = Math.max(0, r.x),
        y = Math.max(0, r.y),
        width = Math.min(r.width - (x - r.x), item.viewport.width - x),
        height = Math.min(r.height - (y - r.y), item.viewport.height - y);
      if (width > 0 && height > 0) {
        item.attachments.push({ name: 'element.png', blob });
        await put('materials', item);
        await offscreen({
          action: 'transform',
          materialId: item.id,
          index: 0,
          rect: { x: x * scale, y: y * scale, width: width * scale, height: height * scale },
        });
      }
    } catch {
      const saved = await get('materials', item.id);
      saved.warnings.push(t('元素截图未能生成，已保留文字内容'));
      await put('materials', saved);
    }
  }
  const saved = await get('materials', item.id);
  for (const tabOrTable of saved.tables ?? [])
    saved.attachments.push({
      name: tabOrTable.name,
      blob: new Blob([tabOrTable.csv], { type: 'text/csv;charset=utf-8' }),
    });
  await put('materials', saved);
  return createDraft([saved], options);
}
const socialService = createSocialService({
  settings,
  bots: botList,
  scope: async () => {
    if (!(await credentials())?.accessToken) throw Error('LOGIN_REQUIRED');
    return {
      accountId: await accountId(),
      workspaceId: await workspaceId(),
      generation: await authGeneration(),
    };
  },
  allowed: contextAllowed,
  assemble: assembleSocialMaterial,
  saveMaterial: (item) => put('materials', item),
  submit: createDraft,
  loadRequest: async (id) =>
    (await api.storage.session.get('socialShare:' + id))['socialShare:' + id],
  saveRequest: async (row) => {
    const rows = await api.storage.session.get(null);
    const old = Object.entries(rows)
      .filter(([key]) => key.startsWith('socialShare:'))
      .sort((a, b) => a[1].createdAt - b[1].createdAt);
    const expired = old
      .filter(([, value]) => Date.now() - value.createdAt > 30 * 60 * 1000)
      .map(([key]) => key);
    if (old.length >= 8 && !rows['socialShare:' + row.id]) expired.push(old[0][0]);
    if (expired.length) await api.storage.session.remove([...new Set(expired)]);
    await api.storage.session.set({ ['socialShare:' + row.id]: row });
  },
  openPopup: async (id) =>
    api.windows.create({
      url: extensionURL('share.html?request=' + encodeURIComponent(id)),
      type: 'popup',
      width: 600,
      height: 740,
    }),
});
async function handle(message, sender) {
  const isUI = sender.id === api.runtime.id && sender.url?.startsWith(extensionURL(''));
  if (message.type === 'i18n.locale' && sender.id === api.runtime.id) {
    await initI18n({ api, locale: (await settings()).language || 'auto', document: null });
    return {
      language: (await settings()).language || 'auto',
      resolvedLanguage: getLocale(),
      catalog: getCatalog(),
    };
  }
  if (!isUI) {
    if (message.type?.startsWith('social.')) {
      if (
        sender.id !== api.runtime.id ||
        !sender.tab ||
        (sender.frameId ?? 0) !== 0 ||
        !platformForURL(sender.url || sender.tab.url)
      )
        throw Error('UNTRUSTED_SENDER');
      if (message.type === 'social.open') {
        await api.tabs.create({ url: extensionURL('app.html') });
        return;
      }
      if (message.type === 'social.targets') return socialService.targets();
      if (message.type === 'social.capture') {
        const record = validateSocialRecord(message.record, sender.url || sender.tab.url);
        return socialService.capture(record, {
          botId: message.botId,
          chooseBot: Boolean(message.chooseBot),
          embedded: Boolean(message.embedded),
          tabId: sender.tab.id,
          windowId: sender.tab.windowId,
        });
      }
      throw Error('UNKNOWN_ACTION');
    }
    if (message.type === 'composer.open' && sender.tab) {
      const draft = await get('drafts', message.draftId);
      if (
        !draft ||
        draft.accountId !== (await accountId()) ||
        draft.workspaceId !== (await workspaceId())
      )
        throw Error('ACCOUNT_CHANGED');
      await api.windows.create({
        url: extensionURL('app.html?view=compose&draft=' + encodeURIComponent(draft.id)),
        type: 'popup',
        width: 660,
        height: 800,
      });
      return { draftId: draft.id, surface: 'window' };
    }
    if (message.type === 'capture.region' && sender.tab) {
      const request = captures.get(sender.tab.id);
      captures.delete(sender.tab.id);
      if (!request || request.kind !== 'region') throw Error('CAPTURE_NOT_REQUESTED');
      if (
        request.accountId !== (await accountId()) ||
        request.workspaceId !== (await workspaceId())
      )
        throw Error('ACCOUNT_CHANGED');
      if (request.url !== sender.tab.url) throw Error('CAPTURE_TAB_CHANGED');
      pixelRegion(message.rect, message.viewport, {
        width: message.viewport?.width,
        height: message.viewport?.height,
      });
      return screenshot(sender.tab, 'region', {
        ...request,
        rect: message.rect,
        viewport: message.viewport,
      });
    }
    if (message.type === 'capture.element' && sender.tab) {
      if (!captures.has(sender.tab.id)) throw Error('CAPTURE_NOT_REQUESTED');
      const request = captures.get(sender.tab.id);
      if (
        request.accountId !== (await accountId()) ||
        request.workspaceId !== (await workspaceId())
      )
        throw Error('ACCOUNT_CHANGED');
      const raw = message.item;
      if (!raw || typeof raw.markdown !== 'string' || raw.markdown.length > 2100000)
        throw Error('INVALID_CAPTURE');
      const item = {
        ...raw,
        id: crypto.randomUUID(),
        accountId: await accountId(),
        url: cleanURL(sender.tab.url),
        sourceWindowId: sender.tab.windowId,
        createdAt: Date.now(),
        attachments: [],
      };
      await put('materials', item);
      const pending = captures.get(sender.tab.id) ?? {};
      captures.delete(sender.tab.id);
      return finishElementCapture(item, sender.tab, pending);
    }
    if (message.type === 'picker.cancel') {
      if (sender.tab) captures.delete(sender.tab.id);
      return;
    }
    throw Error('UNTRUSTED_SENDER');
  }
  const owner = isUI ? await accountId() : undefined;
  switch (message.type) {
    case 'social.picker.state':
      return socialService.pickerState(message.id, sender.tab?.id);
    case 'social.picker.send':
      return socialService.pickerSend(
        message.id,
        message.botId,
        message.instruction || '',
        sender.tab?.id,
      );
    case 'composer.open.saved': {
      const draft = await get('drafts', message.id);
      if (!draft || draft.accountId !== owner || draft.workspaceId !== (await workspaceId()))
        throw Error('DRAFT_UNAVAILABLE');
      return openComposer(draft.id, message.windowId);
    }
    case 'sidepanel.navigate': {
      const key = 'sidepanelView:' + message.windowId;
      await api.storage.session.set({
        [key]: ['compose', 'drafts', 'replies'].includes(message.view) ? message.view : 'replies',
      });
      await api.runtime
        .sendMessage({
          target: 'ui',
          type: 'ui.navigate',
          windowId: message.windowId,
          view: message.view,
        })
        .catch(() => {});
      return;
    }
    case 'auth.check':
      return { allowed: await contextAllowed(message) };
    case 'state':
      return state();
    case 'capture.target': {
      const tabOrTable = await activeTab();
      return {
        id: tabOrTable.id,
        windowId: tabOrTable.windowId,
        title: tabOrTable.title,
        url: cleanURL(tabOrTable.url),
      };
    }
    case 'login':
      return startLogin();
    case 'login.poll':
      pollLogin().catch(() => {});
      return { pending: true };
    case 'login.cancel':
      await api.storage.session.remove('loginFlow');
      await api.alarms.clear('login');
      await notify();
      return;
    case 'logout': {
      if (authTransition) throw Error('ACCOUNT_CHANGED');
      authTransition = true;
      try {
        await invalidateAuth();
        await api.storage.session.remove(['credentials', 'loginFlow']);
        await api.storage.local.remove([
          'credentials',
          'bots',
          'teams',
          'account',
          'rosterTruncated',
          'loginError',
        ]);
        await api.alarms.clear('login');
        await menus();
      } finally {
        authTransition = false;
        await notify();
      }
      return;
    }
    case 'bots.refresh':
      return refreshBots();
    case 'team.select': {
      const teams = (await api.storage.local.get('teams')).teams ?? [];
      const id = message.teamId === 'personal' ? undefined : Number(message.teamId);
      if (id !== undefined && !teams.some((tabOrTable) => tabOrTable.id === id))
        throw Error('TEAM_UNAVAILABLE');
      if (authTransition) throw Error('ACCOUNT_CHANGED');
      authTransition = true;
      const previous = await credentials();
      const snapshot = await api.storage.local.get([
        'settings',
        'bots',
        'account',
        'teams',
        'rosterTruncated',
      ]);
      try {
        if (!previous) throw Error('LOGIN_REQUIRED');
        await invalidateAuth();
        const next = { ...previous, selectedTeamId: id };
        await api.storage.local.set({
          bots: [],
          settings: { ...(await settings()), defaultBotId: '' },
        });
        await notify();
        await api.storage.session.set({ credentials: next });
        if ((await settings()).persistLogin) await api.storage.local.set({ credentials: next });
        await refreshBots();
      } catch (error) {
        if (previous) {
          await api.storage.session.set({ credentials: previous });
          if (snapshot.settings?.persistLogin)
            await api.storage.local.set({ credentials: previous });
        }
        await api.storage.local.set(snapshot);
        await invalidateAuth();
        await menus();
        await toolbar();
        throw error;
      } finally {
        authTransition = false;
        await notify();
        processQueue().catch(() => {});
      }
      return;
    }

    case 'settings':
      return changeSettings(message.patch ?? {});
    case 'capture': {
      const tab = message.tabId ? await api.tabs.get(message.tabId) : await activeTab();
      if (tab.url?.startsWith(extensionURL(''))) throw Error('SELECT_WEBPAGE_FIRST');
      if (message.kind === 'screenshot')
        return screenshot(tab, message.mode ?? (await settings()).screenshotMode, message);
      if (message.kind === 'element') {
        captures.set(tab.id, { ...message, accountId: owner, workspaceId: await workspaceId() });
        await content(tab.id, 'picker');
        return { picking: true };
      }
      return createDraft([await capturePage(tab, { kind: message.kind ?? 'page' })], message);
    }
    case 'capture.tabs': {
      const tabs = await api.tabs.query({ currentWindow: true }),
        ids = new Set(message.tabIds ?? []),
        items = [];
      for (const tab of tabs.filter(
        (tabOrTable) => ids.has(tabOrTable.id) && /^https?:/.test(tabOrTable.url ?? ''),
      ))
        items.push(await capturePage(tab));
      if (!items.length) throw Error('MATERIAL_REQUIRED');
      return createDraft(items, { forcePrompt: true });
    }
    case 'tabs':
      return (await api.tabs.query({ currentWindow: true }))
        .filter((tabOrTable) => /^https?:/.test(tabOrTable.url ?? ''))
        .map((tabOrTable) => ({
          id: tabOrTable.id,
          title: tabOrTable.title,
          url: cleanURL(tabOrTable.url),
        }));
    case 'basket.compose': {
      const items = (await all('materials')).filter((i) => i.inBasket && i.accountId === owner);
      if (!items.length) throw Error('MATERIAL_REQUIRED');
      return createDraft(items, { forcePrompt: true });
    }
    case 'basket.remove': {
      const item = await get('materials', message.id);
      if (item && item.accountId === owner) {
        item.inBasket = false;
        await put('materials', item);
      }
      await notify();
      return;
    }
    case 'draft.send': {
      if (!draftSends.has(message.id))
        draftSends.set(
          message.id,
          (async () => {
            const draft = await get('drafts', message.id);
            if (!draft || draft.accountId !== owner) throw Error('DRAFT_UNAVAILABLE');
            if (draft.jobId) return { jobId: draft.jobId };
            const jobId = await enqueue(draft);
            const session = await api.storage.session.get(null);
            for (const [key, value] of Object.entries(session))
              if (key.startsWith('composerDraft:') && value === draft.id)
                await api.storage.session.remove(key);
            return { jobId };
          })().finally(() => draftSends.delete(message.id)),
        );
      return draftSends.get(message.id);
    }
    case 'image.transform':
      if ((await get('materials', message.materialId))?.accountId !== owner)
        throw Error('MATERIAL_UNAVAILABLE');
      return offscreen({
        action: 'transform',
        materialId: message.materialId,
        index: message.index,
        rect: message.rect,
        operations: message.operations,
      });
    case 'pdf.extract':
      if ((await get('materials', message.materialId))?.accountId !== owner)
        throw Error('MATERIAL_UNAVAILABLE');
      return offscreen({ action: 'pdf', materialId: message.materialId, index: message.index });
    case 'archive.done': {
      const w = archiveWaiters.get(message.materialId);
      archiveWaiters.delete(message.materialId);
      if (message.error) w?.reject(Error('ARCHIVE_FAILED'));
      else w?.resolve(true);
      return;
    }
    case 'job.retry': {
      const job = await get('jobs', message.id);
      if (
        !job ||
        job.accountId !== owner ||
        job.workspaceId !== (await workspaceId()) ||
        job.state !== 'failed'
      )
        throw Error('JOB_NOT_RETRYABLE');
      job.state = 'queued';
      job.error = '';
      await saveJob(job);
      processQueue().catch(() => {});
      return;
    }
    case 'job.check': {
      const job = await get('jobs', message.id);
      if (!job || job.accountId !== owner || job.state !== 'uncertain')
        throw Error('JOB_NOT_UNCERTAIN');
      const result = await (
        await client()
      ).getSendStatus({ botId: job.botId, messageId: job.messageId, sessionId: job.sessionId });
      job.state = deliveryState(result.status);
      if (job.state === 'accepted') job.error = '';
      if (job.state === 'failed') job.error = result.rejectionCode || 'SEND_REFUSED';
      await saveJob(job);
      return result;
    }
    case 'job.cancel': {
      const job = await get('jobs', message.id);
      if (!job || job.accountId !== owner || !['queued', 'failed'].includes(job.state))
        throw Error('JOB_NOT_CANCELLABLE');
      job.state = 'cancelled';
      await saveJob(job);
      return;
    }
    case 'replies': {
      const b = (await botList()).find((b) => b.id === message.botId);
      return (await all('replies'))
        .filter(
          (r) => r.botId === message.botId && r.accountId === owner && r.sessionId === b?.sessionId,
        )
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-100);
    }
    case 'sidepanel':
      await openSidePanel({ windowId: message.windowId ?? (await activeTab()).windowId });
      return;
    default:
      throw Error('UNKNOWN_ACTION');
  }
}
api.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    message?.target === 'offscreen' ||
    message?.target === 'ui' ||
    ['state.changed', 'compose.ready', 'ui.navigate'].includes(message?.type)
  )
    return;
  handle(message, sender).then(
    (value) => respond({ ok: true, value }),
    (error) => respond({ ok: false, error: errorCode(error) }),
  );
  return true;
});
api.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  (async () => {
    const kind = info.selectionText
      ? 'selection'
      : info.mediaType === 'image'
        ? 'image'
        : info.mediaType === 'video'
          ? 'video'
          : info.linkUrl
            ? 'link'
            : 'page';
    const item = await capturePage(tab, {
      kind,
      selectionText: info.selectionText,
      linkUrl: info.linkUrl,
      srcUrl: info.srcUrl,
    });
    const botId = String(info.menuItemId).startsWith('bot:')
      ? String(info.menuItemId).slice(4)
      : undefined;
    await createDraft([item], {
      explicitBotId: botId,
      forcePrompt: ['choose-bot', 'send-note'].includes(info.menuItemId),
      basket: info.menuItemId === 'add-basket',
    });
  })().catch(async (e) => {
    await put('meta', { id: 'lastError', error: errorCode(e), createdAt: Date.now() });
    await api.action.setBadgeText({ text: '!' });
    await notify();
  });
});
api.commands.onCommand.addListener((command) => {
  (async () => {
    const tab = await activeTab();
    if (command === 'capture-region') await screenshot(tab, 'region');
    else if (command === 'send-page') await createDraft([await capturePage(tab)]);
    else if (command === 'quick-command')
      await api.windows.create({
        url: extensionURL('app.html?view=quick'),
        type: 'popup',
        width: 440,
        height: 620,
      });
  })().catch(async (e) => {
    await put('meta', { id: 'lastError', error: errorCode(e), createdAt: Date.now() });
    await notify();
  });
});
api.tabs.onActivated.addListener(async () => {
  await toolbar();
  await menus();
});
api.tabs.onUpdated.addListener((id, change, tab) => {
  if (tab.active && (change.status === 'complete' || change.url)) {
    toolbar(tab).catch(() => {});
    menus().catch(() => {});
  }
});
api.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'login') await pollLogin();
  if (alarm.name === 'outbox' && !processing) {
    await recover();
    processQueue().catch(() => {});
  }
  if (alarm.name === 'cleanup') await prune((await settings()).retentionDays);
});
async function recover() {
  let running = [];
  if (await hasProcessingDocument())
    try {
      running = await offscreen({ action: 'jobs.status' });
    } catch {}
  for (const j of await all('jobs'))
    if (j.state === 'submitting' && !running.includes(j.id)) {
      j.state = 'uncertain';
      j.error = 'SEND_UNCONFIRMED';
      await saveJob(j);
    }
}
async function clearReplies(botId, owner, sessionId) {
  for (const row of await all('replies'))
    if (
      row.botId === botId &&
      row.accountId === owner &&
      (!sessionId || row.sessionId === sessionId)
    )
      await remove('replies', row.id);
}
async function watchReplies(port, bot, owner, signal) {
  const key = `cursor:${owner}:${bot.id}:${bot.sessionId}`;
  let attempt = 0,
    backfill = true;
  const post = (message) => {
    if (signal.aborted) return false;
    try {
      port.postMessage(message);
      return true;
    } catch {
      return false;
    }
  };
  const saveMessage = async (message) => {
    const id = `${owner}:${bot.id}:${bot.sessionId}:${message.entryId}`;
    const prev = await get('replies', id);
    await put('replies', {
      id,
      accountId: owner,
      botId: bot.id,
      sessionId: bot.sessionId,
      text: message.text,
      createdAt: prev?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });
  };
  while (!signal.aborted) {
    try {
      if ((await accountId()) !== owner) return;
      const c = await client();
      let saved = await get('meta', key),
        cursor;
      if (backfill || !saved) {
        const history = await c.listTranscript({
          botId: bot.id,
          sessionId: bot.sessionId,
          limit: 100,
        });
        if (signal.aborted) return;
        await clearReplies(bot.id, owner, bot.sessionId);
        for (const row of history.messages.sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : 1)))
          await saveMessage(row);
        cursor = history.cursor;
        saved = null;
        backfill = false;
        await put('meta', { id: key, cursorState: cursor, accountId: owner });
        if (!post({ type: 'event', event: { type: 'history' } })) return;
      } else cursor = saved.cursorState;
      for await (const event of c.watchBot({
        botId: bot.id,
        sessionId: bot.sessionId,
        ...(saved?.cursor ? { resumeFrom: saved.cursor } : { cursor }),
        signal,
      })) {
        if (signal.aborted) return;
        attempt = 0;
        if (event.id) await put('meta', { id: key, cursor: event.id, accountId: owner });
        if (event.type === 'message')
          await saveMessage({ entryId: event.data.entryId, text: event.data.text });
        if (event.type === 'message.deleted')
          await remove('replies', `${owner}:${bot.id}:${bot.sessionId}:${event.data.entryId}`);
        if (['reset', 'resync-required'].includes(event.type)) {
          await clearReplies(bot.id, owner, bot.sessionId);
          await remove('meta', key);
          backfill = true;
          post({ type: 'event', event });
          break;
        }
        if (!post({ type: 'event', event })) return;
      }
    } catch (e) {
      if (signal.aborted) return;
      if (!post({ type: 'error', error: errorCode(e) })) return;
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)));
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
api.runtime.onConnect.addListener((port) => {
  if (port.name !== 'replies' || !port.sender?.url?.startsWith(extensionURL(''))) return;
  let control;
  const watchKey = crypto.randomUUID();
  port.onMessage.addListener((m) => {
    if (m.type !== 'watch') return;
    control?.abort();
    control = new AbortController();
    watchers.set(watchKey, control);
    const signal = control.signal;
    (async () => {
      const bot = (await botList()).find((b) => b.id === m.botId),
        owner = await accountId();
      if (bot && owner) await watchReplies(port, bot, owner, signal);
    })().catch((e) => {
      try {
        port.postMessage({ type: 'error', error: errorCode(e) });
      } catch {}
    });
  });
  port.onDisconnect.addListener(() => {
    control?.abort();
    watchers.delete(watchKey);
  });
});
async function init() {
  await protectStorage();
  await initI18n({ api, locale: (await settings()).language || 'auto', document: null });
  await api.alarms.create('outbox', { periodInMinutes: 0.5 });
  await api.alarms.create('cleanup', { periodInMinutes: 60 });
  await recover();
  await menus();
  await toolbar();
  processQueue().catch(() => {});
}
api.runtime.onInstalled.addListener(() => init().catch(() => {}));
api.runtime.onStartup.addListener(() => init().catch(() => {}));
init().catch(() => {});
