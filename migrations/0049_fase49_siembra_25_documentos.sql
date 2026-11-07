-- Fase 49: siembra de los 25 documentos modelo de GO-GUI-011-2026.
-- Contenido real del volumen: las tres primeras acciones de cada EOP, los
-- umbrales y tiempos de cada AOP, las areas validadoras y los campos en azul.
-- Entran como 'borrador': ninguno esta validado todavia (cap. 08).
-- El responsable queda en el primer admin; se reasigna por documento desde la UI.
-- Idempotente: INSERT OR IGNORE sobre codigo_corto UNIQUE.

-- ── SCP-ELE-01 · Sistema eléctrico esencial: configuración normal
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'SCP-ELE-01', 'scp', 'electrico', 'Sistema eléctrico esencial: configuración normal', 'Fijar la configuración normal del sistema eléctrico esencial y los valores contra los que se verifican la ronda diaria (SOP-MG-01), la inspección semanal (SOP-MG-02), la prueba mensual (MOP-ELE-01) y la respuesta a la transferencia fallida (EOP-ELE-01).', 'Todas las fuentes y rutas de energía que alimentan quirófanos, UCI, Emergencia, Botiquín, Laboratorio, Imágenes, gases medicinales, bombas de agua, ascensores, sistemas de incendio y tecnología. Excluye el equipo médico conectado, que documenta Mantenimiento Biomédico. Dueño: Jefatura de Mantenimiento General; suplente: electricista líder. Revisión anual y antes de cualquier cambio de carga, equipo o ajuste.', 'NFPA 99 (2012) capítulo 6, sistema eléctrico esencial · NFPA 110 (2010) capítulos 6 y 8 · NFPA 101, 7.9.1.3 · JCI FMS.08.00 y FMS.08.01 · Programa de pruebas de planta C-106, University of Iowa Hospitals and Clinics.', 'Activo padre «Sistema eléctrico esencial» con hijos: acometida, transformador, tablero general, cada planta, cada transferencia, cada UPS. Diagrama unifilar as-built con fecha y versión adjunto al activo; plano de ubicación de plantas, tanques y transferencias; esquema de ramas del sistema esencial por tablero; lista de circuitos críticos por tablero con el servicio clínico que alimenta cada uno; manuales del fabricante de cada planta y transferencia en dos juegos, uno en el cuarto de máquinas y otro en la oficina de Mantenimiento.', NULL, '0.9', 'borrador', 1, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Unifilar as-built, placas, ajustes reales de cada transferencia, combustible y autonomía', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Tecnología y Transformación Digital', 'UPS y cargas de datos', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Tecnología y Transformación Digital');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Compras y Finanzas', 'Acuerdo de reabastecimiento de combustible', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Compras y Finanzas');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Calidad', 'Norma adoptada declarada en el programa FMS.08.00', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Calidad');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo del suplente (electricista líder)', NULL, 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo del suplente (electricista líder)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Capacidad contratada de la acometida', 'kVA', 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Capacidad contratada de la acometida');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Tensión de la acometida', 'V', 'Mantenimiento General', 3 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Tensión de la acometida');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Número de acometidas de la distribuidora (AES)', NULL, 'Mantenimiento General', 4 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Número de acometidas de la distribuidora (AES)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Carga máxima registrada en los últimos 12 meses', 'kW', 'Mantenimiento General', 5 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Carga máxima registrada en los últimos 12 meses');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Fecha de la carga máxima registrada', 'fecha', 'Mantenimiento General', 6 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Fecha de la carga máxima registrada');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Potencia del transformador', 'kVA', 'Mantenimiento General', 7 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Potencia del transformador');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Relación de transformación', NULL, 'Mantenimiento General', 8 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Relación de transformación');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Año del transformador y tipo (aceite o seco)', 'año', 'Mantenimiento General', 9 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Año del transformador y tipo (aceite o seco)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Potencia nominal en standby de la planta de emergencia', 'kW', 'Mantenimiento General', 10 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Potencia nominal en standby de la planta de emergencia');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Valor del 30 % de placa de la planta', 'kW', 'Mantenimiento General', 11 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Valor del 30 % de placa de la planta');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Marca, modelo, tipo de combustible y año de la planta', NULL, 'Mantenimiento General', 12 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Marca, modelo, tipo de combustible y año de la planta');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Capacidad del tanque principal de combustible', 'L', 'Mantenimiento General', 13 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Capacidad del tanque principal de combustible');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Capacidad del tanque diario de combustible', 'L', 'Mantenimiento General', 14 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Capacidad del tanque diario de combustible');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Consumo de combustible a 75 % de carga', 'L/h', 'Mantenimiento General', 15 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Consumo de combustible a 75 % de carga');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Autonomía de combustible a plena carga', 'h', 'Mantenimiento General', 16 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Autonomía de combustible a plena carga');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Tipo de baterías de arranque', NULL, 'Mantenimiento General', 17 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Tipo de baterías de arranque');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Tensión de las baterías de arranque', 'V', 'Mantenimiento General', 18 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Tensión de las baterías de arranque');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Fecha de instalación de las baterías y cargador flotante', 'fecha', 'Mantenimiento General', 19 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Fecha de instalación de las baterías y cargador flotante');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Potencia del UPS', 'kVA', 'Tecnología y Transformación Digital', 20 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Potencia del UPS');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Autonomía del UPS a plena carga', 'min', 'Tecnología y Transformación Digital', 21 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Autonomía del UPS a plena carga');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Equipos alimentados por el UPS', NULL, 'Tecnología y Transformación Digital', 22 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Equipos alimentados por el UPS');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Transferencias de la sede (ATS-1 a ATS-n): identificación, cargas que alimenta, ajustes vigentes de cada retardo y posición normal del selector', NULL, 'Mantenimiento General', 23 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Transferencias de la sede (ATS-1 a ATS-n): identificación, cargas que alimenta, ajustes vigentes de cada retardo y posición normal del selector');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Diagrama unifilar as-built', 'adjunto', 'Mantenimiento General', 24 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Diagrama unifilar as-built');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Tabla de circuitos, ramas y posición normal de interruptores por tablero', 'adjunta', 'Mantenimiento General', 25 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Tabla de circuitos, ramas y posición normal de interruptores por tablero');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Color único de los tomacorrientes conectados a emergencia', NULL, 'Mantenimiento General', 26 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Color único de los tomacorrientes conectados a emergencia');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Ubicación del anunciador remoto en punto atendido 24 horas', NULL, 'Mantenimiento General', 27 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Ubicación del anunciador remoto en punto atendido 24 horas');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Proveedor del acuerdo de reabastecimiento de combustible', NULL, 'Finanzas y Compras', 28 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Proveedor del acuerdo de reabastecimiento de combustible');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Tiempo de entrega comprometido por el proveedor de combustible', 'h', 'Finanzas y Compras', 29 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Tiempo de entrega comprometido por el proveedor de combustible');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Horas disponibles con el tanque lleno a 75 % de carga (cálculo de las 96 horas)', 'h', 'Mantenimiento General', 30 FROM procedimientos p
WHERE p.codigo_corto='SCP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Horas disponibles con el tanque lleno a 75 % de carga (cálculo de las 96 horas)');

-- ── SCP-HVAC-01 · Climatización de áreas críticas: puntos de ajuste y configur
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'SCP-HVAC-01', 'scp', 'hvac', 'Climatización de áreas críticas: puntos de ajuste y configuración', 'Fijar, sala por sala, la relación de presión, las renovaciones de aire, la temperatura, la humedad relativa y el filtro final que el sistema debe mantener, y la configuración de cada manejadora que los produce.', 'Toda sala cuyo ambiente condiciona la seguridad del paciente o la calidad de un producto estéril: quirófanos, cuartos de aislamiento, ambiente protegido, central de esterilización, Emergencia, Botiquín, UCI e Imágenes. Excluye las oficinas y las salas de espera generales. Dueño: Jefatura de Mantenimiento General con el técnico de climatización; Control de Infecciones aprueba los rangos; Mantenimiento Biomédico aporta los requisitos de los equipos instalados.', 'ASHRAE 170-2021 tabla 7-1 · SHTM 03-01 Parte B (2022) · NSW Health, guía de temperatura y humedad (2024) · ACORN · CDC/HICPAC 2007 · JCI FMS.08.04 · Política C-013 de University of Iowa Hospitals and Clinics.', 'Un activo por manejadora con la lista de salas servidas; un atributo por parámetro con valor normal, mínimo y máximo; los sensores de temperatura y humedad adquiridos registrados como componentes con fecha de calibración. La tabla de manejadoras es donde quedan documentados de forma permanente el estudio de climatización y los registros de sensores que pide la certificación del bloque quirúrgico.', NULL, '0.9', 'borrador', 1, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Inventario de manejadoras, caudales, filtros y sensores adquiridos con su calibración', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Control de Infecciones', 'Rangos de operación y banda de alerta', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Control de Infecciones');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Jefatura de Quirófanos', 'Salas servidas y horarios', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Jefatura de Quirófanos');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Central de Esterilización', 'Salas servidas y horarios', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Central de Esterilización');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento Biomédico', 'Requisitos de los equipos de imagen y esterilizadores instalados', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento Biomédico');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Calidad', 'Vínculo con la certificación del bloque quirúrgico', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Calidad');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo del técnico de climatización', NULL, 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo del técnico de climatización');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Identificación de cada manejadora (UMA)', NULL, 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Identificación de cada manejadora (UMA)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Salas servidas por cada manejadora', NULL, 'Jefatura de Quirófanos y Central de Esterilización', 3 FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Salas servidas por cada manejadora');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Caudal de diseño de cada manejadora', 'm³/h', 'Mantenimiento General', 4 FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Caudal de diseño de cada manejadora');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Filtros por manejadora: prefiltro, secundario y final (MERV 8, MERV 14, MERV 16 o HEPA)', 'MERV/HEPA', 'Mantenimiento General', 5 FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Filtros por manejadora: prefiltro, secundario y final (MERV 8, MERV 14, MERV 16 o HEPA)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Presión diferencial de cambio de filtro, según fabricante', 'Pa', 'Mantenimiento General', 6 FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Presión diferencial de cambio de filtro, según fabricante');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sensores de temperatura, humedad relativa y presión diferencial: ubicación y fecha de calibración', NULL, 'Mantenimiento General', 7 FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sensores de temperatura, humedad relativa y presión diferencial: ubicación y fecha de calibración');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Valor de diseño de la sede por tipo de sala, que prevalece sobre el mínimo de ASHRAE 170', NULL, 'Control de Infecciones', 8 FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Valor de diseño de la sede por tipo de sala, que prevalece sobre el mínimo de ASHRAE 170');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Banda de operación y de alerta de quirófano adoptada (rango NSW: 20 a 22 °C y 50 a 60 % de humedad)', '°C y % HR', 'Control de Infecciones', 9 FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Banda de operación y de alerta de quirófano adoptada (rango NSW: 20 a 22 °C y 50 a 60 % de humedad)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Configuración normal de cada manejadora: posición de compuertas de aire exterior, retorno y extracción; punto de ajuste de temperatura de suministro; presión estática de diseño; estado normal del humidificador y del serpentín; secuencia de arranque y de modo reducido fuera de horario', NULL, 'Mantenimiento General', 10 FROM procedimientos p
WHERE p.codigo_corto='SCP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Configuración normal de cada manejadora: posición de compuertas de aire exterior, retorno y extracción; punto de ajuste de temperatura de suministro; presión estática de diseño; estado normal del humidificador y del serpentín; secuencia de arranque y de modo reducido fuera de horario');

-- ── SCP-GAS-01 · Gases medicinales: fuentes, presiones, válvulas de zona y al
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'SCP-GAS-01', 'scp', 'gases', 'Gases medicinales: fuentes, presiones, válvulas de zona y alarmas', 'Documentar la configuración normal del sistema de gases medicinales: fuentes primaria y de reserva, presiones de operación, ubicación y rotulado de cada válvula de zona, paneles de alarma y roles responsables.', 'Desde el tanque criogénico o el banco de cilindros hasta cada toma, para oxígeno, aire medicinal, vacío y, si existen, óxido nitroso y aire para instrumentos. Excluye los equipos conectados a las tomas (ventiladores, máquinas de anestesia), que documenta Mantenimiento Biomédico. Dueño: Jefatura de Mantenimiento General; suplente: técnico de gases. La Regencia del Botiquín interviene en la calidad e identidad del gas; Enfermería designa al oficial que autoriza interrupciones.', 'NFPA 99 tabla 5.1.11 y 5.1.9 · HTM 02-01 Partes A y B (NHS) · Política CORP/FAC 3 v3 de Doncaster and Bassetlaw Teaching Hospitals · Quick Reference Handbook 4-1 de la Association of Anaesthetists · JCI FMS.08.00 y FMS.08.01 · Políticas C-005, C-207, C-208 y C-211 de University of Iowa Hospitals and Clinics.', 'Activo padre «Gases medicinales» con hijos: tanque criogénico, banco de reserva, central de aire, central de vacío, cada válvula de zona y cada panel de alarma. Diagrama de válvulas adjunto. Queda escrita la fecha de última verificación del rotulado con los números de sala vigentes y la equivalencia de roles adoptada (responsable formal, persona autorizada, personas competentes, control de calidad del gas y oficial designado).', NULL, '0.9', 'borrador', 1, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Fuentes, válvulas y alarmas; presiones de diseño', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Regencia del Botiquín', 'Requisitos SRS del gas, del tanque y del proveedor; calidad e identidad del gas', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Regencia del Botiquín');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Legal', 'Requisitos SRS del gas, del tanque y del proveedor', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Legal');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería', 'Oficial designado que autoriza interrupciones y censo de camas con oxígeno por zona', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento Biomédico', 'Equipos conectados a las tomas', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento Biomédico');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Proveedor del gas', 'Autonomía del tanque y de la reserva, y tiempo de reabastecimiento', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Proveedor del gas');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo del suplente (técnico de gases)', NULL, 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo del suplente (técnico de gases)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Presión de diseño de oxígeno', 'kPa', 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Presión de diseño de oxígeno');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Presión de diseño de aire medicinal', 'kPa', 'Mantenimiento General', 3 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Presión de diseño de aire medicinal');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Presión de diseño de óxido nitroso, si existe', 'kPa', 'Mantenimiento General', 4 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Presión de diseño de óxido nitroso, si existe');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Presión de diseño de aire para instrumentos quirúrgicos, si existe', 'kPa', 'Mantenimiento General', 5 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Presión de diseño de aire para instrumentos quirúrgicos, si existe');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Presión de diseño de vacío médico-quirúrgico', 'kPa o inHg', 'Mantenimiento General', 6 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Presión de diseño de vacío médico-quirúrgico');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Ajustes del secador y del monitor de punto de rocío y monóxido', NULL, 'Mantenimiento General', 7 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Ajustes del secador y del monitor de punto de rocío y monóxido');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Capacidad del tanque criogénico (VIE)', 'L', 'Proveedor del gas', 8 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Capacidad del tanque criogénico (VIE)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Consumo diario promedio de oxígeno', 'L/día', 'Proveedor del gas', 9 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Consumo diario promedio de oxígeno');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Días de autonomía al nivel de reorden', 'días', 'Proveedor del gas', 10 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Días de autonomía al nivel de reorden');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cilindros del banco de reserva de emergencia (cantidad por tamaño)', 'cilindros', 'Mantenimiento General', 11 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cilindros del banco de reserva de emergencia (cantidad por tamaño)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Horas de autonomía del banco de reserva al consumo promedio', 'h', 'Proveedor del gas', 12 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Horas de autonomía del banco de reserva al consumo promedio');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Tamaños de cilindro en uso en Avante y su contenido a 137 bar', 'L', 'Mantenimiento General', 13 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Tamaños de cilindro en uso en Avante y su contenido a 137 bar');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Marca, modelo y configuración duty/standby de las centrales de aire y vacío', NULL, 'Mantenimiento General', 14 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Marca, modelo y configuración duty/standby de las centrales de aire y vacío');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Lista de válvulas de zona: válvula, ubicación, salas servidas y camas con oxígeno', NULL, 'Enfermería', 15 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Lista de válvulas de zona: válvula, ubicación, salas servidas y camas con oxígeno');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Ubicación de los dos paneles de alarma maestra y condiciones cableadas', NULL, 'Mantenimiento General', 16 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Ubicación de los dos paneles de alarma maestra y condiciones cableadas');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Paneles de alarma de área, zonas que vigilan y umbrales de presión alta y baja', NULL, 'Mantenimiento General', 17 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Paneles de alarma de área, zonas que vigilan y umbrales de presión alta y baja');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Fecha de última verificación del rotulado de salas', 'fecha', 'Mantenimiento General', 18 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Fecha de última verificación del rotulado de salas');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Alcance del control de calidad e identidad del gas, por confirmar con SRS', NULL, 'Regencia del Botiquín y Legal', 19 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Alcance del control de calidad e identidad del gas, por confirmar con SRS');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Tiempo de reabastecimiento comprometido por el proveedor', 'h', 'Proveedor del gas', 20 FROM procedimientos p
WHERE p.codigo_corto='SCP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Tiempo de reabastecimiento comprometido por el proveedor');

