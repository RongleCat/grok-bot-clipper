// Never search or close other Cursor tabs; only the tab created for this flow.
export async function closeLoginTab(tabs, flow) {
  if (!Number.isInteger(flow?.tabId)) return;
  try {
    const tab = await tabs.get(flow.tabId);
    const current = new URL(tab.pendingUrl || tab.url);
    const login = new URL(flow.loginUrl);
    const uuid = current.searchParams.get('uuid');
    if (current.origin !== login.origin || (uuid && uuid !== flow.uuid)) return;
    // Successful authorization can redirect within Cursor and discard the initial path.
    // The stored tab id and origin identify this flow, rather than its landing path.
    await tabs.remove(flow.tabId);
  } catch {
    /* Closing or navigating the login tab must not invalidate acquired credentials. */
  }
}
