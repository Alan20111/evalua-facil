#!/usr/bin/env node
/**
 * seed-fresh.js — limpia Firestore y siembra datos de demo completos.
 *
 * Antes de correr:
 *   1. Firestore rules deben estar en modo permisivo (ya desplegado por el script)
 *   2. firebase firestore:delete --all-collections -f --project evalua-facil-app
 *
 * Crea:
 *   • 3 escuelas (CBTIS 255, CETIS 115, CBTIS 198)
 *   • 6 docentes con cuentas Firebase Auth + Firestore (mix de email verificado / no)
 *   • 2 asignaturas por docente
 *   • 3-4 alumnos por docente (mix activado / sin activar)
 *   • Suscripciones por docente (trial / activa / vencida / pendiente_pago)
 *   • 1 pago aprobado para docente con suscripción activa
 *   • Plan Pro $100
 *   • Admin: alannicanor62@gmail.com
 */

const https = require('https')
const crypto = require('crypto')

const API_KEY = 'AIzaSyBn-gcF3PioP5Z3C4pN42fzh8Vlrjrggug'
const PROJECT = 'evalua-facil-app'
const ADMIN_UID = 'Z16jetZX0PMAijVBCYS64rVSprd2'
const ADMIN_EMAIL = 'alannicanor62@gmail.com'

const rnd = (n = 6) => crypto.randomBytes(n).toString('hex').toUpperCase().slice(0, n)
const ago = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString() }
const from = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString() }
const now = () => new Date().toISOString()

// ─── DATOS DE DEMO ────────────────────────────────────────────────────────────

const SCHOOLS = [
  { id: '11DCT0020A', shortName: 'CBTIS 255', nombre: 'CBTIS NUM. 255', mun: 'TARIMORO', edo: 'GUANAJUATO' },
  { id: '11DCT0115O', shortName: 'CETIS 115', nombre: 'CETIS NUM. 115', mun: 'CELAYA',   edo: 'GUANAJUATO' },
  { id: '11DCT0009E', shortName: 'CBTIS 198', nombre: 'CBTIS NUM. 198', mun: 'CELAYA',   edo: 'GUANAJUATO' },
]

// password igual para todos: Evalua2024!
const TEACHERS = [
  { email: 'mgarcia.cbtis255@gmail.com', pwd: 'Evalua2024!', nombre: 'María García López',
    username: 'CBTIS255-01', escuelaId: '11DCT0020A', school: 'CBTIS 255',
    verified: true,  sub: { status: 'trial',          fechaInicio: ago(15), fechaVenc: from(45), precio: 0    } },

  { email: 'rsanchez.cetis115@gmail.com', pwd: 'Evalua2024!', nombre: 'Roberto Sánchez Cruz',
    username: 'CETIS115-01', escuelaId: '11DCT0115O', school: 'CETIS 115',
    verified: false, sub: { status: 'trial',          fechaInicio: ago(35), fechaVenc: from(25), precio: 0    } },

  { email: 'amartinez.cbtis198@gmail.com', pwd: 'Evalua2024!', nombre: 'Ana Martínez Flores',
    username: 'CBTIS198-01', escuelaId: '11DCT0009E', school: 'CBTIS 198',
    verified: true,  sub: { status: 'activa',         fechaInicio: ago(5),  fechaVenc: from(25), precio: 100  } },

  { email: 'jlopez.cbtis255@gmail.com', pwd: 'Evalua2024!', nombre: 'Juan López Hernández',
    username: 'CBTIS255-02', escuelaId: '11DCT0020A', school: 'CBTIS 255',
    verified: true,  sub: { status: 'vencida',        fechaInicio: ago(75), fechaVenc: ago(15),  precio: 100  } },

  { email: 'sramirez.cetis115@gmail.com', pwd: 'Evalua2024!', nombre: 'Sofía Ramírez Torres',
    username: 'CETIS115-02', escuelaId: '11DCT0115O', school: 'CETIS 115',
    verified: false, sub: { status: 'trial',          fechaInicio: ago(55), fechaVenc: from(5),  precio: 0    } },

  { email: 'cgomez.cbtis198@gmail.com', pwd: 'Evalua2024!', nombre: 'Carlos Gómez Ruiz',
    username: 'CBTIS198-02', escuelaId: '11DCT0009E', school: 'CBTIS 198',
    verified: true,  sub: { status: 'pendiente_pago', fechaInicio: ago(62), fechaVenc: from(0),  precio: 100  } },
]