-- ── SCP-AGU-01 · Agua potable y agua caliente: configuración y régimen de tem
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'SCP-AGU-01', 'scp', 'agua', 'Agua potable y agua caliente: configuración y régimen de temperaturas', 'Documentar la configuración del sistema de agua y el régimen de temperaturas y purgas que controla el riesgo de Legionella y otras bacterias de agua, para que la ronda mensual (SOP-MG-03), la limpieza de cisterna (MOP-AGU-01), la pérdida de suministro (EOP-AGU-01) y la temperatura fuera de rango (AOP-AGU-01) tengan una referencia común.', 'Desde la acometida hasta cada salida: cisternas, bombeo, red fría, generación y recirculación de agua caliente y puntos centinela. El agua de hemodiálisis y los sistemas de ósmosis se documentan con Mantenimiento Biomédico y Enfermería bajo FMS.08.03; el vapor de esterilización, con la Central de Esterilización. Dueño: Jefatura de Mantenimiento General; suplente: fontanero líder. Control de Infecciones aprueba el programa de control de agua.', 'HSE (Reino Unido), guía técnica HSG274 Parte 2 y régimen de temperaturas · HTM 04-01 (NHS) · CDC, guía de recuperación de sistemas de agua · JCI FMS.08.01, FMS.08.02 y FMS.08.03 · Norma salvadoreña de agua potable, número y edición por confirmar · Política C-206 de University of Iowa Hospitals and Clinics.', 'Activo padre «Agua» con hijos: acometida, cada cisterna, cada bomba, cada calentador o calorifier, cada ramal de recirculación y cada punto centinela. Isométrico adjunto. Quedan escritas las verificaciones del régimen de temperaturas (mensual en centinelas, semestral en la entrada al tanque), las purgas semanales de salidas de poco uso, la limpieza trimestral de regaderas, la inspección anual de tanques y calorifiers y el cloro residual libre al menos trimestral.', NULL, '0.9', 'borrador', 1, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Inventario, puntos centinela y ajustes', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Control de Infecciones', 'Programa de control de agua y áreas de pacientes vulnerables', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Control de Infecciones');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento Biomédico', 'Ósmosis y hemodiálisis', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento Biomédico');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Laboratorio', 'Requisitos de agua', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Laboratorio');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Central de Esterilización', 'Requisitos de agua y vapor', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Central de Esterilización');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Legal', 'Norma de agua potable aplicable y valor de cloro residual', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Legal');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo del suplente (fontanero líder)', NULL, 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo del suplente (fontanero líder)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Número y edición de la norma salvadoreña de agua potable', NULL, 'Legal', 2 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Número y edición de la norma salvadoreña de agua potable');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cloro residual libre en punto de uso', 'mg/L', 'Legal y Control de Infecciones', 3 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cloro residual libre en punto de uso');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Proveedor de la acometida (ANDA u otro)', NULL, 'Mantenimiento General', 4 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Proveedor de la acometida (ANDA u otro)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Diámetro de la acometida', 'mm', 'Mantenimiento General', 5 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Diámetro de la acometida');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Presión normal de la acometida', 'bar', 'Mantenimiento General', 6 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Presión normal de la acometida');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Ubicación del medidor y de la válvula de corte general', NULL, 'Mantenimiento General', 7 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Ubicación del medidor y de la válvula de corte general');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Capacidad de cada cisterna', 'm³', 'Mantenimiento General', 8 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Capacidad de cada cisterna');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Nivel normal y nivel de alarma de cisternas', '%', 'Mantenimiento General', 9 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Nivel normal y nivel de alarma de cisternas');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Autonomía de cisternas al consumo promedio', 'h', 'Mantenimiento General', 10 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Autonomía de cisternas al consumo promedio');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Número de bombas y configuración duty/standby', NULL, 'Mantenimiento General', 11 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Número de bombas y configuración duty/standby');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Presión de arranque y de paro del bombeo', 'bar', 'Mantenimiento General', 12 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Presión de arranque y de paro del bombeo');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Alimentación del bombeo desde emergencia (transferencia)', NULL, 'Mantenimiento General', 13 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Alimentación del bombeo desde emergencia (transferencia)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Tipo de generación de agua caliente', NULL, 'Mantenimiento General', 14 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Tipo de generación de agua caliente');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Capacidad de acumulación de agua caliente', 'L', 'Mantenimiento General', 15 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Capacidad de acumulación de agua caliente');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Punto de ajuste del calentador o calorifier', '°C', 'Mantenimiento General', 16 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Punto de ajuste del calentador o calorifier');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Número de ramales de recirculación', NULL, 'Mantenimiento General', 17 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Número de ramales de recirculación');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Lista de puntos centinela con ubicación y código (la salida más cercana y la más lejana de cada ramal frío y caliente, más las de áreas de pacientes vulnerables)', NULL, 'Control de Infecciones', 18 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Lista de puntos centinela con ubicación y código (la salida más cercana y la más lejana de cada ramal frío y caliente, más las de áreas de pacientes vulnerables)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Inventario de salidas de poco uso para la purga semanal', NULL, 'Mantenimiento General', 19 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Inventario de salidas de poco uso para la purga semanal');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Referencia cruzada del agua de hemodiálisis y la ósmosis documentada por Mantenimiento Biomédico', NULL, 'Mantenimiento Biomédico', 20 FROM procedimientos p
WHERE p.codigo_corto='SCP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Referencia cruzada del agua de hemodiálisis y la ósmosis documentada por Mantenimiento Biomédico');

-- ── SCP-INC-01 · Protección contra incendios: configuración y calendario de p
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'SCP-INC-01', 'scp', 'incendios', 'Protección contra incendios: configuración y calendario de pruebas', 'Documentar la configuración normal de los sistemas de protección contra incendios y el calendario de inspección, prueba y mantenimiento que alimenta la ronda mensual (SOP-MG-05) y la prueba anual de la bomba (MOP-INC-01).', 'Todos los sistemas pasivos y activos de la sede: detección y alarma, rociadores e hidrantes, bomba contra incendios, extintores, iluminación de emergencia, puertas cortafuego y supresión de campana de Cocina. La respuesta a una alarma real y la evacuación pertenecen al plan de emergencias de Seguridad y Salud Ocupacional; este SCP documenta el sistema. Dueño: Jefatura de Mantenimiento General; Seguridad y Salud Ocupacional aprueba; el Cuerpo de Bomberos conserva la autoridad sobre lo que exige la ley.', 'NFPA 25 (2011), NFPA 72 (2010), NFPA 10 (2010), NFPA 80 (2010), NFPA 101 (2012), NFPA 17A (2009) y NFPA 96 (2011), según la matriz de códigos de la American Society for Health Care Engineering · JCI FMS.06.00 a FMS.06.04 · Decreto 254, texto vigente por confirmar · Requisitos del Cuerpo de Bomberos de El Salvador, por confirmar.', 'Activo padre «Protección contra incendios» con hijos por sistema; cada extintor y cada luminaria de emergencia como componente con su ubicación; el calendario de inspección, prueba y mantenimiento cargado como planes recurrentes (bomba eléctrica semanal, prueba de churn mensual, prueba de flujo anual, manómetros y válvulas de control mensuales, drenaje principal trimestral y anual, inspección interna de tubería y calibración de manómetros cada 5 años, panel y dispositivos de alarma anual, sensibilidad de detectores cada 2 años, interruptores de flujo y de supervisión semestrales, extintores mensual y anual, iluminación de emergencia mensual y anual, puertas cortafuego anual, supresión de campana mensual y limpieza de ductos semestral).', NULL, '0.9', 'borrador', 1, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Inventarios y presiones normales', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Decreto 254, plan de emergencias y simulacros', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Cocina', 'Campana y sistema de supresión', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Cocina');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Legal', 'Requisitos del Cuerpo de Bomberos y norma adoptada', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Legal');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Calidad', 'Requisitos del Cuerpo de Bomberos y norma adoptada', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Calidad');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Proveedor de mantenimiento del sistema de alarma', 'Fechas y alcance de contrato', 'pendiente', '2026-11-13' FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Proveedor de mantenimiento del sistema de alarma');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo del suplente', NULL, 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo del suplente');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Marca del panel de detección y alarma', NULL, 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Marca del panel de detección y alarma');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Zonas y dispositivos por zona del panel', 'zonas', 'Mantenimiento General', 3 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Zonas y dispositivos por zona del panel');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Fecha de las baterías de respaldo del panel', 'fecha', 'Proveedor de mantenimiento del sistema de alarma', 4 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Fecha de las baterías de respaldo del panel');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Conexión a monitoreo externo, si existe', NULL, 'Mantenimiento General', 5 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Conexión a monitoreo externo, si existe');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Presiones normales en manómetros de suministro y de sistema de rociadores e hidrantes', 'bar o psi', 'Mantenimiento General', 6 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Presiones normales en manómetros de suministro y de sistema de rociadores e hidrantes');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Ubicación de la válvula de drenaje principal y del punto de prueba de flujo', NULL, 'Mantenimiento General', 7 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Ubicación de la válvula de drenaje principal y del punto de prueba de flujo');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Existencia y tipo de bomba contra incendios (eléctrica o diésel)', NULL, 'Mantenimiento General', 8 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Existencia y tipo de bomba contra incendios (eléctrica o diésel)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Presión de arranque, de descarga y de churn de la bomba', 'bar o psi', 'Mantenimiento General', 9 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Presión de arranque, de descarga y de churn de la bomba');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Inventario de extintores: ubicación, tipo, capacidad, fecha de recarga y de prueba hidrostática', NULL, 'Mantenimiento General', 10 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Inventario de extintores: ubicación, tipo, capacidad, fecha de recarga y de prueba hidrostática');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Inventario de iluminación de emergencia y señalización de salidas por ruta de evacuación', NULL, 'Seguridad y Salud Ocupacional', 11 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Inventario de iluminación de emergencia y señalización de salidas por ruta de evacuación');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Autonomía de diseño de la iluminación de emergencia', 'min', 'Mantenimiento General', 12 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Autonomía de diseño de la iluminación de emergencia');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Inventario de puertas cortafuego con cierre automático, sellos y penetraciones selladas', NULL, 'Mantenimiento General', 13 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Inventario de puertas cortafuego con cierre automático, sellos y penetraciones selladas');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Datos del sistema de supresión de campana de Cocina: sistema, agente, fecha de última prueba e interfaz con el panel de alarma', NULL, 'Cocina', 14 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Datos del sistema de supresión de campana de Cocina: sistema, agente, fecha de última prueba e interfaz con el panel de alarma');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Texto vigente del Decreto 254', NULL, 'Legal y Seguridad y Salud Ocupacional', 15 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Texto vigente del Decreto 254');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Requisitos del Cuerpo de Bomberos de El Salvador', NULL, 'Legal y Calidad', 16 FROM procedimientos p
WHERE p.codigo_corto='SCP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Requisitos del Cuerpo de Bomberos de El Salvador');

-- ── SOP-MG-01 · Ronda de sistemas críticos por turno
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'SOP-MG-01', 'sop', 'otro', 'Ronda de sistemas críticos por turno', 'Confirmar al inicio de cada turno que todos los sistemas críticos están en su configuración normal según los cinco SCP, y abrir el AOP o el EOP correspondiente ante cualquier desviación.', 'Energía, gases medicinales, climatización de áreas críticas, agua, incendios, ascensores y cuartos técnicos de la sede. Frecuencia: al inicio de cada turno, los siete días de la semana, recorriendo las 11 líneas en el orden de la tabla. Responsable: técnico de turno de Mantenimiento General; suplente, el técnico del turno saliente; supervisa la jefatura de Mantenimiento General en el Gemba semanal. Requisitos previos: termómetro e higrómetro calibrados, manómetro de diferencial o tubo de humo, linterna, radio o teléfono, llave de cuartos técnicos y formato de ronda impreso como contingencia. En el sistema: plan recurrente «Ronda por turno» con lista de 11 líneas; cada línea exige la lectura y una línea fuera de rango abre la solicitud con el código del AOP.', 'SCP-ELE-01, SCP-HVAC-01, SCP-GAS-01, SCP-AGU-01 y SCP-INC-01; NFPA 110 (2010) 8.4.1; HTM 02-01 Parte B 5.22 y 5.25; SHTM 03-01 Parte B 3.85; CDC/HICPAC 2007; Política C-001 de University of Iowa Hospitals and Clinics.', 'Orden de ronda cerrada en el sistema de mantenimiento con las once lecturas; el formato impreso se archiva cuando el sistema no está disponible. Revisa la jefatura cada semana y Calidad audita una muestra trimestral.', NULL, '0.9', 'borrador', 2, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Orden del recorrido, duración y umbrales de reorden', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Talento Humano', 'Cobertura de turnos', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Talento Humano');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería', 'Acceso a áreas clínicas: aislamientos y quirófanos durante la ronda', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Calidad', 'Formato y muestra de auditoría', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Calidad');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Duración estimada de la ronda', 'minutos', 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Duración estimada de la ronda');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Nivel de reorden de combustible de la planta', 'L', 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Nivel de reorden de combustible de la planta');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Nivel de alarma de la cisterna', '%', 'Mantenimiento General', 3 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Nivel de alarma de la cisterna');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Frecuencia de prueba del teléfono o botón de emergencia de cabina', NULL, 'Mantenimiento General', 4 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Frecuencia de prueba del teléfono o botón de emergencia de cabina');

-- ── SOP-MG-02 · Inspección semanal de plantas de emergencia y transferencias
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'SOP-MG-02', 'sop', 'electrico', 'Inspección semanal de plantas de emergencia y transferencias automáticas', 'Cumplir la inspección semanal que exige NFPA 110 y dejar el registro que piden JCI FMS.08.01 y la Joint Commission, de modo que la planta arranque y tome carga cuando se necesite.', 'Cada planta diésel y cada transferencia automática de la sede. Frecuencia: semanal, el mismo día de la semana, sin arrancar la planta; se complementa con la prueba mensual con carga del MOP-ELE-01. Responsable: electricista de Mantenimiento General, con cargo suplente definido; supervisa la jefatura de Mantenimiento General. Requisitos previos: manual del fabricante disponible en el cuarto de máquinas, densímetro o voltímetro para baterías según el tipo y equipo de protección para trabajo cerca de partes energizadas. En el sistema: plan semanal por planta con lista de los siete grupos de NFPA 110 y una línea por transferencia, con lecturas y condiciones insatisfactorias.', 'SCP-ELE-01; NFPA 110 (2010) 8.3.5, 8.3.7.1 y 8.4.1; NFPA 99 (2012) 6.4.4.2; JCI FMS.08.01; Programa C-106 de University of Iowa Hospitals and Clinics.', 'Lista semanal con fecha, nombre del técnico, condiciones insatisfactorias, acción correctiva y repuestos. Los registros se conservan en sitio y a disposición del inspector; se recomienda al menos tres años. Punto de decisión: cualquier condición insatisfactoria abre una orden correctiva P1 y, si compromete el arranque (combustible, baterías, calentador), el AOP-ELE-01; la planta no se deja en manual.', NULL, '0.9', 'borrador', 2, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Valores del fabricante por planta y día fijo de inspección', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Proveedor de mantenimiento de plantas', 'Alcance de contrato y pruebas anuales de combustible', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Proveedor de mantenimiento de plantas');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Equipo de protección eléctrica', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Día fijo de la semana para la inspección', NULL, 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Día fijo de la semana para la inspección');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo suplente del electricista', NULL, 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo suplente del electricista');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Nivel de reorden de combustible', 'L', 'Mantenimiento General', 3 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Nivel de reorden de combustible');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Tensión de flotación del cargador de baterías según fabricante', 'V', 'Mantenimiento General', 4 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Tensión de flotación del cargador de baterías según fabricante');

