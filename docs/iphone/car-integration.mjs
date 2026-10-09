export function exactVoiceMatch(items, query, compact) {
  const target = compact(query);
  if (!target) return null;
  const matches = items.filter(item => [item.title, item.originalName].some(title => title && compact(title) === target));
  // Never choose between different remakes/years just because the names match.
  return matches.length === 1 ? matches[0] : null;
}
export function installCarIntegration(api) {
  const { state, compact, playback } = api;
  let voiceEpisode = 0, liveId = '', ready = false;
  function dismissInput() {
    state.refocusSearch = false;
    if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) document.activeElement.blur();
    try { window.CarBridge?.dismissKeyboard?.(); } catch {}
  }
  window.YingshiDismissInput = dismissInput;
  function report(command, ok, detail, title = '') {
    const result = { command, ok, detail, title };
    try { window.CarBridge?.onVoiceResult?.(JSON.stringify(result)); } catch {}
    return result;
  }
  function tab(value) {
    dismissInput();
    api.closePlayer(); api.closeOverlays?.(); state.tab = value; state.query = '';
    api.clearViewCache(); api.resetVisibleLimit(); api.render(); api.resetViewport?.();
  }
  function playLive(item) {
    liveId = item.id;
    api.openPlayer(item.name, item.group, item.url, item.embedUrl || '');
  }
  async function playVod(item, index) {
    await api.openDetail(item.id);
    const actual = state.activeItem;
    if (!actual?.episodes?.[index]) return false;
    voiceEpisode = index; liveId = ''; api.openEpisode(actual, index); return true;
  }
  window.YingshiVoice = {
    async execute(command, query = '') {
      const action = String(command).toUpperCase(), value = String(query).trim();
      try {
        const tabs = { OPEN: 'home', HOME: 'home', MOVIE: 'movie', SERIES: 'series', SHORT: 'short', ANIME: 'anime', VARIETY: 'variety', LIVE: 'live' };
        if (tabs[action]) { tab(tabs[action]); return report(action, true, `tab:${state.tab}`); }
        if (action === 'SEARCH' || action === 'PLAY_SEARCH') {
          if (!value) return report(action, false, 'empty_query');
          dismissInput();
          api.closePlayer(); api.closeOverlays?.();
          // A spoken title is global; a previously selected genre must not hide it.
          if (state.tab !== 'home') tab('home');
          api.search(value, 0); api.render(); api.searchLoad();
          await Promise.resolve(state.searchLoadInFlight?.promise).catch(() => {});
          api.clearViewCache(); api.render();
          const rows = api.visibleItems();
          if (action === 'SEARCH') return report(action, rows.length > 0, 'results_ready');
          const item = exactVoiceMatch(rows, value, compact);
          if (!item) return report(action, false, rows.length ? 'ambiguous_title_select_result' : 'not_found');
          return report(action, await playVod(item, 0), 'requested_title', item.title);
        }
        if (action === 'PLAY_LIVE') {
          tab('live');
          const name = text => compact(String(text || '').replace(/^\d+[\s._-]*/, ''));
          const target = name(value);
          const matches = state.live.filter(row => name(row.name) === target);
          if (!target || !matches.length) return report(action, false, 'channel_not_found');
          playLive(api.rank(matches)[0]); return report(action, true, 'connecting', matches[0].name);
        }
        if (action === 'CLOSE_PLAYER') { api.closePlayer(); return report(action, true, 'closed'); }
        if (!document.querySelector('#playerSheet.is-open')) return report(action, false, 'player_closed');
        const video = document.querySelector('#player');
        if (action === 'PAUSE' || action === 'STOP') playback.pause();
        else if (action === 'PLAY') await playback.play();
        else if (action === 'RESTART') { playback.seek(0); await playback.play(); }
        else if (action === 'SEEK_FORWARD' || action === 'SEEK_BACKWARD') playback.seek(video.currentTime + (action === 'SEEK_FORWARD' ? 30 : -30));
        else if (action === 'FULLSCREEN_ON') await window.YingshiPlayerPresentation?.enter();
        else if (action === 'FULLSCREEN_OFF') await window.YingshiPlayerPresentation?.exit();
        else if (action === 'NEXT' || action === 'PREVIOUS') {
          const delta = action === 'NEXT' ? 1 : -1;
          const currentLive = api.currentLive?.() || liveId;
          if (currentLive) {
            const row = state.live[state.live.findIndex(item => item.id === currentLive) + delta];
            if (!row) return report(action, false, 'end_of_channels');
            playLive(row);
          } else {
            const next = (api.currentEpisode?.() ?? voiceEpisode) + delta;
            if (!state.activeItem?.episodes?.[next]) return report(action, false, 'end_of_episodes');
            await playVod(state.activeItem, next);
          }
        } else return report(action, false, 'unsupported_command');
        return report(action, true, 'completed');
      } catch (error) { return report(action, false, error.message || 'command_failed'); }
    },
    status: () => ({ ready, tab: state.tab, query: state.query, playerOpen: Boolean(document.querySelector('#playerSheet.is-open')) }),
  };
  window.YingshiDiagnostics = {
    snapshot: () => ({ schemaVersion: 1, cloudDataOnly: true, ready, playerRevision: api.playerRevision || '', codeRevision: api.codeRevision || '', sources: state.catalog.sources.length,
      indexedRecords: state.catalog.totals.items || 0, loadedItems: state.itemById.size, liveChannels: state.live.length,
      catalogGeneratedAt: state.catalog.generatedAt || '', tab: state.tab, search: { ...state.searchProgress },
      session: api.session(), activeSignal: api.currentSignal?.() || null, dataRefresh: 'cloud', voice: window.YingshiVoice.status() }),
  };
  let refreshPending = false;
  const refresh = () => {
    if (document.hidden || document.querySelector('.sheet.is-open') || state.query || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) { refreshPending = true; return; }
    if (navigator.onLine !== false) {
      if (api.codeRevision === 'local' && window.CarBridge?.requestCloudPlayerUpdate?.()) return;
      location.reload();
    }
  };
  window.addEventListener('online', () => { refreshPending = true; setTimeout(refresh, 1500); });
  setInterval(() => { if (refreshPending) refresh(); }, 15000);
  // Check the cloud code revision while idle. Playing and paused movies keep their current session.
  let checkingUpdate = false;
  const checkUpdate = async () => {
    if (checkingUpdate || navigator.onLine === false || document.hidden
        || document.querySelector('.sheet.is-open') || state.query) return;
    if (api.codeRevision === 'local') { try { window.CarBridge?.requestCloudPlayerUpdate?.(); } catch {} return; }
    if (!/^[a-f0-9]{40}$/.test(api.codeRevision || '')) return;
    checkingUpdate = true;
    try {
      const response = await fetch('../data/deployment-state.json?player-check=' + Date.now(), { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) return;
      const latest = await response.json();
      if (/^[a-f0-9]{40}$/.test(latest.codeCommit || '') && latest.codeCommit !== api.codeRevision) refresh();
    } catch { /* Keep the working player if the update endpoint is unavailable. */ }
    finally { checkingUpdate = false; }
  };
  setInterval(checkUpdate, 5 * 60000);
  // New catalogs are picked up when returning to an idle app, without interrupting a movie.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 15 * 60000) refresh();
  });
  return { ready() { ready = true; try { window.CarBridge?.onAppReady?.(JSON.stringify(window.YingshiDiagnostics.snapshot())); } catch {} } };
}
