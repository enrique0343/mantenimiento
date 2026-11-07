-- Fase 51: los cinco documentos que faltaban para cerrar el juego por familia.
--   incendios  -> AOP-INC-01, EOP-INC-01
--   ascensores -> SCP-ASC-01, AOP-ASC-01, MOP-ASC-01
-- Escritos cortos a proposito: una ficha que se lee de pie, frente al equipo.
-- Entran como 'borrador' con su matriz de validacion y sus campos en azul.
-- Idempotente: INSERT OR IGNORE sobre codigo_corto UNIQUE.

-- ═════════════════════════════════════════════════════════════════════════════
-- AOP-INC-01 · Sistema contra incendios fuera de servicio (sin fuego)
-- ═════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, version, estado, semana_validacion, responsable_id)
SELECT 'AOP-INC-01', 'aop', 'incendios',
 'Sistema contra incendios fuera de servicio, total o parcial',
 'Manejar el período en que una parte del sistema contra incendios queda fuera de servicio sin que haya fuego, y fijar cuánto tiempo se tolera antes de montar vigilancia, avisar a Bomberos y a la aseguradora, o cerrar el área.',
 'Rociadores, bomba contra incendios, panel y detectores, hidrantes, extintores, puertas cortafuego y campana de cocina, en las cuatro sedes. Dueño: Seguridad y Salud Ocupacional; suplente: jefatura de Mantenimiento General.',
 'SCP-INC-01 · NFPA 25 (2011) capítulo 15, manejo de deterioros · NFPA 72 (2010) capítulo 14 · JCI FMS.05 y FMS.06.',
 'Etiqueta de deterioro con hora de inicio y de cierre, vigilancia contra incendios asignada por turno, avisos emitidos y medidas compensatorias escritas si pasa de 24 horas.',
 '0.9', 'borrador', 2, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;

INSERT OR IGNORE INTO aop_ficha (procedimiento_id, condicion_umbral, quien_detecta, tiempo_tolerable, decision_casos, pasa_a_eop)
SELECT p.id,
 'Válvula de control cerrada, zona de rociadores aislada, presión del sistema bajo el valor del SCP-INC-01, panel en falla o en supervisión, bomba indisponible, extintores vencidos o retirados sin reposición, puerta cortafuego trabada o campana de cocina sin agente.',
 'El técnico en la ronda de turno (SOP-MG-01), la ronda mensual de incendios (SOP-MG-05), el panel de alarma o el contratista al abrir un trabajo.',
 'Deterioro programado: solo dentro de la ventana autorizada. Deterioro imprevisto: 1 hora para confirmar el alcance, 4 horas para restablecer o montar vigilancia contra incendios, 8 horas para avisar a Bomberos y a la aseguradora, 24 horas para dejar medidas compensatorias escritas.',
 'Quirófano, internamiento o UCI sin detección ni rociadores solo sigue en uso con vigilancia contra incendios permanente y autorización escrita de SSO. Sin vigilancia disponible, el área se cierra.',
 'Humo, fuego o alarma confirmada: pasa a EOP-INC-01 de inmediato.'
FROM procedimientos p WHERE p.codigo_corto='AOP-INC-01';

INSERT INTO aop_umbrales (procedimiento_id, minutos_para_actuar, minutos_para_escalar, minutos_evento_persistente, eop_procedimiento_id)
SELECT p.id, 60, 240, 1440, (SELECT id FROM procedimientos WHERE codigo_corto='EOP-INC-01')
FROM procedimientos p WHERE p.codigo_corto='AOP-INC-01'
  AND NOT EXISTS (SELECT 1 FROM aop_umbrales a WHERE a.procedimiento_id=p.id);

INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 1, 'Confirmar en sitio qué componente quedó fuera y qué área deja sin protección.', 'Alcance escrito: componente, zona y área afectada.' FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=1);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 2, 'Colocar la etiqueta de deterioro en la válvula o el panel, con la hora de inicio.', 'Etiqueta puesta; nadie reabre por error.' FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=2);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 3, 'Intentar el restablecimiento inmediato: reabrir la válvula, reponer el extintor, liberar la puerta, restablecer el panel.', 'Sistema de vuelta en servicio, o causa confirmada.' FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=3);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 4, 'Si no se restablece: avisar a SSO, montar vigilancia contra incendios por turno en el área y prohibir trabajo en caliente.', 'Vigilancia asignada por nombre y turno.' FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=4);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 5, 'Abrir orden correctiva P1 y avisar al contratista del sistema. El deterioro se cierra solo con la prueba del componente.', 'Prueba registrada y etiqueta retirada con hora.' FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=5);

INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 0, 60, 'Seguridad y Salud Ocupacional', 'Alcance confirmado y etiqueta de deterioro colocada.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=0);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 1, 240, 'Jefatura de Mantenimiento General y contratista del sistema', 'Restablecido, o vigilancia contra incendios montada en el área.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=1);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 2, 480, 'Cuerpo de Bomberos y aseguradora', 'Aviso emitido con alcance, hora de inicio y medidas tomadas.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=2);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 3, 1440, 'Gerencia de Operaciones', 'Medidas compensatorias escritas, o decisión de cerrar el área.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=3);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 4, 0, 'Seguridad y Salud Ocupacional', 'Humo, fuego o alarma confirmada: pasa a EOP-INC-01.', 1 FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=4);

INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Horas máximas de deterioro, vigilancia contra incendios y criterio de cierre de área', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Presiones normales del sistema y tiempo de llegada del contratista', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Legal', 'A quién y en qué plazo hay que avisar por ley y por póliza', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Legal');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Calidad', 'Trazabilidad del deterioro para FMS.05 y FMS.06', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Calidad');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Proveedor de alarma y rociadores', 'Tiempo de llegada y prueba con la que se cierra el deterioro', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Proveedor de alarma y rociadores');

INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo que autoriza un deterioro programado', NULL, 'Seguridad y Salud Ocupacional', 1 FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo que autoriza un deterioro programado');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Horas máximas de deterioro sin vigilancia contra incendios', 'h', 'Seguridad y Salud Ocupacional', 2 FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Horas máximas de deterioro sin vigilancia contra incendios');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Número del Cuerpo de Bomberos', NULL, 'Seguridad y Salud Ocupacional', 3 FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Número del Cuerpo de Bomberos');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Contacto de la aseguradora y plazo de aviso', NULL, 'Legal', 4 FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Contacto de la aseguradora y plazo de aviso');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo que cubre la vigilancia contra incendios por turno', NULL, 'Seguridad y Salud Ocupacional', 5 FROM procedimientos p
WHERE p.codigo_corto='AOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo que cubre la vigilancia contra incendios por turno');

-- ═════════════════════════════════════════════════════════════════════════════
-- EOP-INC-01 · Alarma de incendio o fuego confirmado
-- ═════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, version, estado, semana_validacion, responsable_id)
SELECT 'EOP-INC-01', 'eop', 'incendios',
 'Alarma de incendio o fuego confirmado',
 'Dar las tres primeras acciones que se hacen de memoria ante humo o fuego, y fijar quién dirige, a quién se avisa y quién autoriza volver a ocupar el área.',
 'Cualquier área de las cuatro sedes. La ficha se imprime y se coloca en cada estación de enfermería, cocina, cuarto técnico y recepción. Dueño: Seguridad y Salud Ocupacional; la parte clínica la dirige la supervisión de Enfermería.',
 'NFPA 101 (2012), capítulos 18 y 19 · NFPA 99 (2012) · JCI FMS.05 y FMS.06 · Plan de emergencias institucional.',
 'Hora de la alarma, hora de control, personas evacuadas por área, extintores usados, informe a Bomberos y causa raíz en 72 horas.',
 '0.9', 'borrador', 3, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;

