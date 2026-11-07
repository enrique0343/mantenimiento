-- Fase 56: la familia MINISPLIT, con sus cinco documentos propios.
-- Decisión de la Gerencia de Operaciones (07/11/2026): un minisplit no se rige por
-- los documentos de climatización de quirófanos y UCI. Ahí el sistema es otro:
-- manejadoras con filtro HEPA, presión y renovaciones. Esos siguen en la familia hvac.
--   SCP-MSP-01  cómo debe estar         SOP-MG-06   el preventivo
--   AOP-MSP-01  se desvió, aún funciona  EOP-MSP-01  ya falló
--   MOP-MSP-01  reemplazo o reparación mayor
-- Entran como 'borrador' con su matriz de validación y sus campos en azul.
-- Idempotente: INSERT OR IGNORE sobre codigo_corto UNIQUE.

-- ═════════════════════════════════════════════════════════════════════════════
-- SCP-MSP-01 · Minisplit: configuración normal
-- ═════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, version, estado, semana_validacion, responsable_id)
SELECT 'SCP-MSP-01', 'scp', 'minisplit',
 'Minisplit: configuración normal',
 'Fijar cómo debe trabajar cada minisplit y contra qué se comparan el preventivo (SOP-MG-06), la desviación (AOP-MSP-01), la falla (EOP-MSP-01) y la liberación después de una reparación (MOP-MSP-01).',
 'Minisplit, cassette, piso techo y aire de ventana de habitaciones, consultorios, oficinas y salas de espera, en las cuatro sedes. No aplica a quirófanos, UCI, almacén estéril ni cuartos de aislamiento: ahí rige SCP-HVAC-01. Dueño: jefatura de Mantenimiento General.',
 'Manual y placa del fabricante de cada modelo · ASHRAE 55, condiciones térmicas de confort · ASHRAE 15, seguridad de sistemas de refrigeración · OSHA 29 CFR 1910.147, bloqueo y etiquetado · JCI FMS.08.00.',
 'Ficha del equipo con marca, modelo, serie, capacidad en BTU, refrigerante, voltaje, corriente de placa, breaker que lo alimenta y ubicación.',
 '0.9', 'borrador', 1, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;

INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Inventario de unidades, datos de placa y breaker de cada una', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería', 'Temperatura de consigna en habitaciones y consultorios', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Control de Infecciones', 'Qué áreas quedan fuera de esta familia por exigir filtración o presión', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Control de Infecciones');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Calidad', 'Formato de ficha y control documental', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Calidad');

INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='SCP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Temperatura de consigna en habitaciones y consultorios', '°C', 'Enfermería', 1 FROM procedimientos p
WHERE p.codigo_corto='SCP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Temperatura de consigna en habitaciones y consultorios');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Temperatura de consigna en oficinas y salas de espera', '°C', 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='SCP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Temperatura de consigna en oficinas y salas de espera');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Diferencia aceptada entre aire de retorno y aire de salida', '°C', 'Mantenimiento General', 3 FROM procedimientos p
WHERE p.codigo_corto='SCP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Diferencia aceptada entre aire de retorno y aire de salida');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Técnico o proveedor autorizado para manejar refrigerante', NULL, 'Mantenimiento General', 4 FROM procedimientos p
WHERE p.codigo_corto='SCP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Técnico o proveedor autorizado para manejar refrigerante');

-- ═════════════════════════════════════════════════════════════════════════════
-- SOP-MG-06 · Mantenimiento preventivo de minisplit
-- ═════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, version, estado, semana_validacion, responsable_id)
SELECT 'SOP-MG-06', 'sop', 'minisplit',
 'Mantenimiento preventivo de minisplit',
 'Mantener cada minisplit limpio, drenando y consumiendo lo que dice su placa, con la misma rutina para todos y lecturas que muestren cuándo empieza a fallar.',
 'Toda unidad de la familia, con la frecuencia que fije su plan. Responsable: el técnico asignado; verifica otra persona. No incluye abrir el circuito de refrigerante: eso va por MOP-MSP-01.',
 'SCP-MSP-01 · Manual del fabricante de cada modelo · OSHA 29 CFR 1910.147 · JCI FMS.08.00.',
 'Orden preventiva con cada paso y su hora, lecturas de voltaje, corriente y diferencia de temperatura, fotos si hay novedad y verificación independiente.',
 '0.9', 'borrador', 2, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;

INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Pasos, tiempos, herramientas y frecuencia por tipo de área', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería', 'Horario de acceso a habitaciones ocupadas y aviso al paciente', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Control de Infecciones', 'Limpieza con paciente en la habitación y manejo del agua de lavado', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Control de Infecciones');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Bloqueo y etiquetado y trabajo en altura para la unidad exterior', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');

INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Frecuencia en áreas con pacientes', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Frecuencia en áreas con pacientes');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Frecuencia en oficinas y salas de espera', NULL, 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Frecuencia en oficinas y salas de espera');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo que verifica el preventivo', NULL, 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo que verifica el preventivo');

-- La lista de pasos del preventivo. Es la que ve el técnico en el celular.
INSERT INTO checklist_plantillas (nombre, descripcion, activa, tipo_documento, procedimiento_id, procedimiento_version)
SELECT 'SOP-MG-06 · Preventivo de minisplit',
 'Doce pasos del SOP-MG-06. El voltaje y la corriente se comparan contra la placa de la unidad.', 1, 'sop', p.id, p.version
FROM procedimientos p WHERE p.codigo_corto='SOP-MG-06'
  AND NOT EXISTS (SELECT 1 FROM checklist_plantillas t WHERE t.procedimiento_id=p.id);

INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, orden)
SELECT t.id, 'Apagar la unidad y bloquear su breaker', 'Breaker bloqueado y etiquetado; sin voltaje en la unidad.', 1, 2, 1
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM checklist_plantilla_items x WHERE x.plantilla_id=t.id AND x.orden=1);
INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, orden)
SELECT t.id, 'Lavar y secar los filtros de la unidad interior', 'Filtros limpios y sin rasgaduras.', 0, 10, 2
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM checklist_plantilla_items x WHERE x.plantilla_id=t.id AND x.orden=2);
INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, materiales, orden)
SELECT t.id, 'Limpiar el serpentín y la turbina de la evaporadora', 'Sin polvo ni moho visibles; tarjeta y motor protegidos del agua.', 0, 15, 'Cubierta de lavado y limpiador de serpentín', 3
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM checklist_plantilla_items x WHERE x.plantilla_id=t.id AND x.orden=3);
INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, orden)
SELECT t.id, 'Limpiar la bandeja y la línea de drenaje', 'El agua sale libre por el drenaje, sin goteo dentro del cuarto.', 0, 10, 4
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM checklist_plantilla_items x WHERE x.plantilla_id=t.id AND x.orden=4);
INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, orden)
SELECT t.id, 'Limpiar el serpentín de la condensadora', 'Aletas limpias y paso de aire libre alrededor de la unidad exterior.', 0, 15, 5
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM checklist_plantilla_items x WHERE x.plantilla_id=t.id AND x.orden=5);
INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, orden)
SELECT t.id, 'Revisar aislamiento, soportes y señales de fuga', 'Aislamiento completo, soportes firmes y sin manchas de aceite en uniones.', 0, 5, 6
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM checklist_plantilla_items x WHERE x.plantilla_id=t.id AND x.orden=6);
INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, orden)
SELECT t.id, 'Reapretar bornes y revisar cables', 'Bornes firmes, sin cables recalentados ni aislamiento dañado.', 1, 5, 7
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM checklist_plantilla_items x WHERE x.plantilla_id=t.id AND x.orden=7);
INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, orden)
SELECT t.id, 'Retirar el bloqueo y encender en modo frío', 'Herramientas retiradas, tapas puestas y unidad encendida. Dejar 15 minutos antes de medir.', 1, 3, 8
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM checklist_plantilla_items x WHERE x.plantilla_id=t.id AND x.orden=8);
INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, requiere_valor, unidad, orden)
SELECT t.id, 'Medir el voltaje de alimentación', 'Dentro del rango de la placa de la unidad.', 0, 2, 1, 'V', 9
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM checklist_plantilla_items x WHERE x.plantilla_id=t.id AND x.orden=9);
INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, requiere_valor, unidad, orden)
SELECT t.id, 'Medir la corriente del compresor', 'No mayor que la corriente de la placa de la unidad.', 0, 3, 1, 'A', 10
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM checklist_plantilla_items x WHERE x.plantilla_id=t.id AND x.orden=10);
INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, requiere_valor, unidad, valor_esperado_min, valor_esperado_max, orden)
SELECT t.id, 'Medir la diferencia de temperatura entre retorno y salida', 'Aire de retorno menos aire de salida, con 15 minutos de operación. Fuera de rango: seguir el AOP-MSP-01.', 0, 5, 1, '°C', 8, 14, 11
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM checklist_plantilla_items x WHERE x.plantilla_id=t.id AND x.orden=11);
INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, orden)
SELECT t.id, 'Probar modos y control, dejar la consigna y el área limpia', 'Responde al control, queda en la consigna del SCP-MSP-01 y sin residuos.', 0, 5, 12
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='SOP-MG-06' AND NOT EXISTS (SELECT 1 FROM checklist_plantilla_items x WHERE x.plantilla_id=t.id AND x.orden=12);