-- ── SOP-MG-03 · Control mensual de temperaturas de agua en puntos centinela 
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'SOP-MG-03', 'sop', 'agua', 'Control mensual de temperaturas de agua en puntos centinela y purga semanal', 'Mantener el régimen de temperaturas que controla Legionella y producir el registro mensual que exige el programa de control de agua y la calidad del agua potable de FMS.08.02.', 'Red de agua fría y caliente, cisternas, calentadores y salidas de poco uso de la sede. Frecuencias: lecturas mensuales en puntos centinela el mismo día del mes; purga semanal de salidas de poco uso; lectura semestral en la entrada de la cisterna (una en época fría y una en época cálida); limpieza trimestral de regaderas; inspección anual de tanques y calentadores. Responsable: fontanero de Mantenimiento General, con cargo suplente definido; Control de Infecciones recibe el informe mensual. Requisitos previos: termómetro de sonda calibrado, cronómetro, lista de puntos centinela y de salidas de poco uso del SCP-AGU-01 y equipo de protección para purgas, evitando aerosoles. En el sistema: planes «Temperaturas centinela» (mensual, una línea por punto), «Purga de salidas de poco uso» (semanal), «Entrada de cisterna» (semestral) e «Inspección de tanques y calentadores» (anual).', 'SCP-AGU-01; HSE (Reino Unido), régimen de temperaturas y lista de controles; HTM 04-01 (NHS); JCI FMS.08.02; norma salvadoreña de agua potable por confirmar.', 'Hoja mensual por sede con cada punto, hora, lectura y firma; informe mensual a Control de Infecciones; los registros alimentan la evaluación anual de riesgos de FMS.02.00. Punto de decisión: una lectura fuera de rango se repite de inmediato y, si persiste, abre el AOP-AGU-01 con la acción que corresponde al punto; ante sospecha de contaminación del suministro, EOP-AGU-01.', NULL, '0.9', 'borrador', 2, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Lista de puntos centinela y día fijo', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-03' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Control de Infecciones', 'Áreas de pacientes vulnerables y programa de muestreo', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-03' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Control de Infecciones');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Laboratorio', 'Análisis microbiológicos si el programa los exige', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-03' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Laboratorio');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Legal', 'Norma de agua potable aplicable', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-03' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Legal');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-03' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Día del mes para las lecturas en puntos centinela', NULL, 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-03' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Día del mes para las lecturas en puntos centinela');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo suplente del fontanero', NULL, 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-03' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo suplente del fontanero');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Fecha de calibración del termómetro de sonda', NULL, 'Mantenimiento General', 3 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-03' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Fecha de calibración del termómetro de sonda');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Norma salvadoreña de agua potable aplicable (por confirmar)', NULL, 'Legal', 4 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-03' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Norma salvadoreña de agua potable aplicable (por confirmar)');

-- ── SOP-MG-04 · Verificación diaria de ambiente en quirófanos y cuartos de a
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'SOP-MG-04', 'sop', 'hvac', 'Verificación diaria de ambiente en quirófanos y cuartos de aislamiento', 'Registrar cada día, antes del primer caso, que cada quirófano está dentro de la banda de operación del SCP-HVAC-01 y que cada cuarto de aislamiento ocupado mantiene presión negativa, con un registro que sirva a Control de Infecciones, a la certificación del bloque quirúrgico y a FMS.08.04.', 'Temperatura, humedad relativa, presión diferencial y estado de la manejadora en cada sala crítica de la sede. Frecuencias: quirófanos, antes del primer caso y cada cuatro horas mientras haya programación, o en continuo si los sensores registran; cuartos de aislamiento, a diario mientras estén ocupados, además de cualquier monitor continuo instalado. Responsable: técnico de climatización de Mantenimiento General; suplente, el técnico de turno; la jefatura de Enfermería de Quirófano confirma la lectura en el libro de sala. Requisitos previos: termohigrómetro calibrado, manómetro de diferencial o, en su defecto, tubo de humo o cinta indicadora, y acceso coordinado con Quirófano y con Enfermería de la unidad de aislamiento. En el sistema: plan diario «Ambiente de salas críticas» con una línea por sala; los sensores conectados sustituyen la lectura manual y conservan el umbral del AOP.', 'SCP-HVAC-01; ASHRAE 170-2021 tabla 7-1; CDC/HICPAC, Guía de precauciones de aislamiento 2007, V.D.2.a; NSW Health 2024; JCI FMS.08.04; Política C-013 de University of Iowa Hospitals and Clinics.', 'Hoja diaria por sala; los registros de los sensores adquiridos se exportan cada mes; Control de Infecciones recibe el resumen mensual de horas fuera de rango (indicador 8 del volumen I). Punto de decisión: lectura fuera de la banda de operación abre AOP-HVAC-01 por temperatura o humedad y AOP-HVAC-02 por presión; manejadora detenida con cirugía en curso activa EOP-HVAC-01; ningún caso electivo inicia en una sala fuera de rango sin la decisión documentada del AOP.', NULL, '0.9', 'borrador', 2, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Control de Infecciones', 'Banda de alerta y método de verificación de presión', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-04' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Control de Infecciones');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Quirófanos', 'Hora de la lectura y firma de inicio de lista', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-04' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Quirófanos');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Instrumentos y sensores', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-04' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Calidad', 'Vínculo con la lista de certificación del bloque quirúrgico', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-04' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Calidad');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-04' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Intervalo de relectura en quirófanos con programación (propuesto: 4)', 'horas', 'Quirófanos', 1 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-04' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Intervalo de relectura en quirófanos con programación (propuesto: 4)');

-- ── SOP-MG-05 · Ronda mensual de protección contra incendios
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'SOP-MG-05', 'sop', 'incendios', 'Ronda mensual de protección contra incendios', 'Ejecutar las inspecciones mensuales que exigen NFPA 10, NFPA 25 y NFPA 101 y producir la evidencia de FMS.06.00 a FMS.06.02: equipos y sistemas inspeccionados, probados y mantenidos.', 'Extintores, manómetros y válvulas de rociadores, bomba contra incendios, iluminación de emergencia y puertas cortafuego de la sede, más la campana de Cocina y el panel de alarma. Frecuencia: mensual, la primera semana de cada mes en día fijo; las pruebas anuales y quinquenales se programan por separado desde el calendario del SCP-INC-01. Responsable: técnico de Mantenimiento General designado para incendios, con cargo suplente definido; Seguridad y Salud Ocupacional recibe el informe y acompaña una ronda al trimestre. Requisitos previos: inventario del SCP-INC-01 impreso o en dispositivo móvil, etiquetas de inspección, llave de gabinetes y cronómetro para iluminación de emergencia. En el sistema: plan mensual con una línea por extintor, manómetro, válvula de control, luminaria de emergencia y puerta cortafuego, y la prueba de churn de la bomba como línea propia.', 'SCP-INC-01; NFPA 10 (2010) 7.2.1.2; NFPA 25 (2011) 8.3.1, 13.2.7.1 y 13.3.2.1.1; NFPA 101 (2012) 7.9.3.3.3; NFPA 80 (2010) 5.2.1; NFPA 17A (2009) 7.2.1; NFPA 72 (2010) 14.4.5; JCI FMS.06.00 a FMS.06.02; Decreto 254.', 'Lista mensual con cada elemento y su estado; etiquetas firmadas; informe a Seguridad y Salud Ocupacional; evidencia para el programa contra incendios de FMS.06.00. Punto de decisión: un extintor fuera de servicio se reemplaza de inmediato por uno de reserva; un sistema de rociadores, una bomba o el panel fuera de servicio activa el procedimiento de deterioro del SCP-INC-01, con aviso a Seguridad y Salud Ocupacional, etiqueta en el sistema y vigilancia contra incendios hasta restablecer.', NULL, '0.9', 'borrador', 2, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Decreto 254, plan de emergencias y vigilancia contra incendios; procedimiento de deterioro', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-05' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Inventarios y presiones, elementos de inspección', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-05' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Cocina', 'Campana y su sistema de supresión', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-05' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Cocina');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Proveedor del sistema de alarma y rociadores', 'Pruebas anuales y quinquenales por contrato', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-05' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Proveedor del sistema de alarma y rociadores');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-05' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Día fijo de la primera semana del mes para la ronda', NULL, 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-05' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Día fijo de la primera semana del mes para la ronda');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo suplente del técnico designado para incendios', NULL, 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-05' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo suplente del técnico designado para incendios');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Texto vigente del Decreto 254', NULL, 'Seguridad y Salud Ocupacional', 3 FROM procedimientos p
WHERE p.codigo_corto='SOP-MG-05' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Texto vigente del Decreto 254');

-- ── MOP-ELE-01 · Prueba mensual de planta de emergencia con transferencia de 
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'MOP-ELE-01', 'mop', 'electrico', 'Prueba mensual de planta de emergencia con transferencia de carga', 'Demostrar que, ante una pérdida de red, la planta arranca, la transferencia toma la carga y el sistema sostiene al menos treinta minutos bajo carga real, dejando el registro que exigen NFPA 110, NFPA 99 y JCI FMS.08.01.', 'Cada planta y cada transferencia automática de la sede, doce veces al año, con intervalos de no menos de 20 ni más de 40 días. Prerrequisitos: inspección semanal SOP-MG-02 sin condiciones abiertas; ventana pactada con 48 horas de aviso y sin procedimiento quirúrgico de alto riesgo en curso; combustible por encima del reorden; carga conectada de al menos el 30 % de la potencia de placa o banco de carga disponible; formato de registro impreso; comunicación de inicio enviada a los servicios con la hora exacta. Seguridad: nadie abre un tablero energizado, equipo de protección para proximidad a partes vivas, protección auditiva en el cuarto de la planta, extintor a mano.', 'SCP-ELE-01 · NFPA 110 (2010) 6.2, 8.4.2 a 8.4.6 y 8.4.9 · NFPA 99 (2012) 6.4.4.1 · Joint Commission EC.02.05.07 EP 5 y 6 · JCI FMS.08.01 · Programas C-105 a C-118 y políticas C-002 y C-004 de University of Iowa Hospitals and Clinics', 'Registro de liberación: identificación de la planta y potencia de placa; valor del 30 %; fecha y firma; transferencia desde la que se inició; tiempo de transferencia; tiempo de enfriamiento; horómetro inicial y final; presión de aceite, temperatura, escape y kW; condiciones insatisfactorias y acción. Las columnas de hora e iniciales se llenan durante la ejecución. Conservar al menos tres años, en sitio. Revisión anual y tras cualquier cambio de planta, transferencia o carga; cada 36 meses prueba de 4 horas.', 'alto', '0.9', 'borrador', 4, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Valores del fabricante y método de inicio por transferencia', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Jefatura de Quirófanos, UCI y Emergencia', 'Ventana de prueba y protocolo de confirmación por radio', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Jefatura de Quirófanos, UCI y Emergencia');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Tecnología', 'UPS y arranque de servidores', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Tecnología');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Equipo de protección', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Calidad', 'Formato como evidencia FMS.08.01', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Calidad');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, NULL, 0 FROM procedimientos p
WHERE p.codigo_corto='MOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Potencia de placa de la planta', 'kW', 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='MOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Potencia de placa de la planta');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Tolerancia de frecuencia', 'Hz ±', 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='MOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Tolerancia de frecuencia');

-- ── MOP-HVAC-01 · Cambio de filtros y mantenimiento de la manejadora de un qui
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'MOP-HVAC-01', 'mop', 'hvac', 'Cambio de filtros y mantenimiento de la manejadora de un quirófano, con ICRA', 'Sustituir filtros y dar mantenimiento a la manejadora de un quirófano sin introducir polvo ni perder la configuración de la sala, y devolver la sala con mediciones que demuestren que cumple el SCP-HVAC-01.', 'Manejadora, filtros de cada etapa y, cuando aplica, filtros HEPA terminales en el cielo de la sala. Se dispara por plan de mantenimiento, por presión diferencial de filtro por encima del valor de cambio del fabricante registrado en la ronda, o por hallazgo de la inspección trimestral. Prerrequisitos: ICRA firmada por Control de Infecciones con la clase de precaución (trabajo en cuarto de máquinas sin polvo, tipo A, clase III; trabajo sobre el cielo de la sala o con paro y arranque de ventiladores, tipo B, clase IV; remoción de componentes o trabajo que no termina en un turno, tipo C o D, clase V con antesala); permiso de trabajo; sala bloqueada en la programación quirúrgica con 48 horas de aviso; filtros del tipo y grado exactos del SCP-HVAC-01 verificados en sitio; manómetro de diferencial y termohigrómetro calibrados; balómetro o anemómetro para la liberación. Seguridad: bloqueo y etiquetado según OSHA 1910.147, respirador para filtros usados, guantes, plataforma segura para trabajo en altura; filtros usados embolsados en el punto de retiro.', 'SCP-HVAC-01 · ASHE ICRA 2.0 (2022) · SHTM 03-01 Parte B 4.21, 4.24, 4.34, 5.6 y 5.7 · OSHA 29 CFR 1910.147 · JCI FMS.08.04, FMS.10.00 y PCI.04.00 · Políticas C-313 y C-337 de University of Iowa Hospitals and Clinics', 'Registro de liberación: presiones diferenciales antes y después por etapa; lote de filtros; lecturas de renovaciones, presión, temperatura y humedad; clase de ICRA y firma de Control de Infecciones; firma de Quirófanos; hora de bloqueo y de desbloqueo de la sala. Las columnas de hora e iniciales se llenan durante la ejecución. Conservar al menos cinco años (SHTM 03-01 5.46). Revisión anual y tras cada uso con desviación; la inspección trimestral de la manejadora alimenta la fecha del próximo cambio.', 'alto', '0.9', 'borrador', 4, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Control de Infecciones', 'Clase de ICRA por tipo de trabajo y criterios de liberación', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Control de Infecciones');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Jefatura de Quirófanos', 'Ventana de bloqueo y programación quirúrgica', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Jefatura de Quirófanos');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Valores del fabricante e instrumentos', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Servicios Generales', 'Limpieza terminal', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Servicios Generales');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Bloqueo y etiquetado y trabajo en altura', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Contratista de climatización', 'Revalidación de la sala', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Contratista de climatización');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, NULL, 0 FROM procedimientos p
WHERE p.codigo_corto='MOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Presión diferencial de cambio del filtro', 'Pa', 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='MOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Presión diferencial de cambio del filtro');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Minutos de estabilización de la sala antes de medir', 'minutos', 'Control de Infecciones', 2 FROM procedimientos p
WHERE p.codigo_corto='MOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Minutos de estabilización de la sala antes de medir');

-- ── MOP-GAS-01 · Aislamiento programado de una zona de gases medicinales para
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'MOP-GAS-01', 'mop', 'gases', 'Aislamiento programado de una zona de gases medicinales para sustituir una válvula o una toma', 'Interrumpir de forma planificada el suministro de gas de una zona para una reparación, sin que ningún paciente pierda el gas, y devolver la zona solo cuando las pruebas de ingeniería y de identidad del gas sean satisfactorias.', 'Oxígeno, aire medicinal o vacío de una zona con pacientes; incluye el permiso, la transferencia a cilindros y las pruebas de retorno. Se dispara por orden de trabajo correctiva o preventiva sobre una válvula de zona, una toma o un tramo de tubería; nunca sin permiso, salvo la emergencia que regula el EOP-GAS-01. Prerrequisitos: permiso de trabajo de alto riesgo con esquema de aislamiento, equivalente al PW2 de HTM 02-01, emitido en el punto de trabajo inmediatamente antes de empezar; aviso con 48 horas a los servicios afectados; censo de pacientes dependientes del gas hecho por Enfermería el mismo día; un cilindro con regulador y flujómetro por paciente dependiente más uno de reserva por cada grupo definido, y unidades portátiles de succión para vacío; válvula de zona identificada en el SCP-GAS-01 y rotulada con las salas que controla; repuestos verificados en sitio. Seguridad: bloqueo y etiquetado de la válvula de zona, rótulos «peligro, no usar» en cada toma afectada, prohibición de aceite y grasa en contacto con oxígeno, soldadura fuerte con purga de gas inerte por técnico certificado, ventilación del área y sin fuentes de ignición.', 'SCP-GAS-01 · HTM 02-01 Parte B capítulos 4 y 6 (permisos PW1 y PW2, aviso de 48 horas, pruebas de retorno; párrafos 4.24, 6.16, 6.17, 6.20, 6.28, 6.55, 6.57, 6.79) · Política CORP/FAC 3 de Doncaster and Bassetlaw · Quick Reference Handbook 4-1 (contenido de cilindros) · NFPA 99 · JCI FMS.08.01 · Política C-004 de University of Iowa Hospitals and Clinics', 'Registro de liberación: permiso de cinco partes; censo de pacientes y hora de transferencia a cilindro y de retorno; resultados de las pruebas; lote del componente; lecturas de presión; firma de la Regencia. Las columnas de hora e iniciales se llenan durante la ejecución. Revisión anual y tras cada uso; el registro de permisos lo audita cada año un evaluador independiente y lo inspecciona la jefatura al menos dos veces al año.', 'alto', '0.9', 'borrador', 4, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Regencia del Botiquín y Legal', 'Papel de control de calidad del gas y requisitos SRS', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Regencia del Botiquín y Legal');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería y Terapia Respiratoria', 'Censo, transferencia a cilindros y reserva mínima de cilindros', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería y Terapia Respiratoria');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Norma de pruebas, certificación del soldador y repuestos', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Permiso de trabajo y bloqueo', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Proveedor del gas', 'Analizador y soporte en la prueba de identidad', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Proveedor del gas');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, NULL, 0 FROM procedimientos p
WHERE p.codigo_corto='MOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Alcance del control de calidad del gas por la Regencia del Botiquín (confirmar con SRS)', NULL, 'Regencia del Botiquín y Legal', 1 FROM procedimientos p
WHERE p.codigo_corto='MOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Alcance del control de calidad del gas por la Regencia del Botiquín (confirmar con SRS)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Pacientes dependientes por cada cilindro de reserva', 'pacientes', 'Enfermería y Terapia Respiratoria', 2 FROM procedimientos p
WHERE p.codigo_corto='MOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Pacientes dependientes por cada cilindro de reserva');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Fecha de calibración del analizador de oxígeno', 'fecha', 'Proveedor del gas', 3 FROM procedimientos p
WHERE p.codigo_corto='MOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Fecha de calibración del analizador de oxígeno');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Margen de reserva de cilindros sobre la ventana de trabajo', 'minutos', 'Enfermería y Terapia Respiratoria', 4 FROM procedimientos p
WHERE p.codigo_corto='MOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Margen de reserva de cilindros sobre la ventana de trabajo');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Presión y duración de la prueba de hermeticidad', 'presión · duración', 'Mantenimiento General', 5 FROM procedimientos p
WHERE p.codigo_corto='MOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Presión y duración de la prueba de hermeticidad');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Criterio de concentración de oxígeno en la toma', NULL, 'Regencia del Botiquín y Mantenimiento General', 6 FROM procedimientos p
WHERE p.codigo_corto='MOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Criterio de concentración de oxígeno en la toma');

