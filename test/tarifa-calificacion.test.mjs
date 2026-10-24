// Tarifa de «Calificar con IA» por entrega y registro de movimientos (oct-2026).
// Funciones puras: no necesita emulador ni red. Va en un archivo propio para
// correr siempre, aunque otra parte de test/unidad.test.mjs se detenga antes.
//
//   node test/tarifa-calificacion.test.mjs

import assert from 'node:assert'
import {
  tituloMovimiento, importeMovimiento, saldoMovimiento, desgloseMovimiento, necesitaConsumoHistorico,
  esModeloAnterior, avisosMovimientos, tieneSaldoComprobable, INICIO_MODELO_CREDITOS, prepararMovimientos,
} from '../src/utils/movimientosCreditos.js'
import {
  evidenciasValidas, archivosDeEntrega, calcularCostoCalificacion, claveOperacionCalificacion,
  textoDesgloseCalificacion, mismaEstimacion, esEvidenciaSoportada, EVIDENCIAS_CFG,
  clasificarContenidoPdf, clasificarContenidoDocx, claseEntrega,
} from '../src/utils/tarifaCalificacionEvidencias.js'

let pasadas = 0
let fallos = 0
function caso(nombre, fn) {
  try { fn(); pasadas++; console.log(`  ✓ ${nombre}`) } catch (e) { fallos++; console.log(`  ✗ ${nombre}\n    ${e.message}`) }
}

caso('registro de movimientos · Créditos con dos decimales; el tono sale del signo (rojo −, verde +, neutro 0.00)', () => {
  assert.deepStrictEqual(importeMovimiento(-21.5), { texto: '−21.50', tono: 'cargo' })
  assert.deepStrictEqual(importeMovimiento(-12), { texto: '−12.00', tono: 'cargo' })
  assert.deepStrictEqual(importeMovimiento(30), { texto: '+30.00', tono: 'abono' })
  assert.deepStrictEqual(importeMovimiento(200), { texto: '+200.00', tono: 'abono' })
  assert.deepStrictEqual(importeMovimiento(-100), { texto: '−100.00', tono: 'cargo' }, 'ajuste negativo')
  assert.deepStrictEqual(importeMovimiento(100), { texto: '+100.00', tono: 'abono' }, 'ajuste positivo')
  assert.deepStrictEqual(importeMovimiento(0), { texto: '0.00', tono: 'neutro' })
})

caso('registro de movimientos · columna Saldo: el saldoDespues del ledger con dos decimales; sin dato, «—» (nunca se inventa)', () => {
  assert.strictEqual(saldoMovimiento({ saldoDespues: 10 }), '10.00')
  assert.strictEqual(saldoMovimiento({ saldoDespues: 43.5 }), '43.50')
  assert.strictEqual(saldoMovimiento({ saldoDespues: 0 }), '0.00')
  assert.strictEqual(saldoMovimiento({}), '—')
  assert.strictEqual(saldoMovimiento({ saldoDespues: null }), '—')
  assert.strictEqual(saldoMovimiento({ saldoDespues: 'x' }), '—')
})

caso('registro de movimientos · «Calificación de evidencias» es el concepto de las cuatro claves de entregables', () => {
  for (const operacion of ['calificar_entregable_ia', 'calificar_entregable_ia_imagenes', 'calificar_entregable_ia_lote', 'calificar_entregable_ia_lote_imagenes']) {
    assert.strictEqual(tituloMovimiento({ tipo: 'consumo', operacion, categoria: 'Otros' }), 'Calificación de evidencias', operacion)
  }
  assert.strictEqual(tituloMovimiento({ tipo: 'consumo', operacion: 'calificar_abierta' }), 'Calificación de respuesta abierta', 'las demás no cambian')
  assert.strictEqual(tituloMovimiento({ tipo: 'consumo', operacion: 'rubrica' }), 'Rúbrica con IA')
})