-- ═════════════════════════════════════════════════════════════════════════════
-- EOP-MSP-01 · Minisplit detenido o con riesgo para las personas
-- (va antes del AOP porque el reloj del AOP apunta a este documento)
-- ═════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, version, estado, semana_validacion, responsable_id)
SELECT 'EOP-MSP-01', 'eop', 'minisplit',
 'Minisplit detenido o con riesgo para las personas',
 'Dar las tres primeras acciones cuando un minisplit ya falló: quitar el riesgo eléctrico o de agua, proteger a quien esté en el cuarto y dejar registro con la hora.',
 'Toda unidad de la familia. Si hay humo o fuego manda EOP-INC-01. En quirófanos y UCI manda EOP-HVAC-01. Dueño: jefatura de Mantenimiento General.',
 'SCP-MSP-01 · AOP-MSP-01 · EOP-INC-01 · OSHA 29 CFR 1910.147 · JCI FMS.08.00.',
 'Orden de emergencia con hora de alarma, de llegada, de mitigación y de restablecimiento, y causa raíz en 72 horas.',
 '0.9', 'borrador', 3, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;

INSERT OR IGNORE INTO eop_ficha
  (procedimiento_id, senal_activacion, activa_quien, dirige_quien, dirige_fuera_horario, accion_1, accion_2, accion_3, estabilizar, comunicar, decidir, restablecer, etiqueta_hora_mitigacion, minutos_escalar_gerencia, horas_causa_raiz)
SELECT p.id,
 'Olor a quemado o chispas, breaker que se dispara otra vez, agua cayendo sobre una cama, un equipo o un tablero, o unidad detenida en una habitación con paciente.',
 'Quien lo detecte, avisando a Mantenimiento y a la supervisión del área.',
 'El técnico de turno de Mantenimiento General.',
 'El técnico de guardia; hasta que llegue, la supervisión de Enfermería.',
 'CORTAR: apagar la unidad desde su breaker y ponerle etiqueta. Si hay humo o fuego, pasar a EOP-INC-01.',
 'PROTEGER: retirar personas y equipos del agua o del olor, secar y señalizar el piso, y avisar a Enfermería.',
 'REGISTRAR: abrir la orden de emergencia con la hora de alarma y avisar a la jefatura.',
 'Mover al paciente a otra habitación si no se puede mantener la temperatura, o llevar un ventilador portátil si Enfermería lo autoriza. La unidad queda sin energía y etiquetada.',
 'El técnico avisa a la supervisión de Enfermería o al responsable del área y a la jefatura de Mantenimiento General. Si son varias unidades a la vez, avisa también a la Gerencia de Operaciones.',
 'La jefatura decide si se repara en el turno, se reemplaza la unidad (MOP-MSP-01) o se deja fuera de servicio, y hasta cuándo.',
 'La unidad vuelve a servicio solo con lecturas dentro del SCP-MSP-01: voltaje, corriente y diferencia de temperatura. La orden cierra con causa raíz y verificación independiente.',
 'Unidad sin energía y área segura', 60, 72
FROM procedimientos p WHERE p.codigo_corto='EOP-MSP-01';

INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 0, 15, 'Supervisión de Enfermería o responsable del área', 'Unidad sin energía y personas protegidas.', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=0);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 1, 30, 'Jefatura de Mantenimiento General', 'Causa probable y decisión: reparar, reemplazar o dejar fuera de servicio.', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=1);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 2, 60, 'Gerencia de Operaciones', 'Solo si hay varias unidades afectadas, pacientes trasladados o daño por agua.', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=2);

INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Tres primeras acciones, guardia y repuestos críticos', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería', 'Cuándo se mueve a un paciente y qué alternativa se usa', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Control de Infecciones', 'Uso de ventilador portátil y manejo de superficies mojadas', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Control de Infecciones');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Riesgo eléctrico y paso a EOP-INC-01', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');

INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Teléfono o radio de la guardia de Mantenimiento', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Teléfono o radio de la guardia de Mantenimiento');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Dónde están los ventiladores portátiles de respaldo', NULL, 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='EOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Dónde están los ventiladores portátiles de respaldo');

-- ═════════════════════════════════════════════════════════════════════════════
-- AOP-MSP-01 · Minisplit que funciona fuera de lo normal
-- ═════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, version, estado, semana_validacion, responsable_id)
SELECT 'AOP-MSP-01', 'aop', 'minisplit',
 'Minisplit que no enfría bien, gotea o consume de más',
 'Atender a tiempo una unidad que sigue funcionando pero fuera de lo normal, antes de que se vuelva una falla, y fijar cuánto se tolera antes de escalar.',
 'Toda unidad de la familia. Dueño: jefatura de Mantenimiento General. Si la unidad se detiene o hay riesgo eléctrico o de agua, pasa a EOP-MSP-01.',
 'SCP-MSP-01 · SOP-MG-06 · Manual del fabricante · JCI FMS.08.00.',
 'Desviación con valor, hora de detección y acciones registradas. Si no se corrige, orden correctiva vinculada.',
 '0.9', 'borrador', 2, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;

INSERT OR IGNORE INTO aop_ficha (procedimiento_id, condicion_umbral, quien_detecta, tiempo_tolerable, decision_casos, pasa_a_eop)
SELECT p.id,
 'Diferencia entre retorno y salida fuera del rango del SCP-MSP-01, cuarto que no llega a la consigna, goteo o bandeja llena, corriente mayor que la de placa, hielo en el serpentín o la tubería, ruido o vibración nuevos, o código de error que se borra al reiniciar.',
 'El técnico en el preventivo, o Enfermería y el personal del área por reporte.',
 'Con pacientes: 4 horas para actuar y 24 para escalar. Oficinas y salas de espera: mismo plazo de escalamiento, y se atiende después de las áreas con pacientes.',
 'Habitación con paciente y temperatura que no se recupera: Enfermería decide si cambia de habitación. Consultorio u oficina: se coordina la reparación con el área. Sospecha de fuga de refrigerante: no recargar; se abre correctivo y va por MOP-MSP-01.',
 'La unidad se detiene, huele a quemado, se dispara el breaker o cae agua sobre una cama, un equipo o un tablero: EOP-MSP-01.'
FROM procedimientos p WHERE p.codigo_corto='AOP-MSP-01';

INSERT INTO aop_umbrales (procedimiento_id, minutos_para_actuar, minutos_para_escalar, minutos_evento_persistente, eop_procedimiento_id)
SELECT p.id, 240, 1440, 4320, (SELECT id FROM procedimientos WHERE codigo_corto='EOP-MSP-01')
FROM procedimientos p WHERE p.codigo_corto='AOP-MSP-01'
  AND NOT EXISTS (SELECT 1 FROM aop_umbrales a WHERE a.procedimiento_id=p.id);

INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 1, 'Revisar control, modo y consigna. Limpiar el filtro si está sucio.', 'Control correcto y filtro limpio.' FROM procedimientos p
WHERE p.codigo_corto='AOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=1);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 2, 'Si gotea, destapar la línea de drenaje y secar el área.', 'Drena libre y sin agua en el piso.' FROM procedimientos p
WHERE p.codigo_corto='AOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=2);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 3, 'Si hay hielo, apagar el compresor, dejar solo el ventilador hasta que se derrita y revisar el paso de aire.', 'Serpentín sin hielo y aire circulando.' FROM procedimientos p
WHERE p.codigo_corto='AOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=3);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 4, 'Volver a medir voltaje, corriente y diferencia de temperatura con 15 minutos de operación.', 'Lecturas registradas con hora.' FROM procedimientos p
WHERE p.codigo_corto='AOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=4);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 5, 'Si sigue fuera de rango, abrir orden correctiva. Las presiones de refrigerante las mide solo el técnico autorizado.', 'Orden abierta, con lecturas y avisos al área.' FROM procedimientos p
WHERE p.codigo_corto='AOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=5);

INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 0, 240, 'Técnico de turno', 'Acciones inmediatas hechas y lecturas registradas.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=0);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 1, 1440, 'Jefatura de Mantenimiento General', 'Corregido, u orden correctiva con fecha y responsable.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=1);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 2, 0, 'Técnico de turno', 'La unidad se detuvo o hay riesgo eléctrico o de agua: pasar a EOP-MSP-01.', 1 FROM procedimientos p
WHERE p.codigo_corto='AOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=2);

INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Condiciones, plazos y acciones inmediatas', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería', 'Plazo tolerable en habitaciones con paciente', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Calidad', 'Registro de la desviación y su cierre', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Calidad');

INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Plazo para actuar en habitaciones con paciente', 'min', 'Enfermería', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Plazo para actuar en habitaciones con paciente');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Plazo para escalar', 'min', 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='AOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Plazo para escalar');

-- ═════════════════════════════════════════════════════════════════════════════
-- MOP-MSP-01 · Reemplazo o reparación mayor de un minisplit
-- ═════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'MOP-MSP-01', 'mop', 'minisplit',
 'Reemplazo o reparación mayor de un minisplit',
 'Cambiar una unidad o intervenir su refrigerante o su alimentación eléctrica sin afectar a los pacientes, sin fugas y con lecturas que demuestren que quedó bien.',
 'Cambio de unidad, compresor o tarjeta; soldadura, recuperación o carga de refrigerante; traslado de una unidad; cambio de breaker o de alimentación. No incluye la limpieza del preventivo (SOP-MG-06). Riesgo medio: trabajo en altura, eléctrico y con refrigerante.',
 'SCP-MSP-01 · Manual del fabricante · ASHRAE 15 · OSHA 29 CFR 1910.147 · Protocolo de Montreal, recuperación de refrigerante · ASHE ICRA 2.0 (2022) en áreas con pacientes.',
 'Plantilla de orden con prerrequisitos y lecturas de liberación, refrigerante recuperado y cargado en kg, y liberación firmada por Mantenimiento General.',
 'medio', '0.9', 'borrador', 4, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;

INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Pasos, instrumentos y lecturas de liberación', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Control de Infecciones', 'Cuándo aplica ICRA y qué clase', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Control de Infecciones');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería', 'Ventana en áreas con pacientes y habitación alterna', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Permiso de trabajo en altura y en caliente, y bloqueo y etiquetado', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');

INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Ventana autorizada (día y horas)', NULL, 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Ventana autorizada (día y horas)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Técnico o proveedor autorizado para manejar refrigerante', NULL, 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Técnico o proveedor autorizado para manejar refrigerante');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo que firma la liberación', NULL, 'Mantenimiento General', 3 FROM procedimientos p
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo que firma la liberación');

INSERT INTO checklist_plantillas (nombre, descripcion, activa, tipo_documento, procedimiento_id, procedimiento_version, nivel_riesgo, plan_reversa)
SELECT 'MOP-MSP-01 · Reemplazo o reparación mayor de minisplit',
 'Prerrequisitos y lecturas de liberación del MOP-MSP-01.', 1, 'mop', p.id, p.version, 'medio',
 'Si no pasa las pruebas antes de cerrar la ventana: dejar la unidad sin energía y etiquetada, sellar la tubería abierta, avisar a Enfermería o al área y coordinar la habitación alterna o el ventilador de respaldo.'
FROM procedimientos p WHERE p.codigo_corto='MOP-MSP-01'
  AND NOT EXISTS (SELECT 1 FROM checklist_plantillas t WHERE t.procedimiento_id=p.id);

