import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Sidecar: no reinterpreta ni reescribe las órdenes históricas.
export const ordenVerificacion = sqliteTable('orden_verificacion', {
  ordenId: integer('orden_id').primaryKey(),
  version: integer('version').notNull().default(0),
  ciclo: integer('ciclo').notNull().default(1),
  ejecutadoPor: integer('ejecutado_por'),
  executoresJson: text('executores_json').notNull().default('[]'),
  revisorId: integer('revisor_id'),
  revisorSuplenteId: integer('revisor_suplente_id'),
  reprogramarPreventivos: integer('reprogramar_preventivos', { mode: 'boolean' }).notNull().default(true),
  pmAvanzadoEn: text('pm_avanzado_en'),
  ultimoMotivo: text('ultimo_motivo'),
  ultimaAccion: text('ultima_accion'),
  ultimoActorId: integer('ultimo_actor_id'),
  actualizadoEn: text('actualizado_en'),
  operacionId: text('operacion_id'),
});
export const ordenVerificacionEventos = sqliteTable('orden_verificacion_eventos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ordenId: integer('orden_id').notNull(),
  ciclo: integer('ciclo').notNull(),
  accion: text('accion').notNull(),
  estadoAntes: text('estado_antes').notNull(),
  estadoDespues: text('estado_despues').notNull(),
  actorId: integer('actor_id'),
  actorNombre: text('actor_nombre').notNull(),
  ocurridoEn: text('ocurrido_en').notNull(),
  motivo: text('motivo'),
  evidenciaJson: text('evidencia_json').notNull(),
  operacionId: text('operacion_id').notNull().unique(),
});
