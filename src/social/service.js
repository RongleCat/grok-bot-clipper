import { t } from '../i18n/index.js';
export function displayBot(bot) {
  return bot
    ? {
        id: bot.id,
        name: bot.name || 'BOT',
        avatarShape: bot.avatarShape,
        avatarColor: bot.avatarColor,
        avatar: bot.avatar
          ? {
              character: bot.avatar.character,
              picture: bot.avatar.picture ? { url: bot.avatar.picture.url } : null,
            }
          : undefined,
      }
    : null;
}
export function createSocialService(deps) {
  const pending = new Map();
  async function targets() {
    let scope;
    try {
      scope = await deps.scope();
    } catch {}
    const settings = await deps.settings(),
      bots = await deps.bots();
    return {
      authenticated: Boolean(scope?.accountId),
      language: settings.language || 'auto',
      askBeforeSend: settings.askBeforeSend,
      primary: displayBot(bots.find((b) => b.id === settings.defaultBotId)),
      favorites: (settings.favorites || [])
        .map((id) => bots.find((b) => b.id === id))
        .filter(Boolean)
        .map(displayBot),
    };
  }
  async function request(id, tabId) {
    const row = await deps.loadRequest(id);
    if (!row || Date.now() - row.createdAt > 30 * 60 * 1000) throw Error('SHARE_EXPIRED');
    if (row.embedded && row.tabId !== tabId) throw Error('UNTRUSTED_SENDER');
    if (!(await deps.allowed(row.scope))) throw Error('ACCOUNT_CHANGED');
    return row;
  }
  async function deliver(record, botId, scope, windowId, instruction = '', draftId) {
    if (!(await deps.allowed(scope))) throw Error('ACCOUNT_CHANGED');
    if (!(await deps.bots()).some((b) => b.id === botId)) throw Error('BOT_UNAVAILABLE');
    const settings = await deps.settings();
    const item = await deps.assemble(record, { maxAttachmentBytes: settings.maxAttachmentBytes });
    if (!(await deps.allowed(scope))) throw Error('ACCOUNT_CHANGED');
    if (
      record.platform === 'xiaohongshu' &&
      record.hasVideo &&
      !item.social?.completeness?.attachedVideos
    ) {
      if (item.warnings?.some((w) => w.includes('VIDEO_ENCRYPTED_FORMAT')))
        throw Error('SOCIAL_VIDEO_ENCRYPTED');
      throw Error(
        record.videos?.length ? 'SOCIAL_VIDEO_DOWNLOAD_FAILED' : 'SOCIAL_VIDEO_NOT_CAPTURED',
      );
    }
    Object.assign(item, {
      id: crypto.randomUUID(),
      accountId: scope.accountId,
      sourceWindowId: windowId,
    });
    await deps.saveMaterial(item);
    if (!(await deps.allowed(scope))) throw Error('ACCOUNT_CHANGED');
    const result = await deps.submit([item], {
      explicitBotId: botId,
      instruction,
      sendNow: true,
      expectedScope: scope,
      draftId,
      windowId,
    });
    return { ...result, warnings: item.warnings || [] };
  }
  async function capture(
    record,
    { botId, chooseBot = false, windowId, embedded = false, tabId } = {},
  ) {
    const scope = await deps.scope(),
      settings = await deps.settings();
    if (
      !chooseBot &&
      botId &&
      ![settings.defaultBotId, ...(settings.favorites || [])].includes(botId)
    )
      throw Error('BOT_UNAVAILABLE');
    if (chooseBot || settings.askBeforeSend || !botId) {
      if (embedded && !Number.isInteger(tabId)) throw Error('UNTRUSTED_SENDER');
      const row = {
        id: crypto.randomUUID(),
        scope,
        record,
        selectedBotId: botId || '',
        windowId,
        embedded,
        tabId,
        createdAt: Date.now(),
      };
      await deps.saveRequest(row);
      if (embedded) return { pickerId: row.id };
      await deps.openPopup(row.id);
      return { pickerOpened: true };
    }
    return deliver(record, botId, scope, windowId);
  }
  async function pickerState(id, tabId) {
    const row = await request(id, tabId),
      settings = await deps.settings();
    return {
      bots: (await deps.bots()).map(displayBot),
      favorites: settings.favorites || [],
      primaryId: settings.defaultBotId,
      selectedBotId: row.selectedBotId || settings.defaultBotId || '',
      askBeforeSend: settings.askBeforeSend,
      theme: settings.theme || 'system',
      language: settings.language || 'auto',
      post: {
        title:
          row.record?.title ||
          row.record?.text?.split('\n')[0]?.slice(0, 100) ||
          row.post?.title ||
          t('分享内容'),
        url: row.record?.url || row.post?.url || '',
      },
      jobId: row.jobId,
    };
  }
  async function pickerSend(id, botId, instruction = '', tabId) {
    await request(id, tabId);
    if (pending.has(id)) return pending.get(id);
    const work = (async () => {
      const row = await request(id, tabId);
      if (row.jobId) return { jobId: row.jobId };
      if (typeof instruction !== 'string' || instruction.length > 200000)
        throw Error('INSTRUCTION_TOO_LARGE');
      const result = await deliver(row.record, botId, row.scope, row.windowId, instruction, row.id);
      await deps.saveRequest({
        ...row,
        selectedBotId: botId,
        post: {
          title: row.record.title || row.record.text?.slice(0, 100) || t('分享内容'),
          url: row.record.url,
        },
        record: null,
        jobId: result.jobId,
      });
      return result;
    })();
    pending.set(id, work);
    try {
      return await work;
    } finally {
      pending.delete(id);
    }
  }
  return { targets, capture, pickerState, pickerSend };
}
