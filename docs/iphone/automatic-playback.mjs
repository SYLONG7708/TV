// A session owns lookups, retries and timers. Closing/changing a movie cancels all of them.
export function createAutomaticPlayback({ rank, resolve, start, exhausted, discover = async () => [],
  waiting = () => {}, online = () => globalThis.navigator?.onLine !== false,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let generation = 0, session = null;
  const close = () => {
    generation++; session?.controller.abort(); clearTimer(session?.timer); session = null;
  };
  const current = (value, token) => value === session && token === generation && !value.controller.signal.aborted;
  function schedule(value, reason) {
    if (value !== session || value.timer) return;
    const delay = reason === 'offline' ? 5000 : Math.min(300000, 30000 * 2 ** Math.min(4, value.round++));
    waiting({ reason, retryMs: delay });
    value.timer = setTimer(() => {
      value.timer = null;
      if (value !== session) return;
      if (!online()) { schedule(value, 'offline'); return; }
      void retry(value.position);
    }, delay);
    value.timer?.unref?.();
  }
  async function lookup(value, token) {
    if (value.discovered || !current(value, token)) return;
    value.discovered = true;
    try {
      const found = await discover(value.options, value.controller.signal);
      if (!current(value, token)) return;
      value.candidates = rank([...value.candidates, ...found]);
      value.queue.push(...found);
    } catch { value.detailFailures++; }
  }
  async function advance(position = 0) {
    const value = session, token = generation;
    if (!value || value.loading || value.paused) return;
    value.position = Math.max(0, Number(position) || 0);
    if (!online()) { schedule(value, 'offline'); return; }
    value.loading = true;
    try {
      while (value.recoveryAttempts < 6 && now() - value.startedAt < 60000) {
        if (!value.queue.length && !value.discovered) await lookup(value, token);
        if (!current(value, token)) return;
        if (!value.queue.length) break;
        const candidate = rank([...value.queue])[0];
        if (!candidate) break;
        value.queue.splice(value.queue.indexOf(candidate), 1);
        let entries = [];
        try { entries = await resolve(candidate, value.controller.signal); } catch { value.detailFailures++; }
        if (!current(value, token)) return;
        const fresh = rank(entries).filter(entry => {
          const key = entry.url || entry.embedUrl;
          if (!key || value.seen.has(key)) return false;
          value.seen.add(key); return true;
        });
        if (!fresh.length) continue;
        const next = fresh.shift();
        value.queue.unshift(...fresh.map(entry => ({ ...entry, resolved: true })));
        for (const entry of fresh) value.seen.delete(entry.url || entry.embedUrl);
        value.attempts++; value.recoveryAttempts++;
        value.attemptId = `${token}:${value.attempts}`;
        start({ ...next, attemptId: value.attemptId }, { ...value.options, position: value.position, attempt: value.attempts });
        return;
      }
      if (!current(value, token)) return;
      exhausted({ attempts: value.attempts, detailFailures: value.detailFailures });
      schedule(value, 'sources');
    } finally { if (value === session) value.loading = false; }
  }
  async function retry(position = session?.position || 0) {
    const value = session;
    if (!value || value.loading || value.paused) return;
    clearTimer(value.timer); value.timer = null; value.attemptId = '';
    value.queue = [...value.candidates]; value.seen.clear(); value.discovered = false;
    value.recoveryAttempts = 0; value.startedAt = now(); value.playedAt = 0;
    return advance(position);
  }
  return {
    open(candidates, options = {}) {
      close(); session = { candidates: [...candidates], queue: [...candidates], seen: new Set(), attempts: 0,
        recoveryAttempts: 0, detailFailures: 0, startedAt: now(), loading: false, options,
        controller: new AbortController(), discovered: false, position: options.position || 0, round: 0 };
      return advance(options.position || 0);
    },
    async failed(entry, position = 0) {
      const value = session, token = generation;
      if (value?.attemptId !== entry?.attemptId) return;
      value.attemptId = ''; value.position = position;
      if (value.hasPlayed) {
        value.startedAt = now();
        if (now() - value.playedAt >= 90000) { value.recoveryAttempts = 0; value.round = 0; }
        value.hasPlayed = false;
      }
      if (!online()) { schedule(value, 'offline'); return; }
      // Search the cloud index even when the home page loaded only one provider.
      await lookup(value, token);
      if (current(value, token)) return advance(position);
    },
    succeeded(entry) {
      if (session?.attemptId !== entry?.attemptId) return;
      session.hasPlayed = true; session.playedAt = now();
      clearTimer(session.timer); session.timer = null;
    },
    retry,
    intent(action) {
      if (!session) return;
      const wasPaused = session.paused;
      session.paused = action === 'pause';
      if (session.paused) { clearTimer(session.timer); session.timer = null; }
      else if (wasPaused && !session.attemptId) void retry(session.position);
    },
    reconnect() { if (session?.timer && online()) return retry(session.position); },
    close,
    snapshot: () => session ? { attempts: session.attempts, remaining: session.queue.length,
      loading: session.loading, waiting: Boolean(session.timer) } : null,
  };
}