caso('registro de movimientos · desglose nuevo: «Lote · 10 entregas · 4 × 0.50 + 6 × 0.25 = 3.50 créditos»', () => {
  const detalle = { modo: 'lote', entregas: 10, conImagenes: 4, soloDocumentos: 6, tarifaImagenes: 0.5, tarifaDocumentos: 0.25, reservado: 3.5, cobrado: 3.5, devuelto: 0 }
  const m = { tipo: 'consumo', operacion: 'calificar_entregable_ia_lote', estado: 'aplicado', delta: -3.5, detalle }
  assert.strictEqual(desgloseMovimiento(m), 'Lote · 10 entregas · 4 × 0.50 + 6 × 0.25 = 3.50 créditos')
  const ind = { tipo: 'consumo', operacion: 'calificar_entregable_ia_imagenes', estado: 'aplicado', detalle: { modo: 'individual', entregas: 1, conImagenes: 1, soloDocumentos: 0, tarifaImagenes: 0.5, tarifaDocumentos: 0.25, devuelto: 0 } }
  assert.strictEqual(desgloseMovimiento(ind), 'Individual · 1 entrega · 1 × 0.50 = 0.50 créditos')
})

caso('registro de movimientos · desglose con fallo parcial: dice cuántas no se procesaron y lo devuelto, sin afirmar que se procesaron', () => {
  const m = {
    tipo: 'consumo', operacion: 'calificar_entregable_ia_lote', estado: 'aplicado', delta: -2.75,
    detalle: { modo: 'lote', entregas: 8, conImagenes: 3, soloDocumentos: 5, tarifaImagenes: 0.5, tarifaDocumentos: 0.25, noProcesadas: 2, reservado: 3.5, cobrado: 2.75, devuelto: 0.75 },
  }
  assert.strictEqual(desgloseMovimiento(m),
    'Lote · 8 entregas · 3 × 0.50 + 5 × 0.25 = 2.75 créditos · 2 no se pudieron procesar (sin cobro) · reservados 3.50, devueltos 0.75')
})

caso('registro de movimientos · sin cobro y otras operaciones: sin desglose', () => {
  const det = { modo: 'lote', entregas: 2, conImagenes: 2, soloDocumentos: 0, tarifaImagenes: 0.5, tarifaDocumentos: 0.25 }
  assert.strictEqual(desgloseMovimiento({ tipo: 'consumo', operacion: 'calificar_entregable_ia_lote', estado: 'sin_cobro', detalle: det }), null)
  assert.strictEqual(desgloseMovimiento({ tipo: 'consumo', operacion: 'rubrica', estado: 'aplicado' }), null)
  assert.strictEqual(desgloseMovimiento({ tipo: 'compra', estado: 'aplicado', delta: 200 }), null)
})

caso('registro de movimientos · histórico (sin detalle): solo lo comprobable con su consumo, sin tipo de evidencia', () => {
  const m = { tipo: 'consumo', operacion: 'calificar_entregable_ia_lote', estado: 'aplicado', delta: -6.5 }
  assert.ok(necesitaConsumoHistorico(m))
  assert.strictEqual(desgloseMovimiento(m, null), null, 'sin consumo leído no se muestra nada')
  assert.strictEqual(desgloseMovimiento(m, { creditosReales: 6.5, unidades: 26, resultado: { generadas: 26 } }),
    'Lote · 26 entregas × 0.25 = 6.50 créditos')
  const ind = { tipo: 'consumo', operacion: 'calificar_entregable_ia_imagenes', estado: 'aplicado', delta: -0.5 }
  assert.strictEqual(desgloseMovimiento(ind, { creditosReales: 0.5, unidades: 1 }), 'Individual · 1 entrega × 0.50 = 0.50 créditos')
  // Si la cuenta no cierra exacta, no se adivina.
  assert.strictEqual(desgloseMovimiento(m, { creditosReales: 6.5, resultado: { generadas: 3 } }), null)
  // Lote sin el conteo de generadas: no se supone.
  assert.strictEqual(desgloseMovimiento(m, { creditosReales: 6.5, unidades: 26 }), null)
  assert.ok(!necesitaConsumoHistorico({ ...m, detalle: { entregas: 1 } }), 'con detalle no hace falta leer el consumo')
})