INSERT OR IGNORE INTO eop_ficha
  (procedimiento_id, senal_activacion, activa_quien, dirige_quien, dirige_fuera_horario, accion_1, accion_2, accion_3, estabilizar, comunicar, decidir, restablecer, etiqueta_hora_mitigacion, minutos_escalar_gerencia, horas_causa_raiz)
SELECT p.id,
 'Alarma del panel, detector activado, olor a humo, fuego a la vista o aviso de una persona.',
 'Quien detecta el fuego, con el pulsador manual más cercano y avisando a la central telefónica.',
 'La jefatura de Seguridad y Salud Ocupacional.',
 'El técnico de turno de Mantenimiento General junto con vigilancia, hasta que llegue SSO.',
 'RESCATAR: sacar del cuarto donde está el fuego a quien corra riesgo inmediato.',
 'ALARMA: activar el pulsador manual y avisar a la central diciendo sede, piso, área y qué se quema.',
 'CONFINAR: cerrar la puerta del cuarto y las puertas cortafuego del pasillo. No usar los ascensores.',
 'Enfermería de la unidad: cuenta pacientes y personal, identifica a los que no caminan, prepara el traslado horizontal y mantiene a los pacientes dentro de su habitación con la puerta cerrada si el humo está en el pasillo. Mantenimiento General: confirma en el panel la zona activada, verifica que la bomba contra incendios arrancó, corta energía y gases del área solo si SSO lo indica y guía a Bomberos al cuarto de controles. Vigilancia: abre la ruta de acceso de Bomberos, libera los accesos controlados, baja los ascensores a planta baja y los deja fuera de servicio, impide el ingreso de público. Cocina: ante fuego en campana, corta el gas y acciona el sistema de supresión antes de usar el extintor.',
 'La central telefónica avisa en este orden: Cuerpo de Bomberos, jefatura de SSO, supervisión de Enfermería, jefatura de Mantenimiento General, Gerencia de Operaciones y Dirección Médica de turno. Un solo mensaje por altavoz o radio, con sede, piso y área; nadie más llama a la central salvo por riesgo de vida.',
 'La evacuación es primero horizontal, al compartimiento contiguo del mismo piso; la vertical solo si el humo lo exige, y nunca por ascensor. Decide SSO con la Dirección Médica de turno, y la suspensión de procedimientos electivos la decide esta última.',
 'El área no se vuelve a ocupar hasta que Bomberos la libere, el panel quede restablecido sin zonas en falla, los extintores y rociadores usados estén repuestos y SSO lo autorice por escrito. Todo componente que quedó fuera de servicio se maneja con el AOP-INC-01 hasta su prueba.',
 'Fuego controlado', 10, 72
FROM procedimientos p WHERE p.codigo_corto='EOP-INC-01';

INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 0, 0, 'Cuerpo de Bomberos', 'Llamada hecha en el momento de la alarma, sin esperar confirmación.', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=0);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 1, 5, 'Seguridad y Salud Ocupacional y supervisión de Enfermería', 'Zona confirmada en el panel y conteo de pacientes del área iniciado.', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=1);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 2, 10, 'Gerencia de Operaciones y Dirección Médica de turno', 'Fuego no controlado a los 10 minutos: se activa el plan de emergencias y se decide la evacuación.', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=2);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 3, 30, 'Gerencia General', 'Evacuación en curso o área fuera de uso: aviso con alcance y pacientes afectados.', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=3);

INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Las tres primeras acciones, el mando y el criterio de evacuación', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería', 'Conteo de pacientes, traslado horizontal y manejo de pacientes que no caminan', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Dirección Médica', 'Quién decide suspender procedimientos y evacuar', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Dirección Médica');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Corte de energía y gases, bomba contra incendios y acceso al cuarto de controles', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Vigilancia', 'Ruta de acceso de Bomberos, ascensores y control de ingreso', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Vigilancia');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Central telefónica', 'Orden de llamadas y el texto del aviso por altavoz', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Central telefónica');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Cocina', 'Corte de gas y uso del sistema de supresión de la campana', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Cocina');

INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Número del Cuerpo de Bomberos', NULL, 'Seguridad y Salud Ocupacional', 1 FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Número del Cuerpo de Bomberos');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Extensión de la central telefónica', NULL, 'Central telefónica', 2 FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Extensión de la central telefónica');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Texto exacto del aviso por altavoz o radio', NULL, 'Seguridad y Salud Ocupacional', 3 FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Texto exacto del aviso por altavoz o radio');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Punto de reunión de cada sede', NULL, 'Seguridad y Salud Ocupacional', 4 FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Punto de reunión de cada sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Compartimiento de evacuación horizontal por piso', NULL, 'Seguridad y Salud Ocupacional', 5 FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Compartimiento de evacuación horizontal por piso');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo que autoriza volver a ocupar el área', NULL, 'Seguridad y Salud Ocupacional', 6 FROM procedimientos p
WHERE p.codigo_corto='EOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo que autoriza volver a ocupar el área');

-- El AOP-INC-01 se insertó antes que su EOP: se amarra aquí, ya existiendo los dos.
UPDATE aop_umbrales
   SET eop_procedimiento_id = (SELECT id FROM procedimientos WHERE codigo_corto='EOP-INC-01')
 WHERE eop_procedimiento_id IS NULL
   AND procedimiento_id = (SELECT id FROM procedimientos WHERE codigo_corto='AOP-INC-01');

-- ═════════════════════════════════════════════════════════════════════════════
-- SCP-ASC-01 · Ascensores: configuración normal
-- ═════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, version, estado, semana_validacion, responsable_id)
SELECT 'SCP-ASC-01', 'scp', 'ascensores',
 'Ascensores: configuración normal',
 'Fijar los datos de cada ascensor contra los que trabajan la ronda de turno, el AOP-ASC-01, el MOP-ASC-01 y el rescate del EOP-ASC-01: capacidad, paradas, alimentación eléctrica, comunicación de cabina, inspección vigente y quién está autorizado a liberar personas.',
 'Todos los ascensores y montacargas de las cuatro sedes, con su cuarto de máquinas, foso y puertas de piso. Excluye escaleras, rampas y camillas de transporte. Dueño: jefatura de Mantenimiento General; suplente: el cargo que se defina en los campos en azul.',
 'ASME A17.1 / CSA B44, operación y mantenimiento · NFPA 72 (2010) capítulo 21, llamada de emergencia por detección · NFPA 99 (2012) capítulo 6, alimentación esencial · JCI FMS.04 · Política de ascensores, South Eastern Sydney Local Health District.',
 'Activo padre «Ascensor N» con hijos: máquina, controlador, puertas, cabina y teléfono de cabina. Adjuntos al activo: ficha técnica, certificado de la última inspección, contrato de mantenimiento vigente y lista de aviso del proveedor con número de 24 horas.',
 '0.9', 'borrador', 1, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;

INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Inventario de ascensores, paradas, rama eléctrica que los alimenta y estado de la inspección', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Proveedor de ascensores', 'Datos de placa, tiempo de respuesta contractual y quién puede liberar personas', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Proveedor de ascensores');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Certificado de inspección vigente y señalización de uso en emergencia', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Tecnología y Transformación Digital', 'A dónde timbra el teléfono de cabina y quién contesta en cada turno', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Tecnología y Transformación Digital');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Calidad', 'Que la configuración declarada coincide con el programa FMS.04', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Calidad');

INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='SCP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Identificación y cantidad de ascensores de la sede', NULL, 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='SCP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Identificación y cantidad de ascensores de la sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Capacidad de cada cabina', 'kg y personas', 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='SCP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Capacidad de cada cabina');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Paradas que sirve cada ascensor y cuál sirve quirófanos y UCI', NULL, 'Mantenimiento General', 3 FROM procedimientos p
WHERE p.codigo_corto='SCP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Paradas que sirve cada ascensor y cuál sirve quirófanos y UCI');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Rama eléctrica que alimenta cada ascensor (normal o emergencia)', NULL, 'Mantenimiento General', 4 FROM procedimientos p
WHERE p.codigo_corto='SCP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Rama eléctrica que alimenta cada ascensor (normal o emergencia)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Tipo de teléfono de cabina y a dónde timbra', NULL, 'Tecnología y Transformación Digital', 5 FROM procedimientos p
WHERE p.codigo_corto='SCP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Tipo de teléfono de cabina y a dónde timbra');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Tiempo de respuesta contractual del proveedor', 'min', 'Mantenimiento General', 6 FROM procedimientos p
WHERE p.codigo_corto='SCP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Tiempo de respuesta contractual del proveedor');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Fecha de la última inspección y de la próxima', 'fecha', 'Seguridad y Salud Ocupacional', 7 FROM procedimientos p
WHERE p.codigo_corto='SCP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Fecha de la última inspección y de la próxima');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo autorizado a liberar personas atrapadas', NULL, 'Proveedor de ascensores', 8 FROM procedimientos p
WHERE p.codigo_corto='SCP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo autorizado a liberar personas atrapadas');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Frecuencia de prueba del teléfono de cabina', NULL, 'Mantenimiento General', 9 FROM procedimientos p
WHERE p.codigo_corto='SCP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Frecuencia de prueba del teléfono de cabina');

-- ═════════════════════════════════════════════════════════════════════════════
-- AOP-ASC-01 · Ascensor con falla, sin personas atrapadas
-- ═════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, version, estado, semana_validacion, responsable_id)
SELECT 'AOP-ASC-01', 'aop', 'ascensores',
 'Ascensor con falla, sin personas atrapadas',
 'Decidir rápido si un ascensor con falla sigue en servicio o se saca, y garantizar que el traslado de pacientes nunca quede sin ruta mientras se repara.',
 'Falla de puertas, nivelación, llamado, ruido o vibración anormal, falla en el controlador, teléfono de cabina o luz de emergencia sin funcionar. Dueño: jefatura de Mantenimiento General.',
 'SCP-ASC-01 · ASME A17.1 / CSA B44 · Política de ascensores, South Eastern Sydney Local Health District · Contrato de mantenimiento vigente.',
 'Hora de detección, falla observada, rótulo de fuera de servicio colocado, hora de aviso al proveedor, hora de llegada y prueba de recorrido al reponerlo.',
 '0.9', 'borrador', 2, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;

INSERT OR IGNORE INTO aop_ficha (procedimiento_id, condicion_umbral, quien_detecta, tiempo_tolerable, decision_casos, pasa_a_eop)
SELECT p.id,
 'El ascensor no responde al llamado, se detiene fuera de nivel, abre o cierra mal, hace ruido o vibración anormal, marca falla en el controlador, o tiene el teléfono de cabina o la luz de emergencia sin funcionar.',
 'El técnico en la ronda de turno (SOP-MG-01), vigilancia, o cualquier persona que lo reporte por ticket.',
 '30 minutos para sacarlo de servicio y avisar al proveedor. Llegada del proveedor según el tiempo contractual del SCP-ASC-01. Una sede que se queda con un solo ascensor en servicio no pasa de 24 horas sin plan alterno escrito para el traslado de pacientes.',
 'Se saca de servicio, se rotula y se bloquea en el piso cuando la falla afecta puertas, nivelación, frenos, teléfono de cabina o luz de emergencia. El teléfono de cabina sin funcionar es ascensor fuera de servicio, sin excepción.',
 'Personas atrapadas: pasa a EOP-ASC-01 de inmediato.'
