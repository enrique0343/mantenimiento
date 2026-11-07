-- Fase 47: Biblioteca de procedimientos (GO-GUI-011-2026)
-- Lleva al sistema los cinco tipos de documento del volumen II y su cadena:
--   SCP (configuracion) -> SOP (rutina) / AOP (condicion anormal) -> EOP (emergencia) -> MOP (intervencion)
-- Capitulo 02 del documento: "un objeto del sistema por cada tipo de documento".
-- Diseño consolidado: UN solo catalogo de procedimientos con doble codigo (cap. 2.4);
-- las fichas por tipo cuelgan por procedimiento_id; activos y plantillas solo guardan FK.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CATALOGO UNICO DE PROCEDIMIENTOS  (cap. 2.4 — doble codificacion)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE procedimientos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  codigo_corto text NOT NULL UNIQUE,          -- SCP-ELE-01, AOP-HVAC-01 (va en el activo y la etiqueta)
  codigo_institucional text,                  -- [AREA]-[TIPO]-[NNN]-[AAAA], lo asigna control documental
  tipo text NOT NULL,                         -- scp | sop | mop | eop | aop
  sistema text NOT NULL,                      -- electrico | hvac | gases | agua | incendios | ascensores | otro
  dominio text,                               -- infraestructura | aires | equipo_general | biomedico
  titulo text NOT NULL,
  proposito text,
  alcance text,
  sucursal_id integer REFERENCES sucursales(id),      -- NULL = documento modelo para todas las sedes
  heredado_de_id integer REFERENCES procedimientos(id),
  version text NOT NULL DEFAULT '0.1',
  estado text NOT NULL DEFAULT 'borrador',    -- borrador | en_validacion | vigente | en_revision | retirado
  responsable_id integer NOT NULL REFERENCES usuarios(id),  -- "un dueño por documento" (cap. 08)
  suplente_cargo text,
  norma_adoptada text,                        -- cap. 00 alerta 1
  referencias text,
  registro text,                              -- que queda escrito, donde y quien lo revisa
  nivel_riesgo text,                          -- solo MOP: bajo | medio | alto
  semana_validacion integer,                  -- 1=SCP 2=SOP/AOP 3=EOP 4=MOP
  aprobado_por integer REFERENCES usuarios(id),
  aprobado_en text,
  proxima_revision text,
  r2_key text,                                -- PDF aprobado
  activo integer NOT NULL DEFAULT 1,
  creado_por integer REFERENCES usuarios(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_procedimientos_tipo ON procedimientos(tipo);
CREATE INDEX idx_procedimientos_sistema ON procedimientos(sistema);
CREATE INDEX idx_procedimientos_estado ON procedimientos(estado);

-- Campos "en azul" que solo Avante puede llenar. Un SCP con una celda vacia es un SCP sin aprobar.
CREATE TABLE procedimiento_campos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  procedimiento_id integer NOT NULL REFERENCES procedimientos(id) ON DELETE CASCADE,
  etiqueta text NOT NULL,
  valor text,                                 -- NULL = celda azul pendiente
  unidad text,
  decide_area text,
  orden integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_proc_campos ON procedimiento_campos(procedimiento_id);

-- Matriz de validacion por area (cap. 08). fecha_programada obligatoria: sin dueño y fecha,
-- "borrador" se vuelve el estado permanente de los 25 documentos.
CREATE TABLE procedimiento_validaciones (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  procedimiento_id integer NOT NULL REFERENCES procedimientos(id) ON DELETE CASCADE,
  area text NOT NULL,
  que_confirma text,
  estado text NOT NULL DEFAULT 'pendiente',   -- pendiente | validado | observado
  fecha_programada text NOT NULL,
  validado_por integer REFERENCES usuarios(id),
  validado_en text,
  metodo_verificacion text,
  observaciones text
);
CREATE INDEX idx_proc_validaciones ON procedimiento_validaciones(procedimiento_id);

-- Control de versiones: ningun cambio de un SCP se ejecuta sin actualizar antes el SCP (cap. 2.4)
CREATE TABLE procedimiento_versiones (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  procedimiento_id integer NOT NULL REFERENCES procedimientos(id) ON DELETE CASCADE,
  version text NOT NULL,
  fecha text NOT NULL,
  cambio text,
  responsable_id integer REFERENCES usuarios(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_proc_versiones ON procedimiento_versiones(procedimiento_id);

-- Escalamiento unico para AOP y EOP (reemplaza tres motores propuestos por separado)
CREATE TABLE procedimiento_escalamientos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  procedimiento_id integer NOT NULL REFERENCES procedimientos(id) ON DELETE CASCADE,
  orden integer NOT NULL DEFAULT 0,
  minutos integer NOT NULL,                   -- desde la deteccion
  avisar_cargo text NOT NULL,
  accion text,
  es_paso_a_eop integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_proc_escal ON procedimiento_escalamientos(procedimiento_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SCP · "Activo padre con sus componentes como hijos" + puntos de ajuste
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE activos ADD COLUMN padre_id integer REFERENCES activos(id);
ALTER TABLE activos ADD COLUMN nivel_jerarquia text NOT NULL DEFAULT 'componente';  -- sistema | subsistema | componente
ALTER TABLE activos ADD COLUMN scp_procedimiento_id integer REFERENCES procedimientos(id);
ALTER TABLE activos ADD COLUMN scp_version_ref text;
CREATE INDEX idx_activos_padre ON activos(padre_id);

-- "Los puntos de ajuste se cargan como atributos con valor normal, minimo y maximo."
-- Se extiende variables_predictivas (ya tiene las 4 bandas y mediciones apunta a ella).
ALTER TABLE variables_predictivas ADD COLUMN tipo_atributo text NOT NULL DEFAULT 'predictiva'; -- punto_ajuste | posicion_normal | predictiva
ALTER TABLE variables_predictivas ADD COLUMN valor_nominal real;
ALTER TABLE variables_predictivas ADD COLUMN valor_nominal_texto text;   -- "selector en AUTO", "valvula abierta y rotulada"
ALTER TABLE variables_predictivas ADD COLUMN fuente text;                -- "ASHRAE 170-2021 tabla 7-1"
ALTER TABLE variables_predictivas ADD COLUMN fuente_referencia text;
ALTER TABLE variables_predictivas ADD COLUMN procedimiento_id integer REFERENCES procedimientos(id);
ALTER TABLE variables_predictivas ADD COLUMN procedimiento_version text;

-- Mapa de distribucion: una manejadora o un tablero sirve varias salas (FMS.08.00)
CREATE TABLE activo_ubicaciones_servidas (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  activo_id integer NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  ubicacion_id integer NOT NULL REFERENCES ubicaciones(id) ON DELETE CASCADE,
  rol text NOT NULL DEFAULT 'sirve',          -- sirve | alimenta | controla | extrae
  notas text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(activo_id, ubicacion_id)
);
CREATE INDEX idx_aus_activo ON activo_ubicaciones_servidas(activo_id);

-- Planos y unifilares as-built (el SCP esta completo cuando el unifilar esta adjunto)
ALTER TABLE activo_documentos ADD COLUMN version text;
ALTER TABLE activo_documentos ADD COLUMN fecha_version text;
ALTER TABLE activo_documentos ADD COLUMN as_built integer NOT NULL DEFAULT 0;

-- Ramas del sistema electrico esencial (NFPA 99 cap. 6) sobre el cuadro de cargas que ya existe
ALTER TABLE cargas_electricas ADD COLUMN rama text;                -- seguridad_vida | critica | equipos | normal
ALTER TABLE cargas_electricas ADD COLUMN circuito text;
ALTER TABLE cargas_electricas ADD COLUMN servicio_clinico text;
ALTER TABLE cargas_electricas ADD COLUMN posicion_normal text;     -- cerrado | abierto | auto

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. AOP · umbral con cronometro de escalamiento
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE aop_ficha (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  procedimiento_id integer NOT NULL UNIQUE REFERENCES procedimientos(id) ON DELETE CASCADE,
  condicion_umbral text,
  quien_detecta text,
  tiempo_tolerable text,
  decision_casos text,
  pasa_a_eop text
);

-- Acciones inmediatas numeradas, con su resultado esperado
CREATE TABLE aop_acciones (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  procedimiento_id integer NOT NULL REFERENCES procedimientos(id) ON DELETE CASCADE,
  orden integer NOT NULL DEFAULT 0,
  accion text NOT NULL,
  resultado_esperado text
);
CREATE INDEX idx_aop_acciones ON aop_acciones(procedimiento_id);

-- El umbral NO replica las bandas: las sobrescribe por contexto de sala. NULL = heredar de la variable.
CREATE TABLE aop_umbrales (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  procedimiento_id integer NOT NULL REFERENCES procedimientos(id) ON DELETE CASCADE,
  variable_id integer REFERENCES variables_predictivas(id) ON DELETE CASCADE,
  activo_id integer REFERENCES activos(id) ON DELETE CASCADE,
  ubicacion_id integer REFERENCES ubicaciones(id),
  min_alerta real,
  max_alerta real,
  minutos_para_actuar integer,                -- quirofano: 120
  minutos_para_escalar integer,               -- quirofano: 480 (8 h en cualquier periodo de 24)
  minutos_evento_persistente integer,         -- quirofano: 1080 (18 h)
  eop_procedimiento_id integer REFERENCES procedimientos(id),
  activo integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_aop_umbrales_var ON aop_umbrales(variable_id);

-- Episodio de desviacion. Tabla unica: el indicador 8 se calcula solo de aqui.
CREATE TABLE aop_eventos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  procedimiento_id integer REFERENCES procedimientos(id),
  umbral_id integer REFERENCES aop_umbrales(id),
  variable_id integer REFERENCES variables_predictivas(id),
  activo_id integer REFERENCES activos(id),
  ubicacion_id integer REFERENCES ubicaciones(id),
  sucursal_id integer REFERENCES sucursales(id),
  valor_detectado real,
  unidad text,
  detectado_en text NOT NULL,
  detectado_por integer REFERENCES usuarios(id),
  origen text NOT NULL DEFAULT 'ronda',       -- ronda | sensor | manual
  medicion_id integer REFERENCES mediciones(id),
  orden_id integer REFERENCES ordenes(id),    -- OT correctiva abierta por la desviacion
  estado text NOT NULL DEFAULT 'abierto',     -- abierto | en_correccion | escalado | paso_a_eop | cerrado
  actuar_antes_de text,
  escalar_antes_de text,
  escalado_en text,
  valor_final real,
  normalizado_en text,
  minutos_fuera integer,
  evaluacion_riesgo text,
  cerrado_por integer REFERENCES usuarios(id),
  cerrado_en text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_aop_eventos_estado ON aop_eventos(estado);
CREATE INDEX idx_aop_eventos_fecha ON aop_eventos(detectado_en);

-- Acciones ejecutadas durante el episodio (traza de que se hizo y cuando)
CREATE TABLE aop_evento_acciones (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  evento_id integer NOT NULL REFERENCES aop_eventos(id) ON DELETE CASCADE,
  accion text NOT NULL,
  resultado text,
  ejecutado_por integer REFERENCES usuarios(id),
  ejecutado_en text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_aop_ev_acc ON aop_evento_acciones(evento_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. EOP · ficha de una pagina, simulacros y constancia de colocacion
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE eop_ficha (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  procedimiento_id integer NOT NULL UNIQUE REFERENCES procedimientos(id) ON DELETE CASCADE,
  senal_activacion text,
  activa_quien text,
  dirige_quien text,
  dirige_fuera_horario text,
  accion_1 text,                              -- las tres primeras acciones se aprenden de memoria
  accion_2 text,
  accion_3 text,
  estabilizar text,                           -- JSON [{rol, que_hace}]
  comunicar text,
  decidir text,
  restablecer text,
  etiqueta_hora_mitigacion text,              -- rotula hora_mitigacion segun el EOP
  minutos_escalar_gerencia integer,
  horas_causa_raiz integer NOT NULL DEFAULT 72,
  ultimo_simulacro_funcional text,
  proximo_simulacro_funcional text
);

CREATE TABLE eop_simulacros (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  procedimiento_id integer NOT NULL REFERENCES procedimientos(id) ON DELETE CASCADE,
  tipo text NOT NULL,                         -- mesa | funcional
  fecha text NOT NULL,
  version_ensayada text,
  sucursal_id integer REFERENCES sucursales(id),
  conducido_por integer REFERENCES usuarios(id),
  participantes text,
  hallazgos text,
  requiere_actualizacion integer NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_eop_simulacros ON eop_simulacros(procedimiento_id);

-- "Se imprime y se coloca en el cuarto tecnico y en el servicio clinico"
CREATE TABLE eop_colocaciones (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  procedimiento_id integer NOT NULL REFERENCES procedimientos(id) ON DELETE CASCADE,
  sucursal_id integer REFERENCES sucursales(id),
  ubicacion_id integer REFERENCES ubicaciones(id),
  lugar_detalle text,
  colocado_por integer REFERENCES usuarios(id),
  colocado_en text,
  verificado_en text,
  version_colocada text
);
CREATE INDEX idx_eop_coloc ON eop_colocaciones(procedimiento_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ORDENES · tipos nuevos, los tres timestamps, P1-P4 y los dos escapes
-- ─────────────────────────────────────────────────────────────────────────────
-- ordenes.tipo admite ahora: preventivo | correctivo | predictivo | intervencion | emergencia
-- ordenes.estado y tipo son TEXT sin CHECK: el enum vive en TypeScript.
ALTER TABLE ordenes ADD COLUMN procedimiento_id integer REFERENCES procedimientos(id);
ALTER TABLE ordenes ADD COLUMN nivel_riesgo text;                 -- bajo | medio | alto (MOP)
ALTER TABLE ordenes ADD COLUMN clase_prioridad text;              -- P1 | P2 | P3 | P4
ALTER TABLE ordenes ADD COLUMN hora_alarma text;                  -- indicadores 5 y 7
ALTER TABLE ordenes ADD COLUMN hora_llegada text;
ALTER TABLE ordenes ADD COLUMN hora_mitigacion text;
ALTER TABLE ordenes ADD COLUMN hora_restablecimiento text;
ALTER TABLE ordenes ADD COLUMN causa_raiz_vencimiento text;
ALTER TABLE ordenes ADD COLUMN plan_reversa text;
ALTER TABLE ordenes ADD COLUMN reversa_ejecutada integer NOT NULL DEFAULT 0;
ALTER TABLE ordenes ADD COLUMN reversa_notas text;
ALTER TABLE ordenes ADD COLUMN aop_evento_id integer REFERENCES aop_eventos(id);
-- Escape 1: diferir una P1 vencida mas de 30 dias (alimenta el indicador de mantenimiento diferido)
ALTER TABLE ordenes ADD COLUMN riesgo_aceptado_por integer REFERENCES usuarios(id);
ALTER TABLE ordenes ADD COLUMN riesgo_aceptado_en text;
ALTER TABLE ordenes ADD COLUMN riesgo_aceptado_notas text;
-- Escape 2 (distinto): cerrar un MOP sin la lectura de liberacion
ALTER TABLE ordenes ADD COLUMN cierre_sin_lectura_por integer REFERENCES usuarios(id);
ALTER TABLE ordenes ADD COLUMN cierre_sin_lectura_en text;
ALTER TABLE ordenes ADD COLUMN cierre_sin_lectura_motivo text;
CREATE INDEX idx_ordenes_clase ON ordenes(clase_prioridad);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. MOP · prerrequisitos que bloquean iniciar, liberaciones que bloquean cerrar
-- ─────────────────────────────────────────────────────────────────────────────
-- Nivel plantilla
CREATE TABLE plantilla_prerrequisitos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  plantilla_id integer NOT NULL REFERENCES checklist_plantillas(id) ON DELETE CASCADE,
  texto text NOT NULL,
  tipo text NOT NULL DEFAULT 'otro',          -- permiso_trabajo | icra | notificacion | loto | espacio_confinado | ventana | instrumento | reserva | otro
  obligatorio integer NOT NULL DEFAULT 1,
  cargo_responsable text,
  orden integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_plant_prereq ON plantilla_prerrequisitos(plantilla_id);

CREATE TABLE plantilla_liberaciones (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  plantilla_id integer NOT NULL REFERENCES checklist_plantillas(id) ON DELETE CASCADE,
  etiqueta text NOT NULL,
  unidad text,
  valor_esperado text,
  min_aceptable real,
  max_aceptable real,
  obligatoria integer NOT NULL DEFAULT 1,
  orden integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_plant_lib ON plantilla_liberaciones(plantilla_id);

-- Nivel ejecucion: la orden no inicia sin prerrequisitos cumplidos
CREATE TABLE orden_prerrequisitos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  orden_id integer NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  texto text NOT NULL,
  tipo text NOT NULL DEFAULT 'otro',
  obligatorio integer NOT NULL DEFAULT 1,
  cumplido integer NOT NULL DEFAULT 0,
  cumplido_por integer REFERENCES usuarios(id),
  cumplido_en text,
  referencia text,                            -- n.o de permiso, clase ICRA, id de candado LOTO
  cargo_responsable text,
  orden integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_orden_prereq ON orden_prerrequisitos(orden_id);

-- ...y no cierra sin la lectura de liberacion
CREATE TABLE orden_liberaciones (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  orden_id integer NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  etiqueta text NOT NULL,
  unidad text,
  valor_esperado text,
  min_aceptable real,
  max_aceptable real,
  valor_medido real,
  valor_medido_texto text,
  conforme integer,
  medido_por integer REFERENCES usuarios(id),
  medido_en text,
  obligatoria integer NOT NULL DEFAULT 1,
  orden integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_orden_lib ON orden_liberaciones(orden_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. SOP · el checklist exige el valor medido y lo compara contra el SCP
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE checklist_plantillas ADD COLUMN tipo_documento text NOT NULL DEFAULT 'sop';  -- sop | mop
ALTER TABLE checklist_plantillas ADD COLUMN procedimiento_id integer REFERENCES procedimientos(id);
ALTER TABLE checklist_plantillas ADD COLUMN procedimiento_version text;
ALTER TABLE checklist_plantillas ADD COLUMN nivel_riesgo text;
ALTER TABLE checklist_plantillas ADD COLUMN plan_reversa text;

ALTER TABLE checklist_plantilla_items ADD COLUMN requiere_valor integer NOT NULL DEFAULT 0;
ALTER TABLE checklist_plantilla_items ADD COLUMN unidad text;
ALTER TABLE checklist_plantilla_items ADD COLUMN valor_esperado_min real;
ALTER TABLE checklist_plantilla_items ADD COLUMN valor_esperado_max real;
ALTER TABLE checklist_plantilla_items ADD COLUMN variable_id integer REFERENCES variables_predictivas(id);
ALTER TABLE checklist_plantilla_items ADD COLUMN aop_procedimiento_id integer REFERENCES procedimientos(id);
ALTER TABLE checklist_plantilla_items ADD COLUMN activo_id integer REFERENCES activos(id);
ALTER TABLE checklist_plantilla_items ADD COLUMN ubicacion_id integer REFERENCES ubicaciones(id);
ALTER TABLE checklist_plantilla_items ADD COLUMN accion_si_no_cumple text;

-- Rondas por turno: "turno" y "cuatrimestral" se suman al catalogo de frecuencias (enum solo en TS)
ALTER TABLE planes_mantenimiento ADD COLUMN plantilla_id integer REFERENCES checklist_plantillas(id);
ALTER TABLE planes_mantenimiento ADD COLUMN veces_por_dia integer NOT NULL DEFAULT 1;
ALTER TABLE planes_mantenimiento ADD COLUMN horas_programadas text;   -- JSON ["06:00","14:00","22:00"]
ALTER TABLE actividades ADD COLUMN plantilla_id integer REFERENCES checklist_plantillas(id);
ALTER TABLE actividades ADD COLUMN veces_por_dia integer NOT NULL DEFAULT 1;
ALTER TABLE actividades ADD COLUMN horas_programadas text;

-- La lectura de la ronda queda ligada a su orden y a la sala
ALTER TABLE mediciones ADD COLUMN orden_id integer REFERENCES ordenes(id);
ALTER TABLE mediciones ADD COLUMN origen text NOT NULL DEFAULT 'manual';   -- manual | ronda | sensor
ALTER TABLE mediciones ADD COLUMN ubicacion_id integer REFERENCES ubicaciones(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. INDICADORES · scope = dominio, sistema = sistema critico (no mezclarlos)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE metricas_kpi ADD COLUMN sistema text;
ALTER TABLE metricas_kpi ADD COLUMN horas_fuera_rango real;          -- indicador 8
ALTER TABLE metricas_kpi ADD COLUMN desviaciones_aop integer;
ALTER TABLE metricas_kpi ADD COLUMN desviaciones_escaladas integer;
ALTER TABLE metricas_kpi ADD COLUMN mantenimiento_diferido integer;  -- P1 vencida >30d sin riesgo aceptado
ALTER TABLE metricas_kpi ADD COLUMN tiempo_respuesta_horas real;     -- indicador 5
ALTER TABLE metricas_kpi ADD COLUMN tiempo_reparacion_horas real;    -- indicador 7

-- Horas fuera de rango por sala: el grano que metricas_kpi no tiene
CREATE TABLE metricas_sala (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  periodo text NOT NULL,                      -- AAAA-MM
  ubicacion_id integer REFERENCES ubicaciones(id),
  sucursal_id integer REFERENCES sucursales(id),
  horas_fuera_rango real NOT NULL DEFAULT 0,
  desviaciones integer NOT NULL DEFAULT 0,
  desviaciones_escaladas integer NOT NULL DEFAULT 0,
  capturado_en text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(periodo, ubicacion_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. CONDICION PREVIA (cap. 00, alerta 1): norma adoptada por sistema.
-- Sin esta declaracion los valores del volumen son referencias, no requisitos.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO app_config (clave, valor) VALUES
  ('normas.electrico',  ''),
  ('normas.gases',      ''),
  ('normas.hvac',       ''),
  ('normas.agua',       ''),
  ('normas.incendios',  ''),
  ('normas.declarada_por', ''),
  ('normas.declarada_en',  '');
