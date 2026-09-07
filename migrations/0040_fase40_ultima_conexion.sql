-- Fase 40: registrar la última conexión de cada usuario.
-- Se actualiza en el endpoint de login (no en cada request, para no inflar
-- writes). Permite mostrar "última vez activo" en la administración de
-- usuarios y detectar cuentas no utilizadas.

ALTER TABLE usuarios ADD COLUMN ultima_conexion TEXT;
