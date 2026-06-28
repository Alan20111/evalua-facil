#!/usr/bin/env node
/**
 * Seed demo subscriptions + payments so admin dashboard has data to display.
 * Uses temp Firebase account + relaxed rules.
 */
const https = require('https')
const crypto = require('crypto')

const API_KEY = 'AIzaSyBn-gcF3PioP5Z3C4pN42fzh8Vlrjrggug'
const PROJECT_ID = 'evalua-facil-app'

// Known teachers from firebase auth:export (non-student, non-admin accounts)
const TEACHERS = [
  { uid: 'AD4ZXu00r8XLMUVExr5z9YEZ5C22', email: 'kikemendez75@gmail.com', school: 'CBTIS255', name: 'Kike Méndez' },
  { uid: 'DV9X0bLR2YYtlhRFa5XCoITL5vv2', email: '24030976@itcelaya.edu.mx', school: 'ITCELAYA', name: 'Alan Méndez' },
  { uid: 'OFe6ltBWbbNOpPhvCgrBHdE32Yf2', email: 'bixiv99245@synsky.com', school: 'CETIS120', name: 'Docente Demo 1' },
  { uid: 'PBwx6PUZijR8JHT2mGKKDlJlQJU2', email: 'jayole1576@synsky.com', school: 'CBTIS256', name: 'Docente Demo 2' },
  { uid: 'eAao8rqqQTOsoP8gzJXbvADZzwr1', email: 'nepop93990@synsky.com', school: 'CETIS50', name: 'Docente Demo 3' },
  { uid: 'iCKhNlWJgdPe0fRaninSlITvE653', email: 'yedocev290@preparmy.com', school: 'CBTIS26', name: 'Docente Demo 4' },
  { uid: 'iblK5uDGJDXFmQYL6GQzj4bt7NM2', email: 'weviwe4011@preparmy.com', school: 'CETIS80', name: 'Docente Demo 5' },
  { uid: 'tbXcDCcPhFTvNfn90rYq0XNmB4g2', email: 'wokorap205@ocuser.com', school: 'CBTIS12', name: 'Docente Demo 6' },
]

const TEMP_EMAIL = `setup.seed.${Date.now()}@evalua-setup.local`
const TEMP_PASS = `Seed1P4ss${Date.now()}`

function randomId() {
  return crypto.randomBytes(10).toString('hex')
}

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

function daysFrom(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString()
}

function idtPost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body)
    const req = https.request(
      {
        hostname: 'identitytoolkit.googleapis.com',
        path: `/v1/${endpoint}?key=${API_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }) } catch { resolve({ status: res.statusCode, body: data }) } })
      }
    )
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}

function fsPost(idToken, collection, data) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify({ fields: fsFields(data) })
    const req = https.request(
      {
        hostname: 'firestore.googleapis.com',
        path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }) } catch { resolve({ status: res.statusCode, body: data }) } })
      }
    )
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}

function fsPatch(idToken, collection, docId, data) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify({ fields: fsFields(data) })
    const req = https.request(
      {
        hostname: 'firestore.googleapis.com',
        path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`,
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }) } catch { resolve({ status: res.statusCode, body: data }) } })
      }
    )
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}

function fsFields(obj) {
  const fields = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      // Detect ISO date strings and store as timestamps
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
        fields[k] = { timestampValue: v }
      } else {
        fields[k] = { stringValue: v }
      }
    }
    else if (typeof v === 'number') fields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v }
    else if (v === null || v === undefined) fields[k] = { nullValue: null }
  }
  return fields
}

async function createDoc(idToken, collection, data) {
  const res = await fsPost(idToken, collection, data)
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`POST ${collection} falló (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`)
  }
  const name = res.body.name || ''
  return name.split('/').pop()
}

