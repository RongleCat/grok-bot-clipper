export function regionRect(start, end, width, height) {
  const clamp = (n, max) => Math.max(0, Math.min(max, n));
  const x1 = clamp(start.x, width),
    x2 = clamp(end.x, width);
  const y1 = clamp(start.y, height),
    y2 = clamp(end.y, height);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}
export function pixelRegion(rect, viewport, image) {
  if (
    ![rect.x, rect.y, rect.width, rect.height, viewport.width, viewport.height].every(
      Number.isFinite,
    ) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    rect.width < 4 ||
    rect.height < 4 ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > viewport.width + 1 ||
    rect.y + rect.height > viewport.height + 1
  )
    throw Error('INVALID_CAPTURE_REGION');
  const x = Math.round((rect.x * image.width) / viewport.width),
    y = Math.round((rect.y * image.height) / viewport.height);
  return {
    x,
    y,
    width: Math.min(image.width - x, Math.round((rect.width * image.width) / viewport.width)),
    height: Math.min(image.height - y, Math.round((rect.height * image.height) / viewport.height)),
  };
}
