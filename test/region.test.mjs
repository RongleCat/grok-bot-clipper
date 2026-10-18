import test from 'node:test';
import assert from 'node:assert/strict';
import { regionRect, pixelRegion } from '../src/core/region.js';
import { icon } from '../src/ui/icons.js';
test('region selection supports reverse dragging and viewport bounds', () => {
  assert.deepEqual(regionRect({ x: 300, y: 200 }, { x: 20, y: 40 }, 800, 600), {
    x: 20,
    y: 40,
    width: 280,
    height: 160,
  });
  assert.deepEqual(regionRect({ x: -2, y: 10 }, { x: 900, y: 700 }, 800, 600), {
    x: 0,
    y: 10,
    width: 800,
    height: 590,
  });
});
test('region converts CSS coordinates to actual captured pixels', () => {
  assert.deepEqual(
    pixelRegion(
      { x: 10, y: 20, width: 300, height: 120 },
      { width: 800, height: 600 },
      { width: 1600, height: 1200 },
    ),
    { x: 20, y: 40, width: 600, height: 240 },
  );
  assert.throws(
    () =>
      pixelRegion(
        { x: 0, y: 0, width: 0, height: 0 },
        { width: 800, height: 600 },
        { width: 800, height: 600 },
      ),
    /INVALID_CAPTURE_REGION/,
  );
});
test('UI icon adapter serializes official Lucide nodes', () => {
  assert.match(icon('close'), /M18 6 6 18/);
  assert.match(icon('capture'), /class="lucide"/);
  assert.doesNotMatch(icon('capture'), /undefined/);
});