async function main() {
  console.log('\n🌱 Sembrando datos de demo para admin dashboard')
  console.log('='.repeat(48))

  // Create temp user
  const signUpRes = await idtPost('accounts:signUp', { email: TEMP_EMAIL, password: TEMP_PASS, returnSecureToken: true })
  if (signUpRes.status !== 200) throw new Error(`signUp falló: ${JSON.stringify(signUpRes.body)}`)
  const { idToken, localId: tempUid } = signUpRes.body
  console.log(`  ✅ Cuenta temporal creada (${tempUid})\n`)

  try {
    // Demo scenarios for subscriptions
    const scenarios = [
      // 1. Trial activo (10 de 30 días transcurridos → 20 restantes)
      { teacher: TEACHERS[0], status: 'trial', planId: '', planName: 'Trial', price: 0,
        fechaInicio: daysAgo(10), fechaVencimiento: daysFrom(20) },
      // 2. Suscripción mensual activa
      { teacher: TEACHERS[1], status: 'activa', planId: 'pro', planName: 'Suscripción mensual', price: 116,
        fechaInicio: daysAgo(15), fechaVencimiento: daysFrom(15) },
      // 3. Pendiente de pago
      { teacher: TEACHERS[2], status: 'pendiente_pago', planId: 'pro', planName: 'Suscripción mensual', price: 116,
        fechaInicio: daysAgo(5), fechaVencimiento: daysFrom(25) },
      // 4. Trial activo, últimos días (2 de 30 transcurridos → 28 restantes)
      { teacher: TEACHERS[3], status: 'trial', planId: '', planName: 'Trial', price: 0,
        fechaInicio: daysAgo(2), fechaVencimiento: daysFrom(28) },
      // 5. Vencida
      { teacher: TEACHERS[4], status: 'vencida', planId: 'pro', planName: 'Suscripción mensual', price: 116,
        fechaInicio: daysAgo(40), fechaVencimiento: daysAgo(10) },
      // 6. Trial por terminar (20 de 30 transcurridos → 10 restantes)
      { teacher: TEACHERS[5], status: 'trial', planId: '', planName: 'Trial', price: 0,
        fechaInicio: daysAgo(20), fechaVencimiento: daysFrom(10) },
      // 7. Suscripción mensual activa
      { teacher: TEACHERS[6], status: 'activa', planId: 'pro', planName: 'Suscripción mensual', price: 116,
        fechaInicio: daysAgo(5), fechaVencimiento: daysFrom(25) },
      // 8. Pendiente de pago
      { teacher: TEACHERS[7], status: 'pendiente_pago', planId: 'pro', planName: 'Suscripción mensual', price: 116,
        fechaInicio: daysAgo(1), fechaVencimiento: daysFrom(29) },
    ]

    console.log('📋 Creando suscripciones demo…')
    const subIds = []
    for (const s of scenarios) {
      const now = new Date().toISOString()
      const subId = await createDoc(idToken, 'subscriptions', {
        docenteId: s.teacher.uid,
        planId: s.planId,
        planName: s.planName,
        escuelaId: s.teacher.school,
        schoolName: s.teacher.school,
        status: s.status,
        fechaInicio: s.fechaInicio,
        fechaVencimiento: s.fechaVencimiento,
        precio: s.price,
        createdAt: now,
        updatedAt: now,
      })
      subIds.push({ subId, scenario: s })
      console.log(`  ✅ ${s.teacher.email.padEnd(30)} → ${s.status}`)
    }

    // Demo payments (for scenarios with price > 0)
    const payableScenarios = scenarios.filter(s => s.price > 0)

    console.log('\n💳 Creando pagos demo…')
    for (let i = 0; i < payableScenarios.length; i++) {
      const s = payableScenarios[i]
      const now = new Date().toISOString()

      // Statuses: some approved, some pending, some rejected
      const payStatus = i === 0 ? 'aprobado' :
                        i === 1 ? 'pendiente' :
                        i === 2 ? 'aprobado' :
                        i === 3 ? 'rechazado' : 'pendiente'

      const payId = await createDoc(idToken, 'payments', {
        docenteId: s.teacher.uid,
        planId: s.planId,
        planName: s.planName,
        monto: s.price,
        status: payStatus,
        referencia: `REF${Math.floor(Math.random() * 900000 + 100000)}`,
        banco: 'BBVA',
        notas: payStatus === 'rechazado' ? 'Referencia no encontrada en sistema' : '',
        createdAt: now,
        updatedAt: now,
        reviewedAt: payStatus !== 'pendiente' ? now : null,
      })
      console.log(`  ✅ Pago ${payStatus.padEnd(10)} — ${s.teacher.email.slice(0, 25)}`)
    }

    console.log('\n✅ Datos de demo sembrados correctamente.')
    console.log(`   • ${scenarios.length} suscripciones`)
    console.log(`   • ${payableScenarios.length} pagos`)
    console.log('\n   Próximo paso: restaurar firestore.rules y redeploy.\n')

  } finally {
    const delRes = await idtPost('accounts:delete', { idToken })
    console.log(delRes.status === 200 ? '🧹 Cuenta temporal eliminada.' : `⚠ No se eliminó cuenta temporal.`)
  }
}

main().catch((err) => {
  console.error('\n❌', err.message)
  process.exit(1)
})
