// Parameter derivation verified against Grok Bot 0.70.2 static client code.
// This module does not load or execute the official renderer or its assets.
export const AVATAR_ALGORITHM_VERSION = 'grok-bot-0.70.2';
export const DEFAULT_SHAPES = Object.freeze([
  'blob',
  'pebble',
  'squircle',
  'tablet',
  'wedge',
  'hex',
  'cloud',
  'teardrop',
]);
export const VALID_SHAPES = Object.freeze([
  'blob',
  'pebble',
  'bean',
  'egg',
  'squircle',
  'tablet',
  'capsule',
  'cylinder',
  'hex',
  'gem',
  'crystal',
  'wedge',
  'shield',
  'dome',
  'arch',
  'cloud',
  'teardrop',
  'leaf',
  'square',
  'sparkle',
  'clover',
  'flower',
  'heart',
  'house',
  'star',
]);
export const DEFAULT_COLORS = Object.freeze([
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'violet',
  'magenta',
  'gray',
]);
const PALETTE = Object.freeze(
  Object.fromEntries(
    [
      ['black', '#000000', '#000000', '#FFFFFF'],
      ['brown', '#936439', '#A27952', '#855C36'],
      ['red', '#FF263C', '#FF3E51', '#E02135'],
      ['orange', '#FF6700', '#FF781C', '#FF6700'],
      ['yellow', '#FF9800', '#FFAF38', '#FF9800'],
      ['green', '#00C972', '#00C972', '#009957'],
      ['cyan', '#00BCA6', '#1CC3B0', '#00A592'],
      ['blue', '#1084FE', '#2A92FE', '#0E74E0'],
      ['violet', '#9159FE', '#A97EFE', '#804EE0'],
      ['magenta', '#FF309B', '#FF5EB1', '#E02A88'],
      ['gray', '#777777', '#959595', '#777777'],
    ].map(([color, baseHex, lightHex, darkHex]) => [
      color,
      Object.freeze({ baseHex, lightHex, darkHex }),
    ]),
  ),
);

export function hashBotId(key) {
  if (typeof key !== 'string' || !key.length) throw new Error('AVATAR_KEY_REQUIRED');
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function deriveDefaultAvatar(key) {
  const hash = hashBotId(key);
  let shapeHash = hash | 0;
  shapeHash = Math.imul(shapeHash ^ (shapeHash >>> 16), 73244475);
  shapeHash = Math.imul(shapeHash ^ (shapeHash >>> 13), 3266489909);
  shapeHash = (shapeHash ^ (shapeHash >>> 16)) >>> 0;
  const shapeIndex = shapeHash % DEFAULT_SHAPES.length;
  // Keep the two independent version salts even though they cancel in 0.70.2.
  const identitySaltVersion = 1,
    paletteSaltVersion = 1;
  const identitySeed = (hash ^ Math.imul(identitySaltVersion, 2654435769)) >>> 0;
  let seed = (identitySeed ^ Math.imul(paletteSaltVersion, 2654435769)) >>> 0;
  seed = (seed + 1831565813) | 0;
  let sample = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  sample = (sample + Math.imul(sample ^ (sample >>> 7), 61 | sample)) ^ sample;
  const random = ((sample ^ (sample >>> 14)) >>> 0) / 4294967296;
  const colorIndex = Math.floor(random * DEFAULT_COLORS.length);
  const shape = DEFAULT_SHAPES[shapeIndex],
    color = DEFAULT_COLORS[colorIndex];
  return {
    algorithmVersion: AVATAR_ALGORITHM_VERSION,
    hash,
    shapeHash,
    shapeIndex,
    colorIndex,
    shape,
    color,
    ...PALETTE[color],
  };
}

// Input is a raw cloud ListGrokBotAgents record: its numeric `id` is not the avatar key.
export function resolveAgentAvatar(agent) {
  if (typeof agent?.agentId !== 'string' || !agent.agentId.length)
    throw new Error('AVATAR_AGENT_ID_REQUIRED');
  const derived = deriveDefaultAvatar(agent.agentId);
  const explicitShape = VALID_SHAPES.includes(agent.avatarShape);
  const explicitColor =
    typeof agent.avatarColor === 'string' && Object.hasOwn(PALETTE, agent.avatarColor);
  const shape = explicitShape ? agent.avatarShape : derived.shape;
  const color = explicitColor ? agent.avatarColor : derived.color;
  const nonempty = (value) => typeof value === 'string' && value.length > 0;
  const url = nonempty(agent.avatarUrl)
    ? agent.avatarUrl
    : nonempty(agent.avatarDataUrl)
      ? agent.avatarDataUrl
      : null;
  const version = nonempty(agent.avatarVersion) ? agent.avatarVersion : null;
  return {
    algorithmVersion: AVATAR_ALGORITHM_VERSION,
    kind: url || version ? 'picture' : 'character',
    character: { shape, color, ...PALETTE[color] },
    sources: {
      shape: explicitShape ? 'explicit' : 'id-default',
      color: explicitColor ? 'explicit' : 'id-default',
    },
    picture: url || version ? { url, version } : null,
  };
}
