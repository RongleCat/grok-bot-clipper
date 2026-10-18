import {
  t,
  setLocale,
  getLocale,
  getCatalog,
  initI18n,
  supportedLocales,
  formatDate,
  formatNumber,
} from '../i18n/index.js';
import { api, isFirefox, openSidePanel, shortcutsURL } from '../platform/browser.js';
import { trackSettingsNavigation } from './navigation.js';
import { escapeHTML as esc, field, settingsSection, disclosure } from './components.js';
import { createMarkdownRenderer } from './markdown.js';
import { icon } from './icons.js';
import { searchBots } from './bot-search.js';
import { mountAvatars, releaseAvatars } from './avatars.js';
import { get, put, all, remove } from '../core/db.js';
import { DEFAULT_SETTINGS, PRESETS, packContext, safeName, cleanURL } from '../core/context.js';
const q = new URLSearchParams(location.search),
  isPopup = location.pathname.endsWith('/popup.html'),
  isSide = location.pathname.endsWith('/sidepanel.html');
let view = q.get('view') || (isSide ? 'replies' : 'home'),
  model = { settings: DEFAULT_SETTINGS, bots: [], basket: [], jobs: [] },
  draft = null,
  items = [],
  sourceTabId,
  sourceWindowId,
  reconnectTimer,
  selectedBotId = '',
  port,
  toastTimer,
  draftTimer,
  repliesRevision = 0,
  navigationRevision = 0;
let shortcuts = [],
  busy = false,
  stopSettingsNavigation = () => {};
