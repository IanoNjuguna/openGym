/* Keeps a local model's prefix cache warm, so nobody pays the cold start.
 *
 * The rules ride as a byte-identical system message precisely so a llama.cpp/Ollama endpoint
 * can reuse its KV prefix across jobs — but the cache only exists after something has sent
 * that prefix once, and it dies with the ollama process. Without this, the first review after
 * a reboot quietly costs ~8 minutes instead of ~1, and whoever asks it looks unlucky.
 *
 * So: when the configured provider is a compatible endpoint, send each chat prefix once at
 * boot and then again every half hour. A warm ping is nearly free (the prefix is cached, one
 * token comes back); a cold one does the expensive read exactly once, off anyone's clock.
 * Cloud providers are never pinged — their caches are their problem, and requests cost money.
 */
import * as cfgStore from './config.js';
import { adapterFor } from './adapters/index.js';
import { isLocalProvider } from './core/providers.js';
import { buildPromptParts } from './core/prompt.js';
import { fetchFor } from './node-fetch.js';

const INTERVAL_MS = 30 * 60000;
const TIMEOUT_MS = 10 * 60000;
// A model on a CPU can need minutes just to read one prefix, and a llama.cpp server decodes one
// request at a time, so a warmup that slow warms nothing: it holds the only slot a real job could
// be using, and a request that arrives behind it dies at the client's five-minute wall. Measured
// on a 2016 dual-core: 510 s for one kind, while the person who asked a question in the app got
// their failure six minutes later. After one pass that slow, warmups stop for this process.
const SLOW_MS = 120000;
const state = { tooSlow: false };
// The two kinds a chat runs day to day; `create` happens once per user and may pay cold.
// Review is deliberately LAST: with OLLAMA_NUM_PARALLEL=1 there is one live slot, it belongs
// to whatever ran most recently, and the fallback restore from the prompt cache is not
// reliable for large prompts — so the slot must end up holding the kind people actually use.
// (Measured: a review right after a debrief ping took 402 s; right after a review ping, 26 s.)
const KINDS = ['debrief', 'review'];

let running = false;

export async function warmOnce({ log = console, fetch: fetchImpl, slowMs = SLOW_MS, state: st = state } = {}) {
  const cfg = cfgStore.load();
  // Any local endpoint warms the same way: the model has to be resident, or the first real job
  // pays the cold start. `isLocalProvider` rather than a name, so a new local row gets it free.
  if (!cfgStore.isEnabled() || !isLocalProvider(cfg.provider)) return { skipped: true };
  // A machine that already proved it is too slow to warm gets left alone.
  if (st.tooSlow) return { skipped: true };
  const adapter = adapterFor(cfg.provider);
  if (!adapter || adapter.spawns !== false) return { skipped: true };
  if (running) return { skipped: true };
  running = true;
  try {
    for (const kind of KINDS) {
      const parts = buildPromptParts(kind, {});
      const t0 = Date.now();
      const r = await adapter.invoke({
        cfg,
        system: parts.system,
        prompt: 'Reply with exactly {"coach_contract":1} and nothing else.',
        model: cfgStore.modelFor(cfg),
        timeoutMs: TIMEOUT_MS,
        fetch: fetchImpl || fetchFor(TIMEOUT_MS)
      });
      const ms = Date.now() - t0;
      if (r.code !== 0) {
        log.log(`coach warmup (${kind}): endpoint not reachable, will retry later`);
        return { ok: false };
      }
      // >5s means the prefix was actually (re)read — worth a line; a warm ping is noise.
      if (ms > 5000) log.log(`coach warmup (${kind}): prefix cached in ${Math.round(ms / 1000)}s`);
      // Past the slow threshold this stops being a favour. Give the slot back and stop trying:
      // the second kind would take just as long, and every minute of it is a minute a real
      // question from somebody's phone would spend queued behind it.
      if (ms > slowMs) {
        st.tooSlow = true;
        log.log(`coach warmup (${kind}): too slow to be worth it on this machine (${Math.round(ms / 1000)}s); no more warmups`);
        return { ok: true, slow: true };
      }
    }
    return { ok: true };
  } finally {
    running = false;
  }
}

/** Boot + every half hour. Never throws; a failed warmup is only a missed optimisation. */
export function startWarmup(log = console) {
  const tick = () => warmOnce({ log }).catch(() => {});
  setTimeout(tick, 5000);                                 // let the container settle first
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();
  return timer;
}
