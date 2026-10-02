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
export function createPlayerController({ video, frame, panel, controls, status, hint, getHls = () => window.Hls, onEpisode = () => {}, storage }) {
  try { storage ??= window.localStorage; } catch { storage = null; }
  const $ = id => panel.querySelector(`#${id}`);
  const settings = { volume: 1, muted: false, rate: 1, remember: false, ...readStored(storage, PLAYER_SETTINGS_KEY, {}) };
  settings.volume = clamp(settings.volume, 0, 1);
  settings.rate = [0.5, 0.75, 1, 1.25, 1.5, 2].includes(settings.rate) ? settings.rate : 1;
  let hls = null, entry = null, generation = 0, readyTimer = null, recoveryTimer = null;
  let recoveries = 0, mediaRecoveries = 0, localTrack = null, localUrl = '', subtitleChoice = 'off';
  let pendingSeek = 0, lastSave = 0, dragging = false, fatal = false;
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
    if (!isDirect()) return;
    const target = seekTarget(time, video.seekable, video.duration);
    if (target !== null) { try { video.currentTime = target; } catch { say('此片源暫時無法跳轉，請稍後再試。'); } }
    syncTransport();
  }
  async function play() {
    if (!isDirect()) return;
    const token = generation;
    try { await video.play(); } catch (error) {
      if (!isCurrent(token) || error.name === 'AbortError' || fatal) return;
      say(error.name === 'NotAllowedError' ? '裝置需要你點一下「播放」後才能開始。' : '尚未開始播放，可按「重新連線」或切換片源。');
    }
  }
  function fail(message) {
    fatal = true; say(message); $('playerRetry').hidden = false;
    clearTimeout(readyTimer); clearTimeout(recoveryTimer);
    hls?.stopLoad();
  }
  function open(next, resumeTime = 0, autoplay = true) {
    stop(); entry = { ...next }; const token = generation; fatal = false; recoveries = mediaRecoveries = 0;
    subtitleChoice = 'off'; pendingSeek = resumeTime || 0; dragging = false;
    document.getElementById('playerResolution').textContent = '';
    if (!pendingSeek && settings.remember && entry.key) pendingSeek = Number(readStored(storage, PLAYER_PROGRESS_KEY, {})[entry.key]?.time) || 0;
    controls.hidden = Boolean(entry.embedUrl); hint.hidden = !entry.embedUrl;
    video.classList.toggle('hidden', Boolean(entry.embedUrl));
    if (entry.embedUrl) {
      frame.classList.remove('hidden'); frame.src = entry.embedUrl;
      say('請在官方播放器內操作聲音、字幕及畫質。'); return;
    }
    $('playerRetry').hidden = true; $('playerRemember').checked = Boolean(settings.remember);
    video.volume = settings.volume; video.muted = Boolean(settings.muted); video.playbackRate = settings.rate;
    video.preservesPitch = true;
    $('playerPip').disabled = !(document.pictureInPictureEnabled && video.requestPictureInPicture);
    $('playerFullscreen').disabled = !(panel.requestFullscreen || video.webkitEnterFullscreen);
    say('正在連線至片源…');
    const Hls = getHls();
    if (/\.m3u8(?:$|\?)/i.test(entry.url) && Hls?.isSupported?.()) {
      hls = new Hls({ lowLatencyMode: false, liveDurationInfinity: true, enableWorker: true, backBufferLength: 15, maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferSize: 40 * 1024 * 1024, manifestLoadingTimeOut: 15000, fragLoadingTimeOut: 20000 });
      const engine = hls;
      for (const event of ['MANIFEST_PARSED', 'LEVEL_SWITCHED', 'AUDIO_TRACKS_UPDATED', 'AUDIO_TRACK_SWITCHED', 'SUBTITLE_TRACKS_UPDATED']) {
        if (Hls.Events[event]) engine.on(Hls.Events[event], () => { if (isCurrent(token)) { syncTracks(); syncTransport(); } });
      }
      engine.subtitleDisplay = false;
      engine.on(Hls.Events.ERROR, (_event, data) => {
        if (!isCurrent(token) || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries++ < 1) {
          say('正在恢復影音解碼…'); engine.recoverMediaError();
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && recoveries < 2) {
          const wait = ++recoveries * 1000; say(`連線中斷，正在重試（${recoveries}/2）…`);
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
    if (!fatal) readyTimer = setTimeout(() => { if (isCurrent(token) && video.readyState < 2) fail('片源回應逾時。可重新連線或切換訊號源。'); }, 30000);
    syncTracks(); syncTransport();
    if (!fatal && autoplay) void play();
  }
  const retry = () => { if (isDirect()) open(entry, video.currentTime); };
  function chooseSubtitle(value) {
    subtitleChoice = value;
    for (const { track } of nativeSubtitles()) track.mode = 'disabled';
    if (hls) { hls.subtitleDisplay = value.startsWith('hls:'); hls.subtitleTrack = value.startsWith('hls:') ? Number(value.split(':')[1]) : -1; }
    if (value.startsWith('text:')) { const track = video.textTracks[Number(value.split(':')[1])]; if (track) track.mode = 'showing'; }
    syncTracks();
  }
  $('playerToggle').addEventListener('click', () => video.paused ? void play() : video.pause());
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
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (panel.requestFullscreen) await panel.requestFullscreen();
      else video.webkitEnterFullscreen?.();
    } catch { say('此裝置未允許全螢幕，可使用影片自帶的全螢幕按鈕。'); }
  }
  $('playerFullscreen').addEventListener('click', fullscreen);
  $('playerPip').addEventListener('click', async () => {
    try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await video.requestPictureInPicture(); }
    catch { say('目前裝置或瀏覽器無法啟用子母畫面。'); }
  });
  for (const event of ['play', 'pause', 'durationchange', 'loadedmetadata', 'progress', 'seeked']) video.addEventListener(event, syncTransport);
  video.addEventListener('volumechange', () => { if (isDirect()) { settings.volume = video.volume; settings.muted = video.muted; rememberSettings(); syncTransport(); } });
  video.addEventListener('ratechange', () => { if (isDirect()) { settings.rate = video.playbackRate; rememberSettings(); syncTransport(); } });
  function resumeWhenReady() {
    if (!isDirect()) return;
    if (pendingSeek > 0 && Number.isFinite(video.duration)) { seek(Math.min(pendingSeek, Math.max(0, video.duration - 8))); pendingSeek = 0; }
    syncTracks();
  }
  video.addEventListener('loadedmetadata', resumeWhenReady);
  video.addEventListener('durationchange', resumeWhenReady);
  video.addEventListener('canplay', () => { if (isDirect()) { clearTimeout(readyTimer); syncTracks(); if (video.paused && !fatal) say('已暫停'); } });
  video.addEventListener('playing', () => { if (isDirect()) { fatal = false; $('playerRetry').hidden = true; say('播放中'); clearTimeout(readyTimer); } });
  video.addEventListener('pause', () => { if (isDirect() && !fatal && !video.ended) say('已暫停'); saveProgress(); });
  video.addEventListener('waiting', () => { if (isDirect() && !fatal) say('緩衝中…'); });
  video.addEventListener('ended', () => { if (isDirect()) { say(entry.index < (entry.episodes?.length || 0) - 1 ? '本集播放完畢，可點選下一集。' : '播放完畢'); saveProgress(); } });
  video.addEventListener('error', () => { if (isDirect()) fail('片源或影音格式暫時無法播放。請重新連線或切換訊號源。'); });
  video.addEventListener('resize', syncTracks);
  video.addEventListener('timeupdate', () => { syncTransport(); if (Date.now() - lastSave > 5000) { lastSave = Date.now(); saveProgress(); } });
  video.textTracks?.addEventListener('addtrack', syncTracks);
  video.textTracks?.addEventListener('removetrack', syncTracks);
  document.addEventListener('keydown', event => {
    if (!isDirect() || controls.hidden || event.ctrlKey || event.metaKey || event.altKey || /INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName) || event.target.isContentEditable) return;
    const key = event.key.toLowerCase();
    const actions = { ' ': () => video.paused ? void play() : video.pause(), arrowleft: () => seek(video.currentTime - 10), arrowright: () => seek(video.currentTime + 10), arrowup: () => { video.volume = clamp(video.volume + 0.1, 0, 1); }, arrowdown: () => { video.volume = clamp(video.volume - 0.1, 0, 1); }, m: () => { video.muted = !video.muted; }, f: fullscreen };
    if (actions[key]) { event.preventDefault(); actions[key](); }
  });
  window.addEventListener('pagehide', saveProgress);
  return { open, close: stop, retry, seek, saveProgress };
}
