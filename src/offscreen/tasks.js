import { t } from '../i18n/index.js';
import { editImage, stitchImages, redactedMaterial } from '../core/images.js';
import { get, put } from '../core/db.js';
import { renderStill, toBody } from '../../vendor/desktop-avatar/engine.js';
import { GrokBotClient } from '../sdk/client.js';
import { runJob } from '../core/outbox.js';

export function createTaskProcessor({
  api,
  authorize: checkScope = async (scope) => {
    const result = await api.runtime.sendMessage({ type: 'auth.check', ...scope });
    return Boolean(result?.ok && result.value?.allowed);
  },
  notify = () => api.runtime.sendMessage({ type: 'state.changed' }),
  createClient = (options) => new GrokBotClient(options),
}) {
  const runningJobs = new Map();
  let activeGeneration;
  async function runStoredJob({ jobId, credentials, accountId, generation }) {
    if (runningJobs.has(jobId)) return runningJobs.get(jobId).promise;
    const control = new AbortController();
    const promise = (async () => {
      const job = await get('jobs', jobId);
      if (!job || job.accountId !== accountId) throw Error('ACCOUNT_CHANGED');
      const authorize = async () => {
        if (activeGeneration && activeGeneration !== generation) throw Error('ACCOUNT_CHANGED');
        if (!(await checkScope({ generation, accountId, workspaceId: job.workspaceId })))
          throw Error('ACCOUNT_CHANGED');
        control.signal.throwIfAborted();
        activeGeneration = generation;
      };
      await authorize();
      const client = createClient({
        accessToken: credentials.accessToken,
        teamId: job.teamId ?? credentials.selectedTeamId,
      });
      await runJob(job, {
        client,
        signal: control.signal,
        authorize,
        save: async (row) => {
          await put('jobs', row);
          Promise.resolve(notify()).catch(() => {});
        },
      });
      return { id: job.id, state: job.state };
    })().finally(() => runningJobs.delete(jobId));
    runningJobs.set(jobId, { control, promise });
    return promise;
  }
  async function abortJobs() {
    for (const job of runningJobs.values()) job.control.abort();
    return { ok: true };
  }
  async function invalidateAuth({ generation }) {
    activeGeneration = generation;
    return abortJobs();
  }
  async function jobStatus() {
    return [...runningJobs.keys()];
  }
  async function bitmap(blob) {
    return createImageBitmap(blob);
  }
  async function transform({ materialId, index = 0, rect, operations = [] }) {
    const item = await get('materials', materialId);
    if (!item) throw Error('MATERIAL_UNAVAILABLE');
    const result = await editImage(item.attachments[index].blob, { rect, operations });
    item.attachments[index] = { ...item.attachments[index], blob: result.blob };
    item.updatedAt = Date.now();
    await put(
      'materials',
      operations.some((op) => op.kind === 'redact') ? redactedMaterial(item, index) : item,
    );
    return { width: result.width, height: result.height };
  }
  async function stitch({ materialId, frames, width, height, scale }) {
    const parts = [];
    for (const frame of frames)
      parts.push({ y: frame.y, blob: await (await fetch(frame.data)).blob() });
    const tiles = await stitchImages(parts, { width, height, scale }),
      item = await get('materials', materialId);
    item.attachments = tiles.map((tile, i) => ({
      name: tiles.length > 1 ? `full-page-${i + 1}.png` : 'full-page.png',
      blob: tile.blob,
    }));
    if (tiles.length > 1) {
      item.warnings ??= [];
      item.warnings.push(
        t('长截图已分为 {count} 个按顺序命名的 PNG 文件', { count: tiles.length }),
      );
    }
    await put('materials', item);
    return { tiles: tiles.length };
  }
  async function icon({ bot }) {
    const image = new Image();
    image.src =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(renderStill({ body: toBody('blob'), ink: '#000000', size: 128 }));
    await image.decode();
    const out = {};
    for (const size of [16, 32, 48, 128]) {
      const c = new OffscreenCanvas(size, size),
        x = c.getContext('2d');
      x.drawImage(image, 0, 0, size, size);
      out[size] = Array.from(x.getImageData(0, 0, size, size).data);
    }
    return out;
  }
  async function pdf({ materialId, index = 0 }) {
    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/build/pdf.mjs');
    GlobalWorkerOptions.workerSrc = api.runtime.getURL('pdf.worker.min.mjs');
    const item = await get('materials', materialId),
      blob = item.attachments[index].blob;
    const doc = await getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i),
        c = await page.getTextContent();
      text +=
        '\n\n## ' +
        t('第 {page} 页', { page: i }) +
        '\n\n' +
        c.items.map((x) => x.str + (x.hasEOL ? '\n' : ' ')).join('');
      if (text.length > 2000000) {
        item.warnings ??= [];
        item.warnings.push(t('PDF 提取文字超过 200 万字符，其余内容保留在原文件中'));
        break;
      }
    }
    item.markdown = (item.markdown ?? '') + text;
    await doc.destroy();
    await put('materials', item);
    return { pages: doc.numPages };
  }
  return {
    transform,
    stitch,
    icon,
    pdf,
    'job.run': runStoredJob,
    'jobs.abort': abortJobs,
    'auth.invalidate': invalidateAuth,
    'jobs.status': jobStatus,
  };
}