const SUBJECTS_BY_TEACHER = {
  'CBTIS255-01': ['Matemáticas I', 'Física I'],
  'CETIS115-01': ['Química I', 'Biología I'],
  'CBTIS198-01': ['Inglés I', 'Historia Universal'],
  'CBTIS255-02': ['Informática I', 'Programación Básica'],
  'CETIS115-02': ['Contabilidad', 'Economía'],
  'CBTIS198-02': ['Administración', 'Gestión Empresarial'],
}

const STUDENTS_BY_TEACHER = {
  'CBTIS255-01': [
    { username: 'MLOP', nombre: 'Manuel López Pérez',           activado: true  },
    { username: 'CLOR', nombre: 'Carmen Flores Ruiz',           activado: true  },
    { username: 'JMHE', nombre: 'José Martínez Hernández',      activado: false },
    { username: 'ANPE', nombre: 'Andrea Pérez García',          activado: false },
  ],
  'CETIS115-01': [
    { username: 'LUMA', nombre: 'Lucía Martínez Ávila',         activado: true  },
    { username: 'ERCA', nombre: 'Eduardo Ramírez Cruz',         activado: false },
    { username: 'VALE', nombre: 'Valentina López Estrada',      activado: false },
  ],
  'CBTIS198-01': [
    { username: 'ROGU', nombre: 'Rosa Gutiérrez Mendoza',       activado: true  },
    { username: 'ALJA', nombre: 'Alberto Jiménez Álvarez',      activado: true  },
    { username: 'PATO', nombre: 'Patricia Torres Orozco',       activado: false },
  ],
  'CBTIS255-02': [
    { username: 'MAVE', nombre: 'Marco Antonio Vega Espinoza',  activado: true  },
    { username: 'GISA', nombre: 'Giovanna Salinas Ávila',       activado: false },
  ],
  'CETIS115-02': [
    { username: 'DANA', nombre: 'Daniel Navarro Aguilar',       activado: false },
    { username: 'BEFE', nombre: 'Beatriz Fernández García',     activado: true  },
    { username: 'ORCO', nombre: 'Orlando Castillo Moreno',      activado: false },
  ],
  'CBTIS198-02': [
    { username: 'IVZA', nombre: 'Ivonne Zamora Ríos',           activado: true  },
    { username: 'HEGO', nombre: 'Héctor González Ortiz',        activado: false },
    { username: 'NIMO', nombre: 'Nimbe Morales López',          activado: true  },
  ],
}

// ─── HTTP HELPERS ────────────────────────────────────────────────────────────

function call(hostname, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : ''
    const req = https.request({ hostname, path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers }
    }, (res) => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => { try { resolve({ s: res.statusCode, b: JSON.parse(d) }) } catch { resolve({ s: res.statusCode, b: d }) } })
    })
    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

const idt = (ep, body) => call('identitytoolkit.googleapis.com', `/v1/${ep}?key=${API_KEY}`, 'POST', {}, body)
const fsUrl = (col, id) => `/v1/projects/${PROJECT}/databases/(default)/documents/${col}${id ? '/'+id : ''}`
const fsPatch = (tok, col, id, fields) => call('firestore.googleapis.com', fsUrl(col, id), 'PATCH', { Authorization: `Bearer ${tok}` }, { fields })
const fsPost  = (tok, col, fields)      => call('firestore.googleapis.com', fsUrl(col),     'POST',  { Authorization: `Bearer ${tok}` }, { fields })

