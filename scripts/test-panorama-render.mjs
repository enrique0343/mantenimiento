// Render the actual built Astro page against isolated SQLite. No network or production data.
// Run after npm run build; this test deliberately does not rebuild or mock page components.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseHtml } from 'parse5';
import { experimental_AstroContainer } from 'astro/container';
import { setup, root } from './test-support/sqlite-app.mjs';

let checks = 0;
let renderCount = 0;
let networkCalls = 0;
const originalFetch = globalThis.fetch;
const NativeDate = globalThis.Date;
const instant = '2026-10-05T15:00:00.000Z';
const attackMarker = '__panoramaInjected';
const hostileRound = `Revisión SSR <img src=x onerror="window.${attackMarker}=1">`;
const hostileZone = `Zona congelada SSR </ScRiPt><script>window.${attackMarker}=2</script> & "`;
const untouchedLiveZone = 'Nombre actual de zona distinto y no histórico';
const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantenimiento-panorama-render-'));
globalThis.fetch = async () => { networkCalls++; throw new Error('Network forbidden in panorama render tests'); };
globalThis.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [instant])); }
  static now() { return NativeDate.parse(instant); }
};
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const nodes = (rootNode, predicate) => {
  const result = [];
  function visit(node) { if (predicate(node)) result.push(node); for (const child of node.childNodes ?? []) visit(child); }
  visit(rootNode); return result;
};
const attr = (node, name) => node.attrs?.find(attribute => attribute.name === name)?.value;
const hasClass = (node, name) => (attr(node, 'class') ?? '').split(/\s+/).includes(name);
const text = node => node?.nodeName === '#text' ? node.value : (node?.childNodes ?? []).map(text).join('');
const overview = document => nodes(document, node => node.tagName === 'section' && attr(node, 'aria-labelledby') === 'rounds-overview-title')[0];
const links = node => nodes(node, item => item.tagName === 'a').map(item => attr(item, 'href'));
const normalizedText = node => text(node).replace(/\s+/g, ' ').trim();
const metricValues = section => nodes(section, node => hasClass(node, 'rounds-metric')).map(node => Number(text(nodes(node, child => child.tagName === 'strong')[0])));
const followup = section => Object.fromEntries(nodes(section, node => node.tagName === 'dt').map(node => {
  const definition = node.parentNode.childNodes.find(child => child.tagName === 'dd');
  return [normalizedText(node), Number(text(definition))];
}));