-- ── MOP-AGU-01 · Limpieza y desinfección de cisterna y desinfección de la red
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'MOP-AGU-01', 'mop', 'agua', 'Limpieza y desinfección de cisterna y desinfección de la red', 'Limpiar y desinfectar la cisterna al menos una vez al año, o tras una contaminación, y desinfectar la red sin dejar sin agua a hemodiálisis, esterilización, quirófanos ni Cocina.', 'Cisterna o tanque de agua potable, bombeo y red de distribución hasta las salidas. Se dispara por plan anual, por inspección del SOP-MG-03 con sedimento o biopelícula, por resultado microbiológico fuera de norma, o en la recuperación tras el EOP-AGU-01. Prerrequisitos: ventana en el horario de menor ocupación (noche o fin de semana) pactada con 48 horas; reserva de agua asegurada con segunda cisterna llena o cisterna móvil contratada; permiso de espacio confinado con medición de atmósfera, vigía y plan de rescate según el Decreto 254 y su reglamento; bloqueo y etiquetado de las bombas; cloro y kit de medición de cloro libre; Hemodiálisis y Esterilización confirman que no programarán sesiones ni cargas durante la ventana. Seguridad: atmósfera medida antes de entrar y en continuo, ventilación forzada, arnés y línea de vida, vigía permanente, prohibición de entrar solo; manejo de hipoclorito con protección ocular y guantes; bloqueo de bombas según OSHA 1910.147.', 'SCP-AGU-01 · CDC, Healthcare water system repair and recovery · HSE (Reino Unido), inspección y limpieza anual de tanques · OSHA 1910.147 · Decreto 254 · Norma salvadoreña de agua potable · JCI FMS.08.01 y FMS.08.02 · Política C-206 de University of Iowa Hospitals and Clinics', 'Registro de liberación: permiso de espacio confinado; lecturas de atmósfera; dosis, tiempo de contacto y residuales medidos por punto; fotografías antes y después; lista de equipos restablecidos por área; resultados de laboratorio. Las columnas de hora e iniciales se llenan durante la ejecución. Revisión anual y tras cada evento de contaminación.', 'alto', '0.9', 'borrador', 4, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Permiso de espacio confinado y Decreto 254', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Control de Infecciones', 'Programa de muestreo y criterio de liberación', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Control de Infecciones');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento Biomédico y Enfermería de Hemodiálisis', 'Ósmosis y reinicio de equipos', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento Biomédico y Enfermería de Hemodiálisis');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Central de Esterilización, Laboratorio y Cocina', 'Equipos de agua y ventana de intervención', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Central de Esterilización, Laboratorio y Cocina');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Legal', 'Norma de agua potable aplicable', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Legal');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, NULL, 0 FROM procedimientos p
WHERE p.codigo_corto='MOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Reserva de agua: volumen y proveedor de cisterna móvil', 'm³', NULL, 1 FROM procedimientos p
WHERE p.codigo_corto='MOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Reserva de agua: volumen y proveedor de cisterna móvil');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Formato institucional del permiso de espacio confinado', NULL, 'Seguridad y Salud Ocupacional', 2 FROM procedimientos p
WHERE p.codigo_corto='MOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Formato institucional del permiso de espacio confinado');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Decreto 254, texto vigente', NULL, 'Legal', 3 FROM procedimientos p
WHERE p.codigo_corto='MOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Decreto 254, texto vigente');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Norma salvadoreña de agua potable (confirmar)', NULL, 'Legal', 4 FROM procedimientos p
WHERE p.codigo_corto='MOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Norma salvadoreña de agua potable (confirmar)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Margen de reserva sobre la duración prevista', 'horas', NULL, 5 FROM procedimientos p
WHERE p.codigo_corto='MOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Margen de reserva sobre la duración prevista');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Dosis y tiempo de contacto de la desinfección de cisterna', 'mg/L · horas', 'Control de Infecciones', 6 FROM procedimientos p
WHERE p.codigo_corto='MOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Dosis y tiempo de contacto de la desinfección de cisterna');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Plazo para el resultado de laboratorio', 'horas', 'Laboratorio', 7 FROM procedimientos p
WHERE p.codigo_corto='MOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Plazo para el resultado de laboratorio');

-- ── MOP-INC-01 · Prueba anual de flujo de la bomba contra incendios con el si
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'MOP-INC-01', 'mop', 'incendios', 'Prueba anual de flujo de la bomba contra incendios con el sistema en deterioro planificado', 'Demostrar cada año que la bomba entrega el caudal y la presión de diseño, con el sistema de rociadores fuera de servicio el menor tiempo posible y con vigilancia mientras dure el deterioro.', 'Bomba contra incendios, controlador, válvulas y cabezal de prueba; aplica también a la prueba anual de drenaje principal. Se dispara por el calendario anual del SCP-INC-01 (NFPA 25 8.3.3) y también tras una reparación mayor de la bomba o del controlador. Prerrequisitos: inspección semanal y prueba mensual de churn conformes; equipo de medición (medidor de flujo o boquillas con tubo pitot) calibrado; ruta de descarga del agua de prueba segura y autorizada; notificación del deterioro planificado con hora de inicio y fin estimada; etiqueta de deterioro para el controlador y las válvulas; personal de vigilancia asignado por zona durante toda la ventana. Seguridad: descarga a alta presión con zona acordonada, mangueras aseguradas, protección auditiva y ocular; en bombas diésel, ventilación del escape; nadie frente al cabezal de prueba.', 'SCP-INC-01 · NFPA 25 (2011) 8.3.1, 8.3.3 y 13.2.5 y capítulo 15 (deterioros) · NFPA 72 (2010) 14.4.5 · JCI FMS.06.00 a FMS.06.02 · Decreto 254', 'Registro de liberación: notificaciones de inicio y fin; lecturas de churn, puntos de flujo y drenaje principal; comparación con la curva del fabricante y con la del año anterior; firmas del contratista y del técnico; etiqueta de deterioro retirada. Las columnas de hora e iniciales se llenan durante la ejecución. Revisión anual y tras cualquier cambio en la bomba, el controlador o el suministro de agua.', 'alto', '0.9', 'borrador', 4, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Vigilancia contra incendios, Decreto 254 y criterio de aviso al Cuerpo de Bomberos', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General y contratista', 'Puntos de la curva, equipo de medición y ruta de descarga', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General y contratista');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Legal', 'Aseguradora y requisitos del Cuerpo de Bomberos', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Legal');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Calidad', 'Evidencia FMS.06.00', 'pendiente', '2026-12-04' FROM procedimientos p
WHERE p.codigo_corto='MOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Calidad');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, NULL, 0 FROM procedimientos p
WHERE p.codigo_corto='MOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Empresa de monitoreo de alarma a notificar (si existe)', NULL, 'Seguridad y Salud Ocupacional y Legal', 1 FROM procedimientos p
WHERE p.codigo_corto='MOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Empresa de monitoreo de alarma a notificar (si existe)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Aseguradora a notificar (si el contrato lo exige)', NULL, 'Legal', 2 FROM procedimientos p
WHERE p.codigo_corto='MOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Aseguradora a notificar (si el contrato lo exige)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Puntos de caudal de la prueba (confirmar en NFPA 25 8.3.3)', 'puntos de caudal', 'Mantenimiento General y contratista', 3 FROM procedimientos p
WHERE p.codigo_corto='MOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Puntos de caudal de la prueba (confirmar en NFPA 25 8.3.3)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Decreto 254, texto vigente', NULL, 'Legal', 4 FROM procedimientos p
WHERE p.codigo_corto='MOP-INC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Decreto 254, texto vigente');

-- ── EOP-ELE-01 · Pérdida de red con transferencia fallida
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'EOP-ELE-01', 'eop', 'electrico', 'Pérdida de red con transferencia fallida', 'Responder a la pérdida de energía normal cuando la planta no toma la carga en 10 segundos o cuando un área clínica queda sin energía: estabilizar pacientes y equipos antes de diagnosticar, operar planta y transferencia en manual y restablecer la configuración normal.', 'Pérdida de energía normal sin toma de carga por la planta en 10 segundos, o pérdida total de energía en un área clínica. Sede por definir.', 'SCP-ELE-01; Loma Linda University Health, plan de emergencias, sección 11.21 Utility Failure: Electrical (rev. 14/08/2020); NFPA 110; NFPA 99 6.4.4.1.1.2; HTM 02-01 Parte B 5.25; Joint Commission FAQ EC.02.05.07; JCI FMS.08.01 y FMS.09.00; políticas C-101 a C-104 de University of Iowa Hospitals and Clinics.', 'Orden de emergencia con hora de alarma, de llegada, de energía de emergencia y de restablecimiento; causa raíz en 72 horas; informe al Comité de Seguridad; actualización del EOP si el ensayo lo exige. Una interrupción real documentada con los criterios de carga y duración puede sustituir la prueba mensual.', NULL, '0.9', 'borrador', 3, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Procedimiento manual de la planta y de la transferencia', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería', 'Acciones clínicas y prioridades de atención', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Dirección Médica', 'Prioridades y decisión de traslado de pacientes', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Dirección Médica');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Tecnología', 'Autonomía del UPS y apagado ordenado', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Tecnología');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Vigilancia', 'Ascensores y accesos', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Vigilancia');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Comité de Emergencias', 'Umbral de activación del plan de emergencias', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Comité de Emergencias');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, NULL, 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Extensión de la central telefónica o vigilancia para activar', 'extensión telefónica', 'Mantenimiento General con la central telefónica', 1 FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Extensión de la central telefónica o vigilancia para activar');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Minutos de falla para que dirija el Comité de Emergencias', 'minutos', 'Comité de Emergencias', 2 FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Minutos de falla para que dirija el Comité de Emergencias');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Autonomía del UPS', 'minutos', 'Tecnología', 3 FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Autonomía del UPS');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Minutos sin energía de emergencia para activar el plan de emergencias', 'minutos', 'Comité de Emergencias', 4 FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Minutos sin energía de emergencia para activar el plan de emergencias');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Plazo para el análisis de causa raíz', 'horas', NULL, 5 FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Plazo para el análisis de causa raíz');
INSERT OR IGNORE INTO eop_ficha
  (procedimiento_id, senal_activacion, activa_quien, dirige_quien, dirige_fuera_horario, accion_1, accion_2, accion_3, estabilizar, comunicar, decidir, restablecer, etiqueta_hora_mitigacion, minutos_escalar_gerencia, horas_causa_raiz)
SELECT p.id, 'Luces normales apagadas y, pasados 10 segundos, tomas de emergencia sin energía; alarma del anunciador remoto de la planta; aviso de un servicio clínico sin energía en tomas de emergencia.', 'El técnico de turno de Mantenimiento General o el primer colaborador que lo detecte, a través de la central telefónica o vigilancia (extensión por definir).', 'La jefatura de Mantenimiento General. Si la falla supera 30 minutos, dirige el Comité de Emergencias.', 'El técnico de turno, con la jefatura de Mantenimiento General por teléfono.', 'Ir al cuarto de máquinas y verificar si la planta arrancó. Si no arrancó, arrancarla en manual según el procedimiento del fabricante fijado en el SCP-ELE-01. Si no arranca, pasar al paso 3 y avisar al proveedor de la planta.', 'Si la planta corre y la transferencia no pasó la carga, operar la transferencia en manual con un segundo técnico, en el orden de tableros que fija el SCP-ELE-01. Confirmar tensión en la rama de seguridad de vida y en la rama crítica.', 'Avisar por radio o teléfono a Quirófanos, UCI y Emergencia el estado y el tiempo estimado; avisar a la jefatura de Mantenimiento General; pedir a vigilancia que revise los ascensores por atrapamientos.', 'Personal clínico de cada unidad: linternas y lámparas frontales, conteo de pacientes y personal, monitores, bombas y ventiladores en tomas de emergencia y reinicio si hace falta, confirmación de que los refrigeradores de cadena de frío están en emergencia, reporte de faltantes y fallas a su jefatura; en pérdida total, atención uno a uno a críticos, ventilación manual y preparación de posible evacuación. Todo el personal: no llama a la central por el apagón, solo por riesgo de vida, líneas caídas, humo o fuego; se mueve despacio con luz y se queda en su lugar si no es seguro; atrapado en ascensor usa el botón o el teléfono de emergencia. Mantenimiento General: verifica que la planta sostiene la carga (kW, temperatura, presión de aceite, combustible), monitorea temperatura y humedad de quirófanos, bombas de agua, alarmas de gases y ascensores, y registra la hora de cada acción. Tecnología: verifica UPS y servidores, apaga de forma ordenada lo no esencial antes de agotar la autonomía del UPS y activa el EOP-TI-01 si cae el sistema de información. Vigilancia: revisa atrapamientos en ascensores, restablece el acceso a áreas con control de acceso y asegura las entradas.', 'La central telefónica o vigilancia notifica en este orden a la jefatura de Mantenimiento General, la Gerencia de Operaciones, la supervisión de Enfermería, la Dirección Médica de turno y Tecnología. Mantenimiento General contacta a la distribuidora para causa, alcance y tiempo estimado de restablecimiento, y al proveedor de la planta si la falla es de la planta. La Gerencia de Operaciones informa a la Gerencia General cuando la interrupción supera 30 minutos.', 'Si no hay energía de emergencia en 10 minutos, o si la planta no sostiene la carga, el Comité de Emergencias activa el plan de emergencias. Prioridad de atención: UCI, quirófanos en curso (terminar casos con seguridad), Emergencia, cadena de frío del Botiquín y del Laboratorio, Tecnología. Se decide el traslado de pacientes dependientes de equipo y la suspensión de procedimientos electivos. Decide la Dirección Médica de turno con la Gerencia de Operaciones.', 'Con la red de vuelta, la transferencia retorna tras su retardo y la planta enfría al menos 5 minutos sin carga antes de parar. Mantenimiento General verifica la configuración normal del SCP-ELE-01, el contenido de los cilindros de gases frente al estado de las alarmas, la selección duty/standby de las centrales de aire y vacío, los ascensores y la temperatura y humedad de cada quirófano antes de autorizar nuevos casos. La central comunica el restablecimiento a todo el personal.', 'Energía de emergencia en servicio', 30, 72
FROM procedimientos p WHERE p.codigo_corto='EOP-ELE-01';
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 1, 'Ir al cuarto de máquinas y verificar si la planta arrancó; si no arrancó, arrancarla en manual según el procedimiento del fabricante fijado en el SCP-ELE-01', 'Planta en marcha. Si no arranca, pasar al paso 3 y avisar al proveedor de la planta' FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=1);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 2, 'Si la planta corre y la transferencia no pasó la carga, operar la transferencia en manual con un segundo técnico, en el orden de tableros del SCP-ELE-01', 'Tensión confirmada en la rama de seguridad de vida y en la rama crítica' FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=2);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 3, 'Avisar por radio o teléfono a Quirófanos, UCI y Emergencia el estado y el tiempo estimado; avisar a la jefatura de Mantenimiento General; pedir a vigilancia que revise los ascensores', 'Servicios críticos informados y ascensores revisados por atrapamientos, con paso al EOP-ASC-01 si hay personas atrapadas' FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=3);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 0, 0, 'Jefatura de Mantenimiento General', 'La central telefónica o vigilancia la notifica primero; asume la dirección de la emergencia', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=0);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 1, 0, 'Gerencia de Operaciones, supervisión de Enfermería, Dirección Médica de turno y Tecnología', 'La central continúa la cadena de aviso en ese orden', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=1);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 2, 0, 'Quirófanos, UCI y Emergencia', 'El técnico de turno avisa por radio o teléfono el estado y el tiempo estimado', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=2);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 3, 10, 'Comité de Emergencias', 'Si no hay energía de emergencia en 10 minutos o la planta no sostiene la carga, activa el plan de emergencias', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=3);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 4, 30, 'Gerencia General', 'La Gerencia de Operaciones informa cuando la interrupción supera 30 minutos; el Comité de Emergencias toma la dirección', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=4);