const root = document.querySelector('#app');
document.body.className = isPopup ? 'popup' : isSide ? 'sidepanel' : 'workspace';
const renderMarkdown = createMarkdownRenderer(window);
const size = (n) =>
  n >= 1048576
    ? formatNumber(n / 1048576, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' MB'
    : n >= 1024
      ? formatNumber(Math.ceil(n / 1024)) + ' KB'
      : formatNumber(n) + ' B';
const labels = {
  get queued() {
    return t('等待发送');
  },
  get uploading() {
    return t('上传中');
  },
  get submitting() {
    return t('正在提交');
  },
  get accepted() {
    return t('已受理');
  },
  get uncertain() {
    return t('投递待确认');
  },
  get failed() {
    return t('发送失败');
  },
  get cancelled() {
    return t('已取消');
  },
};
const errors = {
  get LOGIN_REQUIRED() {
    return t('请先登录');
  },
  get INVALID_SOCIAL_POST() {
    return t('无法确认帖子身份，请打开帖子详情后重试');
  },
  get SOCIAL_POST_NOT_LOADED() {
    return t('帖子还未加载完整，请刷新原页面后重试');
  },
  get BOT_REQUIRED() {
    return t('请选择 BOT');
  },
  get BOT_UNAVAILABLE() {
    return t('所选 BOT 不可用，请重新选择');
  },
  get PAGE_ACCESS_REQUIRED() {
    return t('需要此页面的访问权限');
  },
  get SELECT_WEBPAGE_FIRST() {
    return t('请先打开要采集的网页');
  },
  get MATERIAL_REQUIRED() {
    return t('请先添加材料或输入说明');
  },
  get ATTACHMENT_TOO_LARGE() {
    return t('附件超过大小上限');
  },
  get ATTACHMENT_SIZE_INVALID() {
    return t('附件为空或超过 128 MB');
  },
  get ACCOUNT_AUTH_FAILED() {
    return t('授权已失效，请重新登录');
  },
  get ACCOUNT_CHANGED() {
    return t('账户已切换，任务已暂停');
  },
  get INVALID_CAPTURE_REGION() {
    return t('选区无效，请重新框选');
  },
  get CAPTURE_VIEWPORT_CHANGED() {
    return t('框选后页面尺寸或滚动位置发生变化，请重试');
  },
  get CAPTURE_TAB_CHANGED() {
    return t('截图期间页面已切换，请重试');
  },
  get UPLOAD_MODE_UNAVAILABLE() {
    return t('服务端暂未提供可用上传方式');
  },
  get ATTACHMENT_HOST_UNAVAILABLE() {
    return t('BOT 文件主机暂未就绪，请稍后重试');
  },
  get SEND_UNCONFIRMED() {
    return t('投递结果待确认，请检查状态');
  },
  get UPLOAD_PUT_FAILED() {
    return t('附件上传失败，请检查网站访问权限后重试');
  },
  get LOGIN_TIMED_OUT() {
    return t('授权超时，请重新登录');
  },
  get LOGIN_POLL_FAILED() {
    return t('无法完成授权，请重试');
  },
  get CONTEXT_INDEX_TOO_LARGE() {
    return t('材料目录超过文本预算，请提高预算或分批发送');
  },
  get INSTRUCTION_TOO_LARGE() {
    return t('说明超过文本预算，请缩短说明');
  },
  get PACKAGE_TOO_LARGE() {
    return t('材料总量超过 512 MB，请分批发送');
  },
};
const rpcActionLabels = {
  get settings() {
    return t('保存设置');
  },
  get ['bots.refresh']() {
    return t('刷新 BOT');
  },
  get ['composer.open.saved']() {
    return t('打开草稿');
  },
  get ['basket.remove']() {
    return t('移除材料');
  },
  get ['sidepanel.navigate']() {
    return t('打开侧栏对话');
  },
  get ['draft.send']() {
    return t('发送草稿');
  },
  get ['capture.target']() {
    return t('读取当前网页');
  },
  get state() {
    return t('读取扩展状态');
  },
};
const errorText = (error) => {
  const code = String(error?.message ?? error ?? t('操作失败'));
  if (code === 'UNKNOWN_ACTION')
    return t('后台未识别“{action}”，请重新加载扩展后重试', {
      action: rpcActionLabels[error?.action] || t('此操作'),
    });
  return (
    errors[code] ||
    (/^UPLOAD_REFUSED_/.test(code)
      ? t('服务端拒绝此附件，请检查文件大小、类型与 BOT 存储空间')
      : /^UPLOAD_/.test(code)
        ? t('附件上传未完成，请重试')
        : t('操作失败（{code}）', { code }))
  );
};
const shortTime = (n) =>
  formatDate(n || Date.now(), {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const avatar = (id, large = false, renderSize = large ? 76 : 48) =>
  `<span class="avatar ${large ? 'large' : ''}" data-avatar="${esc(id)}" data-size="${renderSize}" aria-hidden="true"></span>`;
const btn = (action, title, i, cls = 'icon-button') =>
  `<button class="${cls}" data-action="${action}" title="${esc(title)}" aria-label="${esc(title)}">${icon(i)}</button>`;
const bot = () =>
  model.bots.find((b) => b.id === (draft?.botId || selectedBotId || model.settings.defaultBotId));
async function rpc(type, extra = {}) {
  const r = await api.runtime.sendMessage({ type, ...extra });
  if (!r?.ok) {
    const error = Error(r?.error || 'CONNECTION_FAILED');
    error.action = type;
    throw error;
  }
  return r.value;
}
function toast(text) {
  clearTimeout(toastTimer);
  const dialog = document.querySelector('dialog[open]');
  let el;
  if (dialog) {
    el = dialog.querySelector('[data-dialog-status]');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('data-dialog-status', '');
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.className = 'notice';
      el.style.flexShrink = '0';
      dialog.append(el);
    }
  } else el = document.querySelector('#toast');
  if (el) el.textContent = text;
  toastTimer = setTimeout(() => {
    if (dialog) el?.remove();
    else if (el) el.textContent = '';
  }, 4500);
}
function onUIEvent(handler) {
  return async (event) => {
    try {
      // Invoke immediately so browser actions retain the original user gesture.
      await handler(event);
    } catch (error) {
      toast(errorText(error));
    }
  };
}
function mount() {
  mountAvatars(root, model.bots);
}
function switcher(compact = false) {
  const b = bot();
  return `<button class="bot-switch ${compact ? 'bot-switch--compact' : ''}" data-action="pick-bot" aria-label="${esc(t('选择 BOT：{name}', { name: b?.name || t('未选择') }))}" title="${esc(b?.name || t('选择 BOT'))}">${b ? avatar(b.id, false, compact ? 32 : 48) : icon('plus', compact ? 24 : 36)}<span class="bot-name">${esc(b?.name || t('选择 BOT'))}</span><span class="chev">${icon('chevron', 18)}</span></button>`;
}
function top() {
  const action = (id, label, glyph, active = false) =>
    `<button class="icon-button toolbar-action" data-action="${id}" title="${esc(label)}" aria-label="${esc(label)}" ${active ? 'aria-current="page"' : ''}>${icon(glyph, 18)}<span>${esc(label)}</span></button>`;
  return `<header class="topbar">${model.authenticated ? switcher(true) : '<span class="brand">Grok Bot Clipper</span>'}<div class="top-actions">${!['home', 'compose', 'replies'].includes(view) ? btn('home', t('返回首页'), 'back') : ''}${action('resume-compose', t('草稿箱'), 'drafts', view === 'drafts' || view === 'compose')}${view === 'compose' ? action('preview-packet', t('发送预览'), 'preview') : ''}${action('replies', t('BOT 对话'), 'reply', view === 'replies')}${btn('settings', t('设置'), 'settings')}</div></header>`;
}
function shell(content, footer = '', head = '') {
  stopSettingsNavigation();
  stopSettingsNavigation = () => {};
  if (isSide && ['drafts', 'compose', 'replies'].includes(view)) {
    const saved = { ['sidepanelView:' + sourceWindowId]: view };
    if (view === 'compose' && draft) saved['composerDraft:' + sourceWindowId] = draft.id;
    api.storage.session.set(saved).catch(() => {});
  }
  document.body.dataset.view = view;
  root.innerHTML = `<div class="shell">${top()}${head}<main id="panel">${content}</main>${footer}</div><dialog id="bot-dialog" aria-label="${esc(t('选择 BOT'))}"></dialog><div id="toast" class="toast" role="status" aria-live="polite"></div>`;
  const dialog = root.querySelector('dialog');
  dialog.addEventListener('close', () => {
    if (!dialog.open) releaseAvatars(dialog);
  });
  mount();
}
function authView() {
  shell(
    `<div class="login">${avatar('brand', true)}<h1>Grok Bot Clipper</h1>${model.loginPending ? `<button class="primary loading" disabled><span class="spinner"></span>${esc(t('等待浏览器授权'))}</button><div class="bottom-actions"><button class="text-button" data-action="login-cancel">${esc(t('取消'))}</button></div>` : `<button class="primary" data-action="login">${esc(t('授权登录'))} ${icon('arrow', 17)}</button>`}${model.loginError ? `<p class="notice error" role="alert">${esc(errorText(model.loginError))}</p>` : ''}</div>`,
  );
  const hero = root.querySelector('[data-avatar="brand"]');
  if (hero) mountAvatars(root, [{ id: 'brand', avatarShape: 'blob', avatarColor: 'black' }]);
}
function toggle(key, value, label) {
  return `<button class="toggle" role="switch" aria-checked="${Boolean(value)}" id="setting-${key}" data-toggle="${key}" aria-label="${esc(label)}"></button>`;
}
function commandKey(name) {
  const shortcut = shortcuts.find((c) => c.name === name)?.shortcut;
  if (!shortcut) return '';
  const glyphs = {
    Command: ['command', 'Command'],
    Shift: ['shift', 'Shift'],
    Alt: ['option', 'Option'],
    MacCtrl: [null, 'Control'],
    Ctrl: [null, 'Ctrl'],
  };
  return `<span class="shortcut-keys" role="group" aria-label="${esc(shortcut)}">${shortcut
    .split('+')
    .map((key) => {
      const [glyph, label] = glyphs[key] || [null, key];
      return `<kbd title="${esc(label)}" aria-label="${esc(label)}">${glyph ? icon(glyph, 16) : esc(label)}</kbd>`;
    })
    .join('')}</span>`;
}
function home() {
  const groups = [
    [
      t('截图'),
      [
        ['capture-region', t('框选截图'), 'capture'],
        ['capture-viewport', t('可见区域'), 'viewport'],
        ['capture-full', t('长截图'), 'fullpage'],
      ],
    ],
    [
      t('网页与文件'),
      [
        ['save-page', t('保存网页'), 'page'],
        ['element', t('采集元素'), 'element'],
        ['tabs', t('多标签页'), 'tabs'],
        ['video', t('视频时间点'), 'video'],
        ['page-basket', t('网页入篮'), 'basket'],
        ['file', t('添加文件'), 'upload'],
      ],
    ],
    [
      t('材料管理'),
      [
        ['basket', t('材料篮') + (model.basket.length ? ' ' + model.basket.length : ''), 'basket'],
        ['history', t('发送记录'), 'history'],
      ],
    ],
  ];
  shell(
    `<div class="utility-row"><span>${esc(t('发送前补充说明'))}</span>${toggle('askBeforeSend', model.settings.askBeforeSend, t('发送前补充说明'))}</div>${groups.map(([title, tools]) => `<section class="tool-group"><h2>${esc(title)}</h2><div class="home-tools">${tools.map(([action, label, glyph]) => `<button class="home-tool" data-action="${action}">${icon(glyph, 22)}<span>${esc(label)}</span></button>`).join('')}</div></section>`).join('')}`,
  );
}
function titleRow(title, actions = '') {
  return `<div class="row between"><h1>${esc(title)}</h1>${actions}</div>`;
}
function captureOptions() {
  shell(
    `${titleRow(t('采集'))}<div class="quick-actions" style="margin-top:20px">${[
      ['capture-region', t('框选截图'), 'capture'],
      ['capture-viewport', t('可见区域截图'), 'viewport'],
      ['capture-full', t('长截图'), 'fullpage'],
      ['element', t('采集元素'), 'element'],
      ['video', t('视频时间点'), 'video'],
      ['page-basket', t('将网页加入材料篮'), 'basket'],
      ['file', t('添加文件'), 'upload'],
    ]
      .map(
        ([a, t, i]) =>
          `<button class="quick-action" data-action="${a}">${icon(i)}${esc(t)}</button>`,
      )
      .join('')}</div>`,
  );
}
function settingsView() {
  const s = model.settings;
  const botName = (id, fallback = t('使用默认 BOT')) =>
    esc(model.bots.find((b) => b.id === id)?.name || fallback);
  const select = (id, key, values, current) =>
    `<select id="${id}" data-setting="${key}" aria-describedby="${id}-hint">${values.map(([v, label]) => `<option value="${v}" ${current === v ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
  const setting = (id, label, description, control) => field({ id, label, description, control });
  const switchField = (key, label, description) =>
    setting(`setting-${key}`, label, description, toggle(key, s[key], label));
  const numberField = (id, key, label, description, value, min, max, unit) =>
    setting(
      id,
      label,
      description,
      `<div class="number-control"><input id="${id}" type="number" min="${min}" max="${max}" step="1" data-setting="${key}" value="${value}" aria-describedby="${id}-hint ${id}-error"><span>${esc(unit)}</span></div>`,
    );
  const routeField = (action, label) =>
    setting(
      `route-${action}`,
      label,
      t('未单独分配时，使用默认 BOT。'),
      `<div class="route-control"><button id="route-${action}" class="secondary" data-route-pick="action:${action}">${botName(s.actionBots[action])}${icon('chevron', 14)}</button>${s.actionBots[action] ? `<button class="icon-button small" data-reset-route="${action}" aria-label="${esc(t('{label}恢复默认 BOT', { label }))}">${icon('undo', 14)}</button>` : ''}</div>`,
    );
  const groups = [
    [
      'send',
      t('发送方式'),
      t('选择默认接收对象，以及发送前如何补充说明。'),
      setting(
        'default-bot',
        t('默认 BOT'),
        t('没有指定接收对象时，材料会发送给这个 BOT。'),
        `<button id="default-bot" class="secondary" data-action="pick-default">${botName(s.defaultBotId, t('选择 BOT'))}${icon('chevron', 14)}</button>`,
      ) +
        switchField(
          'askBeforeSend',
          t('发送前补充说明'),
          t('采集后先打开草稿，确认材料和说明后再发送。'),
        ) +
        setting(
          'composer-surface',
          t('草稿打开位置'),
          t('选择在侧栏或独立窗口中编辑草稿。'),
          select(
            'composer-surface',
            'composerSurface',
            [
              ['sidepanel', t('浏览器侧栏')],
              ['window', t('独立窗口')],
            ],
            s.composerSurface || 'sidepanel',
          ),
        ) +
        setting(
          'task-preset',
          t('默认任务'),
          t('为新材料预选处理方式，发送时仍可修改。'),
          select(
            'task-preset',
            'taskPreset',
            PRESETS.map(([id]) => [id, presetLabels[id]]),
            s.taskPreset,
          ),
        ),
    ],
    [
      'capture',
      t('采集与上下文'),
      t('决定附带哪些内容，以及材料的大小限制。'),
      setting(
        'screenshot-mode',
        t('默认截图方式'),
        t('通过快捷键或默认截图入口触发时使用。'),
        select(
          'screenshot-mode',
          'screenshotMode',
          [
            ['region', t('框选截图')],
            ['viewport', t('可见区域')],
            ['full', t('长截图')],
          ],
          s.screenshotMode,
        ),
      ) +
        switchField(
          'includeSource',
          t('来源与采集时间'),
          t('附带网页链接、标题和采集时间，方便追溯。'),
        ) +
        switchField('includeNearby', t('选区附近段落'), t('采集选中文字时，附带附近段落。')) +
        switchField(
          'includePageContext',
          t('选区所在页面正文'),
          t('同时提供整页正文，帮助 BOT 理解上下文。'),
        ) +
        switchField(
          'archiveMHTML',
          t('网页归档'),
          isFirefox
            ? t('额外附带正文 HTML 文件，不包含原网页布局及未加载媒体。')
            : t('额外附带 MHTML 文件，保留网页原貌。'),
        ) +
        numberField(
          'text-budget',
          'maxTextBytes',
          t('消息文本上限'),
          t('材料与说明合计的 UTF-8 文本预算。'),
          s.maxTextBytes,
          4096,
          120000,
          t('字节'),
        ) +
        numberField(
          'file-limit',
          'maxAttachmentMB',
          t('单个附件上限'),
          t('超过此大小的附件不会加入发送任务。'),
          s.maxAttachmentBytes / 1048576,
          1,
          128,
          'MB',
        ) +
        numberField(
          'height-limit',
          'maxScrollHeight',
          t('长截图高度上限'),
          t('限制长页面截图的最大高度。'),
          s.maxScrollHeight,
          1000,
          30000,
          'px',
        ),
    ],
    [
      'routing',
      t('BOT 路由'),
      t('按材料类型或网站自动分配接收对象。'),
      routeField('screenshot', t('截图接收 BOT')) +
        routeField('page', t('网页接收 BOT')) +
        `<div class="rules-heading"><div><h3>${esc(t('网站规则'))}</h3><p class="field-description">${esc(t('匹配网站域名后，优先发送给指定 BOT。'))}</p></div><button class="secondary" data-action="add-rule">${icon('plus', 14)}${esc(t('添加规则'))}</button></div><div id="rules">${(s.rules || []).map((r, i) => `<div class="rules-row"><label class="sr-only" for="rule-${i}">${esc(t('网站域名'))}</label><input id="rule-${i}" data-rule-host="${i}" aria-label="${esc(t('网站域名'))}" value="${esc(r.host)}" placeholder="example.com"><button class="secondary" data-route-pick="rule:${i}">${botName(r.botId, t('选择 BOT'))}${icon('chevron', 14)}</button><button class="icon-button small" data-delete-rule="${i}" aria-label="${esc(t('删除 {host} 规则', { host: r.host }))}">${icon('close', 14)}</button></div>`).join('') || `<p class="rules-empty">${esc(t('还没有网站规则。添加域名，为常用网站指定 BOT。'))}</p>`}</div>`,
    ],
    [
      'local',
      t('外观与本机数据'),
      t('调整显示方式、材料保留时间和访问权限。'),
      setting(
        'language',
        t('界面语言'),
        t('自动跟随浏览器，或选择你偏好的语言。'),
        select(
          'language',
          'language',
          [['auto', t('跟随浏览器')], ...supportedLocales.map(({ code, name }) => [code, name])],
          s.language || 'auto',
        ),
      ) +
        setting(
          'theme',
          t('外观'),
          t('浅色、深色或跟随系统。'),
          select(
            'theme',
            'theme',
            [
              ['system', t('跟随系统')],
              ['light', t('浅色')],
              ['dark', t('深色')],
            ],
            s.theme,
          ),
        ) +
        numberField(
          'retention',
          'retentionDays',
          t('材料保留时间'),
          t('过期的本机材料会自动清理。'),
          s.retentionDays,
          1,
          90,
          t('天'),
        ) +
        switchField('persistLogin', t('浏览器重启后保持登录'), t('在这台浏览器中保留登录状态。')) +
        setting(
          'permissions-button',
          t('跨网站采集权限'),
          t('允许采集多个网站的页面内容。'),
          `<button id="permissions-button" class="secondary" data-action="permissions">${esc(t('管理授权'))}</button>`,
        ),
    ],
    [
      'shortcuts',
      t('快捷键'),
      t('在任意网页快速开始采集或打开命令。'),
      [
        ['capture-region', t('框选截图')],
        ['send-page', t('保存网页')],
        ['quick-command', t('快捷命令')],
      ]
        .map(
          ([id, label]) =>
            `<div class="form-row"><span>${esc(label)}</span>${commandKey(id) || `<span class="subtle">${esc(t('未设置'))}</span>`}</div>`,
        )
        .join('') +
        '<div class="section-actions"><button class="secondary" data-action="shortcuts">' +
        (isFirefox ? t('查看快捷键设置方法') : t('打开浏览器快捷键设置')) +
        icon('arrow', 14) +
        '</button></div>',
    ],
    [
      'account',
      t('账户与工作区'),
      t('管理当前账户、工作区和 BOT 列表。'),
      setting(
        'account-name',
        t('当前账户'),
        t('当前已授权的浏览器账户。'),
        `<span id="account-name" class="account-name">${esc(model.account?.name || t('已登录'))}</span>`,
      ) +
        (model.teams?.length
          ? setting(
              'workspace',
              t('工作区'),
              t('切换后，BOT 列表会同步更新。'),
              `<select id="workspace" data-workspace><option value="personal" ${model.workspaceId === 'personal' ? 'selected' : ''}>${esc(t('个人'))}</option>${model.teams.map((t) => `<option value="${esc(t.id)}" ${model.workspaceId === String(t.id) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`,
            )
          : '') +
        `<div class="section-actions"><button class="secondary" data-action="bots-refresh">${icon('refresh', 14)}${esc(t('刷新 BOT 列表'))}</button><button class="danger" data-action="logout">${esc(t('退出登录'))}</button></div>${model.rosterTruncated ? `<p class="warning">${esc(t('服务端返回的 BOT 列表不完整。'))}</p>` : ''}`,
    ],
  ];
  shell(
    `<div class="settings-title"><div><h1>${esc(t('设置'))}</h1><p>${esc(t('为你的采集和对话设置默认行为。'))}</p></div><span id="settings-save-state" role="status">${esc(t('修改后自动保存'))}</span></div><div class="settings-layout"><nav class="settings-nav" aria-label="${esc(t('设置分类'))}">${groups.map(([id, title], i) => `<a href="#settings-${id}" ${i === 0 ? 'aria-current="location"' : ''}>${esc(title)}</a>`).join('')}</nav><div class="settings-content">${groups.map(([id, title, description, content]) => settingsSection(id, title, description, content)).join('')}</div></div>`,
  );
  stopSettingsNavigation = trackSettingsNavigation({
    nav: root.querySelector('.settings-nav'),
    sections: [...root.querySelectorAll('.settings-section')],
    scroller: isPopup ? root.querySelector('#panel') : window,
  });
}
function settingsSaved() {
  const status = document.querySelector('#settings-save-state');
  if (status) status.textContent = t('已自动保存');
}
const presetLabels = {
  get ['']() {
    return t('直接发送');
  },
  get summary() {
    return t('总结');
  },
  get explain() {
    return t('解释');
  },
  get compare() {
    return t('比较');
  },
  get notes() {
    return t('笔记');
  },
  get review() {
    return t('审查');
  },
  get translate() {
    return t('翻译');
  },
};
function presetOptions(selected) {
  return PRESETS.map(
    ([id]) =>
      `<option value="${id}" ${selected === id ? 'selected' : ''}>${esc(presetLabels[id])}</option>`,
  ).join('');
}
function basketView() {
  shell(
    `${titleRow(t('材料篮'), `<span class="count">${model.basket.length}</span>`)}${model.basket.length ? model.basket.map((i) => `<article class="list-item"><div class="row between"><span class="list-title">${esc(i.title || t('材料'))}</span><button class="icon-button small" data-remove-material="${esc(i.id)}" aria-label="${esc(t('移出材料篮'))}">${icon('close', 15)}</button></div><div class="list-meta">${esc(i.url)}</div><div class="list-meta">${shortTime(i.createdAt)}${i.attachmentCount ? ' · ' + esc(t('{count} 个附件', { count: i.attachmentCount })) : ''}</div></article>`).join('') : `<div class="empty">${esc(t('材料篮为空'))}</div>`}<div class="bottom-actions"><button class="secondary" data-action="file">${icon('plus', 16)}${esc(t('添加文件'))}</button><button class="primary" data-action="basket-compose" ${model.basket.length ? '' : 'disabled'}>${esc(t('组合发送'))} ${icon('send', 16)}</button></div>`,
  );
}
function historyView() {
  shell(
    `${titleRow(t('发送记录'))}${model.jobs.length ? model.jobs.map((j) => `<article class="list-item"><div class="list-title">${esc(j.title)}</div><div class="list-meta">${esc(j.botName || 'BOT')} · ${shortTime(j.createdAt)} · ${esc(t('{count} 个附件', { count: j.attachmentCount }))}</div><div class="row between" style="margin-top:8px"><span class="subtle ${j.state === 'failed' ? 'error' : ''}">${esc(labels[j.state] || j.state)}</span><div class="item-actions">${j.state === 'failed' ? `<button class="text-button" data-retry-job="${j.id}">${esc(t('重试'))}</button>` : ''}${j.state === 'uncertain' ? `<button class="text-button" data-check-job="${j.id}">${esc(t('检查状态'))}</button>` : ''}<button class="text-button" data-open-job="${j.id}">${esc(t('详情'))}</button></div></div>${j.error ? `<div class="warning">${esc(errorText(j.error))}${j.limitBytes ? esc(t('（服务端上限 {size}）', { size: size(j.limitBytes) })) : ''}</div>` : ''}</article>`).join('') : `<div class="empty">${esc(t('还没有发送记录'))}</div>`}`,
  );
}
async function tabsView() {
  shell(`${titleRow(t('选择标签页'))}<div class="notice"><span class="spinner"></span></div>`);
  const tabs = await rpc('tabs');
  document.querySelector('#panel').innerHTML =
    `${titleRow(t('选择标签页'))}<div class="tabs-list">${tabs.map((t) => `<label class="tab-choice"><input type="checkbox" name="tab" value="${t.id}" ${t.id === sourceTabId ? 'checked' : ''}><span><span class="list-title">${esc(t.title || t.url)}</span><div class="list-meta">${esc(t.url)}</div></span></label>`).join('')}</div><div class="bottom-actions"><button class="primary" data-action="tabs-capture">${esc(t('采集所选网页'))}</button></div>`;
}
function quickView() {
  shell(
    `${switcher()}<div class="quick-actions">${[
      ['screenshot', t('截图'), 'capture'],
      ['save-page', t('保存网页'), 'page'],
      ['element', t('采集元素'), 'element'],
      ['tabs', t('多标签页'), 'tabs'],
      ['basket', t('材料篮'), 'basket'],
    ]
      .map(
        ([a, t, i]) =>
          `<button class="quick-action" data-action="${a}">${icon(i)}${esc(t)}</button>`,
      )
      .join('')}</div>`,
  );
}
async function draftsView() {
  const drafts = (await all('drafts'))
    .filter(
      (d) =>
        d.accountId === model.account?.id &&
        (d.workspaceId ?? 'personal') === (model.workspaceId ?? 'personal') &&
        !d.jobId,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  shell(
    `${titleRow(t('草稿箱'))}<p class="page-description">${esc(t('尚未发送的材料与说明。打开草稿可继续编辑，再确认发送。'))}</p>${drafts.length ? drafts.map((d) => `<button class="draft-row" data-resume-draft="${esc(d.id)}"><span class="list-title">${esc(model.bots.find((b) => b.id === d.botId)?.name || t('选择 BOT'))}</span><span class="list-meta">${esc(d.instruction || t('待补充的材料'))}</span><span class="subtle">${shortTime(d.updatedAt)}</span>${icon('chevron', 18)}</button>`).join('') : `<div class="empty">${esc(t('暂无草稿'))}</div>`}`,
  );
}
async function composeView() {
  if (!draft) {
    draft = await get('drafts', q.get('draft'));
    if (!draft) {
      shell(`<div class="empty">${esc(t('草稿不存在或已过期'))}</div>`);
      return;
    }
  }
  if (
    draft.accountId !== model.account?.id ||
    (draft.workspaceId ?? 'personal') !== (model.workspaceId ?? 'personal')
  ) {
    draft = null;
    shell('<div class="empty">' + esc(errorText('ACCOUNT_CHANGED')) + '</div>');
    return;
  }
  items = (await Promise.all(draft.itemIds.map((id) => get('materials', id)))).filter(
    (i) => i?.accountId === model.account?.id,
  );
  if (draft.jobId) {
    view = 'history';
    await refresh();
    return;
  }
  shell(
    `<div class="page-intro"><h1>${esc(t('编辑草稿'))}</h1><p>${esc(t('整理说明和材料；「发送预览」只查看将要发送的内容。'))}</p></div><div class="form-block compose-input"><textarea id="instruction" aria-label="${esc(t('补充说明'))}" placeholder="${esc(t('补充说明，Enter 发送…'))}" spellcheck="false">${esc(draft.instruction)}</textarea></div><div class="row between compose-tools"><select id="preset" aria-label="${esc(t('任务'))}">${presetOptions(draft.preset)}</select><label class="text-button" for="file-input">${icon('plus', 15)} ${esc(t('添加文件'))}</label></div><input type="file" id="file-input" multiple class="hidden"><div class="compose-materials">${items.map((item) => `<section class="preview"><div class="row between"><span class="list-title">${esc(item.title || t('材料'))}</span><button class="icon-button small" data-draft-remove="${item.id}" aria-label="${esc(t('移除材料'))}">${icon('close', 14)}</button></div>${item.url ? `<div class="list-meta">${esc(item.url)}</div>` : ''}${item.warnings?.map((w) => `<div class="warning">${esc(w)}</div>`).join('') || ''}${item.markdown ? disclosure(t('正文'), `<div class="markdown material-body">${renderMarkdown(item.markdown)}</div><button class="secondary" data-edit-material="${item.id}">${icon('file', 14)}${esc(t('编辑正文'))}</button>`) : ''}${item.attachments.map((a, i) => `<div class="attachment">${icon('file', 15)}<span>${esc(a.name)}</span><small>${size(a.blob.size)}</small><button class="icon-button small" data-download="${item.id}:${i}" aria-label="${esc(t('下载附件'))}">${icon('download', 14)}</button><button class="icon-button small" data-remove-attachment="${item.id}:${i}" aria-label="${esc(t('移除附件'))}">${icon('close', 14)}</button></div>`).join('')}${item.attachments.some((a) => a.blob.type.startsWith('image/')) ? `<div id="image-${item.id}"></div>` : ''}</section>`).join('')}</div>`,
    `<footer class="compose-footer"><button class="secondary" data-action="draft-basket">${esc(t('加入材料篮'))}</button><button class="primary" id="send-button" data-action="send">${esc(t('发送'))} ${icon('send', 18)}</button></footer>`,
  );
  bindComposer();
  if (draft.chooseBot) {
    const choosingDraft = draft;
    choosingDraft.chooseBot = false;
    await put('drafts', choosingDraft);
    if (view === 'compose' && draft === choosingDraft) await pickBot();
  }
  for (const item of items) {
    const index = item.attachments.findIndex((a) => a.blob.type.startsWith('image/'));
    if (index >= 0) await imageEditor(item, index);
  }
}
function bindComposer() {
  const el = document.querySelector('#instruction');
  if (!el) return;
  el.addEventListener('input', () => {
    draft.instruction = el.value;
    scheduleDraft();
  });
  el.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      await act('send');
    }
  });
  document.querySelector('#preset')?.addEventListener('change', (e) => {
    draft.preset = e.target.value;
    scheduleDraft();
  });
  document
    .querySelector('#file-input')
    ?.addEventListener('change', (e) => addFiles(e.target.files));
}
function scheduleDraft() {
  clearTimeout(draftTimer);
  draft.updatedAt = Date.now();
  draftTimer = setTimeout(() => put('drafts', draft), 200);
}
async function imageEditor(item, index) {
  const mountPoint = document.querySelector('#image-' + item.id),
    attachment = item.attachments[index],
    image = new Image(),
    url = URL.createObjectURL(attachment.blob);
  try {
    image.src = url;
    await image.decode();
  } finally {
    URL.revokeObjectURL(url);
  }
  mountPoint.innerHTML = disclosure(
    t('编辑图片'),
    `<div class="shot-tools">${[
      ['crop', t('裁剪')],
      ['redact', t('打码')],
      ['arrow', t('箭头')],
      ['undo', t('撤销')],
    ]
      .map(
        ([i, t]) =>
          `<button class="icon-button small ${i === 'crop' ? 'active' : ''}" data-tool="${i}" title="${esc(t)}" aria-label="${esc(t)}">${icon(i, 17)}</button>`,
      )
      .join(
        '',
      )}<button class="text-button" data-apply="${item.id}">${draft.screenshotEdit ? t('完成截图') : t('应用修改')}</button></div><div class="canvas-wrap"><canvas aria-label="${esc(t('截图编辑区域'))}"></canvas></div>`,
    { className: 'shot-editor', open: Boolean(draft.screenshotEdit) },
  );
  const canvas = mountPoint.querySelector('canvas'),
    ctx = canvas.getContext('2d');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  let tool = 'crop',
    crop = null,
    ops = [],
    start = null,
    moveRect = null;
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    for (const o of ops) {
      if (o.kind === 'redact') {
        ctx.fillStyle = '#161a18';
        ctx.fillRect(o.x, o.y, o.width, o.height);
      } else drawArrow(o);
    }
    if (crop) {
      ctx.fillStyle = '#0006';
      ctx.fillRect(0, 0, canvas.width, crop.y);
      ctx.fillRect(0, crop.y + crop.height, canvas.width, canvas.height - crop.y - crop.height);
      ctx.fillRect(0, crop.y, crop.x, crop.height);
      ctx.fillRect(crop.x + crop.width, crop.y, canvas.width - crop.x - crop.width, crop.height);
      ctx.strokeStyle = '#1084fe';
      ctx.lineWidth = 3;
      ctx.strokeRect(crop.x, crop.y, crop.width, crop.height);
    }
    if (moveRect) {
      ctx.strokeStyle = '#e36e4c';
      ctx.lineWidth = 3;
      ctx.strokeRect(moveRect.x, moveRect.y, moveRect.width, moveRect.height);
    }
  };
  const drawArrow = (o) => {
    ctx.strokeStyle = '#ef6647';
    ctx.lineWidth = Math.max(3, canvas.width / 300);
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(o.x + o.width, o.y + o.height);
    ctx.stroke();
  };
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, ((e.clientX - r.left) * canvas.width) / r.width)),
      y: Math.max(0, Math.min(canvas.height, ((e.clientY - r.top) * canvas.height) / r.height)),
    };
  };
  canvas.addEventListener('pointerdown', (e) => {
    start = point(e);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!start) return;
    const p = point(e);
    moveRect = {
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      width: Math.abs(p.x - start.x),
      height: Math.abs(p.y - start.y),
    };
    draw();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!start) return;
    const p = point(e),
      r = {
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        width: Math.abs(p.x - start.x),
        height: Math.abs(p.y - start.y),
      };
    if (r.width > 3 && r.height > 3) {
      if (tool === 'crop') crop = r;
      else
        ops.push(
          tool === 'arrow'
            ? { kind: tool, x: start.x, y: start.y, width: p.x - start.x, height: p.y - start.y }
            : { kind: tool, ...r },
        );
    }
    start = null;
    moveRect = null;
    draw();
  });
  for (const b of mountPoint.querySelectorAll('[data-tool]'))
    b.addEventListener('click', () => {
      if (b.dataset.tool === 'undo') {
        if (ops.length) ops.pop();
        else crop = null;
        draw();
        return;
      }
      tool = b.dataset.tool;
      for (const t of mountPoint.querySelectorAll('[data-tool]'))
        t.classList.toggle('active', t === b);
    });
  mountPoint.querySelector('[data-apply]').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      await rpc('image.transform', { materialId: item.id, index, rect: crop, operations: ops });
      draft.screenshotEdit = false;
      await put('drafts', draft);
      if (!model.settings.askBeforeSend && item.kind === 'screenshot') {
        await sendDraft();
      } else await composeView();
    } catch (error) {
      toast(errorText(error));
      b.disabled = false;
    }
  });
  draw();
}
async function sendDraft() {
  if (!draft || busy) return;
  if (draft.screenshotEdit) {
    toast(t('请先完成截图'));
    return;
  }
  busy = true;
  const sendingDraft = draft;
  const button = document.querySelector('#send-button');
  if (button) {
    button.disabled = true;
    button.textContent = t('发送中…');
  }
  try {
    sendingDraft.instruction =
      document.querySelector('#instruction')?.value ?? sendingDraft.instruction;
    await put('drafts', sendingDraft);
    await rpc('draft.send', { id: sendingDraft.id });
    if (draft === sendingDraft && view === 'compose') {
      view = 'history';
      draft = null;
      await refresh();
    } else toast(t('已加入发送队列'));
  } finally {
    busy = false;
    if (button) button.disabled = false;
  }
}
function dialogElement(picker = false, label = t('对话框')) {
  const dialog = document.querySelector('#bot-dialog');
  releaseAvatars(dialog);
  dialog.setAttribute('aria-label', picker ? t('选择 BOT') : label);
  dialog.className = picker ? 'bot-picker' : 'content-dialog';
  return dialog;
}
async function previewPacket() {
  if (!draft) return;
  const previewDraft = draft;
  const previewItems = items;
  await put('drafts', previewDraft);
  const packet = await packContext({
    items: previewItems,
    instruction: previewDraft.instruction,
    preset: previewDraft.preset,
    maxTextBytes: model.settings.maxTextBytes,
    includeSource: model.settings.includeSource,
    maxAttachmentBytes: model.settings.maxAttachmentBytes,
  });
  if (draft !== previewDraft || view !== 'compose') return;
  const dialog = dialogElement(false, t('发送预览'));
  dialog.dataset.localeKind = 'preview';
  dialog.innerHTML = `<div class="dialog-head"><strong>${esc(t('发送预览'))}</strong>${btn('close-dialog', t('关闭'), 'close')}</div><p class="page-description">${esc(t('以下是即将发给 {name} 的说明、正文与附件。此处仅预览，关闭后仍可修改草稿。', { name: bot()?.name || 'BOT' }))}</p><pre class="reply">${esc(packet.text)}</pre>${packet.attachments.map((a) => `<div class="attachment"><span>${esc(a.name)}</span><small>${size(a.blob.size)}</small></div>`).join('')}`;
  dialog.showModal();
}
async function repliesView() {
  shell(
    `<div id="replies-list" role="log" aria-label="${esc(t('聊天记录'))}"></div>`,
    `<footer class="chat-footer"><div class="chat-composer"><textarea id="followup" aria-label="${esc(t('追问'))}" placeholder="${esc(t('输入消息，继续对话…'))}" rows="2"></textarea><div class="composer-actions"><span>${esc(t('Enter 发送 · Shift+Enter 换行'))}</span><button class="primary" data-action="followup" aria-label="${esc(t('发送消息'))}" disabled>${icon('send', 18)}</button></div></div></footer>`,
    `<div class="chat-head"><div class="chat-context">${esc(t('BOT 对话'))}<span>${esc(t('接收回复与继续追问'))}</span></div><div id="stream-status" class="subtle" role="status"></div></div>`,
  );
  const input = document.querySelector('#followup');
  input.addEventListener('input', syncChatInput);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      act('followup');
    }
  });
  await renderReplies();
  if (input.isConnected && view === 'replies') connectReplies();
}
function syncChatInput() {
  const input = document.querySelector('#followup');
  const button = document.querySelector('[data-action="followup"]');
  if (button) button.disabled = busy || !input?.value.trim() || !bot();
}
async function renderReplies() {
  const b = bot(),
    el = document.querySelector('#replies-list');
  if (!el || !b) return;
  const scroller = el.closest('#panel');
  const firstRender = !el.children.length;
  const revision = ++repliesRevision;
  const replies = await rpc('replies', { botId: b.id });
  if (!el.isConnected || bot()?.id !== b.id || revision !== repliesRevision) return;
  const atBottom =
    firstRender || scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 48;
  el.innerHTML = replies.length
    ? replies
        .map(
          (r) =>
            `<article class="reply message"><div class="markdown">${renderMarkdown(r.text)}</div><div class="reply-time">${shortTime(r.updatedAt)}</div></article>`,
        )
        .join('')
    : `<div class="empty">${esc(t('还没有收到回复'))}</div>`;
  if (atBottom) scroller.scrollTop = scroller.scrollHeight;
}
function connectReplies() {
  clearTimeout(reconnectTimer);
  const old = port;
  port = null;
  old?.disconnect();
  if (view !== 'replies' || !bot()) return;
  port = api.runtime.connect({ name: 'replies' });
  port.postMessage({ type: 'watch', botId: bot().id });
  port.onMessage.addListener((message) => {
    const status = document.querySelector('#stream-status');
    if (message.type === 'error') {
      if (status) status.textContent = t('{error}，正在重连', { error: errorText(message.error) });
      return;
    }
    if (status) status.textContent = '';
    if (message.event?.type === 'entry.unavailable' && status)
      status.textContent = t('部分回复正文未由服务端返回');
    if (message.event?.type === 'turn.failed' && status)
      status.textContent = message.event.data.summary || t('BOT 执行失败');
    if (
      ['message', 'message.deleted', 'reset', 'history', 'resync-required'].includes(
        message.event?.type,
      )
    )
      renderReplies();
  });
  const thisPort = port;
  port.onDisconnect.addListener(() => {
    if (port !== thisPort) return;
    port = null;
    clearTimeout(reconnectTimer);
    if (view === 'replies')
      reconnectTimer = setTimeout(() => {
        if (view === 'replies') {
          renderReplies().catch(() => {});
          connectReplies();
        }
      }, 1500);
  });
}
async function pickBot(mode = 'current') {
  const dialog = dialogElement(true);
  dialog.dataset.pickerMode = mode;
  dialog.innerHTML = `<div class="dialog-head"><strong>${esc(t('选择 BOT'))}</strong><div class="picker-header-actions"><button id="refresh-picker-bots" class="secondary" type="button">${icon('refresh', 16)}${esc(t('刷新 BOT'))}</button>${btn('close-dialog', t('关闭'), 'close')}</div></div><div class="search-box">${icon('search', 17)}<input id="bot-search" placeholder="${esc(t('搜索 BOT'))}" aria-label="${esc(t('搜索 BOT'))}" autocomplete="off"></div><div id="bot-list" class="bot-list"></div>`;
  const list = dialog.querySelector('#bot-list'),
    input = dialog.querySelector('input'),
    refreshButton = dialog.querySelector('#refresh-picker-bots');
  let refreshing = false,
    rosterChanged = false;
  const render = () => {
    const favoritesFirst = [...model.bots].sort(
      (a, b) =>
        Number(model.settings.favorites.includes(b.id)) -
        Number(model.settings.favorites.includes(a.id)),
    );
    const filtered = searchBots(favoritesFirst, input.value);
    list.innerHTML = filtered.length
      ? filtered
          .map(
            (b) =>
              `<div class="bot-row ${(mode === 'default' ? model.settings.defaultBotId : bot()?.id) === b.id ? 'is-selected' : ''}"><button class="bot-choice" data-select-bot="${esc(b.id)}" aria-label="${esc(b.name || 'BOT')}" aria-pressed="${(mode === 'default' ? model.settings.defaultBotId : bot()?.id) === b.id}">${avatar(b.id, true, 64)}<span class="name">${esc(b.name || 'BOT')}</span>${model.settings.defaultBotId === b.id ? `<span class="default-badge">${esc(t('默认'))}</span>` : ''}</button><button class="favorite-button ${model.settings.favorites.includes(b.id) ? 'is-saved' : ''}" data-favorite="${esc(b.id)}" aria-pressed="${model.settings.favorites.includes(b.id)}" aria-label="${esc(model.settings.favorites.includes(b.id) ? t('取消收藏 {name}', { name: b.name }) : t('收藏 {name}', { name: b.name }))}">${icon('bookmark', 14)}</button></div>`,
          )
          .join('')
      : `<div class="empty">${esc(t('没有匹配的 BOT'))}</div>`;
    for (const button of list.querySelectorAll('button')) button.disabled = refreshing;
    mountAvatars(dialog, model.bots);
  };
  refreshButton.addEventListener(
    'click',
    onUIEvent(async () => {
      if (refreshing) return;
      refreshing = true;
      refreshButton.disabled = true;
      refreshButton.setAttribute('aria-busy', 'true');
      refreshButton.innerHTML = `${icon('refresh', 16)}${esc(t('刷新中…'))}`;
      render();
      const accountId = model.account?.id,
        workspaceId = model.workspaceId;
      try {
        await rpc('bots.refresh');
        const next = await rpc('state');
        if (!dialog.isConnected || !dialog.open) return;
        if (
          !next.authenticated ||
          next.account?.id !== accountId ||
          next.workspaceId !== workspaceId ||
          model.account?.id !== accountId ||
          model.workspaceId !== workspaceId
        )
          throw Error('ACCOUNT_CHANGED');
        model = next;
        rosterChanged = true;
        render();
        toast(t('BOT 列表已刷新'));
      } finally {
        refreshing = false;
        refreshButton.disabled = false;
        refreshButton.setAttribute('aria-busy', 'false');
        refreshButton.innerHTML = `${icon('refresh', 16)}${esc(t('刷新 BOT'))}`;
        if (dialog.isConnected && dialog.open) render();
      }
    }),
  );
  input.addEventListener('input', render);
  async function handleBotChoice(e) {
    if (refreshing) return;
    const select = e.target.closest('[data-select-bot]'),
      fav = e.target.closest('[data-favorite]');
    if (fav) {
      const favorites = new Set(model.settings.favorites);
      favorites.has(fav.dataset.favorite)
        ? favorites.delete(fav.dataset.favorite)
        : favorites.add(fav.dataset.favorite);
      model.settings = await rpc('settings', { patch: { favorites: [...favorites] } });
      render();
      return;
    }
    if (select) {
      const id = select.dataset.selectBot;
      if (mode.startsWith('action:')) {
        const action = mode.slice(7);
        model.settings = await rpc('settings', {
          patch: { actionBots: { ...model.settings.actionBots, [action]: id } },
        });
      } else if (mode.startsWith('rule:')) {
        const rules = structuredClone(model.settings.rules);
        rules[Number(mode.slice(5))].botId = id;
        model.settings = await rpc('settings', { patch: { rules } });
      } else if (mode === 'default') {
        model.settings = await rpc('settings', { patch: { defaultBotId: id } });
      } else if (draft) {
        draft.botId = id;
        draft.explicitBot = true;
        await put('drafts', draft);
      } else {
        selectedBotId = id;
        if (view === 'home' || view === 'quick')
          model.settings = await rpc('settings', { patch: { defaultBotId: id } });
      }
      rosterChanged = false;
      dialog.close();
      await renderCurrent();
    }
  }
  list.addEventListener('click', onUIEvent(handleBotChoice));
  render();
  dialog.showModal();
  document.body.classList.add('picker-open');
  dialog.addEventListener(
    'close',
    () => {
      document.body.classList.remove('picker-open');
      if (rosterChanged) renderCurrent().catch((error) => toast(errorText(error)));
    },
    { once: true },
  );
  input.focus({ preventScroll: true });
}
async function addFiles(files) {
  const list = [...files];
  if (!list.length) return;
  const newItems = [];
  for (const file of list) {
    if (file.size > model.settings.maxAttachmentBytes) {
      toast(t('{name} 超过大小上限', { name: file.name }));
      continue;
    }
    const item = {
      id: crypto.randomUUID(),
      kind: 'file',
      accountId: model.account?.id,
      title: file.name,
      url: '',
      markdown: '',
      warnings: [],
      createdAt: Date.now(),
      capturedAt: new Date().toISOString(),
      attachments: [{ name: safeName(file.name), blob: file }],
      inBasket: !draft,
    };
    if (
      /^text\//.test(file.type) ||
      /\.(md|csv|json|txt|js|ts|py|html|xml|yaml|yml|log)$/i.test(file.name)
    ) {
      if (file.size <= 4 * 1024 * 1024) item.markdown = await file.text();
      else item.warnings.push(t('文字文件较大，全文保留在附件中'));
    }
    await put('materials', item);
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))
      try {
        await rpc('pdf.extract', { materialId: item.id, index: 0 });
      } catch {
        item.warnings.push(t('PDF 文字提取失败，已保留原文件'));
        await put('materials', item);
      }
    newItems.push(item);
  }
  if (draft) {
    draft.itemIds.push(...newItems.map((i) => i.id));
    await put('drafts', draft);
    await composeView();
  } else {
    view = 'basket';
    await refresh();
  }
}
async function download(itemId, index) {
  const item = await get('materials', itemId);
  if (item?.accountId !== model.account?.id) throw Error('MATERIAL_UNAVAILABLE');
  const a = item.attachments[index],
    url = URL.createObjectURL(a.blob);
  try {
    await api.downloads.download({ url, filename: safeName(a.name), saveAs: true });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
async function capture(kind, options = {}) {
  if (busy) return;
  busy = true;
  toast(t('正在采集…'));
  try {
    if (
      model.settings.askBeforeSend &&
      model.settings.composerSurface !== 'window' &&
      !options.basket
    ) {
      // Open in the original button gesture, before capture and before region coordinates exist.
      await openSidePanel({ windowId: sourceWindowId });
    }
    const result = await rpc('capture', {
      kind,
      tabId: sourceTabId,
      explicitBotId: selectedBotId || undefined,
      ...options,
    });
    if (result?.basket) {
      toast(t('已加入材料篮'));
      await refresh();
    } else if (result?.jobId) {
      view = 'history';
      await refresh();
    } else if (result?.picking) {
      if (isPopup) window.close();
    } else if (result?.draftId) {
      if (isPopup) window.close();
    }
  } finally {
    busy = false;
  }
}
async function goToView(next) {
  const revision = ++navigationRevision;
  const leavingDraft = draft;
  if (leavingDraft && view === 'compose' && next !== 'compose') {
    clearTimeout(draftTimer);
    await put('drafts', leavingDraft);
    if (revision !== navigationRevision) return;
    if (draft === leavingDraft) {
      selectedBotId = leavingDraft.botId;
      draft = null;
    }
  }
  if (revision !== navigationRevision) return;
  view = next;
  await renderCurrent();
}
async function act(action) {
  try {
    switch (action) {
      case 'home':
        await goToView('home');
        break;
      case 'settings':
        if (isPopup) {
          await api.tabs.create({ url: api.runtime.getURL('app.html?view=settings') });
          window.close();
        } else {
          await goToView('settings');
        }
        break;
      case 'basket':
      case 'history':
      case 'more-capture':
      case 'quick':
        await goToView(action);

        break;
      case 'tabs':
        if (isPopup) {
          await api.tabs.create({
            url: api.runtime.getURL('app.html?view=tabs&source=' + sourceTabId),
          });
          window.close();
        } else {
          await goToView('tabs');
        }
        break;
      case 'replies':
        if (!isPopup) {
          await goToView('replies');
        } else {
          await openSidePanel({ windowId: sourceWindowId });
          await rpc('sidepanel.navigate', { windowId: sourceWindowId, view: 'replies' });
          if (isPopup) window.close();
        }
        break;
      case 'pick-bot':
        await pickBot();
        break;
      case 'pick-default':
        await pickBot('default');
        break;
      case 'close-dialog':
        document.querySelector('dialog')?.close();
        break;
      case 'login':
        await rpc('login');
        await refresh();
        break;
      case 'login-cancel':
        await rpc('login.cancel');
        await refresh();
        break;
      case 'logout':
        await rpc('logout');
        draft = null;
        selectedBotId = '';
        await refresh();
        break;
      case 'bots-refresh':
        await rpc('bots.refresh');
        await refresh();
        toast(t('BOT 已更新'));
        break;
      case 'resume-compose':
        await goToView('drafts');
        break;
      case 'screenshot':
        await capture('screenshot', { mode: model.settings.screenshotMode });
        break;
      case 'capture-region':
        await capture('screenshot', { mode: 'region' });
        break;
      case 'capture-viewport':
        await capture('screenshot', { mode: 'viewport' });
        break;
      case 'capture-full':
        await capture('screenshot', { mode: 'full' });
        break;
      case 'save-page':
        await capture('page');
        break;
      case 'video':
        await capture('video');
        break;
      case 'page-basket':
        await capture('page', { basket: true });
        break;
      case 'element':
        await capture('element');
        break;
      case 'basket-compose':
        await rpc('basket.compose');
        if (isPopup) window.close();
        break;
      case 'draft-basket':
        if (draft) {
          for (const id of draft.itemIds) {
            const item = await get('materials', id);
            item.inBasket = true;
            await put('materials', item);
          }
          view = 'basket';
          draft = null;
          await refresh();
        }
        break;
      case 'send':
        await sendDraft();
        break;
      case 'preview-packet':
        await previewPacket();
        break;
      case 'file': {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.addEventListener('change', (e) => addFiles(e.target.files));
        input.click();
        break;
      }
      case 'tabs-capture': {
        const ids = [...document.querySelectorAll('input[name=tab]:checked')].map((x) =>
          Number(x.value),
        );
        const granted = await api.permissions.request({
          origins: ['http://*/*', 'https://*/*'],
        });
        if (!granted) {
          toast(t('未获得跨网站访问权限'));
          return;
        }
        toast(t('正在采集所选网页…'));
        await rpc('capture.tabs', { tabIds: ids });
        break;
      }
      case 'permissions': {
        const granted = await api.permissions.request({
          origins: ['http://*/*', 'https://*/*'],
        });
        toast(granted ? t('已授权跨网站采集') : t('未获得权限'));
        break;
      }
      case 'shortcuts': {
        if (isFirefox) {
          const dialog = dialogElement(false, t('Firefox 快捷键设置'));
          dialog.dataset.localeKind = 'firefox-shortcuts';
          dialog.innerHTML = `<div class="dialog-head"><strong>${esc(t('Firefox 快捷键设置'))}</strong>${btn('close-dialog', t('关闭'), 'close')}</div><p class="page-description">${esc(t('在浏览器地址栏输入 about:addons，点击齿轮菜单，选择「管理扩展快捷键」，再找到 Grok Bot Clipper 修改快捷键。'))}</p>`;
          dialog.showModal();
        } else await api.tabs.create({ url: shortcutsURL });
        break;
      }
      case 'add-rule': {
        const rules = [
          ...model.settings.rules,
          { host: 'example.com', botId: model.settings.defaultBotId, includeSubdomains: false },
        ];
        model.settings = await rpc('settings', { patch: { rules } });
        settingsView();
        break;
      }
      case 'followup': {
        const input = document.querySelector('#followup');
        const text = input?.value.trim();
        if (!text || busy || !bot()) return;
        busy = true;
        syncChatInput();
        try {
          const d = {
            id: crypto.randomUUID(),
            itemIds: [],
            accountId: model.account?.id,
            workspaceId: model.workspaceId,
            botId: bot().id,
            instruction: text,
            preset: '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await put('drafts', d);
          await rpc('draft.send', { id: d.id });
          if (input.value.trim() === text) input.value = '';
          input.focus({ preventScroll: true });
          toast(t('已加入发送队列'));
        } finally {
          busy = false;
          syncChatInput();
        }
        break;
      }
    }
  } catch (error) {
    toast(errorText(error));
  }
}
async function handleRootClick(e) {
  const resume = e.target.closest('[data-resume-draft]');
  if (resume) {
    if (isPopup) {
      await openSidePanel({ windowId: sourceWindowId });
      await rpc('composer.open.saved', {
        id: resume.dataset.resumeDraft,
        windowId: sourceWindowId,
      });
      window.close();
      return;
    }
    draft = null;
    q.set('draft', resume.dataset.resumeDraft);
    view = 'compose';
    await refresh();
    return;
  }

  const action = e.target.closest('[data-action]');
  if (action) {
    await act(action.dataset.action);
    return;
  }
  const toggled = e.target.closest('[data-toggle]');
  if (toggled) {
    try {
      const key = toggled.dataset.toggle;
      model.settings = await rpc('settings', { patch: { [key]: !model.settings[key] } });
      toggled.setAttribute('aria-checked', String(model.settings[key]));
      settingsSaved();
    } catch (e) {
      toast(errorText(e));
    }
    return;
  }
  const codeCopy = e.target.closest('[data-copy-code]');
  if (codeCopy) {
    try {
      await navigator.clipboard.writeText(
        codeCopy.closest('.code-block').querySelector('code').textContent,
      );
      codeCopy.textContent = t('已复制');
      setTimeout(() => {
        if (codeCopy.isConnected) codeCopy.textContent = t('复制');
      }, 1500);
    } catch {
      toast(t('无法复制，请选中代码后复制'));
    }
    return;
  }
  const routeReset = e.target.closest('[data-reset-route]');
  if (routeReset) {
    try {
      const actionBots = { ...model.settings.actionBots };
      delete actionBots[routeReset.dataset.resetRoute];
      model.settings = await rpc('settings', { patch: { actionBots } });
      settingsView();
      settingsSaved();
    } catch (error) {
      toast(errorText(error));
    }
    return;
  }
  const routePick = e.target.closest('[data-route-pick]');
  if (routePick) {
    await pickBot(routePick.dataset.routePick);
    return;
  }
  const removeItem = e.target.closest('[data-remove-material]');
  if (removeItem) {
    await rpc('basket.remove', { id: removeItem.dataset.removeMaterial });
    await refresh();
    return;
  }
  const retry = e.target.closest('[data-retry-job]'),
    check = e.target.closest('[data-check-job]'),
    jobButton = e.target.closest('[data-open-job]');
  try {
    if (retry) {
      await rpc('job.retry', { id: retry.dataset.retryJob });
      await refresh();
    }
    if (check) {
      await rpc('job.check', { id: check.dataset.checkJob });
      await refresh();
      toast(t('已检查投递状态'));
    }
    if (jobButton) {
      const job = await get('jobs', jobButton.dataset.openJob);
      if (job?.accountId !== model.account?.id) throw Error('ACCOUNT_CHANGED');
      const dialog = dialogElement(false, labels[job.state]);
      dialog.innerHTML = `<div class="dialog-head"><strong>${esc(labels[job.state] || job.state)}</strong>${btn('close-dialog', t('关闭'), 'close')}</div><pre class="reply">${esc(job.packet.text)}</pre>${job.packet.attachments.map((a) => `<div class="attachment"><span>${esc(a.name)}</span><small>${size(a.blob.size)}</small></div>`).join('')}`;
      dialog.showModal();
    }
    const downloadBtn = e.target.closest('[data-download]');
    if (downloadBtn) {
      const [id, index] = downloadBtn.dataset.download.split(':');
      await download(id, Number(index));
    }
    const removeDraft = e.target.closest('[data-draft-remove]');
    if (removeDraft) {
      draft.itemIds = draft.itemIds.filter((id) => id !== removeDraft.dataset.draftRemove);
      await put('drafts', draft);
      await composeView();
    }
    const removeAttachment = e.target.closest('[data-remove-attachment]');
    if (removeAttachment) {
      const [id, index] = removeAttachment.dataset.removeAttachment.split(':'),
        item = await get('materials', id);
      item.attachments.splice(Number(index), 1);
      await put('materials', item);
      await composeView();
    }
    const edit = e.target.closest('[data-edit-material]');
    if (edit) {
      const item = await get('materials', edit.dataset.editMaterial),
        dialog = dialogElement(false, t('编辑正文'));
      dialog.innerHTML = `<div class="dialog-head"><strong>${esc(t('编辑正文'))}</strong>${btn('close-dialog', t('关闭'), 'close')}</div><textarea id="material-editor" style="min-height:300px;margin-top:15px" aria-label="${esc(t('材料正文'))}">${esc(item.markdown)}</textarea><div class="bottom-actions"><button class="primary" id="save-material">${esc(t('保存'))}</button></div>`;
      dialog.querySelector('#save-material').onclick = async () => {
        item.markdown = dialog.querySelector('textarea').value;
        await put('materials', item);
        dialog.close();
        await composeView();
      };
      dialog.showModal();
    }
    const deleteRule = e.target.closest('[data-delete-rule]');
    if (deleteRule) {
      model.settings = await rpc('settings', {
        patch: {
          rules: model.settings.rules.filter((_, i) => i !== Number(deleteRule.dataset.deleteRule)),
        },
      });
      settingsView();
    }
  } catch (error) {
    toast(errorText(error));
  }
}
root.addEventListener('click', onUIEvent(handleRootClick));
root.addEventListener('change', async (e) => {
  try {
    const el = e.target;
    if (el.hasAttribute('data-workspace')) {
      await rpc('team.select', { teamId: el.value });
      draft = null;
      selectedBotId = '';
      await refresh();
      return;
    }
    if (el.dataset.setting) {
      const error = document.getElementById(el.id + '-error');
      if (el.type === 'number' && (!el.value.trim() || !el.validity.valid)) {
        el.setAttribute('aria-invalid', 'true');
        if (error) {
          error.hidden = false;
          error.textContent = t('请输入 {min}–{max} 之间的整数。', { min: el.min, max: el.max });
        }
        return;
      }
      el.setAttribute('aria-invalid', 'false');
      if (error) {
        error.hidden = true;
        error.textContent = '';
      }
      let key = el.dataset.setting,
        value = el.type === 'number' ? Number(el.value) : el.value;
      if (key === 'maxAttachmentMB') {
        key = 'maxAttachmentBytes';
        value *= 1048576;
      }
      model.settings = await rpc('settings', { patch: { [key]: value } });
      if (key === 'language') {
        await rerenderForLocale();
      }
      document.documentElement.dataset.theme = model.settings.theme;
      settingsSaved();
    }
    if (el.dataset.actionBot) {
      model.settings = await rpc('settings', {
        patch: { actionBots: { ...model.settings.actionBots, [el.dataset.actionBot]: el.value } },
      });
    }
    if (el.dataset.ruleHost !== undefined || el.dataset.ruleBot !== undefined) {
      const rules = structuredClone(model.settings.rules),
        i = Number(el.dataset.ruleHost ?? el.dataset.ruleBot);
      if (el.dataset.ruleHost !== undefined)
        rules[i].host = el.value
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\//, '')
          .split('/')[0];
      else rules[i].botId = el.value;
      model.settings = await rpc('settings', { patch: { rules } });
      settingsSaved();
    }
  } catch (error) {
    toast(errorText(error));
  }
});
// Preserve user-owned input while rebuilding translated interface controls.
async function rerenderForLocale() {
  const active = document.activeElement;
  const focusAttribute = ['data-action', 'data-select-bot', 'data-favorite', 'name'].find((name) =>
    active?.hasAttribute(name),
  );
  const focus =
    active && root.contains(active)
      ? {
          id: active.id,
          tag: active.tagName,
          attribute: focusAttribute,
          value: focusAttribute && active.getAttribute(focusAttribute),
          controlValue: active.value,
          start: active.selectionStart,
          end: active.selectionEnd,
          direction: active.selectionDirection,
        }
      : null;
  const followup = document.querySelector('#followup')?.value;
  const dialog = document.querySelector('dialog[open]');
  const picker = dialog?.classList.contains('bot-picker')
    ? {
        mode: dialog.dataset.pickerMode || 'current',
        query: dialog.querySelector('#bot-search')?.value || '',
      }
    : null;
  const title = dialog?.querySelector('.dialog-head strong');
  // Only inspect extension chrome. Never reverse-translate material or BOT content.
  const titleSource =
    title && Object.entries(getCatalog()).find(([, text]) => text === title.textContent)?.[0];
  const jobState =
    title && Object.keys(labels).find((state) => labels[state] === title.textContent);
  const scrolls = [...root.querySelectorAll('[id]')]
    .filter((el) => el.scrollTop || el.scrollLeft)
    .map((el) => ({ id: el.id, top: el.scrollTop, left: el.scrollLeft }));
  await renderCurrent();
  if (followup !== undefined) {
    const input = document.querySelector('#followup');
    if (input) {
      input.value = followup;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  if (picker) {
    await pickBot(picker.mode);
    const input = document.querySelector('#bot-search');
    if (input) {
      input.value = picker.query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } else if (dialog) {
    // Keeping this node also preserves pending editor changes and its event handlers.
    dialog.removeAttribute('open');
    root.querySelector('#bot-dialog')?.replaceWith(dialog);
    if (titleSource) title.textContent = t(titleSource);
    else if (jobState) title.textContent = labels[jobState];
    for (const close of dialog.querySelectorAll('[data-action="close-dialog"]')) {
      close.title = t('关闭');
      close.setAttribute('aria-label', t('关闭'));
    }
    const editor = dialog.querySelector('#material-editor');
    if (editor) {
      editor.setAttribute('aria-label', t('材料正文'));
      dialog.querySelector('#save-material').textContent = t('保存');
    }
    if (dialog.dataset.localeKind === 'preview')
      dialog.querySelector('.page-description').textContent = t(
        '以下是即将发给 {name} 的说明、正文与附件。此处仅预览，关闭后仍可修改草稿。',
        { name: bot()?.name || 'BOT' },
      );
    if (dialog.dataset.localeKind === 'firefox-shortcuts')
      dialog.querySelector('.page-description').textContent = t(
        '在浏览器地址栏输入 about:addons，点击齿轮菜单，选择「管理扩展快捷键」，再找到 Grok Bot Clipper 修改快捷键。',
      );
    dialog.showModal();
  }
  for (const scroll of scrolls) {
    const el = document.getElementById(scroll.id);
    if (el) {
      el.scrollTop = scroll.top;
      el.scrollLeft = scroll.left;
    }
  }
  const target =
    focus &&
    (focus.id
      ? document.getElementById(focus.id)
      : focus.attribute &&
        [...root.querySelectorAll(focus.tag)].find(
          (el) =>
            el.getAttribute(focus.attribute) === focus.value &&
            (focus.attribute !== 'name' || el.value === focus.controlValue),
        ));
  if (target) {
    target.focus({ preventScroll: true });
    if (typeof focus.start === 'number' && typeof target.setSelectionRange === 'function')
      target.setSelectionRange(focus.start, focus.end, focus.direction || 'none');
  }
}
async function renderCurrent() {
  await initI18n({ api, locale: model.settings.language || 'auto', document });
  setLocale(model.settings.language || 'auto');
  document.documentElement.lang = getLocale().replace('_', '-');
  document.documentElement.dir =
    supportedLocales.find((locale) => locale.code === getLocale())?.dir || 'ltr';
  if (view !== 'replies') {
    port?.disconnect();
    port = null;
  }
  document.documentElement.dataset.theme = model.settings.theme;
  if (!model.authenticated) {
    authView();
    return;
  }
  switch (view) {
    case 'drafts':
      await draftsView();
      break;
    case 'home':
      home();
      break;
    case 'settings':
      settingsView();
      break;
    case 'basket':
      basketView();
      break;
    case 'history':
      historyView();
      break;
    case 'compose':
      await composeView();
      break;
    case 'tabs':
      await tabsView();
      break;
    case 'replies':
      await repliesView();
      break;
    case 'quick':
      quickView();
      break;
    case 'more-capture':
      captureOptions();
      break;
    default:
      home();
  }
}
async function refresh() {
  const previousLanguage = model.settings.language;
  model = await rpc('state');
  if (previousLanguage !== model.settings.language) await rerenderForLocale();
  else await renderCurrent();
  if (model.lastError) toast(errorText(model.lastError));
}
api.runtime.onMessage.addListener((message) => {
  if (
    ['ui.navigate', 'sidepanel.navigate'].includes(message.type) &&
    isSide &&
    message.windowId === sourceWindowId
  ) {
    if (['compose', 'drafts', 'replies'].includes(message.view))
      goToView(message.view).catch((error) => toast(errorText(error)));
    return;
  }
  if (message.type === 'compose.ready' && isSide && message.windowId === sourceWindowId) {
    clearTimeout(draftTimer);
    if (draft) put('drafts', draft);
    draft = null;
    q.set('draft', message.draftId);
    view = 'compose';
    refresh().catch(() => {});
    return;
  }
  if (message.type !== 'state.changed') return;
  if (
    (['compose', 'settings', 'tabs', 'replies'].includes(view) ||
      document.querySelector('.bot-picker[open]')) &&
    model.authenticated
  ) {
    rpc('state')
      .then(async (next) => {
        if (
          next.account?.id !== model.account?.id ||
          next.workspaceId !== model.workspaceId ||
          !next.authenticated
        ) {
          draft = null;
          selectedBotId = '';
          model = next;
          await renderCurrent();
        } else if (next.settings.language !== model.settings.language) {
          model.settings = next.settings;
          await rerenderForLocale();
        }
      })
      .catch(() => {});
    return;
  }
  refresh().catch(() => {});
});
setInterval(() => {
  if (model.loginPending) {
    rpc('login.poll').catch(() => {});
    refresh().catch(() => {});
  }
  if (port)
    try {
      port.postMessage({ type: 'ping' });
    } catch {}
}, 15000);
window.addEventListener('pagehide', () => {
  stopSettingsNavigation();
  if (draft) put('drafts', draft);
  port?.disconnect();
});
try {
  await initI18n({ api, document });
  shortcuts = await api.commands.getAll();
  const target = await rpc('capture.target').catch(() => null);
  sourceTabId = Number(q.get('source')) || target?.id;
  sourceWindowId = isSide
    ? (await api.windows.getCurrent()).id
    : (target?.windowId ?? (await api.windows.getCurrent()).id);
  if (isSide && !q.has('view')) {
    const key = 'composerDraft:' + sourceWindowId;
    const saved = await api.storage.session.get([key, 'sidepanelView:' + sourceWindowId]);
    const savedView = saved['sidepanelView:' + sourceWindowId];
    if (['drafts', 'replies'].includes(savedView)) view = savedView;
    else if (saved[key]) {
      q.set('draft', saved[key]);
      view = 'compose';
    } else if (savedView === 'compose') view = 'drafts';
  }
  await refresh();
} catch (error) {
  shell(`<div class="notice error">${esc(errorText(error))}</div>`);
}
