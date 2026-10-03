// Starting inspection vocabulary, not a technical frequency or hospital compliance claim.
// Each installation must choose its points, criteria, cadence and qualified staff.
export const ROUND_GROUPS = [
 ['drenaje','Drenaje sanitario',['Desalojo, retorno y olores anormales','Fugas y humedad visible']],
 ['agua','Agua fría y caliente',['Fugas y disponibilidad','Alarmas y lecturas autorizadas']],
 ['hvac','HVAC y condensados',['Condición, alarmas y ruido','Condensados y humedad','Historial preventivo del equipo']],
 ['cubiertas','Humedad, cubiertas y pluviales',['Filtraciones y plafones','Condición visible de cubiertas y pluviales']],
 ['electricidad','Electricidad y respaldo',['Alarmas y disponibilidad','Condición visible sin maniobras eléctricas']],
 ['puertas','Puertas, cerraduras y mobiliario',['Operación segura y herrajes','Mobiliario fijo y circulación']],
 ['elevadores','Elevadores',['Nivelación, puertas y anomalías reportadas']],
 ['cocina','Cocina, extracción y refrigeración',['Extracción y fugas','Alarmas de frío y drenajes']],
 ['incendio','Protección contra incendio',['Rutas y puertas libres','Alarmas y dispositivos visibles']],
 ['higiene','Limpieza, residuos y plagas',['Condición de residuos','Humedad y evidencia de plagas']],
 ['gases','Gases medicinales y servicios clínicos',['Alarmas y disponibilidad sin manipulación']],
].map(([code,name,points]) => ({code:code as string,name:name as string,points:(points as string[]).map((label,index)=>({code:`${code}-${index+1}`,label,criterion:''}))}));