// ── Tarifa de «Calificar con IA» por entrega (oct-2026) ───────────────────
const TARIFAS_CAL = { tarifas: {
  calificar_entregable_ia: 0.25, calificar_entregable_ia_imagenes: 0.5,
  calificar_entregable_ia_lote: 0.25, calificar_entregable_ia_lote_imagenes: 0.5,
} }
const arch = (...nombres) => nombres.map((n) => ({ nombre: n, url: `https://archivos.test/${n}` }))

const usadosDe = (...nombres) => evidenciasValidas(arch(...nombres)).usados.map((a) => a.ext)

caso('evidencias · JPG, JPEG y PNG en cualquier mayúscula son imagen; PDF y DOCX, documento', () => {
  assert.deepStrictEqual(usadosDe('a.JPG', 'b.jpeg', 'c.Png'), ['jpg', 'jpeg', 'png'])
  assert.deepStrictEqual(usadosDe('a.pdf', 'b.docx'), ['pdf', 'docx'])
})

caso('evidencias · formatos no reconocidos y sin extensión no cuentan (ni ocupan lugar en el tope)', () => {
  const r = evidenciasValidas(arch('a.gif', 'b.heic', 'c.webp', 'd.xlsx', 'e.doc'))
  assert.deepStrictEqual([r.usados.length, r.ignoradosPorFormato], [0, 5])
  assert.strictEqual(evidenciasValidas([{ nombre: 'foto', url: 'https://archivos.test/foto' }]).usados.length, 0)
  assert.strictEqual(evidenciasValidas([{ nombre: 'a.png' }]).usados.length, 0, 'sin URL no hay evidencia')
  assert.deepStrictEqual(usadosDe('a.pdf', 'z.gif', 'b.png'), ['pdf', 'png'])
})

caso('evidencias · la extensión sale del nombre y, si no hay nombre, de la URL', () => {
  assert.deepStrictEqual(evidenciasValidas([{ nombre: 'tarea.pdf', url: 'https://archivos.test/x.png' }]).usados.map((a) => a.ext), ['pdf'])
  assert.deepStrictEqual(evidenciasValidas([{ url: 'https://archivos.test/x.png?v=2' }]).usados.map((a) => a.ext), ['png'])
})

caso('evidencias · tope de 3 evidencias válidas por entrega', () => {
  const r = evidenciasValidas(arch('a.pdf', 'b.pdf', 'c.docx', 'd.png'))
  assert.strictEqual(r.usados.length, EVIDENCIAS_CFG.maxPorEntrega)
  assert.strictEqual(r.ignoradosPorTope, 1)
})

// ── Clasificación por CONTENIDO (regla definitiva de Kike, oct-2026) ───────
const pdfC = (o) => clasificarContenidoPdf({ tipoBase: 'texto', paginas: 1, caracteres: 600, imagenes: [], ...o }).clase

caso('PDF · texto sin imágenes = documentos (0.25); escaneado sin texto = imágenes (0.50)', () => {
  assert.strictEqual(pdfC({}), 'documentos')
  assert.strictEqual(pdfC({ tipoBase: 'visual', caracteres: 0, imagenes: [{ w: 800, h: 1000 }] }), 'imagenes')
})

caso('PDF · escaneado CON capa de texto de la app (mucho texto + imagen de página completa) = imágenes', () => {
  assert.strictEqual(pdfC({ caracteres: 2500, imagenes: [{ w: 1240, h: 1754 }] }), 'imagenes')
})

caso('PDF · texto con fotografía grande = imágenes; con logotipo o icono chico = documentos', () => {
  assert.strictEqual(pdfC({ imagenes: [{ w: 400, h: 300 }] }), 'imagenes')
  assert.strictEqual(pdfC({ imagenes: [{ w: 80, h: 80 }, { w: 120, h: 40 }] }), 'documentos')
})

caso('PDF · borde de 200 px por lado (el lado MENOR decide): 199 no es fotografía, 200 sí', () => {
  assert.strictEqual(pdfC({ imagenes: [{ w: 199, h: 900 }] }), 'documentos')
  assert.strictEqual(pdfC({ imagenes: [{ w: 200, h: 900 }] }), 'imagenes')
  assert.strictEqual(pdfC({ imagenes: [{ w: 900, h: 200 }] }), 'imagenes')
})

