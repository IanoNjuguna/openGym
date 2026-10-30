/* The providers that speak plain HTTPS, described once for both runtimes.
 *
 * The server's config.PROVIDERS spreads these rows in next to the runtime-backed providers
 * (Claude Agent SDK, Codex CLI); the phone reads them directly for its own picker. Keeping the
 * facts in one place is what stops the two ever offering different endpoints or defaults.
 *
 * `defaultModel` is a starting point, not a pin. Every one of these providers lists its models
 * over the same API, and the UI offers that list — a name typed here goes stale, a list does
 * not. `compatible` has no default at all: an OpenAI-compatible endpoint is whatever the owner
 * pointed it at, so the model has to come from what that endpoint actually serves.
 */
export const HTTP_PROVIDERS = Object.freeze({
  anthropic: Object.freeze({
    label: 'Anthropic API', runtime: 'HTTPS', http: true,
    apiKeyEnv: 'ANTHROPIC_API_KEY', oauthEnv: null,
    defaultBase: 'https://api.anthropic.com',
    defaultModel: 'claude-opus-5',
    keyPlaceholder: 'sk-ant-…'
  }),
  openai: Object.freeze({
    label: 'OpenAI API', runtime: 'HTTPS', http: true,
    apiKeyEnv: 'OPENAI_API_KEY', oauthEnv: null,
    defaultBase: 'https://api.openai.com',
    defaultModel: 'gpt-5.6',
    keyPlaceholder: 'sk-…'
  }),
  gemini: Object.freeze({
    label: 'Google Gemini', runtime: 'HTTPS', http: true,
    apiKeyEnv: 'GEMINI_API_KEY', oauthEnv: null,
    defaultBase: 'https://generativelanguage.googleapis.com',
    // Stable and on the free tier, which is where the Discord setup guide sends people. The
    // 2.5 names are refused for keys made after Google retired them (#758).
    defaultModel: 'gemini-3.8-flash',
    keyPlaceholder: 'AIza… or AQ.…'
  }),
  // Ollama, LM Studio, vLLM, OpenRouter, a corporate gateway: anything that serves the
  // Chat Completions shape. The base URL is the whole configuration; a key is optional
  // because a model on your own LAN usually has none.
  compatible: Object.freeze({
    label: 'OpenAI-compatible endpoint', runtime: 'HTTPS', http: true,
    apiKeyEnv: 'OPENAI_COMPAT_API_KEY', oauthEnv: null,
    defaultBase: null, baseUrl: true, keyOptional: true,
    defaultModel: null,
    keyPlaceholder: '(optional)'
  }),
  // A model on the owner's own machine, served by QVAC (`qvac serve --openai`). Same wire shape
  // as `compatible` and the same optional key, but with the address already filled in, because
  // a person who just installed QVAC should not have to know the port. The model comes from
  // whatever that server lists: QVAC answers /v1/models with the aliases in its own config.
  qvac: Object.freeze({
    label: 'QVAC (local)', runtime: 'HTTPS', http: true, local: true,
    apiKeyEnv: 'QVAC_API_KEY', oauthEnv: null,
    defaultBase: 'http://localhost:11434', baseUrl: true, keyOptional: true,
    defaultModel: null,
    keyPlaceholder: '(none)'
  })
});

export const HTTP_PROVIDER_IDS = Object.freeze(Object.keys(HTTP_PROVIDERS));

/**
 * Whether this provider is expected to be a model on the user's own machine or network.
 *
 * Four places used to spell this as `provider === 'compatible'` — the long timeout, the warmup,
 * the consent copy and the "running locally" line in the chat — and each of them would have
 * quietly done the wrong thing for the next local provider added. One predicate, read from the
 * table above, so a row that says `local: true` is the only thing to change.
 */
export function isLocalProvider(id) {
  const meta = HTTP_PROVIDERS[id];
  return !!(meta && (meta.local || id === 'compatible'));
}

/** The base URL a provider will actually be called at: the configured override, else the default. */
export function baseUrlFor(id, cfg) {
  const meta = HTTP_PROVIDERS[id];
  const set = cfg && cfg.providerOptions && cfg.providerOptions[id] && cfg.providerOptions[id].baseUrl;
  const raw = (typeof set === 'string' && set.trim()) || (meta && meta.defaultBase) || '';
  return raw.replace(/\/+$/, '');
}

/* Extra static headers a provider is called with (compatible endpoints only in practice):
 * gateways that demand routing/session headers (opencode Go's `x-opencode-session`,
 * `X-Title` style attribution headers elsewhere). Stored plaintext next to baseUrl —
 * routing aids, not credentials. Caps keep a mis-paste from becoming a smuggling vector:
 * at most 8 entries, token-shaped names, short values, and the names that would
 * override auth framing or transport are refused outright (re-checked at send time). */
export const MAX_HEADERS = 8;
export const MAX_HEADER_VALUE = 500;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/i;
const RESERVED_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'content-type', 'content-length',
  'host', 'connection', 'transfer-encoding', 'upgrade', 'cookie', 'set-cookie'
]);
export const isReservedHeader = name => RESERVED_HEADERS.has(String(name || '').toLowerCase());

export function validateHeaders(raw) {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'headers must be an object of name to value' };
  const names = Object.keys(raw);
  if (names.length > MAX_HEADERS) return { ok: false, error: `at most ${MAX_HEADERS} headers` };
  const out = {};
  for (const name of names) {
    const n = String(name).toLowerCase();
    if (!HEADER_NAME.test(name) || name.length > 64) return { ok: false, error: `bad header name: ${name}` };
    if (isReservedHeader(n)) return { ok: false, error: `header is reserved: ${name}` };
    const v = raw[name];
    if (typeof v !== 'string' || !v.trim()) return { ok: false, error: `header ${name} needs a value` };
    if (v.length > MAX_HEADER_VALUE) return { ok: false, error: `header ${name} is too long` };
    out[n] = v.trim();
  }
  return { ok: true, value: Object.keys(out).length ? out : null };
}

/** The extra headers a provider call carries: the configured map minus anything reserved
 *  (validated at write; this is the belt to that suspenders — a stored map from before a
 *  name was reserved must not override auth framing). */
export function extraHeadersFor(id, cfg) {
  const set = cfg && cfg.providerOptions && cfg.providerOptions[id] && cfg.providerOptions[id].headers;
  if (!set || typeof set !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(set)) {
    if (!isReservedHeader(k) && typeof v === 'string' && v) out[String(k).toLowerCase()] = v;
  }
  return out;
}

/**
 * Only http(s), only a parseable URL, and never credentials in it — a base URL is admin
 * configuration, but "admin-configured" and "safe to log" are different properties, and the
 * host is written into the job log so an operator can see where jobs went.
 */
export function validateBaseUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: true, value: null };
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: 'not a valid URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'only http:// and https:// endpoints are supported' };
  if (u.username || u.password) return { ok: false, error: 'put the key in the credential field, not in the URL' };
  if (u.search || u.hash) return { ok: false, error: 'a base URL has no query string' };
  return { ok: true, value: u.toString().replace(/\/+$/, '') };
}
