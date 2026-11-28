// One browser-history guard lets Back dismiss sheets without leaving the app.
export function createSheetNavigation({ sheets, background, onDismiss }) {
  // A modal guard is not page navigation. Automatic history restoration can
  // undo the explicit scroll-to-top after HOME and hide inputs under the nav.
  history.scrollRestoration = 'manual';
  const order = [], focusBefore = new Map();
  let armed = false, pendingPop = false;
  if (history.state?.oktvSheetGuard) {
    const state = { ...history.state }; delete state.oktvSheetGuard;
    history.replaceState(state, '');
  }
  const top = () => order.at(-1);
  function guard() {
    if (order.length && !armed && !pendingPop) {
      history.pushState({ ...history.state, oktvSheetGuard: true }, '');
      armed = true;
    }
  }
  function sync() {
    document.body.classList.toggle('modal-open', Boolean(order.length));
    if (background) background.inert = Boolean(order.length);
    for (const sheet of sheets) {
      const active = sheet === top();
      sheet.inert = !active;
      sheet.setAttribute('aria-hidden', String(!active));
      const panel = sheet.querySelector('.sheet-panel');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', String(active));
      panel.setAttribute('aria-label', sheet.querySelector('.sheet-head strong')?.textContent || '視窗');
      panel.tabIndex = -1;
    }
    guard();
  }
  function open(sheet) {
    const index = order.indexOf(sheet);
    if (index >= 0) order.splice(index, 1);
    else focusBefore.set(sheet, document.activeElement);
    order.push(sheet); sheet.classList.add('is-open'); sync();
    sheet.querySelector('.sheet-head button, .sheet-panel')?.focus({ preventScroll: true });
  }
  function close(sheet) {
    const index = order.indexOf(sheet); if (index < 0) return;
    const wasTop = sheet === top();
    order.splice(index, 1); sheet.classList.remove('is-open'); sync();
    if (wasTop) {
      const previous = focusBefore.get(sheet);
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
      else top()?.querySelector('.sheet-head button, .sheet-panel')?.focus({ preventScroll: true });
    }
    focusBefore.delete(sheet);
    if (!order.length && armed) {
      armed = false; pendingPop = true; history.back();
    }
  }
  window.addEventListener('popstate', () => {
    if (pendingPop) { pendingPop = false; guard(); return; }
    armed = false;
    if (top()) onDismiss(top());
    guard();
  });
  document.addEventListener('keydown', event => {
    const sheet = top(); if (!sheet) return;
    if (event.key === 'Escape') { event.preventDefault(); onDismiss(sheet); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...sheet.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], video[controls], iframe, [tabindex="0"]')]
      .filter(element => !element.closest('[hidden], .hidden, [inert]') && element.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (!first) { event.preventDefault(); sheet.querySelector('.sheet-panel').focus(); }
    else if (event.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  });
  sync();
  return { open, close, dismissTop() { if (!top()) return false; onDismiss(top()); return true; } };
}
