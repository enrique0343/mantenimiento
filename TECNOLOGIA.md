# Tecnología: inventario, custodia y soporte

Tecnología comparte la aplicación, las sedes, las ubicaciones y las cuentas con General y Biomédico. Tiene inventario, solicitudes, órdenes y preventivos propios. No reclasifica equipos ni modifica cuentas existentes automáticamente.

## Uso

1. Seleccionar **Tecnología** en el selector superior. Administración conserva acceso global; una cuenta técnica necesita la especialidad **Tecnología**, asignada desde Usuarios por un administrador.
2. Abrir **Inventario → Nuevo equipo**. Elegir categoría, por ejemplo computadora, impresora o switch. El código interno se genera con prefijo `TEC`. La ficha técnica es opcional; incluye datos de hardware y de red. En **Persona responsable del equipo** se puede escribir libremente el nombre del colaborador; también es opcional y su asignación inicial queda en el historial. Los textos del inventario se normalizan a mayúsculas.
3. En la ficha, abrir **Custodia y traslado**. El nombre de la persona se escribe libremente, sin elegir de un listado ni crearle una cuenta. También se puede asignar o reasignar desde Editar. El custodio es quien utiliza o resguarda el equipo; el responsable de mantenimiento sigue siendo un campo independiente.
4. Usar **Reasignar**, **Devolver** o **Trasladar** para registrar cambios con motivo. El historial conserva persona, ubicación y sede anteriores y nuevas, fecha, autor y motivo. Una devolución sin nueva ubicación mantiene la ubicación física hasta que se registre el traslado.
5. Usar **Solicitar soporte** desde el equipo. El formulario autenticado preselecciona equipo, ubicación y sede; si aún no tiene ubicación, conserva el equipo y solicita elegir la sede. El formulario es único y permite elegir General, Biomédico o Tecnología, incluso si se abrió desde una interfaz concreta. La solicitud se vincula a la orden de trabajo al asignarla o convertirla. La ficha permite consultar solicitudes y órdenes relacionadas.

El filtro **Asignado a** del inventario permite localizar custodios y equipos sin asignar. Mientras ese filtro esté activo no se ofrece exportación: el CSV actual no incluye custodia. La ficha contiene el historial completo paginado.

## Permisos y datos

- `admin` y `visualizador` mantienen su alcance global. `jefe`, `tecnico` y demás roles siguen sus permisos existentes y su especialidad. La especialidad `tecnologia` habilita únicamente ese espacio; `ambos` y el valor vacío conservan el alcance anterior General/Biomédico.
- Solo administración, jefatura y técnicos autorizados pueden modificar custodia. Visualización es de lectura. Ser custodio no concede permisos de mantenimiento.
- El solicitante consulta únicamente sus solicitudes. Los comentarios internos permanecen privados. Los enlaces públicos de soporte muestran identificación mínima del equipo, sin IP, MAC ni datos de custodia.
- El historial de custodia es inmutable. No se permite borrar un equipo con ese historial ni trasladarlo silenciosamente por edición, importación o asignación masiva. Dos cambios simultáneos se controlan por revisión; los reintentos del mismo movimiento no duplican eventos.
- No se almacenan contraseñas de dispositivos, credenciales de red ni información clínica.

## Integración y compatibilidad

Se reutiliza el helpdesk de solicitudes y órdenes de Mantenimiento. No se configura un conector externo ni se afirma comunicación con un proveedor de helpdesk adicional. El contrato privado vigente con SGO conserva sus cuatro áreas y no incorpora Tecnología de forma implícita. Ampliarlo requiere una versión explícita del contrato y su correspondencia de permisos e identificadores en SGO.

Se conservan las fórmulas, plazos, series de órdenes y registros anteriores. El área y el espacio determinan la separación, no el prefijo histórico de las órdenes.

## Cambios de base y comprobaciones

- `0060_tecnologia_espacio.sql`: amplía las restricciones de área y especialidad sin reconstruir tablas principales. Conserva claves, datos, índices, disparadores y vistas de integración.
- `0061_tecnologia_custodia.sql`: agrega estado de custodia, eventos inmutables y protección de movimientos.
- `npm test`: regresiones existentes y pruebas de Tecnología, permisos, trazabilidad, concurrencia y migraciones.
- `npm run build` seguido de `npm run test:panorama:ssr`: páginas servidas y formularios ejecutados en DOM, incluyendo preselección de soporte y custodia.

Las pruebas usan información ficticia y bloquean correo, Telegram y conexiones externas. Antes de publicar se consulta el esquema real y los conteos agregados; se registra un punto de recuperación de D1 sin exportar registros personales.
