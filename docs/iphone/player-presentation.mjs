// The header, media and settings share one presentation state. Android's video
// custom view has its own native exit buttons and calls nativeChanged on exit.
export function createPlayerPresentation({ sheet, onClose }) {
  const panel = sheet.querySelector('.sheet-panel');
  const header = sheet.querySelector('.sheet-head');
  const reveal = sheet.querySelector('.player-chrome-reveal');
  const buttons = [...sheet.querySelectorAll('#playerExpand, #playerFullscreen')];
  let expanded = false, native = false, previousScroll = 0, operation = 0;
  let hideTimer = null;
  const controlsHidden = () => sheet.classList.contains('is-chrome-hidden');
  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const active = () => expanded || native || Boolean(fullscreenElement());
  function setControlsHidden(hidden) {
    if (hidden && header.contains(document.activeElement)) panel.focus({ preventScroll: true });
    sheet.classList.toggle('is-chrome-hidden', hidden);
    header.setAttribute('aria-hidden', String(hidden));
  }
  function scheduleHide() {
    clearTimeout(hideTimer); hideTimer = null;
    if (!expanded || native || !sheet.classList.contains('is-open') || panel.scrollTop > 40) return;
    hideTimer = setTimeout(() => { hideTimer = null; setControlsHidden(true); }, 3000);
  }
  function revealControls() {
    setControlsHidden(false);
    scheduleHide();
  }
  // The first remote press only reveals controls; it must not activate an
  // invisible close/restore target left focused by the previous interaction.
  function handleRemote(key) {
    if (!expanded || native || !['UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER'].includes(key)) return false;
    const hidden = controlsHidden();
    revealControls();
    if (hidden) buttons[0]?.focus({ preventScroll: true });
    return hidden;
  }
  function sync() {
    sheet.classList.toggle('is-expanded', expanded);
    for (const button of buttons) {
      button.disabled = false;
      button.textContent = active() ? '縮回' : button.id === 'playerExpand' ? '放大' : '全螢幕';
      button.setAttribute('aria-label', active() ? '縮回一般畫面' : '放大全螢幕');
      button.setAttribute('aria-pressed', String(active()));
    }
    revealControls();
  }
  async function enter() {
    if (!sheet.classList.contains('is-open') || active()) return;
    const token = ++operation;
    previousScroll = panel.scrollTop;
    expanded = true; panel.scrollTop = 0; sync();
    // The car already owns the entire display. Keep its web header in the same
    // touch surface instead of requesting a video-only Android custom view.
    if (!window.CarBridge && panel.requestFullscreen) {
      try { await panel.requestFullscreen(); }
      catch { /* The equally usable viewport layout is the fallback. */ }
      if (token !== operation && fullscreenElement()) await leaveBrowserFullscreen();
    }
  }
  async function leaveBrowserFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen?.();
      else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
    } catch { /* Native callbacks also restore the controls. */ }
  }
  async function exit({ fromNative = false } = {}) {
    ++operation;
    expanded = false; native = false; sync();
    if (!fromNative) { try { window.CarBridge?.exitPlayerFullscreen?.(); } catch {} }
    await leaveBrowserFullscreen();
    panel.scrollTop = previousScroll;
  }
  function nativeChanged(value) {
    native = Boolean(value);
    if (!native) { expanded = false; ++operation; panel.scrollTop = previousScroll; }
    sync();
  }
  async function closeFromNative() { await exit({ fromNative: true }); onClose(); }
  const toggle = () => active() ? exit() : enter();
  for (const button of buttons) button.addEventListener('click', () => void toggle());
  reveal?.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation(); revealControls();
  });
  sheet.addEventListener('pointerdown', event => {
    // Keep the reveal surface through pointerup/click so a tap at the old
    // close-button position cannot fall through and close the movie.
    if (event.target === reveal) return;
    revealControls();
  }, true);
  sheet.addEventListener('pointermove', event => {
    if (expanded && event.pointerType === 'mouse' && (event.movementX || event.movementY)) {
      revealControls();
    }
  }, { passive: true });
  panel.addEventListener('scroll', revealControls, { passive: true });
  header.addEventListener('focusin', revealControls);
  for (const event of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(event, () => {
    if (!fullscreenElement() && !native) { expanded = false; panel.scrollTop = previousScroll; }
    sync();
  });
  document.addEventListener('keydown', event => {
    if (!sheet.classList.contains('is-open')) return;
    if (event.key === 'Escape' && active()) {
      event.preventDefault(); event.stopImmediatePropagation(); void exit();
    } else if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey
        && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName) && !event.target.isContentEditable) {
      event.preventDefault(); void toggle();
    } else if (expanded && !native) {
      const hidden = controlsHidden(); revealControls();
      if (hidden && ['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation(); buttons[0]?.focus({ preventScroll: true });
      }
    }
  }, true);
  sync();
  return { enter, exit, toggle, active, nativeChanged, closeFromNative, revealControls, handleRemote };
}