INSERT INTO plantilla_prerrequisitos (plantilla_id, texto, tipo, obligatorio, cargo_responsable, orden)
SELECT t.id, 'Ventana acordada con el área y, si hay paciente, habitación alterna confirmada.', 'ventana', 1, 'Supervisión de Enfermería o responsable del área', 0
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM plantilla_prerrequisitos x WHERE x.plantilla_id=t.id AND x.orden=0);
INSERT INTO plantilla_prerrequisitos (plantilla_id, texto, tipo, obligatorio, cargo_responsable, orden)
SELECT t.id, 'Permiso de trabajo emitido, con altura y trabajo en caliente si aplican.', 'permiso_trabajo', 1, 'Seguridad y Salud Ocupacional', 1
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM plantilla_prerrequisitos x WHERE x.plantilla_id=t.id AND x.orden=1);
INSERT INTO plantilla_prerrequisitos (plantilla_id, texto, tipo, obligatorio, cargo_responsable, orden)
SELECT t.id, 'ICRA firmada por Control de Infecciones si el trabajo es en un área con pacientes.', 'icra', 0, 'Control de Infecciones', 2
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM plantilla_prerrequisitos x WHERE x.plantilla_id=t.id AND x.orden=2);
INSERT INTO plantilla_prerrequisitos (plantilla_id, texto, tipo, obligatorio, cargo_responsable, orden)
SELECT t.id, 'Bloqueo y etiquetado del breaker de la unidad, con candado y número registrado.', 'loto', 1, 'Técnico de turno', 3
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM plantilla_prerrequisitos x WHERE x.plantilla_id=t.id AND x.orden=3);
INSERT INTO plantilla_prerrequisitos (plantilla_id, texto, tipo, obligatorio, cargo_responsable, orden)
SELECT t.id, 'Máquina de recuperación, cilindro, nitrógeno, bomba de vacío y vacuómetro listos y con calibración vigente.', 'instrumento', 1, 'Técnico autorizado', 4
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM plantilla_prerrequisitos x WHERE x.plantilla_id=t.id AND x.orden=4);

INSERT INTO plantilla_liberaciones (plantilla_id, etiqueta, unidad, valor_esperado, obligatoria, orden)
SELECT t.id, 'Prueba de hermeticidad con nitrógeno a la presión del fabricante', NULL, 'Sin caída de presión', 1, 0
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM plantilla_liberaciones x WHERE x.plantilla_id=t.id AND x.orden=0);
INSERT INTO plantilla_liberaciones (plantilla_id, etiqueta, unidad, valor_esperado, min_aceptable, max_aceptable, obligatoria, orden)
SELECT t.id, 'Vacío alcanzado antes de cargar', 'micrones', '500 o menos', 0, 500, 1, 1
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM plantilla_liberaciones x WHERE x.plantilla_id=t.id AND x.orden=1);
INSERT INTO plantilla_liberaciones (plantilla_id, etiqueta, unidad, valor_esperado, obligatoria, orden)
SELECT t.id, 'Carga de refrigerante según placa', 'kg', 'La cantidad de la placa', 1, 2
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM plantilla_liberaciones x WHERE x.plantilla_id=t.id AND x.orden=2);
INSERT INTO plantilla_liberaciones (plantilla_id, etiqueta, unidad, valor_esperado, obligatoria, orden)
SELECT t.id, 'Corriente del compresor', 'A', 'No mayor que la de placa', 1, 3
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM plantilla_liberaciones x WHERE x.plantilla_id=t.id AND x.orden=3);
INSERT INTO plantilla_liberaciones (plantilla_id, etiqueta, unidad, valor_esperado, min_aceptable, max_aceptable, obligatoria, orden)
SELECT t.id, 'Diferencia de temperatura entre retorno y salida, con 15 minutos de operación', '°C', 'Dentro del SCP-MSP-01', 8, 14, 1, 4
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM plantilla_liberaciones x WHERE x.plantilla_id=t.id AND x.orden=4);
INSERT INTO plantilla_liberaciones (plantilla_id, etiqueta, unidad, valor_esperado, obligatoria, orden)
SELECT t.id, 'Drenaje probado y bloqueo retirado', NULL, 'Drena libre, sin goteo; candado retirado con hora', 1, 5
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-MSP-01' AND NOT EXISTS (SELECT 1 FROM plantilla_liberaciones x WHERE x.plantilla_id=t.id AND x.orden=5);

-- ═════════════════════════════════════════════════════════════════════════════
-- El juego por familia tiene que verlos: una fila por documento en la familia.
-- ═════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO procedimiento_sistemas (procedimiento_id, sistema)
SELECT id, 'minisplit' FROM procedimientos
WHERE codigo_corto IN ('SCP-MSP-01','SOP-MG-06','AOP-MSP-01','EOP-MSP-01','MOP-MSP-01');
