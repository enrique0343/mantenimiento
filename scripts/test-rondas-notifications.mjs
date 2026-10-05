// Local-only notification lifecycle tests. The real module runs against SQLite,
// the production rounds migration, and transactional D1-style batches.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setup, root } from './test-support/sqlite-app.mjs';

const NOW = '2026-10-03T12:00:00.000Z';
const minutesAfter = (date, minutes) => new Date(Date.parse(date) + minutes * 60000).toISOString();

async function fixture(t) {
  const { api, sqlite, close } = await setup({ modules: { notifications: '../lib/rondas/notifications.ts' } });
  t.after(close);
  // Do not inherit the generic helper's non-transactional Promise.all batch.
  function statement(sql, args = []) {
    const query = sqlite.prepare(sql);
    return {
      bind(...parameters) { return statement(sql, parameters); },
      allSync() { return { results: query.all(...args), success: true }; },
      async all() { return this.allSync(); },
      async run() { return { success: true, meta: query.run(...args) }; },
      async first() { return query.get(...args) ?? null; },
    };
  }
  const DB = {
    prepare: (sql) => statement(sql),
    async batch(queries) {
      sqlite.exec('BEGIN');
      try {
        // Synchronous execution also models one indivisible D1 batch when
        // concurrent processRoundNotifications calls share this database.
        const results = queries.map((query) => query.allSync());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  sqlite.exec(await fs.readFile(path.join(root, 'migrations/0051_rondas.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO usuarios(id,nombre,email,password_hash,rol,activo) VALUES
      (2,'Active reviewer','reviewer@example.invalid','fixture-only','jefe',1),
      (3,'Inactive reviewer','inactive@example.invalid','fixture-only','jefe',0);
    INSERT INTO sucursales(id,nombre) VALUES(1,'Local test site');
    INSERT INTO ubicaciones(id,nombre,sucursal_id) VALUES(1,'Local test room',1);
    INSERT INTO rondas_templates(id,name,config_json,mutation_token,created_by,created_at)
      VALUES(1,'Notification test','{}','test-template',1,'${NOW}');
  `);
  let nextExecution = 0;
  function execution({ status = 'pendiente', dueAt = minutesAfter(NOW, -1), originalDueAt = dueAt,
    recipients = [2], events = ['vencida'] } = {}) {
    const id = ++nextExecution;
    const snapshot = JSON.stringify({ notifications: { recipientIds: recipients, events } });
    sqlite.prepare(`INSERT INTO rondas_executions(
      id,template_id,template_version,name,site_id,location_id,scheduled_date,shift,
      due_at,original_due_at,status,owner_id,reviewer_id,snapshot_json,data_json,mutation_token,created_at
    ) VALUES(?,1,1,'Test round',1,1,?,'day',?,?,?,1,2,?,'[]',?,?)`)
      .run(id, `2026-10-${String(id).padStart(2, '0')}`, dueAt, originalDueAt, status, snapshot, `execution-${id}`, NOW);
    return id;
  }
  function notification({ executionId = execution(), recipientId = 2, status = 'dry_run', attempts = 0,
    nextAttemptAt = null, event = 'vencida', eventRevision = 0 } = {}) {
    const result = sqlite.prepare(`INSERT INTO rondas_notifications(
      execution_id,event,event_revision,recipient_id,status,attempts,next_attempt_at,created_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run(executionId, event, eventRevision, recipientId, status, attempts, nextAttemptAt, NOW);
    return Number(result.lastInsertRowid);
  }
  const get = (id) => sqlite.prepare('SELECT * FROM rondas_notifications WHERE id=?').get(id);
  const audits = (id) => sqlite.prepare('SELECT * FROM rondas_notification_attempts WHERE notification_id=? ORDER BY id').all(id);
  const process = (options = {}) => api.notifications.processRoundNotifications(DB, { now: NOW, ...options });
  const enqueue = (now = NOW) => api.notifications.queueOverdueNotifications(DB, now);
  return { sqlite, DB, execution, notification, get, audits, process, enqueue };
}

test('overdue enqueue deduplicates executions, events and repeated recipient IDs', async (t) => {
  const f = await fixture(t);
  const executionId = f.execution({ recipients: [2, 2, 3, 3] });
  await f.enqueue();
  await f.enqueue();
  await Promise.all([f.enqueue(), f.enqueue()]);
  const rows = f.sqlite.prepare('SELECT execution_id,event,event_revision,recipient_id,status FROM rondas_notifications ORDER BY recipient_id').all();
  assert.deepEqual(rows.map((n) => [n.execution_id, n.event, n.event_revision, n.recipient_id, n.status]), [
    [executionId, 'vencida', 0, 2, 'dry_run'], [executionId, 'vencida', 0, 3, 'dry_run'],
  ]);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM rondas_notification_attempts').get().n, 0);
});

test('enqueue reports only newly inserted notifications', async (t) => {
  const f = await fixture(t);
  f.execution({ recipients: [2, 2, 3] });
  assert.deepEqual(await f.enqueue(), { considered: 1, queued: 2 });
  assert.deepEqual(await f.enqueue(), { considered: 1, queued: 0 });
});

test('only opted-in overdue open statuses enqueue, using the immutable original due date', async (t) => {
  const f = await fixture(t);
  const expected = ['pendiente', 'en_curso', 'devuelta'].map((status) => f.execution({ status }));
  for (const status of ['pendiente_validacion', 'validada', 'omitida']) f.execution({ status });
  f.execution({ dueAt: NOW });
  f.execution({ dueAt: minutesAfter(NOW, 1) });
  f.execution({ events: ['asignada'] });
  f.execution({ recipients: [] });
  // Rescheduling does not erase the original missed deadline.
  expected.push(f.execution({ dueAt: minutesAfter(NOW, 60), originalDueAt: minutesAfter(NOW, -60) }));
  await f.enqueue();
  assert.deepEqual(f.sqlite.prepare('SELECT execution_id FROM rondas_notifications ORDER BY execution_id').all().map((n) => n.execution_id), expected);
});

test('default and explicit dry runs never invoke transport or fetch and record one simulation', async (t) => {
  const f = await fixture(t);
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  let transportCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('Network forbidden by local-only notification test'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const options of [{}, { dryRun: true }]) {
    const id = f.notification();
    const result = await f.process({ ...options, send: async () => { transportCalls++; } });
    assert.deepEqual(result, { dryRun: true, processed: 1, sent: 0, failed: 0 });
    assert.equal(f.get(id).status, 'dry_run');
    assert.equal(f.get(id).delivered_at, null);
    assert.equal(f.audits(id).length, 1);
    assert.match(f.audits(id)[0].details, /Simulación/);
    assert.deepEqual(await f.process(options), { dryRun: true, processed: 0, sent: 0, failed: 0 });
  }
  assert.equal(transportCalls, 0);
  assert.equal(networkCalls, 0);
});

test('a simulated notification remains deliverable after an explicit live transport is enabled', async (t) => {
  const f = await fixture(t);
  const id = f.notification();
  await f.process();
  const messages = [];
  const result = await f.process({ dryRun: false, send: async (message) => { messages.push(message); } });
  assert.equal(result.sent, 1);
  assert.equal(messages.length, 1);
  assert.equal(f.get(id).status, 'sent');
  assert.equal(f.get(id).attempts, 1, 'simulation does not consume the real delivery retry budget');
  assert.deepEqual(f.audits(id).map(a=>a.status), ['dry_run','sent']);
});

test('live processing without an explicitly injected transport is rejected before any writes', async (t) => {
  const f = await fixture(t);
  const id = f.notification();
  const before = { ...f.get(id) };
  await assert.rejects(() => f.process({ dryRun: false }), /No transport explicitly configured/);
  assert.deepEqual({ ...f.get(id) }, before);
  assert.equal(f.audits(id).length, 0);
});

test('injected transport receives stable idempotency, configured app link and no inspection data', async (t) => {
  const f = await fixture(t);
  const id = f.notification({ event: 'pendiente_validacion', eventRevision: 7 });
  const messages = [];
  const result = await f.process({ dryRun: false, appUrl: 'https://rounds.example.invalid/base', send: async (message) => { messages.push(message); } });
  assert.deepEqual(result, { dryRun: false, processed: 1, sent: 1, failed: 0 });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'reviewer@example.invalid');
  assert.equal(messages[0].idempotencyKey, `ronda-notification-${id}`);
  assert.match(messages[0].subject, /pendiente_validacion/);
  assert.match(messages[0].text, /https:\/\/rounds\.example\.invalid\/rondas\?execution=1/);
  assert.match(messages[0].text, /No responda con información clínica/);
  assert.deepEqual(Object.keys(messages[0]).sort(), ['idempotencyKey', 'subject', 'text', 'to']);
  assert.equal(f.get(id).status, 'sent');
  assert.equal(f.get(id).delivered_at, NOW);
  assert.equal(f.get(id).next_attempt_at, null);
  assert.equal(f.audits(id).length, 1);
  assert.match(f.audits(id)[0].details, /entrega final no confirmada/);
  assert.equal((await f.process({ dryRun: false, send: async () => assert.fail('Sent row was processed twice') })).processed, 0);
});

test('transport errors retry exponentially, redact exception details and stop after eight attempts', async (t) => {
  const f = await fixture(t);
  const id = f.notification();
  const messages = [];
  let now = NOW;
  const send = async (message) => { messages.push(message); throw new Error('private transport token must never enter delivery audit'); };
  for (let attempt = 1; attempt <= 8; attempt++) {
    const result = await f.process({ now, dryRun: false, send });
    assert.deepEqual(result, { dryRun: false, processed: 1, sent: 0, failed: 1 });
    const row = f.get(id);
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, attempt);
    assert.equal(row.delivered_at, null);
    assert.doesNotMatch(row.last_error, /private transport token/);
    const retryAt = attempt < 8 ? minutesAfter(now, 2 ** attempt) : null;
    assert.equal(row.next_attempt_at, retryAt, `backoff after attempt ${attempt}`);
    if (retryAt) {
      const early = new Date(Date.parse(retryAt) - 1).toISOString();
      assert.equal((await f.process({ now: early, dryRun: false, send })).processed, 0);
      now = retryAt;
    }
  }
  assert.equal(messages.length, 8);
  assert.deepEqual([...new Set(messages.map((message) => message.idempotencyKey))], [`ronda-notification-${id}`]);
  assert.equal(f.audits(id).length, 8);
  assert.doesNotMatch(JSON.stringify(f.audits(id)), /private transport token/);
  assert.equal((await f.process({ now: minutesAfter(now, 1440), dryRun: false, send })).processed, 0);
});

test('inactive recipients never reach a transport, while active recipients continue normally', async (t) => {
  const f = await fixture(t);
  const inactiveId = f.notification({ recipientId: 3 });
  const activeId = f.notification();
  const recipients = [];
  assert.deepEqual(await f.process({ dryRun: false, send: async (message) => { recipients.push(message.to); } }),
    { dryRun: false, processed: 2, sent: 1, failed: 1 });
  assert.deepEqual(recipients, ['reviewer@example.invalid']);
  assert.equal(f.get(inactiveId).status, 'failed');
  assert.equal(f.get(inactiveId).delivered_at, null);
  assert.equal(f.get(inactiveId).next_attempt_at, minutesAfter(NOW, 2));
  assert.equal(f.audits(inactiveId).length, 1);
  assert.equal(f.get(activeId).status, 'sent');
});

test('a successful retry clears prior failure state without changing delivery identity', async (t) => {
  const f = await fixture(t);
  const id = f.notification();
  const keys = [];
  await f.process({ dryRun: false, send: async (message) => {
    keys.push(message.idempotencyKey);
    throw new Error('Temporary outage');
  } });
  const retryAt = f.get(id).next_attempt_at;
  assert.equal(retryAt, minutesAfter(NOW, 2));
  assert.deepEqual(await f.process({ now: retryAt, dryRun: false, send: async (message) => { keys.push(message.idempotencyKey); } }),
    { dryRun: false, processed: 1, sent: 1, failed: 0 });
  assert.equal(f.get(id).status, 'sent');
  assert.equal(f.get(id).attempts, 2);
  assert.equal(f.get(id).last_error, null);
  assert.equal(f.get(id).next_attempt_at, null);
  assert.equal(f.get(id).delivered_at, retryAt);
  assert.deepEqual(f.audits(id).map((attempt) => attempt.status), ['failed', 'sent']);
  assert.deepEqual(keys, [`ronda-notification-${id}`, `ronda-notification-${id}`]);
});

test('unexpired sending leases are skipped and expired leases can be reclaimed', async (t) => {
  const f = await fixture(t);
  const future = f.notification({ status: 'sending', attempts: 1, nextAttemptAt: minutesAfter(NOW, 5) });
  const expired = f.notification({ status: 'sending', attempts: 1, nextAttemptAt: minutesAfter(NOW, -1) });
  const due = f.notification({ status: 'pending', attempts: 0, nextAttemptAt: NOW });
  const exhausted = f.notification({ status: 'failed', attempts: 8, nextAttemptAt: null });
  const keys = [];
  const result = await f.process({ dryRun: false, send: async (message) => { keys.push(message.idempotencyKey); } });
  assert.equal(result.sent, 2);
  assert.deepEqual(keys, [`ronda-notification-${expired}`, `ronda-notification-${due}`]);
  assert.equal(f.get(future).status, 'sending');
  assert.equal(f.get(future).attempts, 1);
  assert.equal(f.audits(future).length, 0);
  assert.equal(f.get(expired).attempts, 2);
  assert.equal(f.get(exhausted).attempts, 8);
});

test('concurrent processors claim one pending notification with CAS and send only once', async (t) => {
  const f = await fixture(t);
  const id = f.notification();
  const keys = [];
  const options = { dryRun: false, send: async (message) => { keys.push(message.idempotencyKey); } };
  const results = await Promise.all([f.process(options), f.process(options), f.process(options)]);
  assert.equal(results.reduce((sum, result) => sum + result.processed, 0), 1);
  assert.equal(results.reduce((sum, result) => sum + result.sent, 0), 1);
  assert.deepEqual(keys, [`ronda-notification-${id}`]);
  assert.equal(f.get(id).attempts, 1);
  assert.equal(f.audits(id).length, 1);
});

test('a stale worker cannot overwrite the result of a later reclaimed lease', async (t) => {
  const f = await fixture(t);
  const id = f.notification();
  let releaseOldTransport;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const release = new Promise((resolve) => { releaseOldTransport = resolve; });
  const keys = [];
  const staleWorker = f.process({ dryRun: false, send: async (message) => {
    keys.push(message.idempotencyKey);
    signalStarted();
    await release;
    throw new Error('Old worker failed after its lease expired');
  } });
  await started;
  assert.equal(f.get(id).status, 'sending');
  assert.equal(f.get(id).next_attempt_at, minutesAfter(NOW, 5));
  try {
    assert.equal((await f.process({ now: minutesAfter(NOW, 4), dryRun: false,
      send: async () => assert.fail('An unexpired lease was claimed') })).processed, 0);
    const newWorker = await f.process({ now: minutesAfter(NOW, 6), dryRun: false, send: async (message) => { keys.push(message.idempotencyKey); } });
    assert.equal(newWorker.sent, 1);
  } finally {
    releaseOldTransport();
    await staleWorker;
  }
  assert.equal(f.get(id).attempts, 2);
  assert.equal(f.get(id).status, 'sent');
  assert.equal(f.get(id).last_error, null);
  assert.equal(f.get(id).next_attempt_at, null);
  assert.equal(f.get(id).delivered_at, minutesAfter(NOW, 6));
  assert.deepEqual(keys, [`ronda-notification-${id}`, `ronda-notification-${id}`], 'Lease recovery preserves downstream deduplication identity');
});

test('delivery state and append-only attempt audit finalize in one transaction', async (t) => {
  const f = await fixture(t);
  const id = f.notification();
  f.sqlite.exec(`CREATE TRIGGER reject_attempt BEFORE INSERT ON rondas_notification_attempts
    BEGIN SELECT RAISE(ABORT,'injected delivery audit failure'); END;`);
  await assert.rejects(() => f.process(), /injected delivery audit failure/);
  assert.equal(f.get(id).status, 'sending', 'Final state must roll back when its matching audit cannot be written');
  assert.equal(f.get(id).attempts, 1);
  assert.equal(f.get(id).next_attempt_at, minutesAfter(NOW, 5));
  assert.equal(f.audits(id).length, 0);
  f.sqlite.exec('DROP TRIGGER reject_attempt');
  assert.equal((await f.process({ now: minutesAfter(NOW, 6) })).processed, 1);
  assert.equal(f.get(id).status, 'dry_run');
  assert.equal(f.audits(id).length, 1);
  assert.throws(() => f.sqlite.prepare('UPDATE rondas_notification_attempts SET status=? WHERE notification_id=?').run('sent', id), /immutable/);
  assert.throws(() => f.sqlite.prepare('DELETE FROM rondas_notification_attempts WHERE notification_id=?').run(id), /immutable/);
});