function fsF(obj) {
  const f = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) { f[k] = { nullValue: null }; continue }
    if (typeof v === 'string') {
      f[k] = /^\d{4}-\d{2}-\d{2}T/.test(v) ? { timestampValue: v } : { stringValue: v }
    } else if (typeof v === 'number') {
      f[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
    } else if (typeof v === 'boolean') {
      f[k] = { booleanValue: v }
    }
  }
  return f
}

async function signUp(email, password) {
  const r = await idt('accounts:signUp', { email, password, returnSecureToken: true })
  if (r.s !== 200) throw new Error(`signUp ${email}: ${JSON.stringify(r.b).slice(0,200)}`)
  return { uid: r.b.localId, idToken: r.b.idToken }
}

async function setVerified(idToken) {
  await idt('accounts:update', { idToken, emailVerified: true })
}

async function writeDoc(tok, col, id, data) {
  const r = id ? await fsPatch(tok, col, id, fsF(data)) : await fsPost(tok, col, fsF(data))
  if (r.s >= 300) throw new Error(`write ${col}/${id||'?'} (${r.s}): ${JSON.stringify(r.b).slice(0,200)}`)
  return r.b.name?.split('/').pop()
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🌱 Evalúa Fácil — Seed Completo')
  console.log('='.repeat(45))

  // Temp user para escribir Firestore
  const TEMP_EMAIL = `seed.${Date.now()}@evalua-setup.local`
  const { uid: tempUid, idToken: tok } = await signUp(TEMP_EMAIL, `Seed${Date.now()}!`)
  console.log(`\n🔑 Cuenta temporal: ${tempUid}`)

  try {
    // ── Plan Pro ────────────────────────────────────────────────────────────────
    console.log('\n📦 Plan Pro…')
    await writeDoc(tok, 'plans', 'pro', {
      nombre: 'Plan Pro', descripcion: 'Acceso completo sin límites.',
      precio: 100, periodicidad: 'mensual', maxAsignaturas: -1, maxAlumnos: -1,
      activo: true, orden: 1,
    })
    console.log('  ✅ Plan Pro $100/mes')

    // ── Escuelas ────────────────────────────────────────────────────────────────
    console.log('\n🏫 Escuelas…')
    for (const s of SCHOOLS) {
      await writeDoc(tok, 'schools', s.id, { claveSEP: s.id, shortName: s.shortName, nombre: s.nombre, municipio: s.mun, estado: s.edo })
      console.log(`  ✅ ${s.shortName}`)
    }

    // ── Admin ───────────────────────────────────────────────────────────────────
    console.log('\n👤 Admin…')
    await writeDoc(tok, 'users', ADMIN_UID, { role: 'admin', email: ADMIN_EMAIL, username: 'admin', escuelaId: '', schoolName: '' })
    console.log(`  ✅ ${ADMIN_EMAIL}`)

    // ── Docentes ─────────────────────────────────────────────────────────────────
    console.log('\n👩‍🏫 Docentes…')
    const teacherUids = {}

    for (const t of TEACHERS) {
      // Crear cuenta Firebase Auth
      const { uid, idToken: tTok } = await signUp(t.email, t.pwd)
      teacherUids[t.username] = uid
      if (t.verified) await setVerified(tTok)

      // Firestore: users/{uid}
      await writeDoc(tok, 'users', uid, {
        role: 'docente', email: t.email, username: t.username,
        nombrePropio: t.nombre, nombreMostrar: t.nombre.split(' ')[0],
        escuelaId: t.escuelaId, schoolName: t.school, createdAt: now(),
      })

      // Firestore: subscriptions
      await writeDoc(tok, 'subscriptions', null, {
        docenteId: uid, planId: t.sub.status === 'activa' ? 'pro' : '',
        planName: t.sub.status === 'activa' ? 'Plan Pro' : 'Trial',
        escuelaId: t.escuelaId, schoolName: t.school,
        status: t.sub.status, precio: t.sub.precio,
        fechaInicio: t.sub.fechaInicio, fechaVencimiento: t.sub.fechaVenc,
        createdAt: t.sub.fechaInicio, updatedAt: now(),
      })

      const verMark = t.verified ? '✉✓' : '✉✗'
      console.log(`  ✅ ${t.username.padEnd(12)} ${verMark}  ${t.sub.status.padEnd(14)} ${t.nombre}`)
    }

    // Pago aprobado para amartinez (activa)
    const anaUid = teacherUids['CBTIS198-01']
    await writeDoc(tok, 'payments', null, {
      docenteId: anaUid, planId: 'pro', planName: 'Plan Pro',
      monto: 100, metodo: 'transferencia', status: 'aprobado',
      referencia: `REF${Math.floor(Math.random()*900000+100000)}`, banco: 'BBVA',
      escuelaId: '11DCT0009E', notas: '',
      createdAt: ago(5), updatedAt: ago(4), reviewedAt: ago(4),
    })
    console.log('  ✅ Pago aprobado → CBTIS198-01 (Ana Martínez)')

    // Pago pendiente para cgomez (pendiente_pago)
    const carlosUid = teacherUids['CBTIS198-02']
    await writeDoc(tok, 'payments', null, {
      docenteId: carlosUid, planId: 'pro', planName: 'Plan Pro',
      monto: 100, metodo: 'transferencia', status: 'pendiente',
      referencia: `REF${Math.floor(Math.random()*900000+100000)}`, banco: 'BBVA',
      escuelaId: '11DCT0009E', notas: '',
      createdAt: ago(2), updatedAt: ago(2), reviewedAt: null,
    })
    console.log('  ✅ Pago pendiente → CBTIS198-02 (Carlos Gómez)')

    // ── Asignaturas + Alumnos ─────────────────────────────────────────────────
    console.log('\n📚 Asignaturas y alumnos…')
    const CICLO = 'AGO 2024-ENE 2025'

    for (const t of TEACHERS) {
      const teacherUid = teacherUids[t.username]
      const subjects = SUBJECTS_BY_TEACHER[t.username]
      const students = STUDENTS_BY_TEACHER[t.username]
      const subjectIds = []

      for (const subjectName of subjects) {
        const sid = await writeDoc(tok, 'subjects', null, {
          nombre: subjectName, docenteId: teacherUid,
          escuelaId: t.escuelaId, parciales: 3, ciclo: CICLO,
          accessCode: rnd(6), archived: false, createdAt: now(),
        })
        subjectIds.push(sid)
      }

      const firstSubjectId = subjectIds[0]

      for (const st of students) {
        const studentEmail = `${st.username.toLowerCase()}.${t.escuelaId}@evalua.local`
        let studentUid = null

        if (st.activado) {
          // Crear cuenta Firebase Auth para alumnos activados
          const { uid } = await signUp(studentEmail, 'Alumno2024!')
          studentUid = uid
        }

        await writeDoc(tok, 'students', null, {
          username: st.username, nombre: st.nombre,
          email: studentEmail, escuelaId: t.escuelaId,
          asignaturaId: firstSubjectId, docenteId: teacherUid,
          activado: st.activado, uid: studentUid,
          resetPassword: null, createdAt: now(),
        })
      }

      const activados = students.filter(s => s.activado).length
      const total = students.length
      console.log(`  ✅ ${t.username.padEnd(12)} ${subjects.length} asignaturas  ${activados}/${total} alumnos activados`)
    }

    console.log('\n🎉 Seed completado.')
    console.log(`   Docentes: ${TEACHERS.length}`)
    const totalStudents = Object.values(STUDENTS_BY_TEACHER).flat().length
    const activatedStudents = Object.values(STUDENTS_BY_TEACHER).flat().filter(s => s.activado).length
    console.log(`   Alumnos:  ${totalStudents} total (${activatedStudents} activados, ${totalStudents - activatedStudents} sin activar)`)
    console.log(`   Admin:    ${ADMIN_EMAIL}`)
    console.log('\n   Password docentes: Evalua2024!')
    console.log('   Password alumnos activados: Alumno2024!\n')

  } finally {
    await idt('accounts:delete', { idToken: tok })
    console.log('🧹 Cuenta temporal eliminada.')
  }
}

main().catch(err => { console.error('\n❌', err.message); process.exit(1) })
