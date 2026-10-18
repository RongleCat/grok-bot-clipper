import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
globalThis.createImageBitmap = async (blob) => {
  const img = await loadImage(new Uint8Array(await blob.arrayBuffer()));
  img.close = () => {};
  return img;
};
globalThis.OffscreenCanvas = class {
  constructor(w, h) {
    this.canvas = createCanvas(w, h);
    this.width = w;
    this.height = h;
  }
  getContext(type) {
    return this.canvas.getContext(type);
  }
  async convertToBlob() {
    return new Blob([await this.canvas.encode('png')], { type: 'image/png' });
  }
};
test('crop and redaction replace actual uploaded pixels', async () => {
  const { editImage } = await import('../src/core/images.js');
  const c = createCanvas(100, 80),
    x = c.getContext('2d');
  x.fillStyle = '#ff0000';
  x.fillRect(0, 0, 100, 80);
  const result = await editImage(new Blob([await c.encode('png')], { type: 'image/png' }), {
    rect: { x: 10, y: 10, width: 60, height: 50 },
    operations: [{ kind: 'redact', x: 20, y: 20, width: 20, height: 20 }],
  });
  const image = await loadImage(new Uint8Array(await result.blob.arrayBuffer())),
    out = createCanvas(image.width, image.height),
    ctx = out.getContext('2d');
  ctx.drawImage(image, 0, 0);
  assert.equal(image.width, 60);
  assert.equal(image.height, 50);
  assert.deepEqual([...ctx.getImageData(15, 15, 1, 1).data], [22, 26, 24, 255]);
  assert.deepEqual([...ctx.getImageData(0, 0, 1, 1).data], [255, 0, 0, 255]);
});
test('crop rectangles are bounded and reject empty selections', async () => {
  const { boundedRect } = await import('../src/core/images.js');
  assert.deepEqual(boundedRect({ x: -20, y: 5, width: 50, height: 200 }, 100, 80), {
    x: 0,
    y: 5,
    width: 30,
    height: 75,
  });
  assert.throws(
    () => boundedRect({ x: 200, y: 200, width: 10, height: 10 }, 100, 80),
    /EMPTY_CROP/,
  );
});
test('long screenshots split into bounded PNG tiles without losing pixels', async () => {
  const { stitchImages } = await import('../src/core/images.js');
  const c = createCanvas(10, 12),
    ctx = c.getContext('2d');
  ctx.fillStyle = '#00ff00';
  ctx.fillRect(0, 0, 10, 12);
  const blob = new Blob([await c.encode('png')]);
  const output = await stitchImages(
    [
      { blob, y: 0 },
      { blob, y: 12 },
    ],
    { width: 10, height: 24, scale: 1, maxTileHeight: 15 },
  );
  assert.equal(output.length, 2);
  const first = await loadImage(new Uint8Array(await output[0].blob.arrayBuffer())),
    second = await loadImage(new Uint8Array(await output[1].blob.arrayBuffer()));
  assert.equal(first.height + second.height, 24);
  assert.equal(first.height, 15);
  assert.equal(second.height, 9);
});
test('redaction also removes automatic text, URLs and other attachments', async () => {
  const { redactedMaterial } = await import('../src/core/images.js');
  const item = {
    id: 'redact',
    accountId: 'a',
    kind: 'screenshot',
    markdown: 'SECRET',
    url: 'https://example.com/SECRET',
    title: 'SECRET',
    selection: 'SECRET',
    codes: [{ text: 'SECRET' }],
    attachments: [
      { name: 'first.png', blob: new Blob(['first']) },
      { name: 'second.png', blob: new Blob(['second']) },
    ],
  };
  const out = redactedMaterial(item, 0);
  assert.ok(!JSON.stringify(out).includes('SECRET'));
  assert.equal(out.attachments.length, 1);
  assert.equal(out.attachments[0].name, 'redacted.png');
  assert.equal(out.accountId, 'a');
});
