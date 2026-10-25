// Datos de DEMOSTRACIÓN para el emulador local (project demo-esqueletos). Nunca toca producción.
//
// Llena el emulador con un ciclo escolar creíble (CBTIS 255, agosto–enero, 3 parciales)
// para capturas de Google Play y el video de demostración: una docente con 4 asignaturas,
// listas completas, actividades calificadas y por calificar, horario semanal, eventos de
// esta semana, asistencias desde el inicio del curso, avisos y bitácora de notificaciones.
//
// Uso (con los emuladores YA corriendo: Firestore 127.0.0.1:8080, Auth 127.0.0.1:9099):
//   node scripts/emulador/sembrar-demo.cjs
//
// ⚠️ Antes de sembrar BORRA TODO el emulador (Firestore y Auth). Las fechas se calculan
// a partir de HOY, así que conviene volver a correrlo el mismo día de las capturas.
//
// Cuentas (misma contraseña que sembrar-docente.cjs; no se imprime):
//   docente  docente.prueba@evalua.test        → /docente
//   alumna   ANLO (anlo.cbtis255@evalua.local)  → /alumno
//
// Imprime al final una línea JSON con los ids útiles.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
const path = require('path')
const { pathToFileURL } = require('url')
const admin = require('../../seeds-db/node_modules/firebase-admin')
const PROYECTO = 'demo-esqueletos'
admin.initializeApp({ projectId: PROYECTO })
const auth = admin.auth(), db = admin.firestore()
const { Timestamp } = admin.firestore
const CLAVE = 'PruebaEmu-2026!'
const ESCUELA = { id: 'CBTIS255', shortName: 'CBTIS 255', nombre: 'Centro de Bachillerato Tecnológico industrial y de servicios No. 255' }

const raiz = path.resolve(__dirname, '../..')
const importar = (rel) => import(pathToFileURL(path.join(raiz, rel)).href)

// ─── Azar determinista: la misma semilla da las mismas calificaciones ────────
let semilla = 255
function azar() {
  semilla = (semilla * 1103515245 + 12345) % 2147483648
  return semilla / 2147483648
}

// ─── Fechas (hora local) ─────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const isoLocal = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const deFecha = (s, hh = 12, mm = 0) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, hh, mm) }
const masDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
// n días hábiles (lun–vie) desde d; n puede ser negativo.
function diasHabiles(d, n) {
  const x = new Date(d)
  const paso = n < 0 ? -1 : 1
  let falta = Math.abs(n)
  while (falta > 0) { x.setDate(x.getDate() + paso); const w = x.getDay(); if (w !== 0 && w !== 6) falta-- }
  return x
}
const conHora = (d, hh, mm = 0) => { const x = new Date(d); x.setHours(hh, mm, 0, 0); return x }
const ts = (d) => Timestamp.fromDate(d)

const HOY = new Date()
const HOY_ISO = ymd(HOY)
// Ciclo agosto–enero que contiene a hoy (en febrero–julio, el que acaba de terminar).
const Y = HOY.getMonth() >= 7 ? HOY.getFullYear() : HOY.getFullYear() - 1
const CURSO = { inicio: `${Y}-08-03`, fin: `${Y + 1}-01-15` }
const PARCIALES_FECHAS = [
  { inicio: `${Y}-08-03`, fin: `${Y}-09-18` },
  { inicio: `${Y}-09-19`, fin: `${Y}-11-06` },
  { inicio: `${Y}-11-07`, fin: `${Y + 1}-01-15` },
]
const ASUETOS = [`${Y}-09-16`, `${Y}-11-02`, `${Y}-11-16`]
const VACACIONES = { fechaInicio: `${Y}-12-19`, fechaFin: `${Y + 1}-01-06` }
const ALTA = new Date(Y, 6, 28, 10, 0) // alta de los estudiantes: antes del inicio del curso

// ─── Personas ────────────────────────────────────────────────────────────────
const GRUPO_3A = [
  ['Diego', 'Aguilar', 'Méndez'], ['Fernanda', 'Barrera', 'Soto'], ['Emiliano', 'Castillo', 'Ramírez'],
  ['Valeria', 'Cruz', 'Hernández'], ['Santiago', 'Domínguez', 'Peña'], ['Ximena', 'Flores', 'Gutiérrez'],
  ['Mateo', 'García', 'Morales'], ['Camila', 'Jiménez', 'Rojas'], ['Ana', 'López', 'Ortega'],
  ['Leonardo', 'Martínez', 'Vega'], ['Regina', 'Mendoza', 'Castro'], ['Sebastián', 'Navarro', 'Salinas'],
  ['Renata', 'Ortiz', 'Delgado'], ['Iker', 'Pérez', 'Aguirre'], ['Sofía', 'Ramírez', 'Fuentes'],
  ['Rodrigo', 'Reyes', 'Cabrera'], ['María José', 'Sánchez', 'Luna'], ['Alejandro', 'Torres', 'Ibarra'],
  ['Daniela', 'Vargas', 'Medina'], ['Andrés', 'Zamora', 'Ríos'],
]
const GRUPO_3B = [
  ['Joaquín', 'Acosta', 'Lara'], ['Paola', 'Bautista', 'Rivera'], ['Ángel', 'Campos', 'Espinoza'],
  ['Natalia', 'Contreras', 'Mejía'], ['Luis Fernando', 'Durán', 'Becerra'], ['Itzel', 'Espinosa', 'Cortés'],
  ['Gael', 'Guerrero', 'Sandoval'], ['Mariana', 'Herrera', 'Pacheco'], ['Kevin', 'Juárez', 'Ochoa'],
  ['Andrea', 'Lozano', 'Treviño'], ['Bruno', 'Medina', 'Villalobos'], ['Alexa', 'Molina', 'Rosales'],
  ['Héctor', 'Núñez', 'Galván'], ['Montserrat', 'Rangel', 'Tapia'], ['Carlos', 'Ríos', 'Montoya'],
  ['Abril', 'Salazar', 'Vázquez'], ['Jesús', 'Trejo', 'Arellano'], ['Evelyn', 'Valdez', 'Cervantes'],
]
const GRUPO_5C = [
  ['Óscar', 'Álvarez', 'Robles'], ['Brenda', 'Cárdenas', 'Pineda'], ['Uriel', 'Chávez', 'Solís'],
  ['Melissa', 'Estrada', 'Zúñiga'], ['Jorge', 'Figueroa', 'León'], ['Karla', 'Gómez', 'Serrano'],
  ['Ricardo', 'Ibarra', 'Quintero'], ['Lizbeth', 'Lara', 'Montes'], ['Axel', 'Maldonado', 'Paredes'],
  ['Dana', 'Morales', 'Cisneros'], ['Fernando', 'Ponce', 'Gallegos'], ['Jimena', 'Rosas', 'Carrillo'],
  ['Emmanuel', 'Silva', 'Avila'], ['Vanessa', 'Téllez', 'Padilla'], ['Iván', 'Villa', 'Saucedo'],
  ['Arely', 'Zavala', 'Hidalgo'],
]

