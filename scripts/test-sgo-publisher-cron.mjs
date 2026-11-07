// Compile the real Worker and execute its scheduled/manual handlers with a
// deterministic network boundary. No credentials, external calls or live cron.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createOriginCheckMiddleware } from '../node_modules/astro/dist/core/app/middlewares.js';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mantenimiento-sgo-cron-'));
const output = path.join(temporary, 'worker.mjs');
await build({ entryPoints: [new URL('../cron-worker/src/index.ts', import.meta.url).pathname], outfile: output, bundle: true, platform: 'browser', format: 'esm', logLevel: 'silent' });
const worker = (await import(pathToFileURL(output).href)).default;
after(() => fs.rm(temporary, { recursive: true, force: true }));
const PREVENTIVES = 'https://legacy.example.invalid/api/cron/generar-preventivos';
const PUBLISH = 'https://source.example.invalid/api/cron/sgo-snapshot';
const env = {
  APP_URL: 'https://legacy.example.invalid', CRON_SECRET: 'legacy-secret-only-for-fixture',
  SGO_INTEGRATION_ENABLED: 'true', SGO_API_ORIGIN: 'https://source.example.invalid',
  SGO_PUBLISH_SECRET: 'fixture-sgo-publish-secret-0123456789abcdef',
};
const successful = () => Response.json({ ok: true, snapshot_id: 'snapshot-ficticio-1234' });
async function harness(overrides = {}, responder = successful, action = 'scheduled', cron = '0 12 * * *') {
  const saved = { fetch: globalThis.fetch, log: console.log, error: console.error };
  const calls = [], logs = [], pending = [];
  const configured = { ...env, ...overrides };
  globalThis.fetch = async (input, init) => {
    const url = String(input), headers = new Headers(init?.headers);
    calls.push({ url, init, headers });
    if (url === PREVENTIVES) return Response.json({ legacy: 'unchanged' });
    return responder(input, init);
  };
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => logs.push(args.join(' '));
  try {
    const ctx = { waitUntil(promise) { pending.push(Promise.resolve(promise).then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }))); } };
    const response = action === 'scheduled'
      ? await worker.scheduled({ cron }, configured, ctx)
      : await worker.fetch(new Request('https://cron.example.invalid/run', { headers: { 'x-cron-secret': configured.CRON_SECRET } }), configured);
    return { calls, logs, results: await Promise.all(pending), response };
  } finally { globalThis.fetch = saved.fetch; console.log = saved.log; console.error = saved.error; }
}
function assertSafeLogs(logs) {
  const all = logs.join('\n');
  for (const value of [env.SGO_PUBLISH_SECRET, env.CRON_SECRET, env.SGO_API_ORIGIN, 'REMOTE_PRIVATE_BODY']) assert(!all.includes(value), `sensitive log: ${value}`);
}
function assertLegacy(call) {
  assert.equal(call.url, PREVENTIVES); assert.equal(call.init.method, 'POST');
  assert.equal(call.headers.get('x-cron-secret'), env.CRON_SECRET);
  assert.equal(call.headers.get('x-sgo-publish-secret'), null);
  assert.equal(call.init.body, '{}');
}

