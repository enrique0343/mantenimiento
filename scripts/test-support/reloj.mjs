// Las capturas de estas pruebas son de «hace 45 minutos» y la ronda solo acepta horas
// de su turno. Sin reloj fijo, la prueba falla o pasa según la hora en que corra el CI.
// Corre siempre a media mañana de hoy, salvo que RELOJ_PRUEBA pida otra hora para
// ensayar los bordes: RELOJ_PRUEBA=2026-11-08T00:30:00-06:00 node scripts/test-ronda.mjs
export function fijarReloj(momento = process.env.RELOJ_PRUEBA) {
  const Real = Date;
  const hoySV = new Real(Real.now() - 6 * 3_600_000).toISOString().slice(0, 10);
  const inicio = Real.parse(momento || `${hoySV}T10:30:00-06:00`);
  const arranque = Real.now();
  const ahora = () => inicio + (Real.now() - arranque);
  globalThis.Date = class extends Real {
    constructor(...args) { if (args.length) super(...args); else super(ahora()); }
    static now() { return ahora(); }
  };
}