caso('PDF · borde de 200 caracteres por página: con imagen chica, 199 pide revisar dibujos; 200 ya es texto', () => {
  const logo = [{ w: 50, h: 50 }]
  assert.strictEqual(pdfC({ tipoBase: 'mixto', caracteres: 199, imagenes: logo, trazosVectoriales: false }), 'documentos')
  assert.strictEqual(pdfC({ tipoBase: 'mixto', caracteres: 199, imagenes: logo, trazosVectoriales: true }), 'imagenes')
  assert.strictEqual(pdfC({ caracteres: 200, imagenes: logo }), 'documentos', 'con ≥200 no hace falta revisar dibujos')
  const r = clasificarContenidoPdf({ tipoBase: 'mixto', paginas: 1, caracteres: 199, imagenes: logo })
  assert.ok(r.requiereTrazos, 'sin revisar los dibujos no se decide')
})

caso('PDF · poco texto: escaneo en tiras (muchas imágenes chicas que suman una foto) = imágenes', () => {
  const tiras = Array.from({ length: 10 }, () => ({ w: 1000, h: 50 }))
  assert.strictEqual(pdfC({ tipoBase: 'mixto', caracteres: 20, imagenes: tiras }), 'imagenes')
})

caso('PDF · en blanco = vacío (no es evidencia); dañado o revisión que no terminó = incierta', () => {
  assert.strictEqual(pdfC({ tipoBase: 'vacio', caracteres: 0 }), 'vacio')
  assert.strictEqual(pdfC({ tipoBase: 'invalido', paginas: 0, caracteres: 0 }), 'incierta')
  const r = clasificarContenidoPdf({ tipoBase: 'incierto', paginas: 3 })
  assert.deepStrictEqual([r.clase, r.reintentable], ['incierta', true])
  const t = clasificarContenidoPdf({ tipoBase: 'mixto', paginas: 1, caracteres: 30, imagenes: [], trazosVectoriales: null })
  assert.deepStrictEqual([t.clase, t.reintentable], ['incierta', true])
})

caso('PDF · imagen cuyo tamaño no se pudo medir = incierta (no se adivina si es foto o logotipo)', () => {
  assert.strictEqual(pdfC({ imagenes: [{ w: null, h: null }] }), 'incierta')
  assert.strictEqual(pdfC({ imagenes: [{ w: null, h: null }, { w: 900, h: 900 }] }), 'imagenes', 'si ya hay una foto medida, el precio es seguro')
})

const docxC = (o) => clasificarContenidoDocx({ ok: true, texto: 'Reporte', imagenes: [], ...o }).clase

caso('Word · solo texto = documentos; con fotografía insertada = imágenes; con icono chico = documentos', () => {
  assert.strictEqual(docxC({}), 'documentos')
  assert.strictEqual(docxC({ imagenes: [{ w: 600, h: 400, legible: true }] }), 'imagenes')
  assert.strictEqual(docxC({ imagenes: [{ w: 48, h: 48, legible: true }] }), 'documentos')
  assert.strictEqual(docxC({ texto: '', imagenes: [{ w: 600, h: 400, legible: true }] }), 'imagenes', 'solo foto, sin texto')
})

caso('Word · dañado, imagen sin medida o fotografía en formato ilegible = incierta; vacío = vacío', () => {
  assert.strictEqual(clasificarContenidoDocx({ ok: false }).clase, 'incierta')
  assert.strictEqual(docxC({ imagenes: [{ w: null, h: null, legible: true }] }), 'incierta')
  assert.strictEqual(docxC({ imagenes: [{ w: 800, h: 600, legible: false }] }), 'incierta')
  assert.strictEqual(docxC({ texto: '', imagenes: [{ w: 30, h: 30, legible: true }] }), 'vacio')
})

caso('entrega · una sola clase por entrega: cualquier incierta manda; si no, cualquier imagen; en blanco no cuenta', () => {
  assert.strictEqual(claseEntrega(['documentos', 'imagenes', 'documentos']), 'imagenes')
  assert.strictEqual(claseEntrega(['documentos', 'documentos']), 'documentos')
  assert.strictEqual(claseEntrega(['imagenes', 'incierta']), 'incierta')
  assert.strictEqual(claseEntrega(['vacio', 'documentos']), 'documentos')
  assert.strictEqual(claseEntrega(['vacio']), null)
  assert.strictEqual(claseEntrega([]), null)
  const c = calcularCostoCalificacion({ tipos: [claseEntrega(['documentos', 'imagenes', 'imagenes'])], tarifas: TARIFAS_CAL, modo: 'individual' })
  assert.strictEqual(c.total, 0.5, 'varios archivos con imagen cuestan 0.50 en total, no por archivo')
})

