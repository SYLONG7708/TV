(function installYingshiTvRemote() {
  'use strict';
  if (window.__yingshiTvRemote) {
    window.__yingshiTvRemote.refresh();
    return;
  }

  var selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[role="button"]',
    '[tabindex]',
    '.poster-card',
    '.episode-chip',
    '.source-chip',
    '.nav-item',
    '.filter-chip'
  ].join(',');
  var generatedTabIndex = 'data-yingshi-tv-tabindex';

  function visible(element) {
    if (!element || element.disabled) return false;
    if (element.closest('[inert], [hidden], .hidden')) return false;
    var style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    var rect = element.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  }

  function activeScope() {
    var sheets = Array.prototype.slice.call(document.querySelectorAll('.sheet.is-open'));
    return sheets.filter(function (sheet) { return sheet.getAttribute('aria-hidden') !== 'true'; }).pop() || document;
  }

  function focusables() {
    var nodes = Array.prototype.slice.call(activeScope().querySelectorAll(selector));
    return nodes.filter(function (element) {
      if (!element.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(element.tagName)) {
        element.setAttribute('tabindex', '0');
        element.setAttribute(generatedTabIndex, '1');
      }
      return visible(element) && Number(element.getAttribute('tabindex') || 0) >= 0;
    });
  }

  function center(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function focusElement(element) {
    if (!element) return false;
    try {
      element.focus({ preventScroll: true });
    } catch (_) {
      element.focus();
    }
    try {
      element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    } catch (_) {
      element.scrollIntoView(false);
    }
    return true;
  }

  function firstFocusable() {
    var nodes = focusables();
    return focusElement(nodes[0]);
  }

  function scrollPage(delta) {
    var scope = activeScope(), scroller = scope === document ? window : scope.querySelector('.sheet-body, .sheet-panel');
    if (scroller) scroller.scrollBy(0, delta);
  }

  function move(direction) {
    var active = document.activeElement;
    var nodes = focusables();
    if (!active || active === document.body || nodes.indexOf(active) < 0) return firstFocusable();
    var origin = center(active.getBoundingClientRect());
    var best = null;
    var bestScore = Infinity;
    nodes.forEach(function (candidate) {
      if (candidate === active) return;
      var target = center(candidate.getBoundingClientRect());
      var dx = target.x - origin.x;
      var dy = target.y - origin.y;
      var primary;
      var secondary;
      if (direction === 'UP' && dy < -4) { primary = -dy; secondary = Math.abs(dx); }
      else if (direction === 'DOWN' && dy > 4) { primary = dy; secondary = Math.abs(dx); }
      else if (direction === 'LEFT' && dx < -4) { primary = -dx; secondary = Math.abs(dy); }
      else if (direction === 'RIGHT' && dx > 4) { primary = dx; secondary = Math.abs(dy); }
      else return;
      var score = primary * 1.2 + secondary * 2.4 + (secondary > primary * 2.5 ? 10000 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    });
    if (best) return focusElement(best);
    scrollPage(direction === 'UP' ? -window.innerHeight * 0.72
      : direction === 'DOWN' ? window.innerHeight * 0.72 : 0);
    return true;
  }

  function media(key) {
    var action = { PLAY_PAUSE: 'toggle', PLAY: 'PLAY', PAUSE: 'PAUSE', FAST_FORWARD: 'SEEK_FORWARD', REWIND: 'SEEK_BACKWARD' }[key];
    if (action && window.YingshiVoice && document.querySelector('#playerSheet.is-open')) {
      if (action === 'toggle') {
        var button = document.querySelector('#playerToggle');
        if (button && !button.closest('[hidden],.hidden')) button.click();
        else window.YingshiVoice.execute(document.querySelector('#playerStatus').textContent === '已暫停' ? 'PLAY' : 'PAUSE');
      } else window.YingshiVoice.execute(action);
      return true;
    }
    var video = document.querySelector('video');
    if (!video) return false;
    if (key === 'PLAY_PAUSE') video.paused ? video.play() : video.pause();
    else if (key === 'PLAY') video.play();
    else if (key === 'PAUSE') video.pause();
    else if (key === 'FAST_FORWARD') video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 15);
    else if (key === 'REWIND') video.currentTime = Math.max(0, video.currentTime - 15);
    else return false;
    return true;
  }

  function handle(key) {
    if (window.YingshiPlayerPresentation && window.YingshiPlayerPresentation.handleRemote(key)) return true;
    var selected = document.activeElement;
    if ((key === 'LEFT' || key === 'RIGHT') && selected) {
      var delta = key === 'RIGHT' ? 1 : -1;
      if (selected.tagName === 'SELECT' && !selected.disabled) {
        selected.selectedIndex = Math.max(0, Math.min(selected.options.length - 1, selected.selectedIndex + delta));
        selected.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      if (selected.tagName === 'INPUT' && selected.type === 'range' && !selected.disabled) {
        var step = selected.id === 'playerSeek' ? 10 : Number(selected.step || 1);
        selected.value = Math.max(Number(selected.min || 0), Math.min(Number(selected.max || 100), Number(selected.value) + delta * step));
        selected.dispatchEvent(new Event('input', { bubbles: true }));
        selected.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    if (key === 'PAGE_UP' || key === 'PAGE_DOWN') {
      scrollPage((key === 'PAGE_UP' ? -1 : 1) * window.innerHeight * 0.82);
      return true;
    }
    if (key === 'ENTER') {
      var active = document.activeElement;
      if (!active || active === document.body) return firstFocusable();
      if (active.id === 'searchBox') {
        active.dispatchEvent(new Event('search', { bubbles: true }));
        return true;
      }
      active.click();
      return true;
    }
    if (key === 'UP' || key === 'DOWN' || key === 'LEFT' || key === 'RIGHT') return move(key);
    return media(key);
  }

  var observer = new MutationObserver(function () { window.clearTimeout(observer.timer); observer.timer = window.setTimeout(focusables, 80); });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'class', 'style'] });
  window.__yingshiTvRemote = { handle: handle, refresh: focusables, focusFirst: firstFocusable };
  focusables();
  window.setTimeout(firstFocusable, 500);
})();
