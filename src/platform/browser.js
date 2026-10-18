import { createPrivateLocalStorage } from './storage.js';

export function createBrowserPlatform(raw = {}, { firefox = false, indexedDB } = {}) {
  const api = firefox
    ? {
        ...raw,
        action: raw.browserAction,
        storage: {
          ...raw.storage,
          local: createPrivateLocalStorage({ indexedDB }),
        },
      }
    : raw;
  return {
    api,
    isFirefox: firefox,
    // Keep the native call before any await, so the original gesture survives.
    openSidePanel: (options) => (firefox ? raw.sidebarAction.open() : raw.sidePanel.open(options)),
    shortcutsURL: firefox ? 'about:addons' : 'chrome://extensions/shortcuts',
    async protectStorage() {
      if (firefox) return; // private local DB + Firefox's privileged native session area
      await raw.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      await raw.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    },
  };
}
const firefox =
  typeof __BROWSER_TARGET__ !== 'undefined'
    ? __BROWSER_TARGET__ === 'firefox'
    : Boolean(globalThis.browser?.runtime?.getBrowserInfo);
const platform = createBrowserPlatform(firefox ? globalThis.browser : globalThis.chrome, {
  firefox,
});
export const { api, isFirefox, openSidePanel, shortcutsURL, protectStorage } = platform;