// Mismo criterio que generateUsername() en src/utils/generate.js.
function usuario(nombre, paterno) {
  const limpio = (s) => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[ñÑ]/g, 'n').replace(/[^a-zA-Z]/g, '').toLowerCase()
  return `${limpio(paterno) || 'x'}.${limpio(nombre.trim().split(/\s+/)[0]) || 'x'}`
}

// ─── Escritura en lotes ──────────────────────────────────────────────────────
let lote = db.batch(), enLote = 0, escritos = 0
async function poner(ref, data) {
  lote.set(ref, data); enLote++; escritos++
  if (enLote >= 450) { await lote.commit(); lote = db.batch(); enLote = 0 }
}
async function vaciarLote() { if (enLote) { await lote.commit(); lote = db.batch(); enLote = 0 } }

async function borrarEmulador() {
  const fs = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`, { method: 'DELETE' })
  const au = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROYECTO}/accounts`, { method: 'DELETE' })
  if (!fs.ok || !au.ok) throw new Error(`No se pudo vaciar el emulador (firestore ${fs.status}, auth ${au.status}). ¿Están corriendo?`)
}

;(async () => {
  const { generarBloques } = await importar('src/utils/horarioBloques.js')
  const { parcialForDate } = await importar('src/utils/parciales.js')
  const { resumenAsistencia } = await importar('src/utils/asistenciaResumen.js')
  const parcialDe = (fechaISO) => parcialForDate(PARCIALES_FECHAS, fechaISO) || 1

  await borrarEmulador()

  // ── Escuela, docente y configuración ───────────────────────────────────────
  await db.doc(`schools/${ESCUELA.id}`).set({ claveSEP: ESCUELA.id, shortName: ESCUELA.shortName, nombre: ESCUELA.nombre, municipio: 'Ecatepec de Morelos', estado: 'MÉXICO' })
  const docente = await auth.createUser({ email: 'docente.prueba@evalua.test', password: CLAVE, emailVerified: true, displayName: 'Laura Hernández Ríos' })
  const uid = docente.uid
  const perfil = {
    role: 'docente', username: 'CBTIS255-07', email: 'docente.prueba@evalua.test',
    nombre: 'Laura', apellidoPaterno: 'Hernández', apellidoMaterno: 'Ríos',
    nombreMostrar: 'Laura Hernández', prefijo: 'Mtra.',
    escuelaId: ESCUELA.id, schoolName: ESCUELA.shortName, estado: 'MÉXICO', municipio: 'Ecatepec de Morelos',
    provider: 'password', hasLocalPassword: true, profileComplete: true, mostrarFotoAlumnos: true,
    createdAt: ts(new Date(Y, 6, 20, 9, 0)),
  }
  await db.doc(`users/${uid}`).set(perfil)
  await db.doc(`publicProfiles/${uid}`).set({ nombreMostrar: perfil.nombreMostrar, prefijo: perfil.prefijo, nombre: perfil.nombre, mostrarFotoAlumnos: true })
  await db.doc(`iaCreditos/${uid}`).set({
    saldo: 120, consumidoTotal: 38,
    consumoPorCategoria: { rubricas: 14, actividades: 12, evaluaciones: 8, planeacion: 4 },
    updatedAt: ts(masDias(HOY, -3)),
  })
  await db.doc(`iaTrialRegistro/${uid}`).set({ bienvenidaDisponible: true, bienvenidaActivada: true, activadaEn: ts(new Date(Y, 6, 21)) })
  try {
    const { TARIFAS } = require('../../seeds-db/seed-ia-tarifas.js')
    await db.doc('config/iaTarifas').set(TARIFAS)
  } catch { /* sin tarifas la barra de créditos solo no muestra estimaciones */ }

  // ── Asignaturas ────────────────────────────────────────────────────────────
  // dias: 0 = lunes … 4 = viernes (diaSemanaLunes en utils/horarioBloques.js)
  const ASIGNATURAS = [
    { clave: 'mat3a', nombre: 'Matemáticas III', grupo: '3A', colorPalette: 'default', icon: 'sigma', accessCode: '8SU0JB', bloque: 'blue', lugar: 'Aula 12',
      horario: [[0, '07:00'], [2, '07:00'], [4, '09:00']], alumnos: GRUPO_3A },
    { clave: 'fis3a', nombre: 'Física I', grupo: '3A', colorPalette: 'orange', icon: 'atom', accessCode: 'K3P9QX', bloque: 'orange', lugar: 'Laboratorio de Física',
      horario: [[1, '10:00'], [3, '07:50']], alumnos: GRUPO_3A },
    { clave: 'mat3b', nombre: 'Matemáticas III', grupo: '3B', colorPalette: 'teal', icon: 'ruler', accessCode: 'M2N7ZT', bloque: 'teal', lugar: 'Aula 14',
      horario: [[1, '07:00'], [3, '09:40'], [4, '11:20']], alumnos: GRUPO_3B },
    { clave: 'pro5c', nombre: 'Programación', grupo: '5C', colorPalette: 'purple', icon: 'code', accessCode: 'P5C4RQ', bloque: 'purple', lugar: 'Centro de cómputo 2',
      horario: [[0, '12:10'], [2, '12:10']], alumnos: GRUPO_5C },
  ]
  const subj = {}
  for (const [i, a] of ASIGNATURAS.entries()) {
    const ref = db.collection('subjects').doc()
    const horarioPatron = a.horario.map(([diaSemana, horaInicio]) => ({
      diaSemana, horaInicio, duracionMin: 50, lugar: a.lugar, color: a.bloque,
      alarma: { activa: true, sonido: 'campana', minutosAntes: 10 },
    }))
    const data = {
      nombre: a.nombre, grupo: a.grupo, docenteId: uid, escuelaId: ESCUELA.id, parciales: 3, ciclo: `AGO ${Y}-ENE ${Y + 1}`,
      parcialesOcultos: [3], fechaInicio: CURSO.inicio, fechaFin: CURSO.fin, parcialesFechas: PARCIALES_FECHAS,
      colorPalette: a.colorPalette, icon: a.icon, accessCode: a.accessCode, archived: false,
      mostrarAsistenciasEstudiantes: true, notificarActivacion: true, orden: i + 1, order: i,
      horarioPatron, createdAt: ts(new Date(Y, 6, 27, 18, i * 5)),
    }
    await ref.set(data)
    subj[a.clave] = { id: ref.id, ...a, data, horarioPatron, alumnosIds: [], anaId: null }
  }

  // ── Estudiantes ────────────────────────────────────────────────────────────
  const ana = await auth.createUser({ email: 'anlo.cbtis255@evalua.local', password: CLAVE, emailVerified: true })
  for (const s of Object.values(subj)) {
    const lista = [...s.alumnos].sort((x, y) => `${x[1]} ${x[2]} ${x[0]}`.localeCompare(`${y[1]} ${y[2]} ${y[0]}`, 'es'))
    for (const [idx, [nombre, paterno, materno]] of lista.entries()) {
      const esAna = nombre === 'Ana' && paterno === 'López'
      const ref = db.collection('students').doc()
      await poner(ref, {
        asignaturaId: s.id, docenteId: uid, escuelaId: ESCUELA.id,
        nombre, apellidoPaterno: paterno, apellidoMaterno: materno,
        username: esAna ? 'ANLO' : usuario(nombre, paterno),
        // Casi todos ya activaron su cuenta; un par todavía no.
        activado: esAna || idx % 9 !== 4,
        ...(esAna ? { uid: ana.uid, email: 'anlo.cbtis255@evalua.local', activadoAt: ts(new Date(Y, 7, 4, 19, 12)) } : {}),
        resetPassword: null, orden: idx + 1, createdAt: ts(ALTA),
      })
      s.alumnosIds.push({ id: ref.id, nombre, paterno, materno, esAna, nivel: esAna ? 0.93 : 0.62 + azar() * 0.36 })
      if (esAna) s.anaId = ref.id
    }
  }
  await vaciarLote()

  // ── Actividades, materiales y entregas ─────────────────────────────────────
  // p: fecha de publicación; f: fecha límite; entrega: fracción que entregó;
  // califica: fracción de las entregas ya calificadas.
  const P1 = (m, d) => new Date(Y, m - 1, d, 12, 0)
  const H = (n) => conHora(diasHabiles(HOY, n), 12, 0) // n días hábiles desde hoy, a mediodía
  const ACTIVIDADES = {
    mat3a: [
      { nombre: 'Ángulos y sistemas de medición', p: P1(8, 5), f: P1(8, 14), entrega: 1, califica: 1,
        instr: '<p>Resuelve los <strong>12 ejercicios</strong> de la hoja de trabajo: convierte entre grados y radianes y clasifica cada ángulo.</p><p>Entrega una foto clara o un PDF con tu procedimiento completo.</p>' },
      { nombre: 'Triángulos: congruencia y semejanza', p: P1(8, 18), f: P1(8, 28), entrega: 0.95, califica: 1,
        instr: '<p>Demuestra la congruencia de los triángulos de los ejercicios 1 a 6 indicando el criterio (LAL, ALA o LLL).</p><p>En los ejercicios 7 a 10 encuentra la razón de semejanza y el lado faltante.</p>' },
      { nombre: 'Problemario: teorema de Pitágoras', p: P1(9, 1), f: P1(9, 9), entrega: 0.9, califica: 1,
        instr: '<p>Resuelve los 8 problemas de aplicación del teorema de Pitágoras (escaleras, rampas, diagonales de pantallas).</p><ul><li>Haz un dibujo de cada situación.</li><li>Escribe las unidades en tu resultado.</li></ul>' },
      { nombre: 'Examen del primer parcial', examen: true, p: P1(9, 15), f: P1(9, 15), hf: 9, entrega: 1, califica: 1,
        instr: '<p>Examen de 5 reactivos sobre ángulos, triángulos y teorema de Pitágoras. Tienes <strong>30 minutos</strong> y un solo intento.</p>' },
      { nombre: 'Razones trigonométricas', p: H(-16), f: H(-11), entrega: 0.95, califica: 1, rubrica: true,
        instr: '<p>Calcula seno, coseno y tangente de los ángulos agudos de los 6 triángulos rectángulos de la hoja.</p><p>Después resuelve los 4 problemas de altura y distancia usando la razón adecuada.</p>' },
      { nombre: 'Ley de senos y cosenos', destacada: true, p: H(-9), f: H(-4), entrega: 0.85, califica: 0.6, tardes: 2,
        instr: '<p>Resuelve los triángulos oblicuángulos del 1 al 8. Indica en cada uno si usaste la <strong>ley de senos</strong> o la <strong>ley de cosenos</strong> y por qué.</p><p>Formato: PDF o fotos (máximo 3), con tu nombre y número de lista.</p>' },
      { nombre: 'Proyecto: medición de alturas con clinómetro', p: H(-3), f: conHora(diasHabiles(HOY, 4), 23, 59), entrega: 0.35, califica: 0, anaCalif: true,
        instr: '<p>En equipos de 3, construyan un clinómetro casero y midan la altura de tres elementos de la escuela (asta bandera, edificio de laboratorios y un árbol).</p><ol><li>Registren ángulo y distancia en una tabla.</li><li>Calculen la altura con la tangente.</li><li>Comparen contra una medición directa.</li></ol><p>Entreguen un reporte en PDF con fotos del proceso.</p>' },
      { nombre: 'Cuestionario: identidades trigonométricas', cuestionario: true, sinCalificacion: true, p: H(-1), f: conHora(diasHabiles(HOY, 6), 22, 0), entrega: 0, califica: 0,
        instr: '<p>Cuestionario de práctica antes del examen del segundo parcial: <strong>no cuenta para tu calificación</strong>. Puedes contestarlo las veces que quieras.</p>' },
    ],
    fis3a: [
      { nombre: 'Magnitudes y unidades del Sistema Internacional', p: P1(8, 6), f: P1(8, 20), entrega: 1, califica: 1,
        instr: '<p>Completa la tabla de magnitudes fundamentales y derivadas y realiza las 10 conversiones de unidades.</p>' },
      { nombre: 'Práctica de laboratorio: caída libre', p: P1(9, 2), f: P1(9, 11), entrega: 0.95, califica: 1,
        instr: '<p>Reporte de la práctica: objetivo, material, tabla de tiempos, gráfica altura–tiempo y conclusiones.</p>' },
      { nombre: 'Movimiento rectilíneo uniformemente acelerado', p: H(-12), f: H(-6), entrega: 0.9, califica: 1,
        instr: '<p>Resuelve los 6 problemas de MRUA. Escribe datos, fórmula, sustitución y resultado con unidades.</p>' },
      { nombre: 'Leyes de Newton en la vida diaria', p: H(-2), f: conHora(diasHabiles(HOY, 2), 23, 59), entrega: 0.3, califica: 0, anaCalif: true,
        instr: '<p>Graba o fotografía tres situaciones de tu casa o la escuela donde se observe cada ley de Newton y explícalas en una presentación breve.</p>' },
      { nombre: 'Lectura: Isaac Newton y los Principia', sinCalificacion: true, p: H(-1), f: conHora(H(3), 23, 59), entrega: 0.15, califica: 0, sinAna: true,
        instr: '<p>Lee el texto y sube una foto de las tres preguntas que llevarás para comentar en clase. <strong>No cuenta para la calificación.</strong></p>' },
    ],
    mat3b: [
      { nombre: 'Ángulos y sistemas de medición', p: P1(8, 5), f: P1(8, 14), entrega: 1, califica: 1, instr: '<p>Resuelve los 12 ejercicios de la hoja de trabajo.</p>' },
      { nombre: 'Problemario: teorema de Pitágoras', p: P1(9, 1), f: P1(9, 10), entrega: 0.9, califica: 1, instr: '<p>Resuelve los 8 problemas de aplicación con su dibujo.</p>' },
      { nombre: 'Razones trigonométricas', p: H(-15), f: H(-10), entrega: 0.9, califica: 1, instr: '<p>Calcula las razones trigonométricas de los 6 triángulos.</p>' },
      { nombre: 'Ley de senos y cosenos', p: H(-8), f: H(-3), entrega: 0.8, califica: 0.3, tardes: 1, instr: '<p>Resuelve los triángulos oblicuángulos del 1 al 8.</p>' },
    ],
    pro5c: [
      { nombre: 'Algoritmos y diagramas de flujo', p: P1(8, 4), f: P1(8, 19), entrega: 1, califica: 1, instr: '<p>Elabora el diagrama de flujo de los 5 problemas propuestos.</p>' },
      { nombre: 'Variables y tipos de datos en Python', p: P1(8, 26), f: P1(9, 8), entrega: 0.95, califica: 1, instr: '<p>Sube tu archivo <code>.py</code> o el enlace a tu cuaderno de Colab con los 10 ejercicios.</p>' },
      { nombre: 'Estructuras de control: if, for y while', p: H(-14), f: H(-7), entrega: 0.9, califica: 1, instr: '<p>Programa los 6 ejercicios de estructuras de control.</p>' },
      { nombre: 'Proyecto: calculadora de promedios', p: H(-4), f: conHora(diasHabiles(HOY, 5), 23, 59), entrega: 0.4, califica: 0, instr: '<p>Programa una calculadora que pida las calificaciones de un parcial y muestre el promedio y si el estudiante aprobó.</p>' },
    ],
  }
  const MATERIALES = {
    mat3a: [
      { nombre: 'Formulario de geometría plana', parcial: 1, p: P1(8, 4), descripcion: '<p>Áreas, perímetros y criterios de congruencia en una sola hoja. Imprímelo y pégalo en tu cuaderno.</p>', archivo: 'Formulario-geometria-plana.pdf' },
      { nombre: 'Formulario de trigonometría', parcial: parcialDe(ymd(H(-16))), p: H(-16), descripcion: '<p>Razones trigonométricas, ley de senos, ley de cosenos e identidades básicas.</p>', archivo: 'Formulario-trigonometria.pdf' },
    ],
  }
  const RETRO_ANA = {
    'Ángulos y sistemas de medición': '¡Muy bien, Ana! Conversiones correctas y bien ordenadas.',
    'Triángulos: congruencia y semejanza': 'Buen trabajo. En el ejercicio 5 el criterio era ALA, no LAL; revisa cuál es el lado comprendido.',
    'Problemario: teorema de Pitágoras': 'Excelente. Tus dibujos ayudan mucho a entender cada problema.',
    'Razones trigonométricas': '¡Excelente trabajo, Ana! Tus procedimientos son claros y elegiste bien la razón en los problemas de altura. Solo cuida el redondeo a dos decimales en el ejercicio 4.',
    'Ley de senos y cosenos': 'Muy bien resuelto. En el triángulo 7 convenía la ley de cosenos desde el inicio; el resultado es correcto.',
    'Magnitudes y unidades del Sistema Internacional': 'Tabla completa y conversiones correctas. ¡Sigue así!',
    'Práctica de laboratorio: caída libre': 'Buen reporte. La gráfica necesita título y unidades en los ejes.',
    'Movimiento rectilíneo uniformemente acelerado': 'Muy bien. Recuerda escribir siempre las unidades en el resultado final.',
    'Proyecto: medición de alturas con clinómetro': '¡Gran reporte! Las fotos del clinómetro y la tabla de mediciones están muy claras. Entregaste antes de tiempo, felicidades.',
    'Leyes de Newton en la vida diaria': 'Ejemplos muy originales, sobre todo el de la tercera ley con la patineta. ¡Excelente!',
  }
  const RETRO = [
    'Buen trabajo, procedimiento completo.', 'Revisa los signos en el último ejercicio.', 'Bien. Faltó escribir las unidades.',
    'Excelente presentación.', 'Cuida la letra y el orden del procedimiento.', 'Correcto, sigue así.', '', '', '',
  ]
  const nota = (nivel) => Math.max(5, Math.min(10, Math.round((nivel * 10 + (azar() - 0.5) * 2.2) * 2) / 2))

  const featured = { actividadId: null, anaCalificada: null, examenId: null }
  const conteos = {}
  for (const [clave, lista] of Object.entries(ACTIVIDADES)) {
    const s = subj[clave]
    const ordenPorParcial = {}
    for (const a of lista) {
      const fISO = ymd(a.f)
      const parcial = parcialDe(fISO)
      const orden = (ordenPorParcial[parcial] = (ordenPorParcial[parcial] || 0) + 1)
      const esEval = a.examen || a.cuestionario
      const categoria = a.examen ? 'examen' : a.cuestionario ? 'cuestionario' : 'entregable'
      const limite = a.f.getHours() === 12 && a.f.getMinutes() === 0 ? conHora(a.f, a.hf || 23, a.hf ? 0 : 59) : a.f
      const ref = db.collection('activities').doc()
      const actividad = {
        nombre: a.nombre, categoria, tipo: esEval ? 'evaluacion' : 'archivo', maxCalif: 10,
        instrucciones: a.instr, archivosAdjuntos: [],
        fechaLimite: isoLocal(limite), recibirTarde: !esEval, oculta: false, publishAt: null,
        publishedAt: isoLocal(conHora(a.p, 7, 30)), notificarDocente: true,
        parcial, orden, asignaturaId: s.id, docenteId: uid, createdAt: ts(conHora(a.p, 7, 25)),
        comentarioVisibleAlumno: true, rubricaVisibleAlumno: true,
      }
      if (a.sinCalificacion) actividad.sinCalificacion = true
      if (!esEval) actividad.tiposArchivo = ['pdf', 'imagenes']
      let preguntas = []
      if (esEval) {
        preguntas = a.examen ? [
          ['¿Cuántos radianes equivalen a 180°?', ['π', '2π', 'π/2', '90'], 0],
          ['Un triángulo con lados 3, 4 y 5 cm es…', ['Rectángulo', 'Equilátero', 'Obtusángulo', 'Isósceles'], 0],
          ['Si dos triángulos tienen dos ángulos iguales, son…', ['Semejantes', 'Congruentes', 'Iguales en área', 'Ninguna'], 0],
          ['La hipotenusa de un triángulo con catetos 6 y 8 mide…', ['10', '14', '12', '48'], 0],
          ['La suma de los ángulos interiores de un triángulo es…', ['180°', '360°', '90°', '270°'], 0],
        ] : [
          ['sen²θ + cos²θ es igual a…', ['1', '0', 'tan θ', '2'], 0],
          ['tan θ es igual a…', ['sen θ / cos θ', 'cos θ / sen θ', '1 / sen θ', 'sen θ · cos θ'], 0],
          ['sec θ es el recíproco de…', ['cos θ', 'sen θ', 'tan θ', 'cot θ'], 0],
          ['1 + tan²θ es igual a…', ['sec²θ', 'csc²θ', 'cos²θ', '1'], 0],
          ['csc θ es el recíproco de…', ['sen θ', 'cos θ', 'tan θ', 'sec θ'], 0],
        ]
        actividad.evaluacion = {
          numPreguntas: preguntas.length, ordenPreguntas: 'creacion', navegacion: a.examen ? 'secuencial' : 'libre',
          tiempoLimiteMin: a.examen ? 30 : null, intentosPermitidos: a.examen ? 1 : null, conservar: a.examen ? 'ultimo' : 'mejor',
          publicarResultados: 'inmediato', publicarResultadosFecha: null, resultadosPublicados: true,
          publicarRespuestas: 'inmediato', publicarRespuestasFecha: null, respuestasPublicadas: !!a.examen,
          mostrarRetroalimentacion: true, mostrarRespuestasCorrectas: false, mostrarPorcentaje: true, barajarRespuestas: false,
          ...(a.sinCalificacion ? { sinCalificacion: true } : {}),
        }
      }
      if (a.rubrica) {
        // Mismo modelo que src/utils/rubrica.js: pesos que suman 10 y puntos por nivel.
        const niveles = [{ nombre: 'Excelente', porcentaje: 100 }, { nombre: 'Bueno', porcentaje: 80 }, { nombre: 'Suficiente', porcentaje: 60 }, { nombre: 'Insuficiente', porcentaje: 30 }]
        const crit = (nombre, peso, descriptores) => ({ nombre, peso, puntos: niveles.map((n) => Math.round(peso * n.porcentaje / 10) / 10), descriptores })
        actividad.rubrica = {
          titulo: 'Rúbrica: razones trigonométricas', descripcion: 'Problemas de razones trigonométricas en triángulos rectángulos',
          niveles,
          criterios: [
            crit('Planteamiento', 4, ['Identifica todos los datos y elige la razón correcta', 'Identifica los datos con un error menor', 'Elige la razón correcta en la mitad de los casos', 'No identifica la razón adecuada']),
            crit('Procedimiento', 4, ['Desarrollo completo, ordenado y sin errores', 'Desarrollo completo con errores menores', 'Desarrollo incompleto', 'Sin procedimiento']),
            crit('Resultado', 2, ['Resultados correctos con unidades y redondeo', 'Resultados correctos sin unidades', 'Algunos resultados incorrectos', 'Resultados incorrectos']),
          ],
        }
        actividad.rubricaId = null
      }
      await poner(ref, actividad)
      for (const [k, [enunciado, ops, correcta]] of preguntas.entries()) {
        const pid = `p${k + 1}`
        const opciones = ops.map((t, j) => ({ id: `o${j + 1}`, texto: t }))
        await poner(ref.collection('preguntas').doc(pid), { tipo: 'opcion_multiple', enunciado, opciones, ponderacion: 10 / preguntas.length, retroalimentacion: null, orden: k + 1 })
        await poner(ref.collection('clave').doc(pid), { respuestaCorrecta: `o${correcta + 1}`, respuestaEsperada: null })
      }

      // Entregas
      const alumnos = s.alumnosIds
      let entregados = 0, calificados = 0, tardes = 0
      const nEntrega = Math.round(alumnos.length * a.entrega)
      // Quiénes entregan: los de mejor "nivel" primero, con algo de azar.
      const orden_ = [...alumnos].sort((x, y) => (y.nivel + azar() * 0.25) - (x.nivel + azar() * 0.25))
      const entregan = new Set(orden_.slice(0, nEntrega).map((x) => x.id))
      if (s.anaId && !a.sinAna && a.entrega > 0) entregan.add(s.anaId)
      if (s.anaId && a.sinAna) entregan.delete(s.anaId)
      const listaEntregan = alumnos.filter((x) => entregan.has(x.id))
      const nCalif = Math.round(listaEntregan.length * a.califica)
      // Se califica en orden de llegada; Ana, de las primeras.
      const llegada = [...listaEntregan].sort((x, y) => (x.esAna ? -1 : y.esAna ? 1 : azar() - 0.5))
      let tardesRestantes = a.tardes || 0
      for (const [pos, al] of llegada.entries()) {
        // anaCalif: Ana entregó antes de tiempo y la docente ya la calificó.
        const calificada = pos < nCalif || (al.esAna && !!a.anaCalif)
        const esTarde = !al.esAna && !calificada && tardesRestantes > 0 && esPasada(limite) ? (tardesRestantes--, true) : false
        const entregaEn = esTarde
          ? masDias(limite, 1 + Math.floor(azar() * 2))
          : new Date(Math.min(limite.getTime() - 3600e3 * (2 + azar() * 70), HOY.getTime() - 3600e3 * (1 + azar() * 20)))
        if (entregaEn < conHora(a.p, 8)) entregaEn.setTime(conHora(a.p, 8).getTime() + azar() * 86400e3 * 2)
        if (esEval) entregaEn.setTime(conHora(a.p, 8, 5).getTime() + azar() * 45 * 60e3) // examen: durante la clase
        let cal = calificada ? (al.esAna ? (a.examen ? 9 : Math.max(9, nota(al.nivel))) : nota(al.nivel)) : null
        // Con rúbrica la nota ES la suma de los niveles elegidos (totalRubrica en utils/rubrica.js).
        let rubricaEval = null
        if (calificada && actividad.rubrica) {
          rubricaEval = actividad.rubrica.criterios.map((_, i) => {
            const n = cal + (al.esAna ? (i === 2 ? -1.5 : 0.5) : (azar() - 0.5) * 2)
            return n >= 9.3 ? 0 : n >= 7.8 ? 1 : n >= 6.2 ? 2 : 3
          })
          cal = Math.round(actividad.rubrica.criterios.reduce((t, c, i) => t + c.puntos[rubricaEval[i]], 0) * 10) / 10
        }
        const id = `${ref.id}_${al.id}`
        const base = { alumnoId: al.id, actividadId: ref.id, fechaEntrega: ts(entregaEn), calificacion: cal, historial: [] }
        let sub
        if (esEval) {
          sub = { ...base, estadoEvaluacion: 'finalizado', estado: calificada ? 'calificado' : 'entregado', intentoActual: 1,
            tiempoInicio: ts(new Date(entregaEn.getTime() - 22 * 60e3)), intentos: calificada ? [{ numero: 1, calificacion: cal }] : [],
            comentario: '' }
        } else {
          const apellido = al.paterno.normalize('NFD').replace(/\p{Diacritic}/gu, '')
          const nombreArchivo = `${a.nombre.split(':')[0].replace(/\s+/g, '_').normalize('NFD').replace(/\p{Diacritic}/gu, '')}_${apellido}_${al.nombre.split(' ')[0].normalize('NFD').replace(/\p{Diacritic}/gu, '')}.pdf`
          const url = `https://res.cloudinary.com/demo/raw/upload/evalua-facil/submissions/${id}.pdf`
          sub = { ...base, archivoURL: url, nombreArchivo, archivos: [{ url, nombre: nombreArchivo, tamano: 380000 + Math.floor(azar() * 1400000) }],
            completadoSinArchivo: false, estado: calificada ? 'calificado' : 'entregado', tarde: esTarde,
            comentario: calificada ? (al.esAna ? (RETRO_ANA[a.nombre] || 'Muy buen trabajo.') : RETRO[Math.floor(azar() * RETRO.length)]) : '' }
          if (calificada) { sub.ultimaCalificacionPor = 'docente'; sub.comentarioVisibleAlumno = true }
          if (rubricaEval) sub.rubricaEval = rubricaEval
        }
        await poner(db.doc(`submissions/${id}`), sub)
        entregados++; if (calificada) calificados++; if (esTarde) tardes++
        if (al.esAna && calificada && clave === 'mat3a' && a.nombre === 'Razones trigonométricas') featured.anaCalificada = ref.id
      }
      if (a.destacada) featured.actividadId = ref.id
      if (a.examen) featured.examenId = ref.id
      conteos[`${clave}: ${a.nombre}`] = `${entregados}/${alumnos.length} entregas, ${calificados} calificadas${tardes ? `, ${tardes} tarde` : ''}`
    }
    for (const [i, m] of (MATERIALES[clave] || []).entries()) {
      await poner(db.collection('materials').doc(), {
        nombre: m.nombre, descripcion: m.descripcion,
        archivos: [{ url: `https://res.cloudinary.com/demo/raw/upload/evalua-facil/materiales/${m.archivo}`, nombre: m.archivo, tamano: 245000 + i * 51000 }],
        oculta: false, publishAt: null, parcial: m.parcial, orden: 100 + i, ordenManual: false,
        asignaturaId: s.id, docenteId: uid, createdAt: ts(conHora(m.p, 7, 15)),
      })
    }
  }
  await vaciarLote()
  function esPasada(d) { return d.getTime() < HOY.getTime() }

  // Recursos (pestaña Recursos)
  for (const [nombre, descripcion, url, dias] of [
    ['GeoGebra: calculadora gráfica', 'Para comprobar tus triángulos y gráficas de funciones trigonométricas.', 'https://www.geogebra.org/calculator', -60],
    ['Khan Academy: ley de senos', 'Video y ejercicios de práctica con retroalimentación inmediata.', 'https://es.khanacademy.org/math/trigonometry', -9],
  ]) {
    await db.collection('resources').add({ asignaturaId: subj.mat3a.id, docenteId: uid, nombre, descripcion, tipo: 'link', url, fechaPublicacion: ts(masDias(HOY, dias)) })
  }

  // ── Horario (bloques materializados), asuetos y vacaciones ─────────────────
  for (const fecha of ASUETOS) await db.collection('asuetos').add({ docenteId: uid, fecha, clases: true, asistencias: true, createdAt: ts(ALTA) })
  await db.collection('vacaciones').add({ docenteId: uid, ...VACACIONES, clases: true, asistencias: true, createdAt: ts(ALTA) })
  const diasSinClase = [...ASUETOS]
  for (let d = deFecha(VACACIONES.fechaInicio); ymd(d) <= VACACIONES.fechaFin; d = masDias(d, 1)) diasSinClase.push(ymd(d))
  const clasesPorAsignatura = {}
  for (const s of Object.values(subj)) {
    const bloques = generarBloques({
      fechaInicio: CURSO.inicio, fechaFin: CURSO.fin, diasAsueto: diasSinClase, duracionMin: 50,
      patrones: s.horarioPatron, color: s.bloque, alarma: { activa: true, sonido: 'campana', minutosAntes: 10 },
    })
    const programacionId = `prog-${s.clave}`
    for (const b of bloques) await poner(db.collection('horarioBloques').doc(), { ...b, docenteId: uid, programacionId, asignaturaId: s.id, createdAt: ts(ALTA) })
    clasesPorAsignatura[s.clave] = bloques.map((b) => b.fecha).filter((f) => f <= HOY_ISO)
  }
  await vaciarLote()

  // ── Asistencias (todas las clases ya impartidas) + resúmenes del alumno ────
  const MOTIVOS = ['Cita médica', 'Comprobante de salud', 'Asunto familiar']
  for (const s of Object.values(subj)) {
    const registros = []
    for (const fecha of clasesPorAsignatura[s.clave]) {
      const presentes = {}, justificadas = {}, motivos = {}
      for (const al of s.alumnosIds) {
        const r = azar()
        const pFalta = al.esAna ? 0.02 : 0.03 + (1 - al.nivel) * 0.12
        if (r < pFalta) presentes[al.id] = false
        else if (r < pFalta + 0.015) { presentes[al.id] = false; justificadas[al.id] = true; motivos[al.id] = MOTIVOS[Math.floor(azar() * MOTIVOS.length)] }
        else presentes[al.id] = true
      }
      const rec = { asignaturaId: s.id, docenteId: uid, fecha, slot: 1, parcial: parcialDe(fecha), presentes, createdAt: ts(deFecha(fecha, 7, 5)) }
      if (Object.keys(justificadas).length) { rec.justificadas = justificadas; rec.motivos = motivos }
      await poner(db.doc(`attendance/${s.id}_${fecha}_1`), rec)
      registros.push(rec)
    }
    for (const al of s.alumnosIds) {
      await poner(db.doc(`attendanceSummaries/${al.id}`), { asignaturaId: s.id, ...resumenAsistencia(registros, al.id, PARCIALES_FECHAS, HOY_ISO), updatedAt: ts(HOY) })
    }
  }
  await vaciarLote()

  // ── Eventos de esta semana ─────────────────────────────────────────────────
  const lunes = masDias(HOY, -((HOY.getDay() + 6) % 7))
  const enSemana = (dia, hh, mm) => conHora(masDias(lunes, dia), hh, mm)
  const EVENTOS = [
    { col: 'events', titulo: 'Reunión de academia de Matemáticas', descripcion: 'Revisión de avances del segundo parcial', inicio: enSemana(2, 14, 0), fin: enSemana(2, 15, 30), color: 'purple' },
    { col: 'events', titulo: 'Entrega de listas a control escolar', descripcion: 'Asistencias del segundo parcial', inicio: enSemana(4, 13, 0), fin: enSemana(4, 13, 30), color: 'teal' },
    { col: 'academicEvents', titulo: 'Feria de Ciencias y Tecnología', descripcion: 'Los equipos de 3A presentan su clinómetro en la explanada', inicio: enSemana(3, 11, 0), fin: enSemana(3, 13, 0), color: 'amber', asignaturaId: subj.mat3a.id },
    { col: 'academicEvents', titulo: 'Examen del segundo parcial', descripcion: 'Trigonometría: razones, leyes de senos y cosenos e identidades', inicio: conHora(diasHabiles(HOY, 7), 7, 0), fin: conHora(diasHabiles(HOY, 7), 7, 50), color: 'rose', asignaturaId: subj.mat3a.id },
  ]
  for (const e of EVENTOS) {
    await db.collection(e.col).add({
      titulo: e.titulo, descripcion: e.descripcion, notas: '', inicio: isoLocal(e.inicio), fin: isoLocal(e.fin), color: e.color,
      docenteId: uid, tipo: e.col === 'academicEvents' ? 'academico' : 'personal', asignaturaId: e.asignaturaId || null,
      createdAt: ts(masDias(HOY, -6)),
    })
  }
  await db.collection('studentEvents').add({
    titulo: 'Estudiar para el examen de Matemáticas', descripcion: '', inicio: isoLocal(conHora(diasHabiles(HOY, 3), 17, 0)), fin: isoLocal(conHora(diasHabiles(HOY, 3), 18, 30)),
    color: 'purple', alumnoId: ana.uid, createdAt: ts(masDias(HOY, -1)),
  })

  // ── Avisos (Matemáticas III — 3A) y quién ya los leyó ──────────────────────
  const AVISOS = [
    { emoji: '📚', titulo: 'Material de apoyo disponible', mensaje: 'Ya está en Actividades el formulario de trigonometría. Imprímanlo para la clase del lunes y tráiganlo con su cuaderno.', dias: -9, leen: 1 },
    { emoji: '🚪', titulo: 'Cambio de salón', mensaje: 'La próxima clase será en el Centro de cómputo 2 para practicar con GeoGebra. Lleguen puntuales, por favor.', dias: -3, leen: 0.85 },
    { emoji: '📝', titulo: 'Examen próximo', mensaje: 'El examen del segundo parcial incluye razones trigonométricas, ley de senos, ley de cosenos e identidades. Resuelvan el cuestionario de práctica antes del examen.', dias: -1, leen: 0.6 },
  ]
  for (const av of AVISOS) {
    const cuando = conHora(masDias(HOY, av.dias), 8, 20)
    const ref = await db.collection('avisos').add({
      asignaturaId: subj.mat3a.id, docenteId: uid, titulo: av.titulo, emoji: av.emoji, mensaje: av.mensaje,
      tipo: 'OTRO', activo: true, fechaCreacion: ts(cuando), fechaActualizacion: ts(cuando),
    })
    for (const al of subj.mat3a.alumnosIds) {
      if (!al.esAna && azar() > av.leen) continue
      await poner(db.doc(`avisoLecturas/${ref.id}_${al.id}`), {
        avisoId: ref.id, asignaturaId: subj.mat3a.id, estudianteId: al.id,
        fechaHoraLectura: ts(new Date(cuando.getTime() + 3600e3 * (0.2 + azar() * 20))), dispositivo: 'app · Android',
      })
    }
  }
  await vaciarLote()

  // ── Bitácora de notificaciones del docente ─────────────────────────────────
  const m = subj.mat3a
  const nombreDe = (al) => `${al.nombre} ${al.paterno} ${al.materno}`
  const alumnosMat = m.alumnosIds.filter((x) => !x.esAna)
  const BITACORA = [
    { categoria: 'recordatorioClase', asignatura: m.nombre, grupo: m.grupo, anticipacionMinutos: 10, hora: '09:00', lugar: m.lugar, h: -8.6 },
    { categoria: 'nuevasEntregas', asignatura: m.nombre, grupo: m.grupo, actividad: 'Proyecto: medición de alturas con clinómetro', numeroActividad: 7, tipoEntrega: 'entregable', alumno: alumnosMat[3], h: -5.2 },
    { categoria: 'nuevasEntregas', asignatura: m.nombre, grupo: m.grupo, actividad: 'Proyecto: medición de alturas con clinómetro', numeroActividad: 7, tipoEntrega: 'entregable', alumno: alumnosMat[11], h: -3.9 },
    { categoria: 'recordatorioEvento', evento: 'Entrega de listas a control escolar', anticipacionMinutos: 15, hora: '13:00', h: -4.7 },
    { categoria: 'recordatorioClase', asignatura: 'Matemáticas III', grupo: '3B', anticipacionMinutos: 10, hora: '11:20', lugar: 'Aula 14', h: -6.3 },
    { categoria: 'nuevasEntregas', asignatura: 'Física I', grupo: '3A', actividad: 'Leyes de Newton en la vida diaria', numeroActividad: 4, tipoEntrega: 'entregable', h: -26 },
    { categoria: 'activacionEstudiante', asignatura: 'Programación', grupo: '5C', estudiante: 'Arely Zavala Hidalgo', h: -30 },
    { categoria: 'nuevasEntregas', asignatura: m.nombre, grupo: m.grupo, actividad: 'Ley de senos y cosenos', numeroActividad: 6, tipoEntrega: 'entregable', alumno: alumnosMat[7], h: -50 },
    { categoria: 'recordatorioEvento', evento: 'Reunión de academia de Matemáticas', anticipacionMinutos: 15, hora: '14:00', h: -52 },
    { categoria: 'activacionEstudiante', asignatura: m.nombre, grupo: m.grupo, estudiante: nombreDe(alumnosMat[15]), h: -75 },
  ]
  const actPorNombre = {}
  for (const d of (await db.collection('activities').where('docenteId', '==', uid).get()).docs) {
    const a = d.data(); actPorNombre[`${a.asignaturaId}|${a.nombre}`] = d.id
  }
  for (const e of BITACORA) {
    const { alumno, h, ...resto } = e
    const entrada = { uid, ...resto, createdAt: ts(new Date(HOY.getTime() + h * 3600e3)) }
    if (e.categoria === 'nuevasEntregas') {
      const s = Object.values(subj).find((x) => x.nombre === e.asignatura && x.grupo === e.grupo)
      const al = alumno || s.alumnosIds[5]
      entrada.estudiante = nombreDe(al)
      entrada.alumnoId = al.id
      entrada.actividadId = actPorNombre[`${s.id}|${e.actividad}`] || null
    }
    await db.collection('notificationLog').add(entrada)
  }
  await db.doc(`notificationSettings/${uid}`).set({
    nuevasEntregas: { habilitado: true }, activacionEstudiante: { habilitado: true },
    recordatorioClase: { habilitado: true, anticipacionMinutos: [10] }, recordatorioEvento: { habilitado: true, anticipacionMinutos: [15] },
    updatedAt: ts(masDias(HOY, -20)),
  }, { merge: true })

  for (const [k, v] of Object.entries(conteos)) console.error(`  ${k} → ${v}`)
  console.error(`  ${escritos} documentos en lotes · hoy ${HOY_ISO}`)
  console.log(JSON.stringify({
    uid, subjects: Object.fromEntries(Object.values(subj).map((s) => [s.clave, s.id])), main: subj.mat3a.id,
    featuredActivity: featured.actividadId, anaGradedActivity: featured.anaCalificada, examActivity: featured.examenId,
    alumno: ana.uid, anaStudentDocs: { mat3a: subj.mat3a.anaId, fis3a: subj.fis3a.anaId },
  }))
  process.exit(0)
})().catch((e) => { console.error(e); process.exit(1) })
