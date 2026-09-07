// Isolated handlers using the real Drizzle queries. Requires Node with node:sqlite.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { transform } from '@astrojs/compiler';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function setup({ modules, pages = [] }) {
  for (const page of pages) {
    const filename = path.join(root, 'src/pages', `${page}.astro`);
    const result = await transform(await fs.readFile(filename, 'utf8'), { filename });
    assert.equal(result.diagnostics.filter((d) => d.severity === 1).length, 0, JSON.stringify(result.diagnostics));
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mantenimiento-areas-test-'));
  const bundle = path.join(temporary, 'handlers.mjs');
  await build({
    stdin: {
      contents: `export * as schema from './src/lib/schema';\nexport { getTableConfig, SQLiteSyncDialect, SQLiteTable } from 'drizzle-orm/sqlite-core';\nexport { is } from 'drizzle-orm';\n` + Object.entries(modules).map(([name, file]) => `export * as ${name} from ${JSON.stringify(path.join(root, 'src/pages', file))};`).join('\n'),
      resolveDir: root,
      loader: 'ts',
    },
    outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'isolated-effects', setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(auth|audit|daily-digest|encuestas-recordatorio)$/ }, (args) => ({ path: args.path.split('/').at(-1), namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, ({ path: name }) => ({ contents: {
        auth: `export async function requireUser(ctx, roles) { const user=ctx.testUser; return !user ? {user:null,response:new Response('Unauthorized',{status:401})} : roles && !roles.includes(user.rol) ? {user:null,response:new Response('Forbidden',{status:403})} : {user}; }`,
        audit: 'export async function logAudit() {} export function calcularDiff(a,b) { return b; }',
        'daily-digest': 'export async function enviarDigestDiario() { return {enviados:0}; }',
        'encuestas-recordatorio': 'export async function enviarRecordatoriosEncuestas() { return {enviados:0}; }',
      }[name], loader: 'js' }));
    }}],
  });
  const api = await import(pathToFileURL(bundle).href);
  const sqlite = new DatabaseSync(':memory:');
  const dialect = new api.SQLiteSyncDialect();
  for (const table of Object.values(api.schema).filter((value) => api.is(value, api.SQLiteTable))) {
    const config = api.getTableConfig(table);
    const columns = config.columns.map((column) => {
      let definition = `"${column.name}" ${column.getSQLType()}`;
      if (column.primary) definition += ' PRIMARY KEY';
      const realCreatorConstraint = config.name === 'ordenes' && column.name === 'creado_por';
      if (column.notNull || realCreatorConstraint) definition += ' NOT NULL';
      if (column.default !== undefined) {
        const value = column.default;
        const literal = typeof value === 'string' ? `'${value.replaceAll("'", "''")}'` : typeof value === 'boolean' ? Number(value) : typeof value === 'number' ? value : dialect.sqlToQuery(value).sql;
        definition += ` DEFAULT ${literal}`;
      }
      // Match production's creator constraint from migrations/0000_*.sql.
      if (realCreatorConstraint) definition += ' REFERENCES usuarios(id)';
      return definition;
    });
    sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(', ')})`);
  }
  const ftsMigration = await fs.readFile(path.join(root, 'migrations/0024_fase24_fts.sql'), 'utf8');
  for (const statement of ftsMigration.matchAll(/CREATE VIRTUAL TABLE[\s\S]*?;/g)) sqlite.exec(statement[0]);
  function statement(sql, args = []) {
    const query = sqlite.prepare(sql);
    return {
      bind(...parameters) { return statement(sql, parameters); },
      async all() { return { results: query.all(...args), success: true }; },
      async raw() { query.setReturnArrays(true); return query.all(...args); },
      async run() { return { success: true, meta: query.run(...args) }; },
      async first() { return query.get(...args) ?? null; },
    };
  }
  const DB = { prepare: (sql) => statement(sql), batch: (queries) => Promise.all(queries.map((q) => q.all())) };
  const user = { id: 1, nombre: 'Local test', rol: 'admin' };
  sqlite.exec("INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES(1,'Local test','local@example.invalid','not-a-real-password','admin')");
  function ctx(url, { method = 'GET', data, id, rol = 'admin', headers = {}, env = {} } = {}) {
    const address = `https://local.test${url}`;
    return {
      url: new URL(address), params: { id: id == null ? undefined : String(id) },
      request: new Request(address, { method, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) }),
      testUser: { ...user, rol }, locals: { runtime: { env: { DB, ...env } } },
    };
  }
  async function call(route, url, options) {
    const response = await route(ctx(url, options));
    return { status: response.status, body: await response.json().catch(() => null) };
  }
  async function close() { sqlite.close(); await fs.rm(temporary, { recursive: true, force: true }); }
  return { api, sqlite, ctx, call, close };
}