async function fixture({ populated = false } = {}) {
  const f = await setup({ modules: { overview: '../lib/rondas/overview.ts' } });
  const { sqlite } = f;
  sqlite.exec(await fs.readFile(path.join(root, 'migrations/0051_rondas.sql'), 'utf8'));
  sqlite.exec(await fs.readFile(path.join(root, 'migrations/0053_rondas_zonas.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES
      (2,'Inspector SSR ficticio','inspector-ssr@example.invalid','isolated','tecnico'),
      (3,'Jefe SSR ficticio','jefe-ssr@example.invalid','isolated','jefe'),
      (4,'Otro inspector SSR ficticio','otro-ssr@example.invalid','isolated','tecnico'),
      (5,'Consulta SSR ficticia','consulta-ssr@example.invalid','isolated','visualizador');
    INSERT INTO sucursales(id,nombre) VALUES(1,'Sede SSR ficticia');
    INSERT INTO ubicaciones(id,sucursal_id,nombre) VALUES(1,1,'Sala SSR ficticia');
    INSERT INTO activos(id,codigo,nombre,ubicacion_id,rubro) VALUES(1,'SSR-LOCAL','Unidad SSR ficticia',1,'aires');
  `);
  if (populated) {
    const snapshot = { name: 'Plantilla SSR ficticia', siteId: 1, locationId: 1, zoneId: 1, zoneVersion: 1, zoneName: 'Zona congelada SSR', locations: [{ id: 1, nombre: 'Sala SSR ficticia' }] };
    sqlite.prepare('INSERT INTO rondas_zones(id,name,site_id,version,snapshot_json,mutation_token,created_by,created_at) VALUES(1,?,1,2,?,?,1,?)').run(untouchedLiveZone, JSON.stringify({ locations: snapshot.locations }), 'zone-fixture', instant);
    sqlite.exec('INSERT INTO rondas_zone_locations(zone_id,location_id,position) VALUES(1,1,0)');
    sqlite.prepare('INSERT INTO rondas_templates(id,name,config_json,mutation_token,created_by,created_at) VALUES(1,?,?,?,?,?)').run(snapshot.name, JSON.stringify(snapshot), 'template-fixture', 1, instant);
    const insert = sqlite.prepare(`INSERT INTO rondas_executions(id,template_id,template_version,name,site_id,location_id,zone_id,scheduled_date,shift,due_at,original_due_at,status,owner_id,reviewer_id,snapshot_json,data_json,mutation_token,created_at)
      VALUES(?,1,1,?,1,1,1,?,?,?,?,?,?,?,?,'[]',?,?)`);
    for (const row of [
      { id: 1, name: 'Ronda asignada SSR', status: 'pendiente', day: '2026-10-05', due: '2026-10-05T14:00:00Z', owner: 2, reviewer: 3, zone: 'Zona congelada SSR' },
      { id: 2, name: 'Ronda ajena SSR', status: 'en_curso', day: '2026-10-04', due: '2026-10-04T14:00:00Z', owner: 4, reviewer: 3, zone: 'Zona histórica ajena SSR' },
      { id: 3, name: hostileRound, status: 'pendiente_validacion', day: '2026-10-05', due: '2026-10-05T16:00:00Z', owner: 4, reviewer: 2, zone: hostileZone },
      { id: 4, name: 'Ronda concluida SSR', status: 'validada', day: '2026-10-05', due: '2026-10-05T13:00:00Z', owner: 2, reviewer: 3, zone: 'Zona congelada SSR' },
    ]) insert.run(row.id, row.name, row.day, `turno-SSR-${row.id}`, row.due, row.due, row.status, row.owner, row.reviewer, JSON.stringify({ ...snapshot, zoneName: row.zone }), `execution-${row.id}`, instant);
    sqlite.exec(`
      INSERT INTO ordenes(id,titulo,tipo,estado,sucursal_id,ubicacion_id,asignado_a,creado_por,rubro) VALUES
        (100,'OT SSR revisión pendiente','correctivo','completada',1,1,2,1,'aires'),
        (101,'OT SSR de otro inspector','correctivo','abierta',1,1,4,1,'infraestructura');
      INSERT INTO rondas_proposals(id,execution_id,point_id,point_code,location_id,kind,reason,status,dedup_key,order_id,created_by,created_at,mutation_token) VALUES
        (1,1,'control@1','control',1,'correctivo','Hallazgo SSR aislado','aprobada','ssr-proposal-1',100,1,'2026-10-05T12:00:00Z','proposal-1'),
        (2,2,'control@1','control',1,'correctivo','Hallazgo SSR aislado','aprobada','ssr-proposal-2',101,1,'2026-10-05T12:00:00Z','proposal-2'),
        (3,1,'control@1','control',1,'correctivo','Solicitud SSR aislada','pendiente_aprobacion','ssr-proposal-3',NULL,1,'2026-10-05T12:00:00Z','proposal-3');
      INSERT INTO rondas_proposal_links(execution_id,point_id,proposal_id) VALUES(1,'control@1',1),(2,'control@1',2),(1,'control@1',3);
      INSERT INTO rondas_order_links(execution_id,point_id,order_id,proposal_id) VALUES(1,'control@1',100,1),(2,'control@1',101,2);
    `);
  }
  let failOverview = false;
  let overviewQueries = 0;
  function statement(sql, args = []) {
    assert.match(sql, /^\s*(?:SELECT|WITH)\b/i, 'Rendered panorama may only prepare read statements');
    if (/\brondas_executions\b/.test(sql)) {
      overviewQueries++;
      if (failOverview) throw new Error('Injected isolated overview database failure');
    }
    const query = sqlite.prepare(sql);
    return {
      bind(...parameters) { return statement(sql, parameters); },
      async all() { return { results: query.all(...args), success: true }; },
      async raw() { query.setReturnArrays(true); return query.all(...args); },
      async first() { return query.get(...args) ?? null; },
    };
  }
  const DB = { prepare: sql => statement(sql), async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.all()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  const snapshot = () => JSON.stringify(Object.fromEntries(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, sqlite.prepare(`SELECT * FROM "${name}"`).all().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))])));
  return { DB, sqlite, snapshot, close: f.close, failOverview(value) { failOverview = value; }, resetOverviewQueries() { overviewQueries = 0; }, get overviewQueries() { return overviewQueries; } };
}

function areasPreserved(document) {
  const cards = nodes(document, node => hasClass(node, 'workspace-card'));
  eq(cards.map(node => attr(node, 'href')), ['/areas/aires', '/areas/infraestructura', '/areas/equipo_general', '/areas/biomedico'], 'The four operational area cards remain in the rendered home');
  ok(normalizedText(cards[0]).includes('1 unidades'), 'Existing area inventory metrics remain visible');
}
function safeText(section) {
  const content = text(section);
  ok(content.includes(hostileRound), 'Malicious round name is displayed as literal text');
  ok(content.includes(hostileZone), 'Frozen malicious zone name is displayed as literal text');
  eq(nodes(section, node => ['script', 'img'].includes(node.tagName)).length, 0, 'Stored text cannot create script/image elements');
  eq(nodes(section, node => (node.attrs ?? []).some(attribute => /^on/i.test(attribute.name))).length, 0, 'Stored text cannot create event-handler attributes');
}

try {
  const { page } = await import(pathToFileURL(path.join(root, 'dist/_worker.js/pages/index.astro.mjs')).href);
  ok(typeof page().default === 'function', 'The real built Astro page must be importable');
  const container = await experimental_AstroContainer.create();
  async function render(f, role, id, suffix = role) {
    const before = f.snapshot(); f.resetOverviewQueries();
    const html = await container.renderToString(page().default, {
      partial: false, request: new Request('https://local.test/'),
      locals: { user: { id, nombre: `Cuenta SSR ${role}`, rol: role }, runtime: { env: { DB: f.DB } } },
    });
    renderCount++;
    eq(f.snapshot(), before, 'Full-page SSR leaves every fixture table untouched');
    const document = parseHtml(html);
    eq(normalizedText(nodes(document, node => node.tagName === 'h1')[0]), 'Panorama general', 'Build the current Panorama source before running its SSR test');
    eq(normalizedText(nodes(document, node => node.tagName === 'title')[0]), 'Panorama general');
    areasPreserved(document);
    await fs.writeFile(path.join(artifactDir, `${suffix}.html`), html);
    return { html, document, section: overview(document) };
  }
  const populated = await fixture({ populated: true });
  try {
    for (const [role, id] of [['admin', 1], ['jefe', 3], ['visualizador', 5]]) {
      const { document, section } = await render(populated, role, id);
      ok(section, `${role} sees the rounds overview`); eq(metricValues(section), [3, 2, 2, 1], 'Global overview values reach their labelled SSR cards');
      ok(text(section).includes('Ronda ajena SSR')); ok(text(section).includes('Zona congelada SSR'));
      ok(!text(section).includes(untouchedLiveZone), 'An execution displays its frozen zone name rather than the current edited zone name');
      for (const href of ['/rondas?execution=1', '/rondas?execution=2', '/rondas?execution=3', '/rondas?status=pendiente_validacion', '/rondas?view=actions']) ok(links(section).includes(href), `${role} preserves deep link ${href}`);
      ok(!links(section).includes('/rondas?execution=4'), 'Completed round is omitted from the attention list');
      eq(followup(section)['OT de rondas abiertas'], 2); eq(followup(section)['OT pendientes de verificación'], 1);
      for (const href of ['/rondas?view=zones', '/rondas?view=templates']) eq(links(section).includes(href), role !== 'visualizador', 'Configuration management links follow role permissions');
      eq(Object.hasOwn(followup(section), 'Solicitudes por aprobar'), role !== 'visualizador', 'Only chief/admin receive proposal decision metric');
      safeText(section);
      eq(nodes(document, node => node.tagName === 'script' && text(node).includes(attackMarker)).length, 0, 'Untrusted stored strings never enter executable scripts');
    }
    const tech = await render(populated, 'tecnico', 2);
    ok(tech.section); eq(metricValues(tech.section), [3, 1, 1, 1], 'Technician values contain only assigned or designated-review rounds');
    ok(text(tech.section).includes('Tus rondas asignadas')); ok(text(tech.section).includes('Ronda asignada SSR'));
    ok(!text(tech.section).includes('Ronda ajena SSR')); ok(!text(tech.section).includes('Zona histórica ajena SSR'));
    eq(links(tech.section).includes('/rondas?execution=2'), false, 'Unassigned execution cannot leak through a deep link');
    for (const href of ['/rondas?execution=1', '/rondas?execution=3', '/rondas?status=pendiente_validacion', '/rondas?view=actions']) ok(links(tech.section).includes(href));
    eq(followup(tech.section), { 'OT de rondas abiertas': 1, 'OT pendientes de verificación': 1 }, 'Technician followup contains assigned orders and no decision count');
    eq(nodes(tech.section, node => hasClass(node, 'rounds-configuration')).length, 0, 'Technician receives no global configuration metrics');
    for (const href of ['/rondas?view=zones', '/rondas?view=templates']) eq(links(tech.section).includes(href), false);
    safeText(tech.section);
    for (const role of ['proveedor', 'solicitante', 'motorista']) {
      const other = await render(populated, role, 4); eq(other.section, undefined, `${role} receives no rounds overview`);
      eq(populated.overviewQueries, 0, 'Unsupported role does not query rounds overview');
      eq(links(other.document).some(href => href?.startsWith('/rondas')), false, 'Unsupported role receives no rounds navigation');
    }
    populated.failOverview(true);
    const savedError = console.error; const errors = []; console.error = (...args) => errors.push(args.join(' '));
    let failed; try { failed = await render(populated, 'admin', 1, 'overview-database-failure'); } finally { console.error = savedError; }
    eq(failed.section, undefined, 'Database failure is not presented as a valid zero-valued overview');
    ok(normalizedText(failed.document).includes('No se pudo cargar el resumen de rondas.'));
    ok(links(failed.document).includes('/rondas'), 'Failure state preserves a usable module link');
    eq(nodes(failed.document, node => hasClass(node, 'rounds-metric')).length, 0, 'Failure state shows no false zero metrics');
    eq(errors, ['rounds_overview_unavailable'], 'Failure logs only its sanitized diagnostic marker');
  } finally { await populated.close(); }
  const empty = await fixture();
  try {
    for (const [role, id] of [['admin', 1], ['jefe', 3], ['tecnico', 2], ['visualizador', 5]]) {
      const { section } = await render(empty, role, id, `empty-${role}`);
      ok(section); eq(metricValues(section), [0, 0, 0, 0]);
      if (['admin', 'jefe'].includes(role)) {
        ok(text(section).includes('Configura tu primera plantilla'));
        eq(nodes(section, node => hasClass(node, 'rounds-setup')).length, 1, 'Management empty state provides setup steps');
        ok(links(section).includes('/rondas?view=zones')); ok(links(section).includes('/rondas?view=templates'));
      } else {
        eq(nodes(section, node => hasClass(node, 'rounds-setup')).length, 0, 'Nonmanagers receive no configuration instructions');
        ok(text(section).includes(role === 'tecnico' ? 'Sin rondas que requieran tu atención' : 'Sin rondas pendientes de atención'));
        eq(links(section).includes('/rondas?view=zones'), false); eq(links(section).includes('/rondas?view=templates'), false);
      }
    }
    empty.sqlite.prepare('INSERT INTO rondas_templates(id,name,config_json,mutation_token,created_by,created_at) VALUES(1,?,?,?,?,?)').run('Plantilla de ubicación SSR heredada', JSON.stringify({ locationId: 1, siteId: 1 }), 'legacy-template-fixture', 1, instant);
    const configured = await render(empty, 'admin', 1, 'configured-legacy-empty');
    ok(text(configured.section).includes('Sin rondas pendientes de atención'));
    ok(text(configured.section).includes('Ya tienes plantillas configuradas'));
    eq(nodes(configured.section, node => hasClass(node, 'rounds-setup')).length, 0, 'Existing legacy templates do not receive false first-template onboarding merely because zone count is zero');
    ok(nodes(configured.section, node => node.tagName === 'a' && normalizedText(node).includes('Abrir programación')).length === 1);
  } finally { await empty.close(); }
  eq(networkCalls, 0, 'No network/email/storage calls');
  console.log(`PASS panorama real SSR: ${checks} assertions across ${renderCount} built-page renders; roles, scoped content, deep links, frozen escaped names, empty states, visible database failure and preserved area cards. Synthetic HTML: ${artifactDir}`);
} finally { globalThis.fetch = originalFetch; globalThis.Date = NativeDate; }