FROM procedimientos p WHERE p.codigo_corto='AOP-ASC-01';

INSERT INTO aop_umbrales (procedimiento_id, minutos_para_actuar, minutos_para_escalar, minutos_evento_persistente, eop_procedimiento_id)
SELECT p.id, 30, 240, 1440, (SELECT id FROM procedimientos WHERE codigo_corto='EOP-ASC-01')
FROM procedimientos p WHERE p.codigo_corto='AOP-ASC-01'
  AND NOT EXISTS (SELECT 1 FROM aop_umbrales a WHERE a.procedimiento_id=p.id);

INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 1, 'Verificar que no haya nadie dentro de la cabina antes de cualquier otra cosa.', 'Cabina vacía confirmada; si hay personas, es EOP-ASC-01.' FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=1);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 2, 'Probar el teléfono de cabina y la luz de emergencia.', 'Ambos responden; si no, el ascensor sale de servicio.' FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=2);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 3, 'Si la falla afecta puertas, nivelación, frenos o comunicación: sacarlo de servicio, dejarlo abierto en planta baja y rotular las puertas de cada piso.', 'Ascensor bloqueado y rotulado en todos los pisos.' FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=3);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 4, 'Avisar al proveedor por el número de 24 horas y abrir orden correctiva P1. Anotar hora de aviso y hora prometida.', 'Aviso con hora registrada y visita comprometida.' FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=4);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 5, 'Avisar a la supervisión de Enfermería y a Vigilancia qué ascensor queda fuera y por dónde se traslada a los pacientes.', 'Ruta alterna de traslado comunicada por escrito.' FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=5);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 6, 'Reponerlo solo con informe del proveedor y una prueba de recorrido completo con puertas y teléfono.', 'Prueba firmada; rótulos retirados con hora.' FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=6);

INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 0, 30, 'Proveedor de ascensores', 'Ascensor rotulado y fuera de servicio; aviso al proveedor con hora.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=0);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 1, 60, 'Supervisión de Enfermería y Vigilancia', 'Ruta alterna de traslado de pacientes comunicada.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=1);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 2, 240, 'Jefatura de Mantenimiento General', 'Proveedor no llegó en el tiempo contractual: se reclama el contrato por escrito.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=2);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 3, 1440, 'Gerencia de Operaciones', 'Sede con un solo ascensor en servicio por más de 24 horas: plan alterno escrito.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=3);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 4, 0, 'Jefatura de Mantenimiento General', 'Personas atrapadas: pasa a EOP-ASC-01.', 1 FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=4);

INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Criterio para sacarlo de servicio y prueba con la que se repone', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Proveedor de ascensores', 'Tiempo de respuesta contractual y número de 24 horas', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Proveedor de ascensores');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería', 'Ruta alterna de traslado de pacientes por sede', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Rotulación de fuera de servicio y bloqueo seguro', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');

INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Tiempo de respuesta contractual del proveedor', 'min', 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Tiempo de respuesta contractual del proveedor');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Número de emergencia del proveedor (24 horas)', NULL, 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Número de emergencia del proveedor (24 horas)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Ruta alterna de traslado de pacientes por sede', NULL, 'Enfermería', 3 FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Ruta alterna de traslado de pacientes por sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Horas máximas con un solo ascensor en servicio', 'h', 'Gerencia de Operaciones', 4 FROM procedimientos p
WHERE p.codigo_corto='AOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Horas máximas con un solo ascensor en servicio');

