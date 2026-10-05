// @ts-nocheck -- synthetic browser fixture; no real service or operational data.
import React from 'react';
import { createRoot } from 'react-dom/client';
import RondasApp from '../../src/components/RondasApp';

const mode = new URLSearchParams(location.search).get('mode');
const user = { id: 1, nombre: 'Admin local de prueba', rol: 'admin' };
const members = [{ id: 1, nombre: 'Sala uno guardada' }, { id: 2, nombre: 'Sala dos guardada' }];
let zones = [
  { id: 1, name: 'Zona local actual', siteId: 1, version: 2, locations: [members[1], members[0]] },
  { id: 2, name: 'Otra zona local', siteId: 1, version: 1, locations: [{ id: 3, nombre: 'Sala tres' }] },
];
const catalog = {
  groups: [{ code: 'a', name: 'Grupo A', points: [{ code: 'a', label: 'Control A', criterion: 'Criterio local de prueba' }] }, { code: 'b', name: 'Grupo B', points: [{ code: 'b', label: 'Control B', criterion: 'Otro criterio local de prueba' }] }],
  sites: [{ id: 1, nombre: 'Sede local' }, { id: 2, nombre: 'Otra sede local' }],
  locations: [{ id: 1, nombre: 'Sala uno actual', sucursalId: 1 }, { id: 2, nombre: 'Sala dos actual', sucursalId: 1 }, { id: 3, nombre: 'Sala tres', sucursalId: 1 }, { id: 4, nombre: 'Sala cuatro libre', sucursalId: 1 }, { id: 6, nombre: 'Sala seis libre', sucursalId: 1 }, { id: 5, nombre: 'Sala de otra sede', sucursalId: 2 }],
  users: [user, { id: 2, nombre: 'Revisor local', rol: 'jefe' }],
  assets: [{ id: 1, nombre: 'Equipo sala uno', codigo: 'LOCAL-1', ubicacionId: 1 }, { id: 2, nombre: 'Equipo sala dos', codigo: 'LOCAL-2', ubicacionId: 2 }, { id: 3, nombre: 'Equipo sala tres', codigo: 'LOCAL-3', ubicacionId: 3 }],
};
const basePoints = catalog.groups.flatMap(group => group.points.map(point => ({ ...point, group: group.code, active: true, exclusionReason: '', frequency: 'diaria', firstDate: '2026-10-05', evidencePolicy: 'findings', assetId: null, locationId: null })));
const config = { name: 'Plantilla histórica local', effectiveFrom: '2026-10-05', siteId: 1, locationId: 1, zoneId: 1, zoneName: 'Zona guardada anterior', zoneVersion: 1, locations: members, shift: 'Diurno', timezoneOffset: '-06:00', time: '08:00', windowMinutes: 60, ownerId: 1, backupId: null, reviewerId: 2, reviewerBackupId: null, reason: 'Motivo local original', points: basePoints, notifications: { recipientIds: [], events: [] } };
let templates = [{ id: 1, name: config.name, version: 1, config }];
const execution = { id: 1, template_id: 1, template_version: 1, name: 'Ronda local por salas', site_id: 1, location_id: 1, zoneId: 1, zoneName: 'Zona guardada anterior', locations: members, scheduled_date: '2026-10-05', shift: 'Diurno', due_at: '2026-10-05T15:00:00Z', original_due_at: '2026-10-05T15:00:00Z', status: 'pendiente', owner_id: 1, backup_id: null, reviewer_id: 2, reviewer_backup_id: null, executed_by: null, executed_at: null, reviewed_by: null, reviewed_at: null, revision: 0 };
const reviewExecution = { ...execution, id: 2, name: 'Ronda local para validar', status: 'pendiente_validacion', owner_id: 90, reviewer_id: 91 };
const points = members.flatMap(member => basePoints.map(point => ({ ...point, id: `${point.code}@${member.id}`, locationId: member.id, locationName: member.nombre, result: 'pendiente', notes: '', evidence: '', observed_by: null, observed_at: null })));
const calls = [];
window.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : null;
  if (body) calls.push({ url, body });
  await new Promise(resolve => setTimeout(resolve, 30));
  let data = {};
  if (url === '/api/rondas') data = { templates, executions: mode === 'rounds' ? [execution] : mode === 'deeplinks' ? [execution, reviewExecution] : [] };
  else if (url === '/api/rondas/catalog') data = { ...catalog, zones };
  else if (url === '/api/rondas/actions') data = { orders: [] };
  else if (url === '/api/rondas/zones' && !body) data = { zones };
  else if (url === '/api/rondas/zones' && body) {
    const zone = { id: 3, name: body.name, siteId: body.siteId, version: 1, locations: body.locationIds.map(id => ({ id, nombre: catalog.locations.find(item => item.id === id).nombre })) };
    zones = [...zones, zone]; data = { zone };
  } else if (/\/zones\/\d+\/version$/.test(url)) {
    const id = Number(url.split('/')[4]);
    const zone = zones.find(item => item.id === id);
    if (zone.version !== body.expectedVersion) return new Response(JSON.stringify({ error: 'Versión local en conflicto' }), { status: 409 });
    Object.assign(zone, { name: body.name, siteId: body.siteId, version: zone.version + 1, locations: body.locationIds.map(id => ({ id, nombre: catalog.locations.find(item => item.id === id).nombre })) }); data = { zone };
  } else if (url === '/api/rondas/templates' || /\/templates\/\d+\/version$/.test(url)) {
    const zone = zones.find(item => item.id === body.zoneId);
    if (zone && zone.version !== body.zoneVersion) return new Response(JSON.stringify({ error: 'Zona local cambió: seleccione su versión actual' }), { status: 409 });
    const id = url.endsWith('/version') ? Number(url.split('/')[4]) : 2;
    const previous = templates.find(item => item.id === id);
    const template = { id, name: body.name, version: (previous?.version || 0) + 1, config: body };
    templates = [...templates.filter(item => item.id !== id), template]; data = { template };
  } else if (url === '/api/rondas/executions/1') data = { execution, points, events: [], notifications: [], equipment: [], linkedOrders: [], proposals: [] };
  else if (url.endsWith('/action')) {
    Object.assign(points.find(point => point.id === body.pointId), { result: body.result, notes: body.notes, evidence: body.evidence, observed_by: user.id, observed_at: '2026-10-05T14:00:00Z' }); execution.revision++; data = { execution };
  }
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
};
window.confirm = () => true;
const root = createRoot(document.getElementById('root'));
const render = (role = 'admin', initialView = 'rounds', initialStatus = '') => root.render(<RondasApp key={`${role}:${initialView}:${initialStatus}`} user={{ ...user, rol: role }} initialView={initialView} initialStatus={initialStatus}/>);
render();
const wait = (ms = 130) => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
const button = (text, scope = document) => Array.from(scope.querySelectorAll('button')).find(item => item.textContent === text || item.textContent?.includes(text));
const field = (text, scope = document) => Array.from(scope.querySelectorAll('label')).find(item => item.querySelector('.label')?.textContent === text)?.querySelector('input,select,textarea');
const memberInput = text => Array.from(document.querySelectorAll('[role=dialog] label')).find(item => item.textContent?.includes(text))?.querySelector('input[type=checkbox]');
const dialog = () => document.querySelector('[role=dialog]');
function fill(element, value) {
  if (!element) throw new Error(`Missing field for ${value}`);
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}
async function zonesMode() {
  button('Zonas').click(); await wait(); button('Nueva zona').click(); await wait();
  fill(field('Nombre de la zona *'), 'Recorrido local libre'); fill(field('Sede de la zona *'), '1'); await wait();
  assert(memberInput('Sala uno actual').disabled && memberInput('Sala dos actual').disabled && memberInput('Sala tres').disabled, 'Locations already assigned to another zone are disabled');
  assert(!memberInput('Sala de otra sede'), 'Only locations from the selected site are available');
  memberInput('Sala cuatro libre').click(); await wait(); memberInput('Sala seis libre').click(); await wait();
  dialog().querySelector('[aria-label="Subir Sala seis libre en el recorrido"]').click(); await wait();
  assert(Array.from(dialog().querySelectorAll('[aria-label="Orden del recorrido"] li')).map(item => item.textContent.split('.')[0]).join(',') === '1,2', 'Selected locations have accessible traversal order controls');
  assert(field('Motivo de creación de la zona *').required && !dialog().querySelector('form').checkValidity(), 'Zone creation requires an explicit reason');
  fill(field('Motivo de creación de la zona *'), 'Agrupar salas locales para prueba'); await wait(); button('Crear zona', dialog()).click(); await wait(280);
  const created = calls.find(call => call.url === '/api/rondas/zones');
  assert(created.body.locationIds.join(',') === '6,4' && created.body.siteId === 1 && created.body.reason.includes('Agrupar'), 'Zone creation sends existing IDs in the selected order with site and reason');
  const article = Array.from(document.querySelectorAll('article')).find(item => item.textContent.includes('Recorrido local libre'));
  button('Editar zona', article).click(); await wait(); fill(field('Nombre de la zona *'), 'Recorrido local editado');
  dialog().querySelector('[aria-label="Bajar Sala seis libre en el recorrido"]').click(); await wait(); fill(field('Motivo del cambio *'), 'Cambiar orden local de recorrido'); await wait(); button('Guardar nueva versión de zona', dialog()).click(); await wait(280);
  const edited = calls.find(call => call.url === '/api/rondas/zones/3/version');
  assert(edited.body.expectedVersion === 1 && edited.body.locationIds.join(',') === '4,6', 'Zone edit sends expectedVersion and reordered membership');
  assert(document.body.textContent.includes('plantillas y rondas anteriores conservan sus ubicaciones'), 'Zone edits explain that historical template and execution scopes are retained');
  const updated = Array.from(document.querySelectorAll('article')).find(item => item.textContent.includes('Recorrido local editado'));
  button('Editar zona', updated).click(); await wait(); memberInput('Sala cuatro libre').click(); await wait(); memberInput('Sala seis libre').click(); await wait();
  assert(!button('Guardar nueva versión de zona', dialog()).disabled && dialog().textContent.includes('la libera para asignarla a otra zona'), 'An existing zone can release its last locations while keeping history');
  fill(field('Motivo del cambio *'), 'Liberar salas locales para reasignarlas'); await wait(); button('Guardar nueva versión de zona', dialog()).click(); await wait(280);
  const emptied = calls.filter(call => call.url === '/api/rondas/zones/3/version').at(-1);
  assert(emptied.body.expectedVersion === 2 && emptied.body.locationIds.length === 0 && document.body.textContent.includes('Zona sin ubicaciones'), 'Empty-zone version uses CAS and shows its unavailable state');
  button('Plantillas y programación').click(); await wait(); button('Nueva plantilla').click(); await wait(); fill(field('Sede *'), '1'); await wait();
  assert(Array.from(field('Zona de ronda *').options).find(option => option.value === '3').disabled, 'Empty zones cannot be selected for new templates');
  button('Cancelar', dialog()).click(); await wait(); button('Zonas').click(); await wait(); button('Nueva zona').click(); await wait();
  assert(button('Crear zona', dialog()).disabled, 'New-zone creation still requires at least one location');
}
async function templateMode() {
  button('Plantillas y programación').click(); await wait(); button('Nueva plantilla').click(); await wait();
  assert(field('Alcance de la ronda').value === 'zone', 'New template defaults to zones when zones exist');
  fill(field('Nombre de la ronda *'), 'Ronda local nueva'); fill(field('Sede *'), '1'); await wait(); fill(field('Zona de ronda *'), '1'); await wait();
  fill(field('Responsable *'), '1'); fill(field('Validador *'), '2');
  const pointA = () => Array.from(dialog().querySelectorAll('details')).find(item => item.querySelector('summary')?.textContent.includes('Grupo A'));
  const pointB = () => Array.from(dialog().querySelectorAll('details')).find(item => item.querySelector('summary')?.textContent.includes('Grupo B'));
  assert(document.body.textContent.includes('4 controles por fecha'), 'Each-member controls are counted separately for the two locations');
  assert(field('Equipo vinculado (opcional)', pointA()).disabled, 'A zone-wide point cannot select a single asset before choosing its actual location');
  fill(field('Aplicar este punto en', pointA()), '2'); await wait();
  const assets = field('Equipo vinculado (opcional)', pointA());
  assert(Array.from(assets.options).map(item => item.value).join(',') === ',2', 'Asset options include only equipment from the chosen member location');
  fill(assets, '2'); await wait(); fill(field('Aplicar este punto en', pointA()), '1'); await wait();
  assert(field('Equipo vinculado (opcional)', pointA()).value === '', 'Changing a point location clears the old incompatible asset');
  fill(field('Equipo vinculado (opcional)', pointA()), '1'); await wait(); fill(field('Zona de ronda *'), '2'); await wait();
  assert(field('Aplicar este punto en', pointA()).value === '' && field('Equipo vinculado (opcional)', pointA()).value === '', 'Changing zone clears point location and equipment outside the new scope');
  fill(field('Zona de ronda *'), '1'); await wait(); fill(field('Aplicar este punto en', pointA()), '2'); await wait(); fill(field('Equipo vinculado (opcional)', pointA()), '2');
  assert(field('Aplicar este punto en', pointB()).value === '', 'An unscoped zone point still applies separately to every member');
  fill(field('Motivo de creación *'), 'Crear prueba local por sala'); await wait(); button('Crear plantilla', dialog()).click(); await wait(300);
  const saved = calls.find(call => call.url === '/api/rondas/templates').body;
  assert(saved.zoneId === 1 && saved.zoneVersion === 2 && saved.locations.map(item => item.id).join(',') === '2,1', 'Template save carries the selected current zone snapshot and ordered member IDs');
  assert(saved.points[0].locationId === 2 && saved.points[0].assetId === 2 && saved.points[1].locationId == null && saved.points[1].assetId == null, 'Template payload distinguishes one asset location from each-member controls');
  const historical = Array.from(document.querySelectorAll('h3')).find(item => item.textContent === config.name).parentElement.parentElement;
  button('Editar nueva versión', historical).click(); await wait();
  const oldNames = Array.from(dialog().querySelectorAll('ol li')).map(item => item.textContent);
  assert(oldNames[0].includes('Sala uno guardada') && oldNames[1].includes('Sala dos guardada'), 'Editing a template starts from its frozen historical membership order');
  assert(!!button('Usar ubicaciones actuales de la zona', dialog()), 'Stale membership requires an explicit adoption action');
  assert(button('Crear nueva versión', dialog()).disabled, 'Template cannot silently publish changed zone membership before explicit adoption');
  button('Usar ubicaciones actuales de la zona', dialog()).click(); await wait(); fill(field('Motivo de la nueva versión *'), 'Adoptar recorrido local actual'); await wait(); button('Crear nueva versión', dialog()).click(); await wait(300);
  const adopted = calls.find(call => call.url === '/api/rondas/templates/1/version').body;
  assert(adopted.expectedVersion === 1 && adopted.zoneVersion === 2 && adopted.locations.map(item => item.id).join(',') === '2,1', 'Explicit adoption publishes a new template version with current zone scope and CAS version');
}
async function roundsMode() {
  fill(field('Ubicación'), '2'); await wait();
  assert(!!button('Abrir ronda'), 'Location filter matches non-anchor members in the frozen round scope');
  fill(field('Zona de ronda'), '1'); await wait(); button('Abrir ronda').click(); await wait(230);
  assert(document.body.textContent.includes('Sala uno guardada') && document.body.textContent.includes('Sala dos guardada'), 'Round details display all frozen location names');
  const roomFilter = () => document.querySelector('[aria-label="Ubicación de los puntos"]');
  fill(roomFilter(), '2'); await wait();
  const cards = () => Array.from(document.querySelectorAll('article'));
  assert(cards().length === 2 && cards().every(item => item.textContent.includes('Sala dos guardada')), 'Room filter shows only that room’s distinct controls');
  document.querySelector('input[name="point-a@2"][value="conforme"]').click(); await wait(); button('Guardar este punto', cards()[0]).click(); await wait(260);
  assert(calls.find(call => call.url.endsWith('/action')).body.pointId === 'a@2', 'Saving one room sends its distinct point ID');
  assert(document.body.textContent.includes('1 de 4 puntos guardados') && document.body.textContent.includes('3 pendientes'), 'Saving one room leaves the other room’s controls pending');
  fill(roomFilter(), '1'); await wait();
  assert(document.querySelectorAll('input[type=radio]:checked').length === 0, 'The same catalog control in another room remains unanswered');
  fill(document.querySelector('[aria-label="Grupo de puntos"]'), 'b'); await wait();
  assert(cards().length === 1 && cards()[0].textContent.includes('Control B') && cards()[0].textContent.includes('Sala uno guardada'), 'Group and room filters work together');
  fill(roomFilter(), '2'); await wait();
  assert(cards().length === 1 && cards()[0].textContent.includes('Sala dos guardada'), 'Changing room preserves the selected point group');
  fill(document.querySelector('[aria-label="Grupo de puntos"]'), ''); fill(roomFilter(), ''); await wait();
  assert(cards().length === 4 && document.querySelectorAll('input[type=radio]:checked').length === 1, 'All controls retain their individual answers after filtering');
}
async function deepLinksMode() {
  render('admin', 'zones'); await wait(250);
  assert(!!button('Nueva zona') && document.body.textContent.includes('Zonas de ronda'), 'Admin initial zones view opens zone management');
  render('jefe', 'templates'); await wait(250);
  assert(!!button('Nueva plantilla') && document.body.textContent.includes('Plantillas versionadas'), 'Chief initial templates view opens programming');
  render('admin', 'actions'); await wait(250);
  assert(!!field('Filtrar órdenes'), 'Initial actions view opens order follow-up');
  render('admin', 'rounds', 'pendiente_validacion'); await wait(250);
  assert(field('Estado').value === 'pendiente_validacion' && document.body.textContent.includes('Ronda local para validar') && !document.body.textContent.includes('Ronda local por salas'), 'Pending-validation deep link selects the correct status and rounds');
  render('tecnico', 'zones'); await wait(250);
  assert(!button('Nueva zona') && !button('Plantillas y programación') && !!field('Estado'), 'Technician management deep link safely falls back to rounds');
  assert(document.body.textContent.includes('Ronda local por salas') && !document.body.textContent.includes('Ronda local para validar'), 'Technician default scope includes only assigned inspections');
  render('visualizador', 'templates'); await wait(250);
  assert(!button('Nueva plantilla') && document.body.textContent.includes('Ronda local por salas') && document.body.textContent.includes('Ronda local para validar'), 'Viewer management deep link falls back to the global permitted round list');
}
async function run() {
  await wait(250);
  if (mode === 'zones') await zonesMode(); else if (mode === 'template') await templateMode(); else if (mode === 'deeplinks') await deepLinksMode(); else await roundsMode();
  const output = document.createElement('pre'); output.id = 'qa-result'; output.textContent = `PASS ${results.length}: ${results.join(' | ')}`; document.body.prepend(output);
}
if (location.search.includes('run')) run().catch(error => {
  const output = document.createElement('pre'); output.id = 'qa-result'; output.textContent = `FAIL ${error.message} | ${results.join(' | ')}`; document.body.prepend(output);
});