-- ── EOP-GAS-01 · Falla del suministro de oxígeno por tubería
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'EOP-GAS-01', 'eop', 'gases', 'Falla del suministro de oxígeno por tubería', 'Responder a la pérdida de presión de oxígeno por tubería en una zona o en todo el hospital: pasar a cilindro a cada paciente dependiente, aislar la sección fallada y reponer la reserva antes de volver a usar las tomas. Aplica con ajustes al aire medicinal y al vacío.', 'Pérdida de presión en una zona o en todo el hospital; aplica con ajustes al aire medicinal y al vacío. Sede por definir.', 'SCP-GAS-01; Association of Anaesthetists, Quick Reference Handbook 4-1 Mains oxygen failure v1 (2018); Doncaster and Bassetlaw Teaching Hospitals, CORP/FAC 3 v3; HTM 02-01 Parte B 6.19 y 6.57; JCI FMS.08.01; políticas C-201, C-207 y C-208 de University of Iowa Hospitals and Clinics.', 'Orden de emergencia con horas de alarma, de reserva en servicio, de reparación y de retorno; formulario de incidente crítico; causa raíz; reposición del banco de reserva al nivel del SCP-GAS-01; informe al Comité de Seguridad y a Regencia; actualización del EOP.', NULL, '0.9', 'borrador', 3, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Anestesia', 'Acciones clínicas de prolongación del cilindro y monitorización', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Anestesia');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Terapia Respiratoria', 'Acciones clínicas y paso a cilindro de pacientes dependientes', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Terapia Respiratoria');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería', 'Acciones clínicas y dotación de cilindros por unidad', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Regencia del Botiquín', 'Verificación de identidad del gas, contacto con el proveedor y requisitos SRS', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Regencia del Botiquín');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Almacén', 'Existencia mínima de cilindros por tamaño', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Almacén');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Autonomía de la reserva y procedimiento del tanque', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Dirección Médica', 'Criterio de traslado de pacientes', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Dirección Médica');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, NULL, 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Número de emergencia del proveedor de gas', 'número telefónico', 'Regencia del Botiquín', 1 FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Número de emergencia del proveedor de gas');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Horas de autonomía de la reserva para priorizar y decidir traslados', 'horas', 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Horas de autonomía de la reserva para priorizar y decidir traslados');
INSERT OR IGNORE INTO eop_ficha
  (procedimiento_id, senal_activacion, activa_quien, dirige_quien, dirige_fuera_horario, accion_1, accion_2, accion_3, estabilizar, comunicar, decidir, restablecer, etiqueta_hora_mitigacion, minutos_escalar_gerencia, horas_causa_raiz)
SELECT p.id, 'Alarma de área o maestra por baja presión de oxígeno; caída de flujo o alarma de FiO2 en ventiladores o máquinas de anestesia; aviso clínico de tomas sin flujo.', 'Quien detecta la falla, avisando a la central telefónica y a la enfermera de turno de la unidad.', 'La jefatura de Mantenimiento General como persona autorizada, con la supervisión de Enfermería; en quirófanos, la coordinación de quirófanos dirige la parte clínica.', NULL, 'Avisar al equipo y a la coordinación de la unidad; pedir ayuda, porque la falla puede ser amplia.', 'Pasar a cilindro a cada paciente que depende del oxígeno: ventiladores y máquinas de anestesia a su cilindro de respaldo, pacientes con cánula o mascarilla a cilindro con regulador y flujómetro. Verificar el contenido de cada cilindro y mantener siempre al menos uno de reserva a mano.', 'Desconectar los equipos de las tomas falladas y no reconectarlos hasta que Mantenimiento General y Regencia confirmen que es seguro.', 'Anestesia y Terapia Respiratoria: prolongan el cilindro con circuito circular, flujo de gas fresco y FiO2 lo más bajos que sean clínicamente seguros, vigilan alarmas de FiO2, ventilan a mano si el ventilador es neumático, mantienen la monitorización de oxígeno inspirado y de agente anestésico y consideran mover al paciente a un área con suministro intacto. Coordinación de quirófanos: detiene casos nuevos salvo prioridad clínica, averigua la extensión de la falla y la reserva disponible, organiza la entrega de más cilindros, mantiene informada a cada sala y considera recuperar al paciente en el quirófano. Enfermería de cada unidad: identifica pacientes en riesgo y los que no necesitan oxígeno suplementario y registra quién está en cilindro y desde qué hora. Almacén y transporte interno: monitorean y reemplazan cilindros en los puntos de emergencia y llevan el conteo por tamaño (cilindro lleno a 137 bar: E 680 L, F 1.360 L, G 3.400 L, J 6.800 L). Mantenimiento General: determina la causa (tanque, regulador, manifold, fuga, válvula cerrada), estima la autonomía de la reserva con el consumo actual y organiza la reparación bajo permiso.', 'La central telefónica avisa a la supervisión de Enfermería, a la jefatura de Mantenimiento General, a la Gerencia de Operaciones, a Regencia del Botiquín, a Almacén y a la Dirección Médica de turno. Regencia y Almacén contactan al proveedor para entregas de emergencia. Cada unidad reporta a la supervisión de Enfermería el número de pacientes en cilindro.', 'La jefatura de Mantenimiento General decide la provisión de gas a largo plazo (reserva, cilindros, reparación). Si la central falla y la autonomía de la reserva baja del umbral en horas, la Dirección Médica de turno prioriza UCI, quirófanos y Emergencia y decide traslados. Ninguna toma afectada vuelve a usarse sin la verificación de restablecimiento.', 'Tras la reparación bajo permiso: pruebas de presión y hermeticidad, purga, verificación de identidad y calidad del gas en las tomas afectadas por Regencia, porque al volver el suministro el gas puede no ser oxígeno al 100 % al principio, reapertura de la válvula de zona, reconexión paciente por paciente con verificación de flujo, alarmas sin señal y cilindros recogidos y repuestos.', 'Reserva en servicio', NULL, 72
FROM procedimientos p WHERE p.codigo_corto='EOP-GAS-01';
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 1, 'Unidad clínica: avisar al equipo y a la coordinación de la unidad y pedir ayuda', 'Equipo y coordinación avisados, asumiendo que la falla puede ser amplia' FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=1);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 2, 'Unidad clínica: pasar a cilindro a cada paciente dependiente de oxígeno, ventiladores y máquinas de anestesia a su cilindro de respaldo, cánula o mascarilla a cilindro con regulador y flujómetro', 'Contenido de cada cilindro verificado y al menos uno de reserva a mano' FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=2);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 3, 'Unidad clínica: desconectar los equipos de las tomas falladas', 'Ninguna reconexión hasta que Mantenimiento General y Regencia confirmen que es seguro' FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=3);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 4, 'Técnico de turno: leer la alarma maestra y verificar la fuente, nivel y válvulas del tanque criogénico, presión de línea y estado del banco de reserva', 'Si la reserva no entró sola, abrir los cilindros del banco y confirmar presión de línea' FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=4);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 5, 'Técnico de turno: si la falla es de una zona, cerrar la válvula de zona de la sección afectada', 'Resto del sistema protegido; el médico o la enfermera de la zona puede cerrarla antes de que llegue el técnico y debe informarlo de inmediato' FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=5);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 6, 'Técnico de turno: llamar al proveedor de gas al número de emergencia para reabastecimiento o asistencia técnica y avisar a la jefatura de Mantenimiento General', 'Proveedor y jefatura notificados, con entrega de emergencia en curso' FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=6);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 0, 0, 'Enfermera de turno de la unidad y central telefónica', 'Quien detecta la falla activa el EOP avisando a ambos', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=0);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 1, 0, 'Supervisión de Enfermería, jefatura de Mantenimiento General, Gerencia de Operaciones, Regencia del Botiquín, Almacén y Dirección Médica de turno', 'La central telefónica cumple la cadena de aviso completa', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=1);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 2, 0, 'Proveedor de gas, al número de emergencia', 'El técnico de turno pide reabastecimiento o asistencia técnica; Regencia y Almacén gestionan entregas de emergencia', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=2);

-- ── EOP-HVAC-01 · Falla de ventilación o climatización de un quirófano con cir
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'EOP-HVAC-01', 'eop', 'hvac', 'Falla de ventilación o climatización de un quirófano con cirugía en curso', 'Responder a la manejadora detenida, la pérdida de presión positiva o la temperatura y humedad fuera de rango durante un procedimiento: proteger al paciente y el campo estéril, decidir si se continúa o se cierra el caso y no liberar la sala sin medición y firma. Sin cirugía en curso aplica el AOP-HVAC-01.', 'Manejadora detenida, pérdida de presión positiva o temperatura y humedad fuera de rango durante un procedimiento. Sede por definir.', 'SCP-HVAC-01; NSW Health, SHPN (CEC) 240241 v1.0 (04/2024); UNC Medical Center, flujo de respuesta de temperatura, humedad, presión y renovaciones; SHTM 03-01 Parte B 4.34; JCI FMS.08.04; políticas C-307 y C-323 de University of Iowa Hospitals and Clinics.', 'Orden de emergencia con hora de alarma, de llegada, de parada y de liberación; horas de sala fuera de rango para el indicador 8; reporte en el sistema de incidentes cuando hubo condensación, moho o atención a un paciente en una sala fuera de rango; causa raíz; actualización del EOP.', NULL, '0.9', 'borrador', 3, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Jefatura de Quirófanos', 'Decisión clínica, criterio de liberación de la sala y acciones de la circulante', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Jefatura de Quirófanos');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Cirugía', 'Decisión clínica de continuar, cerrar o reprogramar', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Cirugía');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Anestesia', 'Decisión clínica y seguridad del paciente durante la falla', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Anestesia');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Control de Infecciones', 'Criterio de liberación, uso de unidades HEPA portátiles y material expuesto', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Control de Infecciones');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Central de Esterilización', 'Reprocesamiento del material expuesto a humedad', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Central de Esterilización');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Respaldo disponible y tiempos de reparación', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Calidad', 'Reporte de incidentes', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Calidad');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, NULL, 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Extensión 24 horas de Mantenimiento General', 'extensión telefónica', 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Extensión 24 horas de Mantenimiento General');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Intervalo de informes de estado hasta restablecer', 'minutos', 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Intervalo de informes de estado hasta restablecer');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Minutos de estabilización dentro del rango antes de liberar la sala', 'minutos', 'Control de Infecciones con la jefatura de Quirófanos', 3 FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Minutos de estabilización dentro del rango antes de liberar la sala');
INSERT OR IGNORE INTO eop_ficha
  (procedimiento_id, senal_activacion, activa_quien, dirige_quien, dirige_fuera_horario, accion_1, accion_2, accion_3, estabilizar, comunicar, decidir, restablecer, etiqueta_hora_mitigacion, minutos_escalar_gerencia, horas_causa_raiz)
SELECT p.id, 'Panel local de la manejadora en falla o apagado; alarma de presión o de temperatura y humedad; condensación visible en superficies; aviso del equipo quirúrgico. Sin cirugía en curso, aplica el AOP-HVAC-01.', 'La enfermera circulante, avisando al cirujano, al anestesiólogo y a la coordinación de quirófanos.', 'La parte clínica, el cirujano con el anestesiólogo; la parte técnica, el técnico de climatización con la jefatura de Mantenimiento General. Control de Infecciones decide la liberación de la sala.', NULL, 'Informar al cirujano y al anestesiólogo del tipo de falla y de la hora; mantener las puertas cerradas y reducir el tráfico al mínimo.', 'Llamar a Mantenimiento General a la extensión de 24 horas y a la coordinación de quirófanos; anotar la hora de la llamada.', 'Revisar que las rejillas de suministro y retorno no estén obstruidas y vigilar superficies y empaques estériles por condensación.', 'Pérdida de presión o de renovaciones con la unidad en marcha: confirmar puertas cerradas y rejillas libres, volver a medir a los 5 minutos, si persiste prueba de flujo en la puerta con tisú o humo, si persiste colocar dos unidades portátiles de filtración HEPA, una cerca del paciente y otra cerca de la puerta de salida, y avisar a Control de Infecciones. Temperatura o humedad fuera de rango con la unidad en marcha: ajustar el punto de control, volver a medir a los 30 minutos, confirmar que no hay condensación y que el paciente no está afectado; con humedad alta avisar a Control de Infecciones; con humedad por debajo del 30 % alertar a todo el equipo del mayor riesgo de fuego quirúrgico, dejar secar por completo las preparaciones alcohólicas antes de colocar campos y retirar compresas empapadas antes de usar electrocauterio. Unidad detenida sin reparación inmediata: el equipo quirúrgico decide, según la fase del procedimiento, cerrar con seguridad o terminar en el menor tiempo posible, no se abre material estéril que no sea indispensable, se protege el campo y se registra la hora de parada. Condensación visible: informar al cirujano del riesgo para el paciente y de la posible falla de equipos eléctricos; todo dispositivo médico reutilizable con humedad en o dentro del empaque se considera contaminado y se reprocesa; los insumos en riesgo se trasladan a un área no afectada.', 'La coordinación de quirófanos informa a la jefatura de Quirófanos, a Control de Infecciones, a la Central de Esterilización por el material expuesto y a la Gerencia de Operaciones. Mantenimiento General informa el estado cada 30 minutos hasta restablecer. Si la falla persiste más de 8 horas se escala a la Gerencia General, como fija la guía de NSW Health.', 'Decisión clínica: continuar, cerrar o reprogramar, la toman el cirujano y el anestesiólogo con la coordinación. Decisión de sala: ningún caso nuevo se programa en la sala afectada hasta que se restablezca y se mida; en salas vecinas decide la coordinación con Control de Infecciones. Decisión de liberación: Control de Infecciones con la jefatura de Quirófanos, después de la medición. Un sistema crítico que no cumple la verificación no vuelve a servicio, y el informe se entrega a la jefatura del servicio, a Control de Infecciones y a la jefatura de Mantenimiento General.', 'Reparación según el MOP que corresponda, MOP-HVAC-01 si se intervienen filtros o ventiladores; medición con puertas cerradas de renovaciones, presión, temperatura y humedad y estabilización de 30 minutos dentro del rango del SCP-HVAC-01; limpieza terminal; liberación firmada por Control de Infecciones y la jefatura de Quirófanos; desbloqueo de la sala en la programación.', 'Parada de la manejadora registrada', 480, 72
FROM procedimientos p WHERE p.codigo_corto='EOP-HVAC-01';
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 1, 'Enfermera circulante: informar al cirujano y al anestesiólogo del tipo de falla y de la hora', 'Equipo quirúrgico informado, puertas cerradas y tráfico reducido al mínimo' FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=1);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 2, 'Enfermera circulante: llamar a Mantenimiento General a la extensión de 24 horas y a la coordinación de quirófanos', 'Hora de la llamada anotada' FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=2);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 3, 'Enfermera circulante: revisar que las rejillas de suministro y retorno no estén obstruidas y vigilar superficies y empaques estériles', 'Rejillas libres y ausencia de condensación confirmadas' FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=3);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 4, 'Técnico de climatización: verificar la manejadora, disparo eléctrico, correa, ventilador, chiller o agua helada y alimentación de emergencia', 'Hora de llegada registrada y causa probable identificada' FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=4);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 5, 'Técnico de climatización: si existe respaldo, segunda unidad o cambio a enfriamiento de reserva, conmutarlo según el SCP-HVAC-01', 'Caudal confirmado en la sala' FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=5);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 6, 'Técnico de climatización: informar a la coordinación de quirófanos la causa probable y el tiempo estimado de reparación, o que no hay reparación inmediata', 'Coordinación con información suficiente para decidir cerrar o terminar el caso' FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=6);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 0, 0, 'Cirujano, anestesiólogo y coordinación de quirófanos', 'La enfermera circulante informa el tipo de falla y la hora', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=0);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 1, 0, 'Mantenimiento General, extensión de 24 horas', 'La circulante llama y anota la hora de la llamada', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=1);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 2, 0, 'Jefatura de Quirófanos, Control de Infecciones, Central de Esterilización y Gerencia de Operaciones', 'La coordinación de quirófanos informa el evento y el material expuesto', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=2);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 3, 30, 'Coordinación de quirófanos', 'Mantenimiento General informa el estado cada 30 minutos hasta restablecer', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=3);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 4, 120, 'Ingeniería o Mantenimiento General, según la guía de NSW Health', 'Escalamiento a ingeniería a las 2 horas de variación de temperatura o humedad', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=4);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 5, 480, 'Gerencia General, máxima autoridad', 'Si la falla persiste más de 8 horas se escala a la Gerencia General', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=5);

