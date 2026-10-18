import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AvatarMark, toBody, appearance, renderStill } from '../../vendor/desktop-avatar/engine.js';
import { resolveAgentAvatar } from '../sdk/avatar.js';
const instances = new Map();
let stillSequence = 0;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
function character(bot) {
  return (
    bot.avatar?.character ??
    resolveAgentAvatar({
      agentId: bot.id,
      avatarShape: bot.avatarShape,
      avatarColor: bot.avatarColor,
    }).character
  );
}
function paint(el, entry) {
  const bot = entry.bot,
    look = character(bot),
    size = Number(el.dataset.size) || 44;
  const picture = bot.avatar?.picture?.url;
  if (picture && /^(https?:|data:image\/)/.test(picture)) {
    entry.root.render(createElement('img', { src: picture, alt: '', draggable: false }));
    return;
  }
  entry.root.render(
    createElement(AvatarMark, {
      key: `${bot.id}:${reduced.matches}`,
      body: toBody(look.shape),
      appearance: appearance(look.baseHex),
      size,
      state: 'idle',
      seed: bot.id,
      isPlaying: !document.hidden && !reduced.matches,
      isStatic: reduced.matches,
      isFollowingPointer: !reduced.matches,
      maxFrameRate: 30,
    }),
  );
}
export function mountAvatars(root, bots) {
  for (const [el, entry] of instances)
    if (!el.isConnected) {
      entry.root.unmount();
      instances.delete(el);
    }
  for (const el of root.querySelectorAll('[data-avatar]')) {
    const bot = bots.find((b) => b.id === el.dataset.avatar);
    if (!bot) continue;
    let entry = instances.get(el);
    if (!entry) {
      const look = character(bot);
      // The native still renderer also owns the initial frame; no substitute SVG.
      el.innerHTML = renderStill({
        id: `native-still-${++stillSequence}`,
        body: toBody(look.shape),
        ink: look.baseHex,
        size: Number(el.dataset.size) || 44,
      });
      entry = { root: createRoot(el), bot };
      instances.set(el, entry);
    }
    entry.bot = bot;
    paint(el, entry);
  }
}
export function releaseAvatars(scope) {
  for (const [el, entry] of instances) {
    if (!el.isConnected || scope.contains(el)) {
      entry.root.unmount();
      instances.delete(el);
    }
  }
}
function refreshMotion() {
  for (const [el, entry] of instances) if (el.isConnected) paint(el, entry);
}
document.addEventListener('visibilitychange', refreshMotion);
reduced.addEventListener('change', refreshMotion);
function disposeAvatars() {
  for (const entry of instances.values()) entry.root.unmount();
  instances.clear();
}
window.addEventListener('pagehide', disposeAvatars);
