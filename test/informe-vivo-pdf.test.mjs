// Participación en vivo · «Informe en PDF»: plan puro (qué va y en qué orden), sin Firebase ni jsPDF.
// Archivo propio: test/unidad.test.mjs hoy se interrumpe antes del final por fallos previos ajenos a esto.
import assert from 'node:assert'

let pasadas = 0
const fallos = []
const caso = (nombre, fn) => {
  try { fn(); console.log('  ✓', nombre); pasadas++ }
  catch (e) { console.log('  ✗', nombre); console.log('     ', e.message.split('\n')[0]); fallos.push({ nombre, e }) }
}
const grupo = (t) => console.log(`\n── ${t}`)

// ── Participación en vivo · «Informe en PDF» (plan puro: qué va y en qué orden) ───────
grupo('participación en vivo — plan del informe en PDF con notas del docente')
{
  const { planInformeVivoPDF, participantesVivo, AVISO_IA_VIVO } = await import('../src/utils/informeVivoPDF.js')
  const sesion = {
    codigo: 'ABCDEFGHJK', titulo: 'Diagnóstico MCCEMS', proposito: 'encuesta', acceso: 'externo', analisisActivo: true,
    preguntas: [{ id: 'p1' }, { id: 'p2' }], creadaEn: new Date('2026-10-23T15:00:00Z'),
  }
  const respuestas = [{ participanteKey: 'a' }, { participanteKey: 'a' }, { participanteKey: 'b' }, { alumnoId: 'c' }]
  const informe = {
    estado: 'listo', actualizadoEn: new Date('2026-10-23T16:00:00Z'),
    informe: { sintesis: 'El grupo prioriza la formación.', comprende: ['Formación docente'], noComprende: [], siguientePaso: { tipo: 'aclarar', texto: 'Conversar los resultados.' }, actividadBreve: 'Lluvia de ideas', limitaciones: 'Muestra pequeña.' },
  }
  const titulos = (p) => p.secciones.map((s) => s.titulo)

  caso('informe listo: apartados en el orden de pantalla, aviso de IA y notas al final, separadas', () => {
    const p = planInformeVivoPDF({ sesion, informe, respuestas, notas: 'Acuerdo 1\n\nSeguimiento: viernes' })
    assert.deepStrictEqual(titulos(p), ['Síntesis', 'Opiniones en las que coinciden', 'Temas con división o sin consenso', 'Siguiente paso: Conversar con el grupo', 'Limitaciones', 'Notas del docente'])
    assert.strictEqual(p.aviso, AVISO_IA_VIVO)
    assert.strictEqual(p.titulo, 'Diagnóstico MCCEMS')
    assert.ok(p.lineas[1].startsWith('2 preguntas · 3 participantes · 4 respuestas'), p.lineas[1])
    const notas = p.secciones.at(-1)
    assert.strictEqual(notas.tono, 'docente', 'las notas no van con el tono de la IA')
    assert.deepStrictEqual(notas.bloques.map((b) => b.tipo), ['parrafo', 'espacio', 'parrafo'], 'se respetan los renglones del docente')
    assert.ok(p.secciones.find((s) => s.titulo.startsWith('Siguiente paso')).bloques.some((b) => b.texto === 'Actividad breve: Lluvia de ideas'))
    assert.deepStrictEqual(p.secciones[2].bloques, [{ tipo: 'nota', texto: 'Sin elementos en este apartado.' }], 'apartado vacío: se dice, no se inventa')
  })

  caso('sin análisis de IA: sin aviso de IA, lo dice, y aun así lleva las notas', () => {
    const p = planInformeVivoPDF({ sesion: { ...sesion, analisisActivo: false }, informe: null, respuestas, notas: 'Observé poca participación' })
    assert.strictEqual(p.aviso, null)
    assert.deepStrictEqual(titulos(p), ['Informe de la sesión', 'Notas del docente'])
    assert.match(p.secciones[0].bloques[0].texto, /no se activó el análisis/)
  })

  caso('muestra insuficiente, informe sin generar y sin notas: se dice tal cual', () => {
    const ins = planInformeVivoPDF({ sesion, informe: { estado: 'insuficiente', motivo: 'pocas respuestas' }, respuestas: [], notas: '   ' })
    assert.match(ins.secciones[0].bloques[0].texto, /Muestra insuficiente: pocas respuestas/)
    assert.deepStrictEqual(ins.secciones.at(-1).bloques, [{ tipo: 'nota', texto: 'Sin notas del docente.' }])
    const err = planInformeVivoPDF({ sesion, informe: { estado: 'error' }, respuestas: [] })
    assert.match(err.secciones[0].bloques[0].texto, /no estaba disponible/)
  })

  caso('diagnóstico (no encuesta): rótulos de comprensión y conteo de participantes', () => {
    const p = planInformeVivoPDF({ sesion: { ...sesion, proposito: 'diagnostico' }, informe, respuestas })
    assert.deepStrictEqual(titulos(p).slice(1, 4), ['Lo que el grupo comprende', 'Lo que aún no comprende', 'Siguiente paso: Aclarar con un ejemplo'])
    assert.strictEqual(participantesVivo(respuestas), 3)
  })
}

if (fallos.length) {
  console.log(`${pasadas} pasaron, ${fallos.length} FALLARON`)
  process.exit(1)
}
console.log(`ALL ${pasadas} INFORME VIVO PDF CHECKS PASSED`)