test('versioned production configuration preserves legacy origin and public SGO activation without secrets', async () => {
  const config = await fs.readFile(new URL('../cron-worker/wrangler.toml', import.meta.url), 'utf8');
  assert.match(config, /^APP_URL = "https:\/\/mantenimiento-49c\.pages\.dev"$/m);
  assert.match(config, /^SGO_INTEGRATION_ENABLED = "true"$/m);
  assert.match(config, /^SGO_API_ORIGIN = "https:\/\/mantenimiento\.complejoavante\.dev"$/m);
  assert.doesNotMatch(config, /^(?:SGO_PUBLISH_SECRET|CRON_SECRET)\s*=/m);
});
test('flag absent, false, 1 or TRUE does not add a scheduled request', async () => {
  for (const flag of [undefined, 'false', '1', 'TRUE', '']) {
    const result = await harness({ SGO_INTEGRATION_ENABLED: flag });
    assert.equal(result.calls.length, 1); assert.equal(result.results.length, 1);
    assertLegacy(result.calls[0]); assertSafeLogs(result.logs);
  }
});
test('opt-in scheduled publishing uses its own origin/secret and POST without redirects', async () => {
  const result = await harness();
  assert.equal(result.calls.length, 2); assertLegacy(result.calls[0]);
  const publish = result.calls[1];
  assert.equal(publish.url, PUBLISH); assert.equal(publish.init.method, 'POST');
  assert.equal(publish.headers.get('x-sgo-publish-secret'), env.SGO_PUBLISH_SECRET);
  assert.equal(publish.headers.get('x-cron-secret'), null);
  assert.equal(publish.headers.get('content-type'), 'application/json');
  assert.equal(publish.headers.get('origin'), env.SGO_API_ORIGIN);
  assert.equal(publish.init.redirect, 'manual'); assert(publish.init.signal instanceof AbortSignal);
  assert(result.results.every(x => x.status === 'fulfilled'));
  assert(result.logs.includes('[sgo-snapshot] published')); assertSafeLogs(result.logs);
});
test('real Astro origin protection rejects the old request and accepts both scheduled publishers', async () => {
  const originCheck = createOriginCheckMiddleware();
  const protectedPublisher = (input, init) => {
    const request = new Request(input, init);
    return originCheck({ request, url: new URL(request.url), isPrerendered: false }, successful);
  };
  const oldRequest = await protectedPublisher(PUBLISH, {
    method: 'POST', headers: { 'X-SGO-Publish-Secret': env.SGO_PUBLISH_SECRET },
  });
  assert.equal(oldRequest.status, 403);
  assert.match(await oldRequest.text(), /Cross-site POST form submissions are forbidden/);
  for (const cron of ['0 12 * * *', '5 * * * *']) {
    const result = await harness({ SGO_API_ORIGIN: env.SGO_API_ORIGIN + '/' }, protectedPublisher, 'scheduled', cron);
    assert(result.results.every(x => x.status === 'fulfilled'));
    const publish = result.calls.find(call => call.url === PUBLISH);
    assert.equal(publish.headers.get('origin'), env.SGO_API_ORIGIN, 'origin is canonicalized from trusted configuration');
    assert.equal(publish.headers.get('content-type'), 'application/json');
    assert.equal(publish.init.body, undefined, 'no request data is needed for snapshot publication');
    assert(result.logs.includes('[sgo-snapshot] published')); assertSafeLogs(result.logs);
  }
});
test('hourly trigger publishes once and never invokes preventive generation', async () => {
  const result = await harness({}, successful, 'scheduled', '5 * * * *');
  assert.equal(result.calls.length, 1); assert.equal(result.results.length, 1);
  assert.equal(result.calls[0].url, PUBLISH); assert.equal(result.calls[0].headers.get('x-cron-secret'), null);
  assert.equal(result.calls[0].headers.get('x-sgo-publish-secret'), env.SGO_PUBLISH_SECRET);
  assert.equal(result.results[0].status, 'fulfilled'); assertSafeLogs(result.logs);
  for (const flag of [undefined, 'false', '1', 'TRUE']) {
    const disabled = await harness({ SGO_INTEGRATION_ENABLED: flag }, successful, 'scheduled', '5 * * * *');
    assert.equal(disabled.calls.length, 0); assert.equal(disabled.results.length, 0);
  }
});
test('unrecognized cron schedules execute neither job', async () => {
  for (const cron of ['', '0 * * * *', '*/5 * * * *']) {
    const result = await harness({}, successful, 'scheduled', cron);
    assert.equal(result.calls.length, 0); assert.equal(result.results.length, 0);
  }
});
test('manual /run remains preventive-only even with integration enabled', async () => {
  const result = await harness({}, successful, 'manual');
  assert.equal(result.calls.length, 1); assertLegacy(result.calls[0]);
  assert.deepEqual(await result.response.json(), { legacy: 'unchanged' });
  assert.equal(result.results.length, 0); assertSafeLogs(result.logs);
});
test('unsafe origin and missing dedicated credential fail closed before additional fetch', async () => {
  for (const invalid of [undefined, 'http://source.example.invalid', 'https://user:pass@source.example.invalid', 'https://source.example.invalid/path', 'https://source.example.invalid?token=PRIVATE', 'https://source.example.invalid#PRIVATE', 'https://source.example.invalid:8443']) {
    const result = await harness({ SGO_API_ORIGIN: invalid });
    assert.equal(result.calls.length, 1); assertLegacy(result.calls[0]);
    assert.equal(result.results[1].status, 'rejected');
    assert.equal(result.results[1].reason.message, 'SGO_SNAPSHOT_CONFIGURATION_INVALID');
    assertSafeLogs(result.logs);
  }
  for (const secret of [undefined, '', 'short']) {
    const result = await harness({ SGO_PUBLISH_SECRET: secret });
    assert.equal(result.calls.length, 1); assert.equal(result.results[1].status, 'rejected');
  }
});
test('500 and redirect responses fail without logging bodies or retrying', async () => {
  for (const status of [500, 302]) {
    const result = await harness({}, () => new Response('REMOTE_PRIVATE_BODY ' + env.SGO_PUBLISH_SECRET, { status, headers: { Location: 'https://other.example.invalid' } }));
    assert.equal(result.calls.length, 2); assert.equal(result.results[0].status, 'fulfilled');
    assert.equal(result.results[1].status, 'rejected');
    assert.equal(result.results[1].reason.message, status === 302 ? 'SGO_SNAPSHOT_REDIRECT_REJECTED' : 'SGO_SNAPSHOT_HTTP_ERROR');
    assertSafeLogs(result.logs);
  }
});
test('network errors never disclose the raw error or configuration', async () => {
  const result = await harness({}, () => { throw Error(`REMOTE_PRIVATE_BODY ${env.SGO_PUBLISH_SECRET}`); });
  assert.equal(result.results[1].reason.message, 'SGO_SNAPSHOT_REQUEST_FAILED'); assertSafeLogs(result.logs);
});
test('success requires a small valid acknowledgement; streamed body is bounded too', async () => {
  let canceled = false;
  for (const responder of [
    () => new Response('REMOTE_PRIVATE_BODY', { headers: { 'content-length': '9000' } }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4097)); }, cancel() { canceled = true; } })),
    () => Response.json({ ok: false, snapshot_id: 's' }),
    () => Response.json({ ok: true, snapshot_id: 'REMOTE_PRIVATE_BODY / path' }),
    () => new Response('not-json REMOTE_PRIVATE_BODY'),
  ]) {
    const result = await harness({}, responder);
    assert.equal(result.results[1].status, 'rejected'); assertSafeLogs(result.logs);
  }
  assert.equal(canceled, true);
});
test('10-second deadline bounds both a hanging request and a stalled response stream', async () => {
  const originalTimeout = globalThis.setTimeout;
  // Exercise the actual deadline callback immediately; avoid sleeping ten seconds.
  globalThis.setTimeout = (handler, delay, ...args) => { assert.equal(delay, 10_000); return originalTimeout(handler, 1, ...args); };
  try {
    for (const responder of [
      () => new Promise(() => {}),
      () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); } })),
    ]) {
      const result = await harness({}, responder);
      assert.equal(result.results[0].status, 'fulfilled'); assert.equal(result.results[1].status, 'rejected');
      assert.equal(result.results[1].reason.message, 'SGO_SNAPSHOT_TIMEOUT');
      assert.equal(result.calls[1].init.signal.aborted, true); assertSafeLogs(result.logs);
    }
  } finally { globalThis.setTimeout = originalTimeout; }
});
