import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-warmup-'));
process.env.DATA_DIR = DIR;
fs.writeFileSync(path.join(DIR, 'secret'), 'x'.repeat(64));

const cfgStore = await import('../coach/config.js');
const { warmOnce } = await import('../coach/warmup.js');
const { buildPromptParts } = await import('../coach/core/prompt.js');

test('warmup pings the compatible endpoint once per chat kind, with the real rules prefix', async t => {
  cfgStore.reset();
  cfgStore.save({ enabled: true, provider: 'compatible', models: { compatible: 'm1' }, providerOptions: { compatible: { baseUrl: 'http://ollama.test:11434' } } });
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"coach_contract":1}' }, finish_reason: 'stop' }] }), { status: 200 });
  };
  const quiet = { log: () => {} };
  t.after(() => cfgStore.reset());

  const r = await warmOnce({ log: quiet, fetch: fakeFetch });
  assert.equal(r.ok, true);
  assert.equal(seen.length, 2);
  const reviewPrefix = buildPromptParts('review', {}).system;
  assert.ok(seen[1].messages[0].content.endsWith(reviewPrefix), 'review is warmed LAST, so the single live slot ends up holding it');
  assert.ok(seen[0].messages[0].content.endsWith(buildPromptParts('debrief', {}).system));
  assert.equal(seen[0].model, 'm1');

  cfgStore.save({ provider: 'anthropic' });
  assert.equal((await warmOnce({ log: quiet, fetch: fakeFetch })).skipped, true, 'cloud providers are never pinged');
});

/* A slow local model and a single decode slot: a warmup that takes minutes holds the slot a real
   question needs, and the person who asked one gets a failure instead of an answer. Measured on a
   2016 dual-core laptop, one warmup kind took 510 s while a chat request died at 301 s. */
test('a warmup too slow to be worth it stops after the first kind and then stops entirely', async t => {
  cfgStore.reset();
  cfgStore.save({ enabled: true, provider: 'compatible', models: { compatible: 'm1' }, providerOptions: { compatible: { baseUrl: 'http://ollama.test:11434' } } });
  t.after(() => cfgStore.reset());
  const seen = [];
  const slowFetch = async (url, init) => {
    seen.push(JSON.parse(init.body));
    await new Promise(r => setTimeout(r, 5));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"coach_contract":1}' }, finish_reason: 'stop' }] }), { status: 200 });
  };
  const quiet = { log: () => {} };
  const st = { tooSlow: false };

  const r = await warmOnce({ log: quiet, fetch: slowFetch, slowMs: 1, state: st });
  assert.deepEqual(r, { ok: true, slow: true });
  assert.equal(seen.length, 1, 'the second kind is not attempted: it would hold the slot just as long');
  assert.equal(st.tooSlow, true);

  assert.equal((await warmOnce({ log: quiet, fetch: slowFetch, slowMs: 1, state: st })).skipped, true, 'and a machine that proved it is too slow is left alone');
  assert.equal(seen.length, 1);
});
