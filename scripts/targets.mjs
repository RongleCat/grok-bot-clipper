export function buildTarget(name = 'chrome') {
  if (!['chrome', 'firefox'].includes(name)) throw Error('UNKNOWN_BUILD_TARGET: ' + name);
  return {
    name,
    outdir: name === 'firefox' ? 'dist-firefox' : 'dist',
    esbuildTarget: name === 'firefox' ? 'firefox140' : 'chrome120',
  };
}
export function manifestFor(source, name = 'chrome') {
  buildTarget(name);
  const manifest = structuredClone(source);
  if (name === 'chrome') return manifest;
  manifest.manifest_version = 2;
  manifest.web_accessible_resources = [
    ...new Set((manifest.web_accessible_resources || []).flatMap((entry) => entry.resources)),
  ];
  manifest.background = { page: 'background.html', persistent: true };
  manifest.browser_action = manifest.action;
  manifest.sidebar_action = {
    default_title: manifest.name,
    default_panel: 'sidepanel.html',
    default_icon: manifest.icons['32'],
  };
  manifest.permissions = [
    ...manifest.permissions.filter(
      (permission) => !['sidePanel', 'offscreen', 'pageCapture'].includes(permission),
    ),
    ...manifest.host_permissions,
  ];
  manifest.optional_permissions = [
    ...(manifest.optional_permissions || []),
    ...manifest.optional_host_permissions,
  ];
  manifest.content_security_policy = manifest.content_security_policy.extension_pages;
  manifest.browser_specific_settings = {
    gecko: {
      id: 'grok-bot-browser@ronglecat.local',
      strict_min_version: '140.0',
      data_collection_permissions: {
        required: ['authenticationInfo', 'websiteContent', 'browsingActivity'],
      },
    },
  };
  manifest.browser_specific_settings.gecko_android = { strict_min_version: '142.0' };
  for (const key of [
    'action',
    'side_panel',
    'minimum_chrome_version',
    'host_permissions',
    'optional_host_permissions',
  ])
    delete manifest[key];
  return manifest;
}
