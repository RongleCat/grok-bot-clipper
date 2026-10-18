import { pinyin } from 'pinyin-pro';

const index = new WeakMap();
function normalize(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/u\u0308/g, 'v')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/gu, '');
}
function keys(bot) {
  const name = bot.name || '';
  const cached = index.get(bot);
  if (cached?.name === name) return cached.keys;
  const syllables = pinyin(name, { toneType: 'none', type: 'array' });
  const values = [
    normalize(name),
    normalize(syllables.join('')),
    normalize(syllables.map((s) => s[0] || '').join('')),
  ];
  index.set(bot, { name, keys: values });
  return values;
}

// Equal matches retain roster order, including any existing favorite ordering.
export function searchBots(bots, query) {
  const term = normalize(query);
  if (!term) return [...bots];
  return bots
    .map((bot) => ({
      bot,
      rank: Math.min(
        ...keys(bot).map((key) =>
          key === term ? 0 : key.startsWith(term) ? 1 : key.includes(term) ? 2 : Infinity,
        ),
      ),
    }))
    .filter(({ rank }) => Number.isFinite(rank))
    .sort((a, b) => a.rank - b.rank)
    .map(({ bot }) => bot);
}
