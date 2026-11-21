export function youTubeVideoId(embedUrl) {
  try {
    const url = new URL(embedUrl);
    if (url.protocol !== 'https:' || !['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname)) return '';
    const id = /^\/embed\/([A-Za-z0-9_-]{11})$/.exec(url.pathname)?.[1] || '';
    return id === 'live_stream' ? '' : id;
  } catch { return ''; }
}

export function createBlueMLiveResolver({ bridge = globalThis.window?.CarBridge, events = globalThis.window,
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let serial = 0;
  return {
    supported: () => typeof bridge?.resolveBlueMLive === 'function',
    open(embedUrl) {
      const videoId = youTubeVideoId(embedUrl);
      const requestId = `live_${Date.now().toString(36)}_${++serial}`;
      let finish, timer, closed = false;
      const close = () => {
        if (closed) return; closed = true; clearTimer(timer);
        events.removeEventListener('yingshi-bluem-live', receive);
        try { bridge.cancelBlueMLive(requestId); } catch {}
      };
      const receive = event => {
        const value = event.detail;
        if (closed || value?.requestId !== requestId) return;
        clearTimer(timer); events.removeEventListener('yingshi-bluem-live', receive);
        if (!value.ok) { const error = new Error(value.message || '藍色 M 直播暫時無法連線。'); error.terminal = Boolean(value.terminal); finish.reject(error); return; }
        try {
          const url = new URL(value.url);
          if (value.backend !== 'blue-m' || url.origin !== 'https://sylong7708.github.io' || !/^\/TV\/__bluem_live__\/[a-f0-9-]{36}\/master\.m3u8$/.test(url.pathname) || url.search || url.hash) throw new Error('Invalid app-local stream');
          finish.resolve({ url: url.href, backend: 'blue-m' });
        } catch { finish.reject(new Error('藍色 M 直播資料驗證失敗。')); }
      };
      const promise = new Promise((resolve, reject) => {
        finish = { resolve, reject };
        if (!videoId) { reject(new Error('YouTube 直播網址無效。')); return; }
        events.addEventListener('yingshi-bluem-live', receive);
        timer = setTimer(() => { close(); reject(new Error('藍色 M 直播解析逾時，請重新連線。')); }, 40000);
        try { bridge.resolveBlueMLive(videoId, requestId); } catch { close(); reject(new Error('藍色 M 內播服務尚未就緒。')); }
      });
      return { promise, close };
    },
  };
}
