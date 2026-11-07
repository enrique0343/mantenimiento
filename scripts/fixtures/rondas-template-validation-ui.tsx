// @ts-nocheck -- synthetic browser fixture; no real service or operational data.
// Serve a bundle with #root to explore manually; ?run=1 runs the assertions.
import React from 'react';
import { createRoot } from 'react-dom/client';
import RondasApp from '../../src/components/RondasApp';
import { ROUND_GROUPS } from '../../src/lib/rondas/catalog';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'validation';
const user = { id: 1, nombre: 'Jefatura local de prueba', rol: 'jefe' };
const zone = { id: 1, name: 'Zona sintética de prueba', siteId: 1, version: 3, locations: [{ id: 11, nombre: 'Ubicación sintética' }] };
const catalog = {
  groups: ROUND_GROUPS, zones: [zone], sites: [{ id: 1, nombre: 'Sede sintética' }],
  locations: [{ id: 11, nombre: 'Ubicación sintética', sucursalId: 1 }],
  users: [user, { id: 2, nombre: 'Validador local de prueba', rol: 'tecnico' }], assets: [],
};
const points = ROUND_GROUPS.flatMap(group => group.points.map(point => ({ ...point, group: group.code })));
const criterionFor = index => `Criterio ficticio de prueba ${points[index].code}; no es un criterio operativo.`;
const historicalConfig = {
  name: 'Plantilla histórica sintética', effectiveFrom: '2026-10-07', siteId: 1, locationId: 11,
  zoneId: zone.id, zoneName: zone.name, zoneVersion: zone.version, locations: zone.locations,
  shift: 'Diurno', timezoneOffset: '-06:00', time: '08:00', windowMinutes: 60,
  ownerId: 1, backupId: null, reviewerId: 2, reviewerBackupId: null,
  reason: 'Alta sintética para verificar versionado', notifications: { recipientIds: [], events: [] },
  points: points.map((point, index) => ({ ...point, criterion: criterionFor(index), active: true, exclusionReason: '', frequency: 'diaria', firstDate: '2026-10-07', evidencePolicy: 'findings', assetId: null, locationId: null, measurementType: 'none', measurementUnit: '', limitSource: '', photoRequired: false })),
};
let templates = mode === 'version' ? [{ id: 7, version: 4, name: historicalConfig.name, config: historicalConfig }] : [];
const calls = [];
let nextFailure = mode === 'errors' ? 409 : Number(params.get('failure')) || 0;
window.__rondasTemplateQA = { calls, failNext: status => { nextFailure = status; } };
window.fetch = async (url, options = {}) => {
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : null;
  if (method !== 'GET') calls.push({ url, method, body });
  await new Promise(resolve => setTimeout(resolve, 10));
  let data;
  if (url === '/api/rondas' && method === 'GET') data = { templates, executions: [] };
  else if (url === '/api/rondas/catalog' && method === 'GET') data = catalog;
  else if (url === '/api/rondas/actions' && method === 'GET') data = { orders: [] };
  else if (url === '/api/rondas/zones' && method === 'GET') data = { zones: [zone] };
  else if ((url === '/api/rondas/templates' || url === '/api/rondas/templates/7/version') && method === 'POST') {
    if (nextFailure) {
      const status = nextFailure; nextFailure = 0;
      return new Response(JSON.stringify({ error: status === 409 ? 'La zona cambió. Revisa su versión antes de guardar.' : 'No fue posible guardar. Intenta nuevamente.' }), { status, headers: { 'content-type': 'application/json' } });
    }
    const existing = templates.find(item => item.id === 7);
    const template = { id: 7, version: (existing?.version || 0) + 1, name: body.name, config: body };
    templates = [template]; data = { template };
  } else throw new Error(`Unexpected synthetic request: ${method} ${url}`);
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
};
window.confirm = () => true;
createRoot(document.getElementById('root')).render(<RondasApp user={user} initialView="templates"/>);
const results = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
const wait = (ms = 35) => new Promise(resolve => setTimeout(resolve, ms));
const dialog = () => document.querySelector('[role="dialog"]');
const button = (text, scope = document) => Array.from(scope.querySelectorAll('button')).find(item => item.textContent === text);
const field = key => dialog()?.querySelector(`[data-template-field="${key}"] input, [data-template-field="${key}"] select, [data-template-field="${key}"] textarea`);
const summary = () => dialog()?.querySelector('[role="alert"][aria-label="Datos pendientes de la plantilla"]');
const save = () => dialog().querySelector('button[type="submit"]');
const pointBox = index => field(`points.${index}.label`).parentElement.parentElement.parentElement;
async function fill(element, value) {
  if (!element) throw new Error(`Missing field for ${value}`);
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  await wait();
}
async function submit() { save().click(); await wait(130); }
async function openNew() {
  button('Nueva plantilla').click(); await wait();
  await fill(field('name'), 'Ronda de prueba sin datos reales');
  await fill(field('siteId'), '1'); await fill(field('zoneId'), '1');
  await fill(field('ownerId'), '1'); await fill(field('reviewerId'), '2');
  await fill(field('reason'), 'Comprobar guardado con catálogo real en entorno sintético');
}
async function completeCriteria(start = 0, end = points.length) {
  for (let index = start; index < end; index++) await fill(field(`points.${index}.criterion`), criterionFor(index));
}
async function validation() {
  assert(points.length === 21 && points.every(point => point.criterion === ''), 'The real catalog starts with 21 empty criteria');
  await openNew();
  assert(dialog().textContent.includes('21 criterios pendientes'), 'New template explains all 21 pending criteria');
  await fill(field('points.0.criterion'), criterionFor(0));
  await submit();
  const pendingLinks = Array.from(summary()?.querySelectorAll('button') || []);
  assert(calls.length === 0 && pendingLinks.length === 20, 'Completing general fields and one criterion sends no POST and identifies 20 pending items');
  assert(points.slice(1).every(point => pendingLinks.some(link => link.textContent.includes(point.code) && link.textContent.includes(point.label))), 'Every pending item identifies its actual catalog point and code');
  const lastCriterion = field(`points.${points.length - 1}.criterion`);
  const lastGroup = lastCriterion.closest('details');
  assert(!lastGroup.open, 'A later incomplete group is initially collapsed');
  pendingLinks.at(-1).click(); await wait();
  assert(lastGroup.open && document.activeElement === lastCriterion, 'A pending-item link opens its group and focuses the exact criterion');
  await completeCriteria(1, points.length - 1);
  const lastActive = Array.from(pointBox(points.length - 1).querySelectorAll('label')).find(item => item.textContent === 'Activo')?.querySelector('input');
  lastActive.click(); await wait(); await submit();
  assert(calls.length === 0 && summary()?.querySelectorAll('button').length === 1 && summary().textContent.includes('Motivo de exclusión'), 'Deactivating the last point requires an explicit exclusion reason');
  assert(!lastCriterion.required && lastCriterion.value === '', 'Excluded points may keep an empty criterion');
  await fill(field(`points.${points.length - 1}.exclusionReason`), 'No corresponde a esta zona sintética');
  await fill(field('points.0.criterion'), '   '); await submit();
  assert(calls.length === 0 && summary().textContent.includes(points[0].code), 'Whitespace-only active criteria remain invalid with their point identified');
  await fill(field('points.0.criterion'), criterionFor(0));
  await fill(field('reviewerId'), '1'); await submit();
  assert(calls.length === 0 && summary().textContent.includes('distinta'), 'The responsible person cannot validate their own work');
  await fill(field('reviewerId'), '2'); await submit();
  const saved = calls[0]?.body;
  assert(calls.length === 1 && calls[0].url === '/api/rondas/templates' && !dialog(), 'A complete configuration is saved once and closes the editor');
  assert(saved.points.length === 21 && saved.points.filter(point => point.active).length === 20 && saved.points[20].criterion === '' && saved.points[20].exclusionReason.includes('No corresponde'), 'Payload preserves the excluded point and its reason without inventing criteria');
  assert(saved.zoneId === 1 && saved.zoneVersion === 3 && saved.locations[0].id === 11 && saved.ownerId === 1 && saved.reviewerId === 2, 'Payload retains zone snapshot and independent assignments');
  assert(document.body.textContent.includes('Plantilla guardada'), 'Success is confirmed to the user');
}
async function errors() {
  await openNew(); await completeCriteria();
  for (const status of [409, 500]) {
    nextFailure = status;
    const before = calls.length;
    await submit();
    assert(calls.length === before + 1 && !!dialog(), `API ${status} leaves the editor open after one attempt`);
    assert(field('name').value === 'Ronda de prueba sin datos reales' && points.every((point, index) => field(`points.${index}.criterion`).value === criterionFor(index)), `API ${status} preserves all entered data`);
    const footer = save().parentElement.parentElement;
    const alert = footer.querySelector('[role="alert"]');
    assert(alert?.textContent.includes('No se guardó la plantilla') && alert.textContent.includes('Tu información sigue en el formulario'), `API ${status} displays the failure beside the save action`);
    assert(alert.textContent.includes(status === 409 ? 'La zona cambió' : 'No fue posible guardar'), `API ${status} shows the actionable server message`);
    assert(!save().disabled, `API ${status} allows retry without re-entering the draft`);
  }
  await submit();
  assert(calls.length === 3 && !dialog() && document.body.textContent.includes('Plantilla guardada'), 'Retry succeeds with the preserved draft');
  assert(JSON.stringify(calls[0].body) === JSON.stringify(calls[2].body), 'The successful retry sends the original complete draft');
}
async function version() {
  button('Editar nueva versión').click(); await wait();
  assert(field('name').value === historicalConfig.name, 'Version editor starts with the saved configuration');
  await fill(field('reason'), 'Corregir criterio sintético conservando la versión anterior');
  await fill(field('points.0.criterion'), 'Criterio ficticio corregido en una nueva versión');
  await submit();
  assert(calls.length === 1 && calls[0].url === '/api/rondas/templates/7/version' && calls[0].body.expectedVersion === 4, 'Version save retains expectedVersion for concurrent-change protection');
  assert(calls[0].body.zoneVersion === 3 && historicalConfig.points[0].criterion === criterionFor(0), 'Changing a criterion preserves the zone version and original template');
}
async function run() {
  await wait(150);
  if (mode === 'errors') await errors(); else if (mode === 'version') await version(); else await validation();
  const output = document.createElement('pre'); output.id = 'qa-result'; output.textContent = `PASS ${results.length}: ${results.join(' | ')}`; document.body.prepend(output);
}
if (params.get('run') === '1') run().catch(error => {
  const output = document.createElement('pre'); output.id = 'qa-result'; output.textContent = `FAIL ${error.message} | ${results.join(' | ')}`; document.body.prepend(output);
});