caso('tarifa por entrega · archivos de la entrega: archivos[], par legacy y «completada sin archivo»', () => {
  assert.deepStrictEqual(archivosDeEntrega({ archivos: [{ url: 'u1', nombre: 'a.png' }, { nombre: 'sinurl.pdf' }] }), [{ url: 'u1', nombre: 'a.png' }])
  assert.deepStrictEqual(archivosDeEntrega({ archivoURL: 'u2', nombreArchivo: 'b.pdf' }), [{ url: 'u2', nombre: 'b.pdf' }])
  assert.deepStrictEqual(archivosDeEntrega({ completadoSinArchivo: true, archivos: [{ url: 'u3', nombre: 'c.png' }] }), [])
  assert.deepStrictEqual(archivosDeEntrega(null), [])
})

caso('tarifa por entrega · lote de 4 con imágenes + 6 solo documentos = 3.50, con su desglose', () => {
  const tipos = [...Array(4).fill('imagenes'), ...Array(6).fill('documentos')]
  const c = calcularCostoCalificacion({ tipos, tarifas: TARIFAS_CAL, modo: 'lote' })
  assert.deepStrictEqual(c, { modo: 'lote', entregas: 10, conImagenes: 4, soloDocumentos: 6, tarifaImagenes: 0.5, tarifaDocumentos: 0.25, total: 3.5 })
  assert.strictEqual(textoDesgloseCalificacion(c), 'Lote · 10 entregas · 4 × 0.50 + 6 × 0.25 = 3.50 créditos')
  assert.strictEqual(claveOperacionCalificacion(c), 'calificar_entregable_ia_lote', 'lote mixto: clave base')
  assert.strictEqual(claveOperacionCalificacion({ ...c, conImagenes: 10, soloDocumentos: 0 }), 'calificar_entregable_ia_lote_imagenes')
})

caso('tarifa por entrega · individual y lote dan lo mismo para la misma entrega', () => {
  const tipo = claseEntrega(['imagenes', 'documentos'])
  const ind = calcularCostoCalificacion({ tipos: [tipo], tarifas: TARIFAS_CAL, modo: 'individual' })
  const lote = calcularCostoCalificacion({ tipos: [tipo], tarifas: TARIFAS_CAL, modo: 'lote' })
  assert.strictEqual(ind.total, lote.total)
  assert.strictEqual(ind.total, 0.5)
})

caso('tarifa por entrega · sin las tarifas configuradas no hay costo (no se cobra a ciegas)', () => {
  assert.strictEqual(calcularCostoCalificacion({ tipos: ['imagenes'], tarifas: { tarifas: { calificar_entregable_ia: 0.25 } }, modo: 'individual' }), null)
  assert.strictEqual(calcularCostoCalificacion({ tipos: ['imagenes'], tarifas: undefined, modo: 'lote' }), null)
})

caso('tarifa por entrega · mismaEstimacion: cualquier diferencia (firma, conteo, tarifa, total) obliga a confirmar de nuevo', () => {
  const base = { firma: 'abc', entregas: 10, conImagenes: 4, soloDocumentos: 6, tarifaImagenes: 0.5, tarifaDocumentos: 0.25, total: 3.5 }
  assert.ok(mismaEstimacion(base, { ...base }))
  for (const cambio of [{ firma: 'otra' }, { entregas: 9 }, { conImagenes: 5 }, { soloDocumentos: 5 }, { tarifaImagenes: 0.6 }, { tarifaDocumentos: 0.3 }, { total: 1 }, { noClasificables: [{ submissionId: 'x' }] }]) {
    assert.ok(!mismaEstimacion({ ...base, ...cambio }, base), JSON.stringify(cambio))
  }
  assert.ok(!mismaEstimacion(null, base))
  assert.ok(!mismaEstimacion(base, null))
})

