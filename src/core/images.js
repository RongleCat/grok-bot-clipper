export function boundedRect(rect, width, height) {
  const r = rect ?? { x: 0, y: 0, width, height };
  if (![r.x, r.y, r.width, r.height, width, height].every(Number.isFinite))
    throw Error('INVALID_CROP');
  const x = Math.max(0, Math.floor(r.x)),
    y = Math.max(0, Math.floor(r.y)),
    right = Math.min(width, Math.ceil(r.x + r.width)),
    bottom = Math.min(height, Math.ceil(r.y + r.height));
  if (right <= x || bottom <= y) throw Error('EMPTY_CROP');
  return { x, y, width: right - x, height: bottom - y };
}
export async function editImage(blob, { rect, operations = [] } = {}) {
  const image = await createImageBitmap(blob);
  try {
    const r = boundedRect(rect, image.width, image.height);
    if (r.width * r.height > 64 * 1024 * 1024 || r.width > 30000 || r.height > 30000)
      throw Error('IMAGE_TOO_LARGE');
    const canvas = new OffscreenCanvas(r.width, r.height),
      ctx = canvas.getContext('2d');
    ctx.drawImage(image, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height);
    for (const op of operations) {
      if (![op.x, op.y, op.width, op.height].every(Number.isFinite))
        throw Error('INVALID_ANNOTATION');
      const x = op.x - r.x,
        y = op.y - r.y;
      ctx.fillStyle = '#161a18';
      ctx.strokeStyle = '#ef6647';
      ctx.lineWidth = Math.max(3, canvas.width / 300);
      if (op.kind === 'redact') ctx.fillRect(x, y, op.width, op.height);
      if (op.kind === 'arrow') {
        const ex = x + op.width,
          ey = y + op.height,
          a = Math.atan2(op.height, op.width);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - 14 * Math.cos(a - 0.5), ey - 14 * Math.sin(a - 0.5));
        ctx.lineTo(ex - 14 * Math.cos(a + 0.5), ey - 14 * Math.sin(a + 0.5));
        ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      }
    }
    return {
      blob: await canvas.convertToBlob({ type: 'image/png' }),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    image.close();
  }
}
export async function stitchImages(
  frames,
  { width, height, scale = 1, maxTileHeight = 16000 } = {},
) {
  const pixelsWide = Math.round(width * scale),
    pixelsHigh = Math.round(height * scale);
  if (
    !Number.isSafeInteger(pixelsWide) ||
    !Number.isSafeInteger(pixelsHigh) ||
    pixelsWide < 1 ||
    pixelsHigh < 1 ||
    pixelsWide > 16384 ||
    pixelsHigh > 120000
  )
    throw Error('IMAGE_TOO_LARGE');
  const tileHeight = Math.min(16000, maxTileHeight, Math.floor((48 * 1024 * 1024) / pixelsWide));
  if (tileHeight < 1) throw Error('IMAGE_TOO_LARGE');
  const result = [];
  for (let top = 0; top < pixelsHigh; top += tileHeight) {
    const h = Math.min(tileHeight, pixelsHigh - top),
      canvas = new OffscreenCanvas(pixelsWide, h),
      ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, pixelsWide, h);
    for (const frame of frames) {
      const image = await createImageBitmap(frame.blob);
      try {
        const y = Math.round(frame.y * scale) - top;
        if (y < h && y + image.height > 0) ctx.drawImage(image, 0, y);
      } finally {
        image.close();
      }
    }
    result.push({
      blob: await canvas.convertToBlob({ type: 'image/png' }),
      startY: top / scale,
      endY: (top + h) / scale,
    });
  }
  return result;
}
export function redactedMaterial(item, index) {
  return {
    id: item.id,
    accountId: item.accountId,
    kind: item.kind,
    title: '已打码图片',
    url: '',
    markdown: '',
    createdAt: item.createdAt,
    capturedAt: item.capturedAt,
    updatedAt: Date.now(),
    inBasket: item.inBasket,
    redacted: true,
    warnings: ['打码后已移除自动提取文字、来源信息及其他附件'],
    attachments: [{ name: 'redacted.png', blob: item.attachments[index].blob }],
  };
}
