import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const asarPath = process.argv[2] ?? '/Applications/Grok Bot.app/Contents/Resources/app.asar';
const archive = readFileSync(asarPath),
  headerBytes = archive.readUInt32LE(4),
  jsonBytes = archive.readUInt32LE(12);
const header = JSON.parse(archive.subarray(16, 16 + jsonBytes).toString('utf8'));
const assets = header.files.dist.files.renderer.files.assets.files;
const assetName = Object.keys(assets).find(
  (n) => n.startsWith('index.eager-platform-') && n.endsWith('.js'),
);
if (!assetName) throw Error('Desktop avatar renderer unavailable');
const asset = assets[assetName],
  offset = 8 + headerBytes + Number(asset.offset);
const source = archive.subarray(offset, offset + asset.size).toString('utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
const scope = analyze(ast, {
  ecmaVersion: 2024,
  sourceType: 'module',
  optimistic: true,
  ignoreEval: true,
});
const moduleScope = scope.scopes.find((s) => s.type === 'module');
const pieces = [];
for (const n of ast.body) {
  if (n.type === 'VariableDeclaration')
    for (const d of n.declarations)
      pieces.push({ node: d, text: n.kind + ' ' + source.slice(d.start, d.end) + ';' });
  else if (n.type !== 'ExportNamedDeclaration' && n.type !== 'ExpressionStatement')
    pieces.push({ node: n, text: source.slice(n.start, n.end) });
}
const owner = (pos) => pieces.find((p) => pos >= p.node.start && pos < p.node.end);
const binding = new Map(moduleScope.variables.map((v) => [v.name, owner(v.identifiers[0]?.start)]));
const graph = new Map(pieces.map((p) => [p, new Set()]));
for (const v of moduleScope.variables)
  for (const ref of v.references) {
    const from = owner(ref.identifier.start),
      to = binding.get(v.name);
    if (from && to && from !== to) graph.get(from).add(to);
  }
const chosen = new Set();
function visit(p) {
  if (!p || chosen.has(p)) return;
  chosen.add(p);
  for (const dep of graph.get(p)) visit(dep);
}
const exports = {
  AvatarMark: 'KN',
  toBody: 'YN',
  renderStill: 'aP',
  appearance: 'sP',
  createAvatarEngine: 'ih',
};
for (const name of Object.values(exports)) visit(binding.get(name));
const usedImports = [];
for (const p of chosen)
  if (p.node.type === 'ImportDeclaration') {
    const names = p.node.specifiers.filter((spec) =>
      moduleScope.variables
        .find((v) => v.name === spec.local.name)
        ?.references.some((r) => chosen.has(owner(r.identifier.start))),
    );
    usedImports.push({
      source: p.node.source.value,
      names: names.map((n) => ({ imported: n.imported?.name, local: n.local.name })),
    });
  }
console.log(JSON.stringify(usedImports, null, 2));
const imports = usedImports.flatMap((x) =>
  x.names.map((n) => {
    const map = {
      M: ['react/jsx-runtime', '*'],
      k: ['react', '*'],
      Ee: ['react/compiler-runtime', '*'],
    };
    if (!map[n.local]) throw Error('Unmapped dependency ' + n.local + ' ' + n.imported);
    const [pkg, name] = map[n.local];
    return `import * as ${n.local} from '${pkg}';`;
  }),
);
const code = pieces
  .filter((p) => chosen.has(p) && p.node.type !== 'ImportDeclaration')
  .map((p) => p.text)
  .join('\n');
mkdirSync('vendor/desktop-avatar', { recursive: true });
writeFileSync(
  'vendor/desktop-avatar/engine.js',
  `// Extracted verbatim declarations from Grok Bot 0.70.2 desktop renderer.\n// See PROVENANCE.md. No geometry or motion math has been rewritten.\n${imports.join('\n')}\n${code}\nexport {${Object.entries(
    exports,
  )
    .map(([a, b]) => `${b} as ${a}`)
    .join(',')}};\n`,
);
writeFileSync(
  'vendor/desktop-avatar/provenance.json',
  JSON.stringify(
    {
      appVersion: '0.70.2',
      asset: assetName,
      sourceSHA256: sha(source),
      declarations: chosen.size,
      engineSHA256: sha(readFileSync('vendor/desktop-avatar/engine.js')),
      exports,
    },
    null,
    2,
  ) + '\n',
);
console.log('Extracted native avatar declarations:', chosen.size, 'bytes:', code.length);