-- ── EOP-AGU-01 · Pérdida o contaminación del suministro de agua
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'EOP-AGU-01', 'eop', 'agua', 'Pérdida o contaminación del suministro de agua', 'Responder al corte del proveedor, la falla de bombeo o cisterna, el aviso de hervir el agua o un resultado microbiológico fuera de norma: activar la reserva, fijar reglas de uso por servicio y purgar y verificar el sistema antes de volver a la normalidad.', 'Corte del proveedor, falla de bombeo o cisterna, aviso de hervir el agua, agua turbia o resultado microbiológico fuera de norma. Sede por definir.', 'SCP-AGU-01; CDC, Healthcare Water System Repair and Recovery Following a Boil Water Alert or Disruption of Water Supply; JCI FMS.08.01 a FMS.08.03 y FMS.09.00; políticas C-206, C-320 y C-321 de University of Iowa Hospitals and Clinics.', 'Orden de emergencia con horas; registro de residuales por punto tras la purga; muestras y resultados; informe del equipo de gestión del agua; revisión del plan de gestión del agua; causa raíz si la falla fue interna; prueba anual de la fuente alterna documentada para FMS.08.01.', NULL, '0.9', 'borrador', 3, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Control de Infecciones', 'Reglas por uso del agua y avisos internos', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Control de Infecciones');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería de Hemodiálisis', 'Guía específica de diálisis y criterio de traslado de pacientes', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería de Hemodiálisis');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento Biomédico', 'Desinfección de membranas de ósmosis y lazos de hemodiálisis', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento Biomédico');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Central de Esterilización', 'Suspensión y reinicio del reprocesamiento', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Central de Esterilización');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Cocina', 'Agua embotellada o hervida, hielo y vajilla', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Cocina');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Almacén', 'Existencia de agua embotellada y hielo', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Almacén');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Laboratorio', 'Muestreo y resultados', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Laboratorio');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Compras', 'Contrato de cisterna móvil', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Compras');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Legal', 'Autoridad sanitaria y norma de agua', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Legal');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, NULL, 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Horas de restricción para reunir al equipo de gestión del agua', 'horas', 'Control de Infecciones con el equipo de gestión del agua', 1 FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Horas de restricción para reunir al equipo de gestión del agua');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Horas de autonomía de la cisterna para reducir consumos y trasladar pacientes', 'horas', 'Mantenimiento General con la Dirección Médica de turno', 2 FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Horas de autonomía de la cisterna para reducir consumos y trasladar pacientes');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Proveedor de cisterna móvil y tiempo de entrega', 'horas', 'Compras', 3 FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Proveedor de cisterna móvil y tiempo de entrega');
INSERT OR IGNORE INTO eop_ficha
  (procedimiento_id, senal_activacion, activa_quien, dirige_quien, dirige_fuera_horario, accion_1, accion_2, accion_3, estabilizar, comunicar, decidir, restablecer, etiqueta_hora_mitigacion, minutos_escalar_gerencia, horas_causa_raiz)
SELECT p.id, 'Caída de presión de red sin entrada a la cisterna; alarma de nivel bajo; aviso del proveedor de corte o de hervir el agua; agua con turbidez, color u olor; resultado de laboratorio fuera de norma; falla de bombas sin reserva.', 'El técnico de turno o quien reciba el aviso del proveedor, a través de la central telefónica.', 'La jefatura de Mantenimiento General con Control de Infecciones; el equipo de gestión del agua (Mantenimiento General, Control de Infecciones, Hemodiálisis, Esterilización, Laboratorio, Cocina, Botiquín y Enfermería) se reúne para fijar objetivos cuando la restricción supera 4 horas.', NULL, 'Verificar nivel de cisterna, estado del bombeo y acometida; calcular la autonomía con el consumo promedio del SCP-AGU-01. Si hay sospecha de contaminación, cerrar la entrada de la cisterna y mantener la reserva aislada.', 'Avisar a la jefatura de Mantenimiento General, a Control de Infecciones y a la supervisión de Enfermería; la central avisa a Hemodiálisis, Central de Esterilización, Laboratorio, Cocina y Botiquín.', 'Activar la reserva: cisterna alterna, cisterna móvil del proveedor contratado y agua embotellada desde Almacén.', 'Reglas por uso durante el evento. Beber y hielo: solo agua embotellada o hervida a ebullición más de 1 minuto, sin hielo de máquinas, avisos en bebederos y grifos e información a pacientes, familias, personal y visitantes. Lavado quirúrgico de manos y cirugía de emergencia: agua estéril embotellada. Reprocesamiento de dispositivos: el agua debe cumplir las normas de la AAMI; sin tratamiento adicional se suspende el reprocesamiento y se usa material de la otra sede o tratamiento en el punto de uso. Hemodiálisis: se sigue la guía específica, continuar solo con agua que cumpla, agua de cisterna móvil tratada o traslado de pacientes, con comunicación directa con el proveedor. Cuidado de heridas y baño: agua embotellada o hervida para lactantes, niños pequeños, inmunocomprometidos y pacientes con heridas; agua de grifo aceptable para pacientes sanos solo en avisos sin evidencia de contaminación. Ventiladores, incubadoras, CPAP y humidificadores: agua estéril o embotellada según el fabricante. Odontología: sin agua potencialmente contaminada por las líneas, solo unidades aisladas con reservorio o tratamiento aprobado. Cocina: agua embotellada o hervida para preparación, sin hielo y vajilla según el criterio de Control de Infecciones.', 'La Gerencia de Operaciones informa a la Gerencia General y a la Dirección Médica. Mantenimiento General mantiene contacto con el proveedor de agua para causa y tiempo estimado. Control de Infecciones emite los avisos internos. En un aviso prolongado con sospecha de contaminación microbiana se consulta a la autoridad sanitaria sobre tratamiento suplementario de corto plazo.', 'Si la autonomía de la cisterna baja del umbral en horas sin cisterna móvil confirmada: reducir consumos, suspender procedimientos electivos y trasladar a pacientes de hemodiálisis; decide la Dirección Médica de turno con la Gerencia de Operaciones. La restricción por uso la fija Control de Infecciones con el equipo de gestión del agua.', 'Levantado el aviso o restablecido el suministro: purgar todos los grifos y equipos más de 5 minutos hasta detectar el desinfectante residual y seguir hasta percibir cloro en el punto de uso; descartar el hielo y limpiar y sanitizar las máquinas; retirar los filtros de punto de uso, purgar y colocar filtros nuevos; regenerar ablandadores y cambiar filtros de pretratamiento; limpiar y desinfectar membranas de ósmosis y lazos de hemodiálisis con Mantenimiento Biomédico; drenar, desinfectar y rellenar tanques según el caso; revisar la calidad del vapor y el reinicio de esterilizadores según el fabricante; si se indica, desinfección del sistema de agua caliente con más de 2 mg/L de cloro libre durante más de 2 y menos de 24 horas. Control de Infecciones y Laboratorio refuerzan la vigilancia de infecciones asociadas al agua.', 'Reserva de agua en servicio (cisterna alterna o móvil)', NULL, 72
FROM procedimientos p WHERE p.codigo_corto='EOP-AGU-01';
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 1, 'Verificar nivel de cisterna, estado del bombeo y acometida y calcular la autonomía con el consumo promedio del SCP-AGU-01', 'Autonomía calculada; con sospecha de contaminación, entrada de la cisterna cerrada y reserva aislada' FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=1);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 2, 'Avisar a la jefatura de Mantenimiento General, a Control de Infecciones y a la supervisión de Enfermería', 'La central avisa a Hemodiálisis, Central de Esterilización, Laboratorio, Cocina y Botiquín' FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=2);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 3, 'Activar la reserva: cisterna alterna, cisterna móvil del proveedor contratado y agua embotellada desde Almacén', 'Reserva en servicio con tiempo de entrega confirmado' FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=3);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 0, 0, 'Jefatura de Mantenimiento General, Control de Infecciones y supervisión de Enfermería', 'El técnico de turno avisa como segunda acción inmediata', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=0);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 1, 0, 'Hemodiálisis, Central de Esterilización, Laboratorio, Cocina y Botiquín', 'La central telefónica cumple la cadena de aviso a los servicios dependientes del agua', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=1);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 2, 0, 'Gerencia General y Dirección Médica', 'La Gerencia de Operaciones informa el evento y su alcance', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=2);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 3, 240, 'Equipo de gestión del agua', 'Cuando la restricción supera 4 horas se reúne para fijar objetivos', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=3);

-- ── EOP-ASC-01 · Atrapamiento de personas en un ascensor
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'EOP-ASC-01', 'eop', 'ascensores', 'Atrapamiento de personas en un ascensor', 'Responder al atrapamiento de personas en una cabina detenida entre pisos o con puertas bloqueadas: establecer contacto y acompañar a las personas, llamar a la empresa de ascensores y dejar la liberación solo al técnico o al cuerpo de rescate. Nadie del hospital abre puertas ni mueve la cabina.', 'Cualquier cabina con personas, pacientes o camillas detenida entre pisos o con puertas bloqueadas. Sede por definir.', 'South Eastern Sydney Local Health District (NSW Health), SESLHDPR/715 Lift Entrapment Emergency Procedures, revisión 5 (08/2021), con referencia a AS 4083 y AS 3745; contrato de mantenimiento de ascensores; política C-203 de University of Iowa Hospitals and Clinics; JCI FMS.09.00.', 'Reunión de cierre el mismo día con todos los que intervinieron, cada uno entrega sus notas; lista de verificación de la central completa; informe de incidente; el coordinador y la Gerencia de Operaciones definen el nivel de revisión según la gravedad; orden correctiva y revisión del plan preventivo del ascensor con el proveedor.', NULL, '0.9', 'borrador', 3, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Tiempo de respuesta contractual y prohibición de liberación por personal propio', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Proveedor de ascensores', 'Tiempo de respuesta contractual y que solo su técnico libera la cabina', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Proveedor de ascensores');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Vigilancia', 'Lista de aviso y lista de verificación', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Vigilancia');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Central telefónica', 'Lista de aviso y registro de horas y decisiones en la lista de verificación', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Central telefónica');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería', 'Atención a pacientes atrapados', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Seguridad y Salud Ocupacional', 'Criterio de aviso al Cuerpo de Bomberos', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Seguridad y Salud Ocupacional');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Gerencia General', 'Ejecutivo de turno y nivel de apoyo fuera de horario', 'pendiente', '2026-11-27' FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Gerencia General');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, NULL, 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Cargo del coordinador fuera de horario (supervisor de turno)', NULL, 'Mantenimiento General con Gerencia General', 1 FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Cargo del coordinador fuera de horario (supervisor de turno)');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Proveedor de ascensores y tiempo de respuesta contractual', NULL, 'Mantenimiento General con el proveedor de ascensores', 2 FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Proveedor de ascensores y tiempo de respuesta contractual');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Lista de cargos para el aviso «atrapamiento confirmado»', NULL, 'Vigilancia y central telefónica', 3 FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Lista de cargos para el aviso «atrapamiento confirmado»');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Número del Cuerpo de Bomberos', 'número telefónico', 'Seguridad y Salud Ocupacional', 4 FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Número del Cuerpo de Bomberos');
INSERT OR IGNORE INTO eop_ficha
  (procedimiento_id, senal_activacion, activa_quien, dirige_quien, dirige_fuera_horario, accion_1, accion_2, accion_3, estabilizar, comunicar, decidir, restablecer, etiqueta_hora_mitigacion, minutos_escalar_gerencia, horas_causa_raiz)
SELECT p.id, 'Llamada desde el botón o el teléfono de la cabina; aviso de un usuario; alarma del ascensor; cabina detenida durante una falla eléctrica, con el EOP-ELE-01 en curso.', 'Quien recibe el aviso, notificando a la central telefónica o a vigilancia.', 'Coordinador: la jefatura de Mantenimiento General, que llama a la empresa de ascensores y decide las alternativas. Oficial de emergencia: el técnico de turno de Mantenimiento General, que va a la cabina y se queda con las personas. Solo el coordinador autoriza el «todo despejado».', 'El supervisor de turno, con el cargo por definir, asume el papel de coordinador: llama a la empresa de ascensores y decide las alternativas.', 'La central o vigilancia registra la hora y avisa al oficial de emergencia y al coordinador con el ascensor y el piso probable; envía el aviso «atrapamiento confirmado» a los cargos de la lista.', 'El oficial va al ascensor; si no se conoce el piso, empieza en planta baja y sube piso por piso hasta establecer contacto. Confirma cuántas personas hay, sus nombres, condiciones médicas y signos de angustia, y lo transmite al coordinador.', 'El coordinador llama a la empresa de ascensores, comparte la información médica y pide un técnico; registra la hora estimada de llegada.', 'Oficial de emergencia: se queda con las personas hasta que el coordinador indique otra cosa, les asegura que están a salvo y que la empresa ya fue llamada sin prometer horas exactas; las únicas acciones que puede sugerir son pulsar el botón de planta baja o el de abrir puertas para ver si la cabina responde; nunca sugiere forzar las puertas ni salir de la cabina si no está a nivel del piso; antes de cortar una llamada confirma que saben usar el teléfono de emergencia. Central o vigilancia: mantiene la comunicación con el oficial, vigila la cabina por cámara si existe y registra cada hora y cada decisión en la lista de verificación. Vigilancia: asegura el área en cada piso y controla a los curiosos; si no hay oficial ni coordinador disponibles, asume el papel hasta que lleguen. Mantenimiento General: evalúa el impacto en los servicios (traslado de pacientes, camillas, alimentos, insumos) y reorganiza el uso de los demás ascensores, sin intentar liberar la cabina. Clínico de turno: si hay un paciente o una persona con condición médica en la cabina, evalúa desde fuera y prepara la atención a la salida; una emergencia médica dentro de la cabina se informa de inmediato al coordinador.', 'El coordinador informa a la Gerencia de Operaciones y, fuera de horario, al ejecutivo de turno, que define el nivel de apoyo. Cada 15 minutos el oficial informa al coordinador el estado de las personas.', 'Según la hora estimada de llegada del técnico y la condición médica de las personas, el coordinador decide si espera al técnico o activa una alternativa, por ejemplo el Cuerpo de Bomberos. La liberación la ejecuta solo el técnico de la empresa o el cuerpo de rescate; nadie del hospital abre puertas ni mueve la cabina.', 'Tras la salida, atención médica a las personas y registro de sus datos; el ascensor queda fuera de servicio y señalizado hasta la revisión y el informe de la empresa; el coordinador autoriza el «todo despejado» y la central lo comunica.', 'Salida de las personas de la cabina', NULL, 72
FROM procedimientos p WHERE p.codigo_corto='EOP-ASC-01';
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 1, 'La central o vigilancia registra la hora y avisa al oficial de emergencia y al coordinador con el ascensor y el piso probable', 'Aviso «atrapamiento confirmado» enviado a los cargos de la lista' FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=1);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 2, 'El oficial va al ascensor y, si no se conoce el piso, empieza en planta baja y sube piso por piso hasta establecer contacto', 'Número de personas, nombres, condiciones médicas y signos de angustia transmitidos al coordinador' FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=2);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 3, 'El coordinador llama a la empresa de ascensores, comparte la información médica y pide un técnico', 'Hora estimada de llegada del técnico registrada' FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=3);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 0, 0, 'Oficial de emergencia y coordinador', 'La central o vigilancia registra la hora y los avisa con el ascensor y el piso probable', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=0);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 1, 0, 'Cargos de la lista de aviso', 'La central envía el aviso «atrapamiento confirmado»', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=1);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 2, 0, 'Empresa de ascensores', 'El coordinador pide un técnico, comparte la información médica y registra la hora estimada de llegada', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=2);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 3, 0, 'Gerencia de Operaciones o, fuera de horario, ejecutivo de turno', 'El coordinador informa y el ejecutivo define el nivel de apoyo', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=3);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 4, 15, 'Coordinador', 'El oficial informa el estado de las personas cada 15 minutos', 0 FROM procedimientos p
WHERE p.codigo_corto='EOP-ASC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=4);

