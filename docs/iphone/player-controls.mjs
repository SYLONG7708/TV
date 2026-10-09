export const PLAYER_SETTINGS_KEY = 'oktv:player:settings:v1';
export const PLAYER_PROGRESS_KEY = 'oktv:player:progress:v1';
export const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const value = Math.floor(seconds), h = Math.floor(value / 3600), m = Math.floor(value / 60) % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
export function seekTarget(time, ranges, duration) {
  const requested = Math.max(0, Number(time) || 0);
  if (ranges?.length) {
    for (let i = 0; i < ranges.length; i++) {
      if (requested < ranges.start(i)) return ranges.start(i);
      if (requested <= ranges.end(i)) return Math.min(requested, Math.max(ranges.start(i), ranges.end(i) - 0.05));
    }
    return Math.max(ranges.start(ranges.length - 1), ranges.end(ranges.length - 1) - 0.05);
  }
  return Number.isFinite(duration) ? clamp(requested, 0, Math.max(0, duration - 0.05)) : null;
}
export function subtitleToVtt(text) {
  text = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (text.length > 2 * 1024 * 1024) throw new Error('字幕檔不可超過 2 MB。');
  if (/^WEBVTT(?:\s|$)/.test(text)) return text + '\n';
  if (!/\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(text)) throw new Error('請選擇 UTF-8 的 SRT 或 WebVTT 字幕。');
  return 'WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2') + '\n';
}
function readStored(storage, key, fallback) {
  try { return JSON.parse(storage?.getItem(key) || 'null') || fallback; } catch { return fallback; }
}
export function createPlayerController({ video, frame, panel, controls, status, hint, getHls = () => window.Hls, onEpisode = () => {}, onFailure = () => {}, onEvidence = () => {}, onRetry, onIntent = () => {}, storage }) {
  try { storage ??= window.localStorage; } catch { storage = null; }
  const $ = id => panel.querySelector(`#${id}`);
  const settings = { volume: 1, muted: false, rate: 1, remember: false, ...readStored(storage, PLAYER_SETTINGS_KEY, {}) };
  settings.volume = clamp(settings.volume, 0, 1);
  settings.rate = [0.5, 0.75, 1, 1.25, 1.5, 2].includes(settings.rate) ? settings.rate : 1;
  let hls = null, entry = null, generation = 0, readyTimer = null, recoveryTimer = null;
  let recoveries = 0, mediaRecoveries = 0, localTrack = null, localUrl = '', subtitleChoice = 'off';
  let pendingSeek = 0, lastSave = 0, dragging = false, fatal = false;
  let startedAt = 0, hasStarted = false, userPaused = false, stallTimer = null, youtube = null;
  let lastMediaTime = -1, lastProgressAt = 0, stableProgress = 0, evidenceSent = false, lastGoodPosition = 0;
  const retiredHlsTracks = new WeakSet();
  const store = (key, data) => { try { storage?.setItem(key, JSON.stringify(data)); } catch { /* Private browsing / full storage remain usable. */ } };
  const say = text => { status.textContent = text; };
  const rememberSettings = () => store(PLAYER_SETTINGS_KEY, settings);
  const isDirect = () => Boolean(entry && !entry.embedUrl);
  const isCurrent = token => Boolean(entry && generation === token);
  function saveProgress() {
    if (!settings.remember || !entry?.key || !isDirect() || !Number.isFinite(video.duration)) return;
    const rows = readStored(storage, PLAYER_PROGRESS_KEY, {});
    if (video.currentTime > 5 && video.duration - video.currentTime > 8) rows[entry.key] = { time: video.currentTime, updated: Date.now() };
    else delete rows[entry.key];
    store(PLAYER_PROGRESS_KEY, Object.fromEntries(Object.entries(rows).sort((a, b) => Number(b[1]?.updated || 0) - Number(a[1]?.updated || 0)).slice(0, 50)));
  }
  function clearLocalSubtitle() {
    localTrack?.remove(); localTrack = null;
    if (localUrl) URL.revokeObjectURL(localUrl);
    localUrl = '';
  }
  function stop() {
    saveProgress(); generation++;
    clearTimeout(stallTimer); stallTimer = null;
    if (youtube) { try { youtube.destroy(); } catch {} youtube = null; }
    // The iframe API may replace/remove its element when destroyed.
    if (!frame.isConnected) { frame = document.createElement('iframe'); frame.id = 'playerFrame'; frame.className = 'player-frame hidden'; frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture'; frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation'); frame.setAttribute('allowfullscreen', ''); video.after(frame); }
    clearTimeout(readyTimer); clearTimeout(recoveryTimer); readyTimer = recoveryTimer = null;
    if (hls) for (const track of Array.from(video.textTracks || [])) {
      if (track === localTrack?.track) continue;
      retiredHlsTracks.add(track); track.mode = 'disabled';
      for (const cue of Array.from(track.cues || [])) { try { track.removeCue(cue); } catch {} }
    }
    hls?.destroy(); hls = null; entry = null;
    video.pause(); video.onerror = null;
    video.removeAttribute('src'); video.load();
    frame.removeAttribute('src'); frame.classList.add('hidden');
    clearLocalSubtitle();
    if (document.pictureInPictureElement === video) document.exitPictureInPicture?.().catch(() => {});
  }
  const option = (value, label) => { const node = document.createElement('option'); node.value = String(value); node.textContent = label; return node; };
  function fill(select, rows, value) {
    const signature = JSON.stringify(rows);
    if (select.dataset.options !== signature) {
      select.replaceChildren(...rows.map(([id, label]) => option(id, label)));
      select.dataset.options = signature;
    }
    select.value = String(value);
    if (select.selectedIndex < 0) select.selectedIndex = 0;
  }
  function nativeSubtitles() {
    return Array.from(video.textTracks || []).map((track, index) => ({ track, index })).filter(({ track }) => ['subtitles', 'captions'].includes(track.kind));
  }
  function syncTracks() {
    if (!isDirect()) return;
    const levels = hls?.levels || [];
    const variants = !hls ? entry.variants || [] : [];
    const qualityRows = levels.length ? [[-1, '自動（依網路調整）'], ...levels.map((level, i) => [i, `${level.height ? level.height + 'p' : '畫質 ' + (i + 1)}${level.bitrate ? ` · ${(level.bitrate / 1e6).toFixed(1)} Mbps` : ''}`])] : variants.length ? variants.map((v, i) => [`mp4:${i}`, v.label || `${v.height}p`]) : [[-1, '由片源／裝置決定']];
    fill($('playerQuality'), qualityRows, variants.length ? `mp4:${Math.max(0, variants.findIndex(v => v.url === entry.url))}` : hls?.autoLevelEnabled !== false ? -1 : hls.currentLevel);
    $('playerQuality').disabled = Math.max(levels.length, variants.length) < 2;
    const audio = hls?.audioTracks || Array.from(video.audioTracks || []);
    fill($('playerAudio'), audio.length ? audio.map((track, i) => [i, track.name || track.label || track.lang || track.language || `音軌 ${i + 1}`]) : [[-1, '片源預設音軌']], hls ? hls.audioTrack : Math.max(0, audio.findIndex(track => track.enabled)));
    $('playerAudio').disabled = audio.length < 2;
    const subtitles = (hls?.subtitleTracks || []).map((track, i) => [`hls:${i}`, track.name || track.lang || `字幕 ${i + 1}`]);
    for (const { track, index } of nativeSubtitles()) {
      if (retiredHlsTracks.has(track) && (!hls || !track.cues?.length)) continue;
      if (!hls || track === localTrack?.track || !hls.subtitleTracks.length) subtitles.push([`text:${index}`, track.label || track.language || `字幕 ${index + 1}`]);
    }
    fill($('playerSubtitles'), [['off', subtitles.length ? '字幕關閉' : '片源未提供可切換字幕'], ...subtitles], subtitleChoice);
    $('playerSubtitles').disabled = subtitles.length === 0;
    const height = video.videoHeight || levels[hls?.currentLevel]?.height;
    $('playerResolution').textContent = height ? `${video.videoWidth || levels[hls?.currentLevel]?.width || '—'} × ${height}${hls?.autoLevelEnabled ? ' · 自動畫質' : ''}` : '畫質依片源提供';
  }
  function syncTransport() {
    if (!isDirect()) return;
    $('playerToggle').textContent = video.paused ? '播放' : '暫停';
    $('playerMute').textContent = video.muted || video.volume === 0 ? '開啟聲音' : '靜音';
    $('playerMute').setAttribute('aria-pressed', String(video.muted));
    $('playerVolume').value = String(video.muted ? 0 : Math.round(video.volume * 100));
    $('playerSpeed').value = String(video.playbackRate);
    const finite = Number.isFinite(video.duration) && video.duration > 0;
    const start = video.seekable?.length ? video.seekable.start(0) : 0;
    const end = video.seekable?.length ? video.seekable.end(video.seekable.length - 1) : finite ? video.duration : 0;
    const seek = $('playerSeek'); seek.min = String(start); seek.max = String(Math.max(start, end)); seek.disabled = end <= start;
    if (!dragging) seek.value = String(clamp(video.currentTime, start, Math.max(start, end)));
    const display = `${formatTime(video.currentTime)} / ${finite ? formatTime(video.duration) : '直播'}`;
    $('playerTime').textContent = display; seek.setAttribute('aria-valuetext', display);
    $('playerBack').disabled = $('playerForward').disabled = seek.disabled;
    $('playerLive').hidden = finite || !hls?.liveSyncPosition;
    $('playerPrevious').disabled = !entry.episodes?.length || entry.index < 1;
    $('playerNext').disabled = !entry.episodes?.length || entry.index >= entry.episodes.length - 1;
  }
  function seek(time) {
    if (!isDirect()) return false;
    const target = seekTarget(time, video.seekable, video.duration);
    let applied = false;
    if (target !== null) { try { video.currentTime = target; lastGoodPosition = target; applied = true; } catch { say('此片源暫時無法跳轉，請稍後再試。'); } }
    syncTransport();
    return applied;
  }
  async function play() {
    userPaused = false; lastProgressAt = performance.now(); onIntent('play');
    if (youtube) { userPaused = false; youtube.playVideo(); return; }
    if (!isDirect()) return;
    const token = generation;
    try { await video.play(); } catch (error) {
      if (!isCurrent(token) || error.name === 'AbortError' || fatal) return;
      if (error.name === 'NotAllowedError') { userPaused = true; onIntent('pause'); clearTimeout(readyTimer); }
      say(error.name === 'NotAllowedError' ? '裝置需要你點一下「播放」後才能開始。' : '尚未開始播放，可按「重新連線」或切換片源。');
    }
  }
  function fail(message) {
    if (!entry || fatal || userPaused) return;
    fatal = true; say(message); $('playerRetry').hidden = false;
    clearTimeout(readyTimer); clearTimeout(recoveryTimer);
    clearTimeout(stallTimer);
    hls?.stopLoad();
    const failed = { ...entry }, token = generation;
    const position = isDirect() ? Math.max(lastGoodPosition, pendingSeek, Number(video.currentTime) || 0) : 0;
    if (isDirect()) video.pause();
    onEvidence(failed, 'failure', { reason: message });
    Promise.resolve().then(() => { if (isCurrent(token)) onFailure(failed, { position, message }); });
  }
  function observedPlaying(height = video.videoHeight) {
    if (!entry) return;
    clearTimeout(readyTimer); clearTimeout(stallTimer); userPaused = false; onIntent('play');
    hasStarted = true;
    fatal = false; $('playerRetry').hidden = true; say('播放中');
  }
  function ensureYouTube() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (!window.__oktvYouTubeReady) window.__oktvYouTubeReady = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
      const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => { window.__oktvYouTubeReady = null; reject(new Error('YouTube API unavailable')); };
      document.head.append(script);
    });
    return window.__oktvYouTubeReady;
  }
  function open(next, resumeTime = 0, autoplay = true) {
    stop(); entry = { ...next }; const token = generation; fatal = false; recoveries = mediaRecoveries = 0;
    startedAt = performance.now(); hasStarted = false; userPaused = !autoplay;
    lastProgressAt = startedAt; lastMediaTime = -1; stableProgress = 0; evidenceSent = false; lastGoodPosition = resumeTime || 0;
    subtitleChoice = 'off'; pendingSeek = resumeTime || 0; dragging = false;
    document.getElementById('playerResolution').textContent = '';
    if (!pendingSeek && settings.remember && entry.key) pendingSeek = Number(readStored(storage, PLAYER_PROGRESS_KEY, {})[entry.key]?.time) || 0;
    controls.hidden = Boolean(entry.embedUrl); hint.hidden = !entry.embedUrl;
    video.classList.toggle('hidden', Boolean(entry.embedUrl));
    if (entry.embedUrl) {
      frame.classList.remove('hidden');
      const embed = new URL(entry.embedUrl);
      embed.searchParams.set('enablejsapi', '1'); embed.searchParams.set('origin', location.origin);
      // A single app-owned fullscreen control keeps exit/restore available even
      // when the embedded mobile player's own fullscreen action is ineffective.
      embed.searchParams.set('fs', '0');
      if (window.CarBridge) embed.searchParams.set('mute', settings.muted ? '1' : '0');
      frame.src = embed.href;
      say('正在連線至官方播放器…');
      readyTimer = setTimeout(() => {
        if (!isCurrent(token) || hasStarted || userPaused) return;
        if (entry.canFallback) fail('官方直播尚未回報啟播，正在檢查其他訊號。');
        else {
          say('官方播放器尚未回報啟播，正在等候回應。');
          readyTimer = setTimeout(() => { if (isCurrent(token) && !hasStarted && !userPaused) fail('官方播放器連線逾時，正在重新檢查同一頻道。'); }, 15000);
        }
      }, 15000);
      ensureYouTube().then(YT => {
        if (!isCurrent(token)) return;
        youtube = new YT.Player(frame, { events: {
          onReady: event => { if (isCurrent(token) && autoplay) event.target.playVideo(); },
          onStateChange: event => {
            if (!isCurrent(token)) return;
            if (event.data === 1) observedPlaying(0);
            if (event.data === 2 && !fatal) { userPaused = true; onIntent('pause'); clearTimeout(readyTimer); clearTimeout(stallTimer); say('已暫停'); }
            if (event.data === 3 && hasStarted && !userPaused) { say('直播緩衝中…'); clearTimeout(stallTimer); stallTimer = setTimeout(() => { if (isCurrent(token)) fail('直播持續緩衝，正在檢查其他訊號。'); }, 10000); }
          },
          onError: event => { if (isCurrent(token)) fail(`官方播放器回報錯誤 ${event.data}，正在檢查其他訊號。`); },
        } });
      }).catch(() => { if (isCurrent(token)) fail('官方播放器無法連線，正在重新檢查同一頻道。'); });
      return;
    }
    $('playerRetry').hidden = true; $('playerRemember').checked = Boolean(settings.remember);
    video.volume = settings.volume; video.muted = Boolean(settings.muted); video.playbackRate = settings.rate;
    video.preservesPitch = true;
    $('playerPip').disabled = !(document.pictureInPictureEnabled && video.requestPictureInPicture);
    $('playerFullscreen').disabled = false;
    say('正在連線至片源…');
    const Hls = getHls();
    if (/\.m3u8(?:$|\?)/i.test(entry.url) && Hls?.isSupported?.()) {
      hls = new Hls({ lowLatencyMode: false, liveDurationInfinity: true, enableWorker: true, backBufferLength: 15, maxBufferLength: 20, maxMaxBufferLength: 40, maxBufferSize: 32 * 1024 * 1024, manifestLoadingTimeOut: 6000, manifestLoadingMaxRetry: 1, fragLoadingTimeOut: 8000, fragLoadingMaxRetry: 1, abrEwmaDefaultEstimate: 1500000, capLevelToPlayerSize: true });
      const engine = hls;
      for (const event of ['MANIFEST_PARSED', 'LEVEL_SWITCHED', 'AUDIO_TRACKS_UPDATED', 'AUDIO_TRACK_SWITCHED', 'SUBTITLE_TRACKS_UPDATED']) {
        if (Hls.Events[event]) engine.on(Hls.Events[event], () => { if (isCurrent(token)) { syncTracks(); syncTransport(); } });
      }
      engine.subtitleDisplay = false;
      engine.on(Hls.Events.ERROR, (_event, data) => {
        if (!isCurrent(token) || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries++ < 1) {
          say('正在恢復影音解碼…'); engine.recoverMediaError();
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && recoveries < 1
            && ![401, 403, 404, 410].includes(Number(data.response?.code))) {
          const wait = ++recoveries * 700; say('連線中斷，正在重新取得串流…');
          clearTimeout(recoveryTimer); recoveryTimer = setTimeout(() => {
            if (!isCurrent(token)) return;
            if (!engine.levels.length) engine.loadSource(entry.url);
            else engine.startLoad();
          }, wait);
        } else fail('片源暫時無法播放。可重新連線，或關閉播放器切換其他訊號源。');
      });
      engine.loadSource(entry.url); engine.attachMedia(video);
    } else if (/\.m3u8(?:$|\?)/i.test(entry.url) && !video.canPlayType('application/vnd.apple.mpegurl')) {
      fail('此裝置尚未載入 HLS 播放支援，請重新連線或重新整理。');
    } else video.src = entry.url;
    if (!fatal && autoplay) readyTimer = setTimeout(() => {
      if (!isCurrent(token) || hasStarted || userPaused) return;
      if (entry.canFallback) fail('片源啟播逾時，正在檢查其他訊號。');
      else {
        // Do not abort the only viable connection just because it needs more
        // than nine seconds on a tethered network. It still has a hard limit.
        say('此來源連線較慢，仍在嘗試連線…');
        readyTimer = setTimeout(() => { if (isCurrent(token) && !hasStarted && !userPaused) fail('此來源連線逾時，請稍後重新連線。'); }, 17000);
      }
    }, 9000);
    syncTracks(); syncTransport();
    if (!fatal && autoplay) void play();
  }
  const retry = () => {
    if (!entry) return;
    const position = isDirect() ? Math.max(lastGoodPosition, pendingSeek, Number(video.currentTime) || 0) : 0;
    if (onRetry) onRetry(position); else open(entry, position);
  };
  function pause() {
    userPaused = true; onIntent('pause'); clearTimeout(readyTimer); clearTimeout(stallTimer);
    if (youtube) youtube.pauseVideo(); else video.pause();
  }
  function stalled(message) {
    if (!entry || fatal || userPaused) return;
    if (navigator.onLine === false) { fail('網路已中斷，等待連線恢復。'); return; }
    if (isDirect() && !entry.rebuilt) {
      const position = Math.max(lastGoodPosition, pendingSeek, Number(video.currentTime) || 0);
      onEvidence(entry, 'stall', { reason: 'rebuild-buffer' });
      open({ ...entry, rebuilt: true }, position);
      say('正在重建播放緩衝並接續原進度…');
    } else fail(message);
  }
  function chooseSubtitle(value) {
    subtitleChoice = value;
    for (const { track } of nativeSubtitles()) track.mode = 'disabled';
    if (hls) { hls.subtitleDisplay = value.startsWith('hls:'); hls.subtitleTrack = value.startsWith('hls:') ? Number(value.split(':')[1]) : -1; }
    if (value.startsWith('text:')) { const track = video.textTracks[Number(value.split(':')[1])]; if (track) track.mode = 'showing'; }
    syncTracks();
  }
  $('playerToggle').addEventListener('click', () => video.paused ? void play() : pause());
  $('playerMute').addEventListener('click', () => { video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 0.7; });
  $('playerVolume').addEventListener('input', event => {
    const desired = clamp(event.target.value, 0, 100) / 100; video.volume = desired; video.muted = desired === 0;
    if (Math.abs(video.volume - desired) > 0.02) say('此裝置的音量由系統控制，請使用音量鍵。');
    syncTransport();
  });
  $('playerSpeed').addEventListener('change', event => { video.playbackRate = clamp(event.target.value, 0.5, 2); });
  $('playerBack').addEventListener('click', () => seek(video.currentTime - 10));
  $('playerForward').addEventListener('click', () => seek(video.currentTime + 10));
  $('playerLive').addEventListener('click', () => seek(hls?.liveSyncPosition));
  $('playerSeek').addEventListener('input', event => { dragging = true; $('playerTime').textContent = formatTime(Number(event.target.value)); });
  $('playerSeek').addEventListener('change', event => { seek(Number(event.target.value)); dragging = false; syncTransport(); });
  $('playerRetry').addEventListener('click', retry);
  $('playerPrevious').addEventListener('click', () => { if (entry?.index > 0) onEpisode(entry.index - 1); });
  $('playerNext').addEventListener('click', () => { if (entry?.index < (entry.episodes?.length || 0) - 1) onEpisode(entry.index + 1); });
  $('playerQuality').addEventListener('change', event => {
    if (hls) { hls.currentLevel = Number(event.target.value); syncTracks(); return; }
    const match = /^mp4:(\d+)$/.exec(event.target.value), variant = match && entry?.variants?.[Number(match[1])];
    if (variant && variant.url !== entry.url) open({ ...entry, url: variant.url }, video.currentTime, !video.paused);
  });
  $('playerAudio').addEventListener('change', event => {
    if (hls) hls.audioTrack = Number(event.target.value);
    else Array.from(video.audioTracks || []).forEach((track, i) => { track.enabled = i === Number(event.target.value); });
  });
  $('playerSubtitles').addEventListener('change', event => chooseSubtitle(event.target.value));
  $('playerSubtitleFile').addEventListener('change', async event => {
    const file = event.target.files?.[0], token = generation; event.target.value = '';
    if (!file || !isDirect()) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('字幕檔不可超過 2 MB。');
      const vtt = subtitleToVtt(await file.text()); if (!isCurrent(token)) return;
      clearLocalSubtitle(); localUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      localTrack = document.createElement('track'); localTrack.kind = 'subtitles'; localTrack.label = file.name; localTrack.srclang = 'und'; localTrack.src = localUrl;
      video.append(localTrack); localTrack.track.mode = 'hidden';
      localTrack.addEventListener('load', () => { if (isCurrent(token)) { chooseSubtitle(`text:${Array.from(video.textTracks).indexOf(localTrack.track)}`); say('已載入本機字幕；檔案不會上傳。'); } }, { once: true });
      localTrack.addEventListener('error', () => { if (isCurrent(token)) say('字幕格式無法讀取，請確認為 UTF-8 的 SRT／WebVTT。'); }, { once: true });
      syncTracks();
    } catch (error) { if (isCurrent(token)) say(error.message); }
  });
  $('playerRemember').addEventListener('change', event => {
    settings.remember = event.target.checked; rememberSettings();
    if (!settings.remember) { try { storage?.removeItem(PLAYER_PROGRESS_KEY); } catch {} }
    else saveProgress();
  });
  $('playerPip').addEventListener('click', async () => {
    try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await video.requestPictureInPicture(); }
    catch { say('目前裝置或瀏覽器無法啟用子母畫面。'); }
  });
  for (const event of ['play', 'pause', 'durationchange', 'loadedmetadata', 'progress', 'seeked']) video.addEventListener(event, syncTransport);
  video.addEventListener('volumechange', () => { if (isDirect()) { settings.volume = video.volume; settings.muted = video.muted; rememberSettings(); syncTransport(); } });
  video.addEventListener('ratechange', () => { if (isDirect()) { settings.rate = video.playbackRate; rememberSettings(); syncTransport(); } });
  function resumeWhenReady() {
    if (!isDirect()) return;
    if (pendingSeek > 0 && Number.isFinite(video.duration) && seek(Math.min(pendingSeek, Math.max(0, video.duration - 8)))) pendingSeek = 0;
    syncTracks();
  }
  video.addEventListener('loadedmetadata', resumeWhenReady);
  video.addEventListener('durationchange', resumeWhenReady);
  video.addEventListener('canplay', () => { if (isDirect()) { resumeWhenReady(); syncTracks(); if (video.paused && !fatal) say('已暫停'); } });
  video.addEventListener('playing', () => { if (isDirect()) observedPlaying(); });
  video.addEventListener('pause', () => { if (isDirect() && !fatal && !video.ended && !video.error && video.readyState >= 2) { userPaused = hasStarted; if (userPaused) onIntent('pause'); clearTimeout(stallTimer); say('已暫停'); } saveProgress(); });
  video.addEventListener('waiting', () => {
    if (!isDirect() || fatal || userPaused) return;
    say('緩衝中…');
    if (hasStarted && !stallTimer) {
      const token = generation; onEvidence(entry, 'stall');
      stallTimer = setTimeout(() => { stallTimer = null; if (isCurrent(token) && !userPaused && video.readyState < 3) stalled('片源持續緩衝，正在檢查其他訊號。'); }, 6000);
    }
  });
  video.addEventListener('ended', () => { if (isDirect()) { say(entry.index < (entry.episodes?.length || 0) - 1 ? '本集播放完畢，可點選下一集。' : '播放完畢'); saveProgress(); } });
  video.addEventListener('error', () => { if (isDirect()) fail('片源或影音格式暫時無法播放。請重新連線或切換訊號源。'); });
  video.addEventListener('resize', syncTracks);
  video.addEventListener('timeupdate', () => { syncTransport(); if (Date.now() - lastSave > 5000) { lastSave = Date.now(); saveProgress(); } });
  video.textTracks?.addEventListener('addtrack', syncTracks);
  video.textTracks?.addEventListener('removetrack', syncTracks);
  document.addEventListener('keydown', event => {
    if (!isDirect() || controls.hidden || event.ctrlKey || event.metaKey || event.altKey || /INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName) || event.target.isContentEditable) return;
    const key = event.key.toLowerCase();
    const actions = { ' ': () => video.paused ? void play() : pause(), arrowleft: () => seek(video.currentTime - 10), arrowright: () => seek(video.currentTime + 10), arrowup: () => { video.volume = clamp(video.volume + 0.1, 0, 1); }, arrowdown: () => { video.volume = clamp(video.volume - 0.1, 0, 1); }, m: () => { video.muted = !video.muted; } };
    if (actions[key]) { event.preventDefault(); actions[key](); }
  });
  window.addEventListener('pagehide', saveProgress);
  // Progress is measured independently of waiting/error events, which some WebViews omit.
  const checkProgress = () => {
    if (!entry || fatal || userPaused) return;
    const time = youtube ? Number(youtube.getCurrentTime?.() || 0) : video.currentTime;
    const now = performance.now(), delta = time - lastMediaTime;
    if (lastMediaTime >= 0 && delta > 0.05 && delta < 5) {
      lastProgressAt = now; stableProgress += delta;
      if (isDirect()) lastGoodPosition = time;
      if (!evidenceSent && stableProgress >= 1 && (youtube || video.videoHeight > 0)) {
        evidenceSent = true; onEvidence(entry, 'playing', { startupMs: Math.round(now - startedAt), height: video.videoHeight || 0 });
      }
      if (stableProgress >= 90) entry.rebuilt = false;
    } else if (delta >= 5 || delta < 0 || video.seeking) lastProgressAt = now;
    lastMediaTime = time;
    if (navigator.onLine === false) { fail('網路已中斷，等待連線恢復。'); return; }
    const ended = youtube ? youtube.getPlayerState?.() === 0 : video.ended;
    if (hasStarted && !ended && !video.seeking && now - lastProgressAt >= 8000)
      stalled('播放進度停滯，正在檢查其他訊號。');
  };
  let watchdog = setInterval(checkProgress, 1000);
  window.addEventListener('pagehide', () => clearInterval(watchdog));
  window.addEventListener('pageshow', event => { if (event.persisted) { lastProgressAt = performance.now(); clearInterval(watchdog); watchdog = setInterval(checkProgress, 1000); } });
  return { open, close: stop, retry, seek, saveProgress, play, pause };
}