// La pantalla (activity/utilidades.js → isEvidenciaSoportada) delega en esta
// misma función: así cuenta las mismas entregas candidatas que el servidor.
caso('tarifa por entrega · qué archivo es evidencia válida (misma regla en pantalla y servidor)', () => {
  for (const [n, u, esperado] of [['a.png', 'x', true], ['a.JPEG', 'x', true], ['a.pdf', 'x', true], ['a.docx', 'x', true], ['a.doc', 'x', false], ['a.gif', 'x', false], ['', 'https://archivos.test/a.png', true], ['foto', 'https://archivos.test/a.png', false]]) {
    assert.strictEqual(esEvidenciaSoportada(n, u), esperado, `${n} ${u}`)
  }
})

// ── Avisos del registro (A/B) — solo presentación, nunca cambian importes ni saldos ──
const ts = (iso) => ({ toMillis: () => Date.parse(iso) })

caso('registro · modelo anterior = antes del corte de la migración (20-ago 23:20 hora de México)', () => {
  assert.strictEqual(INICIO_MODELO_CREDITOS, '21-ago-2026')
  assert.strictEqual(esModeloAnterior({ fecha: ts('2026-08-20T20:17:06Z') }), true, 'último cobro del modelo anterior')
  assert.strictEqual(esModeloAnterior({ fecha: ts('2026-08-21T04:20:27Z') }), false, 'primer cobro que cuenta en consumidoTotal')
  assert.strictEqual(esModeloAnterior({ fecha: ts('2026-10-24T10:00:00Z') }), false)
  assert.strictEqual(esModeloAnterior({ fecha: { seconds: Date.parse('2026-08-10T00:00:00Z') / 1000 } }), true, 'Timestamp sin toMillis')
  assert.strictEqual(esModeloAnterior({}), false, 'sin fecha no se marca')
  assert.strictEqual(esModeloAnterior(null), false)
})

caso('registro · avisos del mes según las filas que se muestran', () => {
  assert.deepStrictEqual(avisosMovimientos([]), { sinSaldo: false, modeloAnterior: false }, 'mes vacío: sin avisos')
  const octubre = [{ fecha: ts('2026-10-24T10:00:00Z'), saldoDespues: 24 }, { fecha: ts('2026-10-02T01:40:00Z'), origen: 'historico' }]
  assert.deepStrictEqual(avisosMovimientos(octubre), { sinSaldo: true, modeloAnterior: false })
  assert.deepStrictEqual(avisosMovimientos([octubre[0]]), { sinSaldo: false, modeloAnterior: false }, 'todo con saldo: sin aviso')
  const agosto = [{ fecha: ts('2026-08-25T10:00:00Z') }, { fecha: ts('2026-08-15T10:00:00Z') }]
  assert.deepStrictEqual(avisosMovimientos(agosto), { sinSaldo: true, modeloAnterior: true })
  assert.strictEqual(tieneSaldoComprobable({ saldoDespues: 0 }), true, 'saldo 0 sí es comprobable')
  assert.strictEqual(tieneSaldoComprobable({ saldoDespues: NaN }), false)
})

caso('registro · los avisos no cambian importes, saldos ni orden de las filas', () => {
  const filas = [
    { id: 'a', fecha: ts('2026-08-15T10:00:00Z'), tipo: 'consumo', delta: -5, origen: 'historico' },
    { id: 'b', fecha: ts('2026-10-06T03:33:24Z'), tipo: 'ajuste', delta: 30, saldoDespues: 30.5, origen: 'historico' },
  ]
  const copia = JSON.stringify(filas)
  avisosMovimientos(filas)
  filas.forEach(esModeloAnterior)
  assert.strictEqual(JSON.stringify(filas), copia, 'no muta los movimientos')
  assert.deepStrictEqual(prepararMovimientos(filas).map((m) => [m.id, importeMovimiento(m.delta).texto, saldoMovimiento(m)]), [['b', '+30.00', '30.50'], ['a', '−5.00', '—']])
})

console.log(`\n${pasadas} pasaron, ${fallos} fallaron`)
if (fallos) process.exit(1)