-- ── AOP-HVAC-01 · Temperatura o humedad fuera de rango en quirófano o almacén 
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'AOP-HVAC-01', 'aop', 'hvac', 'Temperatura o humedad fuera de rango en quirófano o almacén estéril', 'Fijar acción, tiempo tolerable y umbral de paso al EOP cuando una lectura de temperatura o humedad sale de la banda de operación con la manejadora en marcha, para no tratar la desviación como falla ni dejarla anotada hasta la próxima ronda.', 'Lectura fuera de la banda de operación con la manejadora en marcha; con cirugía en curso y unidad detenida aplica el EOP-HVAC-01. Cubre quirófano, almacén estéril, área perioperatoria y recuperación.', 'SCP-HVAC-01; NSW Health SHPN (CEC) 240241 v1.0 04/2024, tabla 1 y secciones de eventos persistentes; UNC Medical Center, flujo de respuesta de temperatura y humedad; JCI FMS.08.04; Política C-013 de University of Iowa Hospitals and Clinics.', 'Solicitud con código del AOP; lecturas y horas; evaluación de riesgo; reporte en el sistema de incidentes si hubo condensación, moho o un evento persistente; horas fuera de rango para el indicador 8.', NULL, '0.9', 'borrador', 2, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Control de Infecciones', 'Umbrales y decisión sobre los casos', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Control de Infecciones');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Jefatura de Quirófanos', 'Umbrales y decisión sobre los casos', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Jefatura de Quirófanos');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Central de Esterilización', 'Almacén estéril y reprocesamiento del material con humedad en el empaque', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Central de Esterilización');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Tiempos de respuesta', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Calidad', 'Reporte de incidentes', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Calidad');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT OR IGNORE INTO aop_ficha (procedimiento_id, condicion_umbral, quien_detecta, tiempo_tolerable, decision_casos, pasa_a_eop)
SELECT p.id, 'Quirófano: humedad relativa por encima del 60 % o por debajo del 35 %; temperatura por encima de 22 °C o por debajo de 18 °C. Almacén estéril: humedad por encima del 70 % o por debajo del 35 %; temperatura por encima de 25 °C o por debajo de 18 °C. Área perioperatoria y recuperación: humedad fuera de 40 a 60 %; temperatura fuera de 18 a 25 °C.', 'Sensor con alarma, lectura del SOP-MG-04 o personal de la sala. Quien detecta avisa en el momento; el escalamiento empieza al primer signo de variación.', 'Quirófano: 2 horas para informar a Mantenimiento General e iniciar la corrección. Almacén estéril: 8 horas para completar la evaluación de riesgo. Si no se restablece en 8 horas dentro de cualquier período de 24, se escala a la Gerencia General. Un evento persistente de más de 18 horas activa las medidas de la tabla.', 'Con humedad por encima del 60 % durante más de 18 horas y condensación visible, no se inician procedimientos nuevos hasta que la condensación cese; las emergencias se operan con insumos de un área no afectada. Con humedad baja persistente, evaluación de riesgo de fuego. Con temperatura baja persistente, revisión de pacientes vulnerables y reprogramación si procede, con vigilancia de normotermia en recuperación. Todo dispositivo reutilizable con humedad en el empaque se considera contaminado y se reprocesa.', 'La manejadora se detiene con cirugía en curso o la sala pierde presión positiva: EOP-HVAC-01 y AOP-HVAC-02.'
FROM procedimientos p WHERE p.codigo_corto='AOP-HVAC-01';
INSERT INTO aop_umbrales (procedimiento_id, minutos_para_actuar, minutos_para_escalar, minutos_evento_persistente, eop_procedimiento_id)
SELECT p.id, 120, 480, 1080, (SELECT id FROM procedimientos WHERE codigo_corto='EOP-HVAC-01')
FROM procedimientos p WHERE p.codigo_corto='AOP-HVAC-01'
  AND NOT EXISTS (SELECT 1 FROM aop_umbrales a WHERE a.procedimiento_id=p.id);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 1, 'Ajustar el punto de control de la sala (subir o bajar la consigna según el caso) y verificar puertas cerradas.', 'Ajuste registrado con hora.' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=1);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 2, 'Volver a medir a los 30 minutos con el instrumento calibrado.', 'Si está en rango, cerrar el AOP con el registro; si no, seguir.' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=2);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 3, 'Revisar condensación en superficies y en empaques estériles; confirmar que ningún paciente presente está afectado.', 'Sin condensación; paciente sin afectación.' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=3);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 4, 'Con humedad alta, avisar a Control de Infecciones; con humedad por debajo del 30 %, alertar al equipo quirúrgico del riesgo de fuego y extremar precauciones con el electrocauterio y las preparaciones alcohólicas.', 'Aviso registrado.' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=4);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 5, 'Si persiste, llamar a Mantenimiento General; fuera de horario, al supervisor de turno. Mantenimiento revisa la manejadora, el humidificador, el serpentín y el chiller.', 'Orden correctiva abierta con hora de llamada y de llegada.' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=5);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 6, 'Evaluación de riesgo conjunta (Quirófanos, Control de Infecciones, Esterilización, Mantenimiento): causa probable, duración esperada, riesgo de recurrencia, evidencia de humedad, función de los equipos e instrucciones de uso de los fabricantes.', 'Evaluación escrita; sirve como evidencia de que el evento no tuvo consecuencia o de las medidas tomadas.' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=6);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 0, 0, 'Mantenimiento General (fuera de horario, supervisor de turno)', 'Quien detecta avisa en el momento; el escalamiento empieza al primer signo de variación.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=0);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 1, 30, 'Control de Infecciones', 'Relectura con instrumento calibrado; con humedad alta se avisa a Control de Infecciones y con humedad por debajo del 30 % se alerta al equipo quirúrgico por riesgo de fuego.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=1);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 2, 120, 'Jefatura de Mantenimiento General', 'Quirófano: informar e iniciar la corrección dentro de 2 horas.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=2);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 3, 480, 'Gerencia General', 'No restablecido en 8 horas dentro de cualquier período de 24; en almacén estéril se completa la evaluación de riesgo.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=3);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 4, 1080, 'Quirófanos, Control de Infecciones, Esterilización y Mantenimiento General', 'Evento persistente de más de 18 horas: se aplican las medidas de decisión sobre los casos y se reporta en el sistema de incidentes.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=4);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 5, 0, 'Jefatura de Quirófanos y Mantenimiento General', 'Manejadora detenida con cirugía en curso o sala sin presión positiva: pasa a EOP-HVAC-01 y AOP-HVAC-02.', 1 FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=5);

-- ── AOP-HVAC-02 · Pérdida de presión diferencial en un quirófano o en un cuart
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'AOP-HVAC-02', 'aop', 'hvac', 'Pérdida de presión diferencial en un quirófano o en un cuarto de aislamiento', 'Recuperar la presión diferencial y proteger al paciente y al personal cuando un quirófano queda sin presión positiva o un cuarto de aislamiento sin presión negativa con la manejadora en marcha, fijando qué medidas alternativas rigen mientras se corrige.', 'Quirófano sin presión positiva o cuarto de aislamiento de infecciones por aire sin presión negativa, con la manejadora en marcha.', 'SCP-HVAC-01; ASHRAE 170-2021 (±2.5 Pa); CDC/HICPAC 2007 (verificación diaria, 12 o 6 renovaciones, extracción o HEPA, puerta cerrada); UNC Medical Center, flujo de respuesta; JCI FMS.08.04 y PCI.', 'Solicitud con código del AOP; método de verificación; medidas; horas; decisión de Control de Infecciones; horas fuera de rango.', NULL, '0.9', 'borrador', 2, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Control de Infecciones', 'Medidas alternativas en aislamiento y criterio de traslado del paciente', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Control de Infecciones');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería', 'Verificación diaria compartida de la presión mientras el cuarto esté ocupado', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Monitores de presión y unidades HEPA portátiles disponibles', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Quirófanos', 'Umbral de presión y criterio de no iniciar un caso hasta restablecer', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Quirófanos');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Calidad', 'Umbrales, tiempos tolerables y registro del evento', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Calidad');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Minutos de tolerancia en aislamiento', 'minutos', 'Control de Infecciones', 1 FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Minutos de tolerancia en aislamiento');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Unidades HEPA portátiles disponibles', 'unidades', 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Unidades HEPA portátiles disponibles');
INSERT OR IGNORE INTO aop_ficha (procedimiento_id, condicion_umbral, quien_detecta, tiempo_tolerable, decision_casos, pasa_a_eop)
SELECT p.id, 'Quirófano con presión respecto al pasillo por debajo de +2.5 Pa, o humo que entra en vez de salir. Cuarto de aislamiento ocupado con presión por encima de −2.5 Pa, o humo que sale en vez de entrar, en la verificación diaria o en el monitor continuo.', 'Técnico de climatización en el SOP-MG-04, monitor continuo con alarma, o Enfermería de la unidad.', 'Quirófano sin paciente: no se inicia un caso hasta restablecer. Cuarto de aislamiento ocupado: acción inmediata; si no se restablece en 60 minutos, Control de Infecciones decide el traslado del paciente o las medidas alternativas.', NULL, 'La manejadora o el extractor se detienen con cirugía en curso (EOP-HVAC-01) o con un paciente en aislamiento por transmisión aérea sin alternativa, caso en el que Control de Infecciones activa su propio plan.'
FROM procedimientos p WHERE p.codigo_corto='AOP-HVAC-02';
INSERT INTO aop_umbrales (procedimiento_id, minutos_para_actuar, minutos_para_escalar, minutos_evento_persistente, eop_procedimiento_id)
SELECT p.id, NULL, 60, NULL, (SELECT id FROM procedimientos WHERE codigo_corto='EOP-HVAC-01')
FROM procedimientos p WHERE p.codigo_corto='AOP-HVAC-02'
  AND NOT EXISTS (SELECT 1 FROM aop_umbrales a WHERE a.procedimiento_id=p.id);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 1, 'Confirmar todas las puertas cerradas y las rejillas de suministro y retorno libres de obstrucción.', 'Puertas y rejillas conformes.' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=1);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 2, 'Volver a medir a los 5 minutos.', 'Si está en rango, cerrar el AOP; si no, seguir.' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=2);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 3, 'Prueba de flujo en la puerta con tisú o tubo de humo.', 'Dirección del flujo registrada.' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=3);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 4, 'Si persiste: en quirófano, colocar dos unidades portátiles de filtración HEPA (una cerca del paciente o de la mesa y otra cerca de la puerta de salida) y avisar a Control de Infecciones; en aislamiento, mantener la puerta cerrada, avisar a Control de Infecciones y aplicar las medidas que indique (respirador para el personal, filtración portátil, restricción de entradas).', 'Medidas en sitio registradas con hora.' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=4);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 5, 'Llamar a Mantenimiento General; revisar compuertas, ventilador de extracción, filtros saturados, ajustes del control y puertas vecinas abiertas.', 'Causa identificada; orden correctiva.' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=5);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 6, 'Restablecida la presión, medir de nuevo y registrar; en aislamiento, repetir la verificación diaria mientras el cuarto esté ocupado.', 'Presión en rango; registro.' FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=6);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 0, 0, 'Control de Infecciones', 'Cuarto de aislamiento ocupado: acción inmediata y aviso al confirmar la pérdida de presión. En quirófano sin paciente, no se inicia un caso hasta restablecer.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=0);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 1, 5, 'Mantenimiento General', 'Relectura a los 5 minutos; si sigue fuera de rango se hace la prueba de flujo y se llama a Mantenimiento General para revisar compuertas, extractor, filtros y ajustes.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=1);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 2, 60, 'Control de Infecciones', 'No restablecido en 60 minutos en aislamiento ocupado: Control de Infecciones decide el traslado del paciente o las medidas alternativas.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=2);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 3, 0, 'Jefatura de Quirófanos y Control de Infecciones', 'Manejadora o extractor detenidos con cirugía en curso: EOP-HVAC-01. Paciente en aislamiento aéreo sin alternativa: Control de Infecciones activa su propio plan.', 1 FROM procedimientos p
WHERE p.codigo_corto='AOP-HVAC-02' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=3);

-- ── AOP-GAS-01 · Alarma de gases medicinales sin pérdida de suministro
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'AOP-GAS-01', 'aop', 'gases', 'Alarma de gases medicinales sin pérdida de suministro', 'Investigar y corregir toda alarma maestra o de área de gases medicinales mientras el suministro al paciente se mantiene, fijando los tiempos de reposición y corrección y el umbral en que la condición pasa al EOP-GAS-01.', 'Cambio automático al banco de reserva, reserva baja, punto de rocío alto, monóxido de carbono o presión de línea fuera de rango con pacientes abastecidos.', 'SCP-GAS-01; NFPA 99 5.1.9 (alarmas) y requisitos de aire medicinal; HTM 02-01 Parte B 5.22 y 5.25; Doncaster and Bassetlaw CORP/FAC 3 v3; Política C-211 de University of Iowa Hospitals and Clinics (prueba y falla del panel de alarmas).', 'Solicitud con código del AOP; condición, hora y acción; pedido al proveedor; lecturas de punto de rocío o monóxido; la prueba periódica de los paneles de alarma se registra en su propio plan.', NULL, '0.9', 'borrador', 2, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Tiempos de reabastecimiento y corrección, ajustes del secador y del monitor', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Proveedor del gas', 'Tiempos de reabastecimiento, ajustes del secador y del monitor', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Proveedor del gas');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Regencia del Botiquín', 'Criterio de calidad del aire medicinal y del oxígeno', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Regencia del Botiquín');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Enfermería', 'Respuesta en los paneles de área', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Enfermería');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Almacén', 'Existencia de cilindros', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Almacén');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Horas de reposición del banco agotado', 'horas', 'Mantenimiento General y proveedor del gas', 1 FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Horas de reposición del banco agotado');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Minutos de corrección de punto de rocío o monóxido', 'minutos', 'Mantenimiento General y proveedor del gas', 2 FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Minutos de corrección de punto de rocío o monóxido');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Horas máximas sin redundancia', 'horas', 'Mantenimiento General', 3 FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Horas máximas sin redundancia');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Autonomía mínima de la reserva para pasar al EOP', 'horas', 'Mantenimiento General y proveedor del gas', 4 FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Autonomía mínima de la reserva para pasar al EOP');
INSERT OR IGNORE INTO aop_ficha (procedimiento_id, condicion_umbral, quien_detecta, tiempo_tolerable, decision_casos, pasa_a_eop)
SELECT p.id, 'Alarma maestra o de área con suministro mantenido: cambio a reserva o reserva en uso; reserva baja; punto de rocío del aire medicinal por encima de +4 °C a presión del sistema; monóxido de carbono por encima de 10 ppm; presión de línea fuera del rango del SCP-GAS-01 (alarma de área por desviación de la presión normal); falla de un compresor o de una bomba de vacío con el equipo de reserva en marcha.', 'Panel de alarma, ronda del SOP-MG-01 o Enfermería de la unidad donde está el panel de área.', 'Toda alarma se investiga de inmediato. Cambio a reserva: reposición del banco agotado en 2 horas y reabastecimiento del tanque según el proveedor. Punto de rocío o monóxido: corrección en 30 minutos; si no se corrige, el aire medicinal pasa a la fuente de reserva. Reserva baja: proveedor en modo de emergencia.', NULL, 'La presión de línea cae por debajo del rango con pacientes afectados, la reserva no entra o su autonomía baja del umbral definido: EOP-GAS-01.'
FROM procedimientos p WHERE p.codigo_corto='AOP-GAS-01';
INSERT INTO aop_umbrales (procedimiento_id, minutos_para_actuar, minutos_para_escalar, minutos_evento_persistente, eop_procedimiento_id)
SELECT p.id, 30, 120, 1440, (SELECT id FROM procedimientos WHERE codigo_corto='EOP-GAS-01')
FROM procedimientos p WHERE p.codigo_corto='AOP-GAS-01'
  AND NOT EXISTS (SELECT 1 FROM aop_umbrales a WHERE a.procedimiento_id=p.id);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 1, 'Leer el panel: identificar gas, condición y zona; silenciar sin borrar; registrar la hora.', 'Condición identificada; el indicador visual permanece hasta corregir la causa.' FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=1);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 2, 'Cambio a reserva o reserva en uso: verificar que el banco en servicio está abierto y con presión; pedir cilindros a Almacén y el reabastecimiento al proveedor; confirmar que el otro banco quedará lleno antes de 2 horas.', 'Reserva operando; pedido registrado; contenido de cilindros coherente con la alarma (verificación obligatoria tras una falla eléctrica).' FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=2);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 3, 'Punto de rocío o monóxido: cambiar al secador o compresor de reserva; revisar purgas, filtros y entrada de aire del compresor (fuentes de monóxido cerca de la toma); medir de nuevo.', 'Valores en rango en 30 minutos; si no, aire medicinal desde la reserva de cilindros y aviso a Regencia del Botiquín.' FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=3);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 4, 'Presión de línea fuera de rango con suministro: revisar reguladores de la central y de la zona; comparar con el manómetro de referencia; verificar fugas en la zona.', 'Presión dentro del rango del SCP-GAS-01; orden correctiva si fue necesario ajustar.' FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=4);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 5, 'Falla de compresor o bomba con reserva en marcha: confirmar que el equipo de reserva sostiene la demanda; abrir orden correctiva P1; no dejar el sistema sin redundancia más de 24 horas sin riesgo aceptado por escrito.', 'Redundancia restablecida o riesgo aceptado por escrito.' FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=5);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 6, 'Informar a la jefatura de Mantenimiento General y, si la condición afecta la calidad del gas, a Regencia del Botiquín; registrar.', 'Aviso con hora.' FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=6);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 0, 0, 'Jefatura de Mantenimiento General', 'Toda alarma se investiga de inmediato: se identifica gas, condición y zona, se silencia sin borrar y se registra la hora.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=0);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 1, 30, 'Regencia del Botiquín', 'Punto de rocío o monóxido no corregidos en 30 minutos: el aire medicinal pasa a la reserva de cilindros y se avisa a Regencia por calidad del gas.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=1);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 2, 120, 'Proveedor del gas y Almacén', 'Reposición del banco agotado y confirmación de que el otro banco queda lleno antes de 2 horas; con reserva baja el proveedor entra en modo de emergencia.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=2);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 3, 1440, 'Jefatura de Mantenimiento General', 'Sistema sin redundancia más de 24 horas: no se mantiene sin riesgo aceptado por escrito.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=3);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 4, 0, 'Enfermería y jefatura de Mantenimiento General', 'Presión de línea bajo rango con pacientes afectados, reserva que no entra o autonomía bajo el umbral: pasa a EOP-GAS-01.', 1 FROM procedimientos p
