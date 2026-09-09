// D1-compatible isolated database. Unlike a schema-derived fake, this applies
// every real migration so foreign keys, indexes and traceability triggers run.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function setupConjuntos() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mantenimiento-conjuntos-'));
  const filename = path.join(temporary, 'routes.mjs');
  await build({
    stdin: { contents: `
      export * as list from './src/pages/api/conjuntos/index';
      export * as detail from './src/pages/api/conjuntos/[id]/index';
      export * as components from './src/pages/api/conjuntos/[id]/componentes';
      export * as assets from './src/pages/api/activos/[id]/index';
      export * as orders from './src/pages/api/ordenes/index';
      export * as order from './src/pages/api/ordenes/[id]/index';
      export * as bulkOrderDelete from './src/pages/api/ordenes/bulk-delete';
      export * as conjuntos from './src/lib/conjuntos';
      export { createSessionToken, setSessionCookie } from './src/lib/auth';
    `, resolveDir: root, loader: 'ts' },
    outfile: filename, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'no-external-effects', setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(email|smtp-worker|telegram|notificaciones|notif-app|audit|especialidad)$/ }, (args) => ({ path: args.path.split('/').at(-1), namespace: 'no-effects' }));
      builder.onLoad({ filter: /.*/, namespace: 'no-effects' }, () => ({ contents: `
        export const sendMail=async()=>{}; export const emailLayout=()=>'';
        export const sendTelegram=async()=>{}; export const crearNotificacion=async()=>{};
        export const logAudit=async()=>{}; export const calcularDiff=(a,b)=>b;
        export const jefesNotificar=async()=>[]; export const disparadorOT=async()=>{};
        export const disparadorProyecto=async()=>{};
      `, loader: 'js' }));
    }}],
  });
  const app = await import(pathToFileURL(filename).href);
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrations = (await fs.readdir(path.join(root, 'migrations'))).filter((name) => /^\d{4}.*\.sql$/.test(name)).sort();
  assert(migrations.some((name) => name.startsWith('0048_')), 'Traceability migration must exist');
  for (const migration of migrations) {
    try { sqlite.exec(await fs.readFile(path.join(root, 'migrations', migration), 'utf8')); }
    catch (error) { throw new Error(`Real migration failed: ${migration}`, { cause: error }); }
  }
  assert.equal(sqlite.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);

  const faults = { beforeBatch: null, beforeStatement: null, statement: null, batchCount: 0, rollbackCount: 0, enforceColumnLimit: false };
  const queries = [];
  function prepared(sql, parameters = []) {
    async function beforeStatement() {
      const hook = faults.beforeStatement;
      if (hook?.matches(sql, parameters)) {
        faults.beforeStatement = null;
        await hook.run();
      }
    }
    function execute(mode = 'all') {
      const query = sqlite.prepare(sql);
      const columns = query.columns();
      queries.push({ sql, columns: columns.map((column) => column.name) });
      if (faults.enforceColumnLimit && columns.length > 100) throw new Error(`D1 query projection exceeds 100 columns (${columns.length})`);
      let results;
      if (mode === 'raw') query.setReturnArrays(true);
      if (mode === 'run') { query.run(...parameters); results = []; }
      else results = query.all(...parameters);
      const meta = sqlite.prepare('SELECT changes() AS changes, last_insert_rowid() AS last_row_id').get();
      return { results, success: true, meta: { ...meta, duration: 0 } };
    }
    return {
      sql, parameters, execute,
      bind(...values) { return prepared(sql, values); },
      async all() { await beforeStatement(); return execute(); },
      async raw(options = {}) {
        await beforeStatement();
        const rows = execute('raw').results;
        return options.columnNames ? [sqlite.prepare(sql).columns().map((column) => column.name), ...rows] : rows;
      },
      async run() { await beforeStatement(); return execute('run'); },
      async first(column) { await beforeStatement(); const row = execute().results[0] ?? null; return column && row ? row[column] : row; },
    };
  }
  const DB = {
    prepare: prepared,
    async batch(statements) {
      const before = faults.beforeBatch;
      faults.beforeBatch = null;
      if (before) await before();
      const fail = faults.statement;
      faults.statement = null;
      faults.batchCount++;
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((statement, index) => {
          if (fail?.(statement.sql, index, statement.parameters)) throw new Error('Injected transactional statement failure');
          return statement.execute();
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        faults.rollbackCount++;
        throw error;
      }
    },
    async exec(sql) { sqlite.exec(sql); return { count: 1, duration: 0 }; },
  };
  const secret = 'isolated-conjuntos-fixture-signing-secret-no-live-credentials';
  const roles = ['admin', 'jefe', 'tecnico', 'visualizador', 'solicitante', 'motorista', 'bodega'];
  const cookies = {};
  for (const [index, rol] of roles.entries()) {
    const id = index + 1, nombre = `Prueba ${rol}`, email = `${rol}@example.invalid`;
    sqlite.prepare('INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES(?,?,?,?,?)').run(id, nombre, email, 'isolated', rol);
    const token = await app.createSessionToken({ sub: id, nombre, email, rol }, secret);
    const headers = new Headers();
    app.setSessionCookie(headers, token);
    cookies[rol] = headers.get('set-cookie').split(';')[0];
  }
  const effects = { r2Deletes: 0 };
  function ctx(url, { method = 'GET', data, id, rol = 'admin' } = {}) {
    const address = `https://test.invalid${url}`;
    return {
      url: new URL(address), params: { id: id == null ? undefined : String(id) },
      request: new Request(address, { method, headers: { ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...(rol ? { cookie: cookies[rol] } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }),
      locals: { runtime: { env: { DB, JWT_SECRET: secret, R2: { async delete() { effects.r2Deletes++; throw new Error('R2 deletion forbidden'); } } }, ctx: { waitUntil() {} } } },
    };
  }
  let requests = 0;
  async function call(route, url, options) {
    requests++;
    const response = await route(ctx(url, options));
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, body };
  }
  return { app, sqlite, DB, faults, effects, queries, ctx, call, migrations, get requests() { return requests; },
    async close() { sqlite.close(); await fs.rm(temporary, { recursive: true, force: true }); },
  };
}