-- ═════════════════════════════════════════════════════════════════════════════
-- MOP-ASC-01 · Puesta fuera de servicio programada de un ascensor
-- ═════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'MOP-ASC-01', 'mop', 'ascensores',
 'Puesta fuera de servicio programada de un ascensor',
 'Sacar un ascensor de servicio para mantenimiento o reparación programada sin dejar un traslado de paciente sin ruta, sin nadie dentro de la cabina, y devolverlo con prueba de recorrido firmada.',
 'Mantenimiento preventivo contratado, reparación programada y modernización. No aplica a atrapamientos (EOP-ASC-01) ni a fallas imprevistas (AOP-ASC-01). Riesgo alto: afecta el traslado de pacientes y expone a caída.',
 'SCP-ASC-01 · ASME A17.1 / CSA B44 · OSHA 1910.147, bloqueo y etiquetado · Contrato de mantenimiento vigente.',
 'Plantilla de orden con prerrequisitos y lecturas de liberación; permiso de trabajo; informe del proveedor; prueba de recorrido firmada por Mantenimiento General.',
 'alto', '0.9', 'borrador', 4, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;

INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Ventana autorizada, bloqueo y etiquetado, y prueba de recorrido', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Proveedor de ascensores', 'Alcance del trabajo, duración y personal certificado', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Proveedor de ascensores');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería', 'Ventana que no choca con traslados programados y ruta alterna', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Permiso de trabajo, bloqueo y etiquetado, y trabajo en foso', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Servicios Generales', 'Rotulación en cada piso y desvío de circulación', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Servicios Generales');

INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Ventana autorizada (día y horas)', NULL, 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Ventana autorizada (día y horas)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo que autoriza la ventana', NULL, 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo que autoriza la ventana');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Ruta alterna de traslado durante la ventana', NULL, 'Enfermería', 3 FROM procedimientos p
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Ruta alterna de traslado durante la ventana');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo que firma la prueba de recorrido', NULL, 'Mantenimiento General', 4 FROM procedimientos p
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo que firma la prueba de recorrido');

-- Plantilla de orden del MOP-ASC-01: los prerrequisitos bloquean iniciar y las
-- lecturas de liberación bloquean cerrar (regla dura del capítulo 06).
INSERT INTO checklist_plantillas (nombre, descripcion, activa, tipo_documento, procedimiento_id, procedimiento_version, nivel_riesgo, plan_reversa)
SELECT 'MOP-ASC-01 · Ascensor fuera de servicio programado',
 'Pasos, prerrequisitos y lecturas de liberación del MOP-ASC-01.', 1, 'mop', p.id, p.version, 'alto',
 'Si el trabajo no termina en la ventana: dejar el ascensor bloqueado y rotulado en planta baja, no devolverlo al servicio, extender la ruta alterna de traslado y avisar a la supervisión de Enfermería.'
FROM procedimientos p WHERE p.codigo_corto='MOP-ASC-01'
  AND NOT EXISTS (SELECT 1 FROM checklist_plantillas t WHERE t.procedimiento_id=p.id);

INSERT INTO plantilla_prerrequisitos (plantilla_id, texto, tipo, obligatorio, cargo_responsable, orden)
SELECT t.id, 'Ventana autorizada por la jefatura de Mantenimiento General.', 'ventana', 1, 'Jefatura de Mantenimiento General', 0
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM plantilla_prerrequisitos x WHERE x.plantilla_id=t.id AND x.orden=0);
INSERT INTO plantilla_prerrequisitos (plantilla_id, texto, tipo, obligatorio, cargo_responsable, orden)
SELECT t.id, 'Permiso de trabajo emitido, con trabajo en foso y en altura si aplica.', 'permiso_trabajo', 1, 'Seguridad y Salud Ocupacional', 1
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM plantilla_prerrequisitos x WHERE x.plantilla_id=t.id AND x.orden=1);
INSERT INTO plantilla_prerrequisitos (plantilla_id, texto, tipo, obligatorio, cargo_responsable, orden)
SELECT t.id, 'Ruta alterna de traslado de pacientes confirmada con la supervisión de Enfermería.', 'notificacion', 1, 'Supervisión de Enfermería', 2
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM plantilla_prerrequisitos x WHERE x.plantilla_id=t.id AND x.orden=2);
INSERT INTO plantilla_prerrequisitos (plantilla_id, texto, tipo, obligatorio, cargo_responsable, orden)
SELECT t.id, 'Cabina verificada vacía y puertas de cada piso rotuladas como fuera de servicio.', 'otro', 1, 'Técnico de turno', 3
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM plantilla_prerrequisitos x WHERE x.plantilla_id=t.id AND x.orden=3);
INSERT INTO plantilla_prerrequisitos (plantilla_id, texto, tipo, obligatorio, cargo_responsable, orden)
SELECT t.id, 'Bloqueo y etiquetado del interruptor del ascensor, con candado y número registrado.', 'loto', 1, 'Técnico de turno', 4
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM plantilla_prerrequisitos x WHERE x.plantilla_id=t.id AND x.orden=4);
INSERT INTO plantilla_prerrequisitos (plantilla_id, texto, tipo, obligatorio, cargo_responsable, orden)
SELECT t.id, 'Personal certificado del proveedor en sitio, con su equipo de protección.', 'otro', 1, 'Proveedor de ascensores', 5
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM plantilla_prerrequisitos x WHERE x.plantilla_id=t.id AND x.orden=5);