WHERE p.codigo_corto='AOP-GAS-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=4);

-- ── AOP-ELE-01 · Condición anormal del sistema eléctrico esencial sin pérdida
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'AOP-ELE-01', 'aop', 'electrico', 'Condición anormal del sistema eléctrico esencial sin pérdida de suministro', 'Corregir las condiciones que dejan en duda la capacidad de arranque del sistema eléctrico esencial mientras la red sigue presente, con plan de contingencia activo antes de que se tolere más allá del límite y con paso inmediato al EOP-ELE-01 si la red se pierde.', 'Combustible bajo, falla de baterías o cargador, hallazgo en la inspección semanal, prueba mensual fuera de criterio, planta en manual, UPS en baterías y disparos por capacidad de carga.', 'SCP-ELE-01; NFPA 110 (2010) 8.4.2.3 y 8.4.5; NFPA 99 (2012) 6.4.3.1 y 6.4.4.1.1.2; Joint Commission, FAQ de combustible y plan de 96 horas; Política C-103 de University of Iowa Hospitals and Clinics; Minnesota Department of Health.', 'Solicitud con código del AOP; condición, hora, acción y responsable; actualización del registro de pruebas; expediente de capacidad de carga.', NULL, '0.9', 'borrador', 2, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Umbrales de combustible y autonomía, contrato de planta de alquiler', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Tecnología', 'Autonomía del UPS y apagado ordenado', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Tecnología');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Compras', 'Acuerdo de reabastecimiento de combustible', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Compras');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Comité de Emergencias', 'Criterio de deterioro del sistema de emergencia', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Comité de Emergencias');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Gerencia de Operaciones', 'Riesgo aceptado por escrito', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Gerencia de Operaciones');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Nivel de reorden de combustible', 'litros', 'Mantenimiento General', 1 FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Nivel de reorden de combustible');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Autonomía mínima de la planta', 'horas', 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Autonomía mínima de la planta');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Horas tolerables sin plan de contingencia activo', 'horas', 'Comité de Emergencias', 3 FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Horas tolerables sin plan de contingencia activo');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Horas para la reposición de combustible', 'horas', 'Compras', 4 FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Horas para la reposición de combustible');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Porcentaje de autonomía del UPS para iniciar el apagado ordenado', '%', 'Tecnología', 5 FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Porcentaje de autonomía del UPS para iniciar el apagado ordenado');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Contrato de planta de alquiler', NULL, 'Mantenimiento General', 6 FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Contrato de planta de alquiler');
INSERT OR IGNORE INTO aop_ficha (procedimiento_id, condicion_umbral, quien_detecta, tiempo_tolerable, decision_casos, pasa_a_eop)
SELECT p.id, 'Combustible por debajo del nivel de reorden en litros o autonomía por debajo de las horas definidas; tensión de baterías o cargador fuera del valor del fabricante; calentador de camisa apagado; cualquier condición insatisfactoria del SOP-MG-02; prueba mensual con carga por debajo del 30 % o transferencia por encima de 10 segundos; selector de la planta o de una transferencia fuera de automático; UPS operando en baterías; disparo de protecciones por sobrecarga en la acometida.', 'Ronda del SOP-MG-01, inspección del SOP-MG-02, prueba del MOP-ELE-01, anunciador remoto o Tecnología (UPS).', 'Ninguna condición que impida el arranque se tolera más de 4 horas sin plan de contingencia activo. Combustible: reposición en 24 horas. Prueba fuera de criterio: acción dentro del mismo ciclo de 20 a 40 días.', NULL, 'Hay pérdida de red con la planta o la transferencia en condición anormal: EOP-ELE-01 de inmediato.'
FROM procedimientos p WHERE p.codigo_corto='AOP-ELE-01';
INSERT INTO aop_umbrales (procedimiento_id, minutos_para_actuar, minutos_para_escalar, minutos_evento_persistente, eop_procedimiento_id)
SELECT p.id, 240, 240, NULL, (SELECT id FROM procedimientos WHERE codigo_corto='EOP-ELE-01')
FROM procedimientos p WHERE p.codigo_corto='AOP-ELE-01'
  AND NOT EXISTS (SELECT 1 FROM aop_umbrales a WHERE a.procedimiento_id=p.id);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 1, 'Combustible bajo: pedir la reposición al proveedor del acuerdo de reabastecimiento; recalcular la autonomía con el consumo a 75 % de carga; informar a la jefatura.', 'Pedido con hora de entrega comprometida; autonomía registrada.' FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=1);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 2, 'Baterías, cargador o calentador: corregir o reemplazar en el día; mientras tanto, verificar arranque manual posible y dejar la planta en automático.', 'Planta capaz de arrancar; si no lo está, pasar al punto 6.' FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=2);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 3, 'Carga por debajo del 30 % en la prueba mensual: registrar, mantener la prueba mensual con la carga disponible y programar la prueba anual con banco de carga (30 minutos al 50 % y 60 minutos al 75 %).', 'Prueba anual en el calendario con fecha.' FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=3);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 4, 'Transferencia por encima de 10 segundos: revisar ajustes de retardo y arranque; confirmar el cumplimiento en un proceso anual o registrar el tiempo en la próxima interrupción real.', 'Ajuste registrado en el SCP-ELE-01 si cambió.' FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=4);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 5, 'Selector fuera de automático o UPS en baterías: devolver a automático con la causa identificada; Tecnología inicia el apagado ordenado si el UPS no recupera red antes del 50 % de su autonomía.', 'Configuración normal restablecida.' FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=5);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 6, 'Planta incapaz de arrancar o transferencia inoperante: declarar deterioro del sistema de emergencia; avisar a la Gerencia de Operaciones y al Comité de Emergencias; activar al proveedor en modo urgente y la contingencia de planta de alquiler; informar a los servicios críticos.', 'Contingencia activa en 4 horas; riesgo aceptado por escrito si se prolonga.' FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=6);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 7, 'Disparo por capacidad de carga en la acometida: registrar carga y hora; redistribuir cargas no críticas; documentar el incidente para la solicitud formal de aumento de carga a la distribuidora.', 'Incidente en el expediente de la solicitud.' FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=7);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 0, 0, 'Jefatura de Mantenimiento General', 'Combustible bajo: pedido de reposición al proveedor del acuerdo de reabastecimiento y autonomía recalculada con el consumo a 75 % de carga.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=0);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 1, 0, 'Tecnología', 'UPS en baterías: Tecnología inicia el apagado ordenado si el UPS no recupera red antes del 50 % de su autonomía.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=1);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 2, 240, 'Gerencia de Operaciones y Comité de Emergencias', 'Planta incapaz de arrancar o transferencia inoperante: deterioro del sistema de emergencia declarado, proveedor en modo urgente y contingencia de planta de alquiler activa en 4 horas; riesgo aceptado por escrito si se prolonga.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=2);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 3, 1440, 'Proveedor del acuerdo de reabastecimiento', 'Reposición de combustible entregada dentro de 24 horas.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=3);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 4, 0, 'Jefatura de Mantenimiento General y Comité de Emergencias', 'Pérdida de red con la planta o la transferencia en condición anormal: pasa a EOP-ELE-01 de inmediato.', 1 FROM procedimientos p
WHERE p.codigo_corto='AOP-ELE-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=4);

-- ── AOP-AGU-01 · Temperatura, nivel o residual de cloro fuera de rango en el 
INSERT OR IGNORE INTO procedimientos
  (codigo_corto, tipo, sistema, titulo, proposito, alcance, referencias, registro, nivel_riesgo, version, estado, semana_validacion, responsable_id)
SELECT 'AOP-AGU-01', 'aop', 'agua', 'Temperatura, nivel o residual de cloro fuera de rango en el sistema de agua', 'Confirmar y corregir las lecturas de temperatura, nivel y cloro residual que salen de rango en el sistema de agua, y definir cuándo la repetición de la desviación o un resultado de laboratorio fuera de norma obliga a la evaluación de riesgo con Control de Infecciones y al muestreo.', 'Lecturas fuera de rango en puntos centinela, cisterna por encima de 20 °C, nivel bajo con entrada activa, cloro residual bajo y resultado de laboratorio pendiente de confirmar.', 'SCP-AGU-01; HSE (Reino Unido) HSG274 Parte 2 y régimen de temperaturas; CDC, Healthcare Water System Repair and Recovery; JCI FMS.08.02 (8.ª edición); norma salvadoreña de agua potable por confirmar.', 'Solicitud con código del AOP; lecturas, horas y acciones; evaluación de riesgo; muestras y resultados; informe mensual a Control de Infecciones.', NULL, '0.9', 'borrador', 2, u.id
FROM (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1) u;
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Control de Infecciones', 'Criterios de evaluación de riesgo y muestreo', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Control de Infecciones');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Laboratorio', 'Análisis y tiempos de respuesta', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Laboratorio');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Mantenimiento General', 'Umbrales de nivel y tiempos de respuesta', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Mantenimiento General');
INSERT INTO procedimiento_validaciones (procedimiento_id, area, que_confirma, estado, fecha_programada)
SELECT p.id, 'Legal', 'Norma de agua potable y valor de cloro residual', 'pendiente', '2026-11-20' FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_validaciones v WHERE v.procedimiento_id=p.id AND v.area='Legal');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Sede', NULL, 'Mantenimiento General', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Sede');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Valor de cloro residual libre de la norma', 'mg/L', 'Legal', 1 FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Valor de cloro residual libre de la norma');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Horas para corrección y nueva lectura de temperatura', 'horas', 'Mantenimiento General', 2 FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Horas para corrección y nueva lectura de temperatura');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Horas para corregir el cloro residual bajo', 'horas', 'Mantenimiento General', 3 FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Horas para corregir el cloro residual bajo');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Horas para identificar la causa del nivel bajo', 'horas', 'Mantenimiento General', 4 FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Horas para identificar la causa del nivel bajo');
INSERT INTO procedimiento_campos (procedimiento_id, etiqueta, unidad, decide_area, orden)
SELECT p.id, 'Norma salvadoreña de agua potable (por confirmar)', NULL, 'Legal', 5 FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_campos k WHERE k.procedimiento_id=p.id AND k.etiqueta='Norma salvadoreña de agua potable (por confirmar)');
INSERT OR IGNORE INTO aop_ficha (procedimiento_id, condicion_umbral, quien_detecta, tiempo_tolerable, decision_casos, pasa_a_eop)
SELECT p.id, 'Salida caliente centinela por debajo de 50 °C al minuto; salida del calentador por debajo de 60 °C; retorno por debajo de 50 °C; salida fría por encima de 20 °C a los 2 minutos; agua almacenada o entrante por encima de 20 °C; cloro residual libre en punto de uso por debajo del valor de la norma en mg/L; nivel de cisterna por debajo del nivel de alarma con entrada activa.', 'SOP-MG-03 (mensual y semestral), SOP-MG-01 (nivel y cloro), Laboratorio (resultado) o sensor de nivel.', 'Lectura de temperatura fuera de rango: corrección y nueva lectura en 24 horas; dos lecturas consecutivas fuera de rango en el mismo punto o un resultado de laboratorio fuera de norma activan la evaluación de riesgo con Control de Infecciones y el muestreo. Cloro bajo: corrección en 4 horas. Nivel bajo: identificar causa en 1 hora.', NULL, 'Se pierde el suministro, la cisterna no recibe agua y la autonomía baja del umbral, o hay evidencia de contaminación del suministro: EOP-AGU-01.'
FROM procedimientos p WHERE p.codigo_corto='AOP-AGU-01';
INSERT INTO aop_umbrales (procedimiento_id, minutos_para_actuar, minutos_para_escalar, minutos_evento_persistente, eop_procedimiento_id)
SELECT p.id, 60, 1440, NULL, (SELECT id FROM procedimientos WHERE codigo_corto='EOP-AGU-01')
FROM procedimientos p WHERE p.codigo_corto='AOP-AGU-01'
  AND NOT EXISTS (SELECT 1 FROM aop_umbrales a WHERE a.procedimiento_id=p.id);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 1, 'Repetir la lectura con el instrumento calibrado y el método del SOP-MG-03.', 'Lectura confirmada o descartada.' FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=1);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 2, 'Salida caliente baja: verificar el punto de ajuste y la salida del calentador (60 °C), el retorno (50 °C), la bomba de recirculación y las válvulas mezcladoras; buscar tramos muertos; purgar la salida hasta estabilizar y volver a medir.', 'Salida en rango; si no, orden correctiva P1 y evaluación de riesgo.' FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=2);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 3, 'Salida fría alta o agua almacenada por encima de 20 °C: verificar aislamiento y ubicación del tanque, volumen almacenado (cercano a un día de consumo), tramos expuestos al calor y proximidad a tuberías calientes; purgar y volver a medir.', 'Lectura en rango; medidas registradas.' FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=3);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 4, 'Cloro residual bajo: verificar el residual en la acometida y en la cisterna; ajustar la dosificación si la sede la tiene; avisar al proveedor de agua; tomar muestra; avisar a Control de Infecciones.', 'Residual restablecido; muestra registrada.' FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=4);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 5, 'Nivel bajo con entrada activa: verificar válvula de flotador, filtros de entrada, fugas en la red y consumo anormal; cerrar sectores con fuga.', 'Causa identificada; nivel en recuperación.' FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=5);
INSERT INTO aop_acciones (procedimiento_id, orden, accion, resultado_esperado)
SELECT p.id, 6, 'Evaluación de riesgo con Control de Infecciones ante lecturas repetidas o resultado de laboratorio fuera de norma: restricción de uso en el sector, purgas intensivas, limpieza de regaderas y, si se decide, desinfección del sector según el MOP-AGU-01; muestreo de confirmación.', 'Decisión escrita; resultado de confirmación.' FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM aop_acciones k WHERE k.procedimiento_id=p.id AND k.orden=6);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 0, 60, 'Mantenimiento General', 'Nivel bajo con entrada activa: causa identificada en 1 hora (flotador, filtros de entrada, fugas, consumo anormal) y sectores con fuga cerrados.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=0);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 1, 240, 'Control de Infecciones y proveedor de agua', 'Cloro residual bajo: corrección en 4 horas, dosificación ajustada, muestra tomada y aviso a Control de Infecciones.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=1);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 2, 1440, 'Control de Infecciones y Laboratorio', 'Corrección y nueva lectura de temperatura en 24 horas; dos lecturas consecutivas fuera de rango en el mismo punto o un resultado de laboratorio fuera de norma activan la evaluación de riesgo y el muestreo.', 0 FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=2);
INSERT INTO procedimiento_escalamientos (procedimiento_id, orden, minutos, avisar_cargo, accion, es_paso_a_eop)
SELECT p.id, 3, 0, 'Jefatura de Mantenimiento General y Control de Infecciones', 'Pérdida de suministro, cisterna sin entrada con autonomía bajo el umbral o evidencia de contaminación: pasa a EOP-AGU-01.', 1 FROM procedimientos p
WHERE p.codigo_corto='AOP-AGU-01' AND NOT EXISTS (SELECT 1 FROM procedimiento_escalamientos s WHERE s.procedimiento_id=p.id AND s.orden=3);
