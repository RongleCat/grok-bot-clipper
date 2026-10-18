import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { trackSettingsNavigation } from '../src/ui/navigation.js';

test('settings selection follows scrolling, reaches the final section and stops after cleanup', async () => {
  const dom = new JSDOM(
    '<!doctype html><nav><a href="#one">One</a><a href="#two">Two</a><a href="#three">Three</a></nav><section id="one"></section><section id="two"></section><section id="three"></section>',
    { pretendToBeVisual: true },
  );
  const w = dom.window,
    nav = w.document.querySelector('nav'),
    sections = [...w.document.querySelectorAll('section')];
  let top = 0;
  sections.forEach(
    (section, i) => (section.getBoundingClientRect = () => ({ top: i * 500 - top })),
  );
  Object.defineProperties(w.document.documentElement, {
    scrollHeight: { value: 1800 },
    clientHeight: { value: 600 },
  });
  Object.defineProperty(w, 'innerHeight', { value: 600 });
  Object.defineProperty(w, 'scrollY', { get: () => top });
  const stop = trackSettingsNavigation({ nav, sections, scroller: w });
  const selected = () => nav.querySelector('[aria-current]').getAttribute('href');
  assert.equal(selected(), '#one');
  top = 540;
  w.dispatchEvent(new w.Event('scroll'));
  await new Promise((r) => w.requestAnimationFrame(r));
  assert.equal(selected(), '#two');
  top = 1200;
  w.dispatchEvent(new w.Event('scroll'));
  await new Promise((r) => w.requestAnimationFrame(r));
  assert.equal(selected(), '#three');
  stop();
  top = 0;
  w.dispatchEvent(new w.Event('scroll'));
  await new Promise((r) => w.requestAnimationFrame(r));
  assert.equal(selected(), '#three');
  w.close();
});
