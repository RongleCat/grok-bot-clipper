// A single scroll owner drives the settings section navigation.
export function trackSettingsNavigation({ nav, sections, scroller }) {
  const window = nav.ownerDocument.defaultView;
  const isWindow = scroller === window;
  let frame;
  function update() {
    frame = undefined;
    if (!nav.isConnected || !sections.length) return;
    const threshold = (isWindow ? 0 : scroller.getBoundingClientRect().top) + 96;
    let current = sections[0];
    for (const section of sections)
      if (section.getBoundingClientRect().top <= threshold) current = section;
    const top = isWindow ? window.scrollY : scroller.scrollTop;
    const height = isWindow ? window.innerHeight : scroller.clientHeight;
    const total = isWindow ? nav.ownerDocument.documentElement.scrollHeight : scroller.scrollHeight;
    if (top > 0 && total > height && top + height >= total - 2) current = sections.at(-1);
    for (const link of nav.querySelectorAll('a')) {
      if (link.hash === '#' + current.id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }
  function schedule() {
    frame ??= window.requestAnimationFrame(update);
  }
  scroller.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  update();
  return () => {
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    scroller.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
  };
}