INSERT INTO plantilla_liberaciones (plantilla_id, etiqueta, unidad, valor_esperado, obligatoria, orden)
SELECT t.id, 'Recorrido completo a todas las paradas, subiendo y bajando', NULL, 'Sin detenciones ni fallas', 1, 0
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM plantilla_liberaciones x WHERE x.plantilla_id=t.id AND x.orden=0);
INSERT INTO plantilla_liberaciones (plantilla_id, etiqueta, unidad, valor_esperado, min_aceptable, max_aceptable, obligatoria, orden)
SELECT t.id, 'Nivelación de la cabina en cada parada', 'mm', 'Dentro de tolerancia del fabricante', -13, 13, 1, 1
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM plantilla_liberaciones x WHERE x.plantilla_id=t.id AND x.orden=1);
INSERT INTO plantilla_liberaciones (plantilla_id, etiqueta, unidad, valor_esperado, obligatoria, orden)
SELECT t.id, 'Apertura, cierre y reapertura por obstrucción de puertas', NULL, 'Correcto en todas las paradas', 1, 2
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM plantilla_liberaciones x WHERE x.plantilla_id=t.id AND x.orden=2);
INSERT INTO plantilla_liberaciones (plantilla_id, etiqueta, unidad, valor_esperado, obligatoria, orden)
SELECT t.id, 'Teléfono de cabina probado y contestado', NULL, 'Timbra y contestan donde dice el SCP-ASC-01', 1, 3
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM plantilla_liberaciones x WHERE x.plantilla_id=t.id AND x.orden=3);
INSERT INTO plantilla_liberaciones (plantilla_id, etiqueta, unidad, valor_esperado, obligatoria, orden)
SELECT t.id, 'Luz de emergencia de cabina', NULL, 'Enciende al cortar la alimentación', 1, 4
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM plantilla_liberaciones x WHERE x.plantilla_id=t.id AND x.orden=4);
INSERT INTO plantilla_liberaciones (plantilla_id, etiqueta, unidad, valor_esperado, obligatoria, orden)
SELECT t.id, 'Candados de bloqueo retirados y rótulos de fuera de servicio recogidos', NULL, 'Todos, con hora registrada', 1, 5
FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id
WHERE p.codigo_corto='MOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM plantilla_liberaciones x WHERE x.plantilla_id=t.id AND x.orden=5);

-- ═════════════════════════════════════════════════════════════════════════════
-- El juego por familia tiene que verlos: una fila por documento en la familia.
-- ═════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO procedimiento_sistemas (procedimiento_id, sistema)
SELECT id, sistema FROM procedimientos
WHERE codigo_corto IN ('AOP-INC-01','EOP-INC-01','SCP-ASC-01','AOP-ASC-01','MOP-ASC-01')
  AND sistema IS NOT NULL;
