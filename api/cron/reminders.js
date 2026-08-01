import { getDb } from '../_lib/firebaseAdmin.js'
import { enviarCorreo } from '../_lib/email.js'
import { armarCorreo, parrafo, boton, SITIO } from '../_lib/emailTemplates.js'

// Corre 1 vez al día (ver "crons" en vercel.json) y manda hasta 6 tipos de
// recordatorio, dos etapas por caso:
//   - prueba por vencer:        día 6 de faltantes, y último día
//   - suscripción por vencer:   día 7 de faltantes, y último día
//   - 90 días de retención:     día 60 vencida (30 antes), y día 83 (7 antes)
//
// El punto de partida de los 90 días es la MISMA fecha de vencimiento que ya
// usa el resto de la app (effectiveVencimiento/isSubscriptionExpired en
// subscriptionHelpers.js) — no un campo nuevo. Duplicado aquí en vez de
// importado porque api/ no puede importar de src/ (bundles separados).
const TRIAL_DURATION_DAYS = 30

function toDate(value) {
  if (!value) return null
  if (value.toDate) return value.toDate()
  return new Date(value)
}

function diasRestantes(fecha) {
  const end = toDate(fecha)
  if (!end) return null
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  return Math.ceil((end - now) / (1000 * 60 * 60 * 24))
}

function vencimientoEfectivo(sub) {
  if (sub.status === 'trial') {
    const start = toDate(sub.fechaInicio) || new Date()
    const end = new Date(start)
    end.setDate(end.getDate() + TRIAL_DURATION_DAYS)
    return end
  }
  return sub.fechaVencimiento
}

// Las claves quedan grabadas en `remindersSent` de la propia suscripción para
// no volver a mandar el mismo correo si el cron corre dos veces el mismo día
// o si por lo que sea no avanza exacto un día por corrida.
const CLAVES = {
  TRIAL_TEMPRANO: 'trial-6',
  TRIAL_URGENTE: 'trial-1',
  SUB_TEMPRANO: 'sub-7',
  SUB_URGENTE: 'sub-1',
  RETENCION_TEMPRANO: 'retencion-60',
  RETENCION_URGENTE: 'retencion-83',
}

function nombreDe(perfil) {
  return perfil?.nombreMostrar || perfil?.nombre || perfil?.username || ''
}

function correoTrial(nombre, urgente) {
  const saludo = nombre ? `Hola ${nombre},` : 'Hola,'
  const cuerpo = [
    parrafo(saludo),
    urgente
      ? parrafo('<strong>Hoy es tu último día</strong> de período de prueba en Evalúa Fácil.')
      : parrafo('Te quedan <strong>6 días</strong> de tu período de prueba en Evalúa Fácil.'),
    parrafo('Tus grupos, estudiantes, actividades y calificaciones siguen ahí — activar tu suscripción mensual no cambia nada de lo que ya hiciste, solo te deja seguir usándolo.'),
  ].join('')
  const titulo = urgente ? 'Tu prueba termina hoy' : 'Tu período de prueba está por terminar'
  return {
    subject: titulo,
    html: armarCorreo({ titulo, cuerpo, accion: boton('Activar mi suscripción →', SITIO) }),
  }
}

function correoSuscripcion(nombre, urgente) {
  const saludo = nombre ? `Hola ${nombre},` : 'Hola,'
  const cuerpo = [
    parrafo(saludo),
    urgente
      ? parrafo('<strong>Tu suscripción mensual vence hoy.</strong>')
      : parrafo('Tu suscripción mensual vence en <strong>7 días</strong>.'),
    parrafo('Si ya tienes activada la renovación automática no necesitas hacer nada. Si no, renueva desde tu perfil para no perder acceso a tu cuenta.'),
  ].join('')
  const titulo = urgente ? 'Tu suscripción vence hoy' : 'Tu suscripción está por vencer'
  return {
    subject: titulo,
    html: armarCorreo({ titulo, cuerpo, accion: boton('Renovar mi suscripción →', SITIO) }),
  }
}

function correoRetencion(nombre, urgente) {
  const saludo = nombre ? `Hola ${nombre},` : 'Hola,'
  const cuerpo = [
    parrafo(saludo),
    urgente
      ? parrafo('En <strong>7 días</strong> se eliminará definitivamente tu cuenta de Evalúa Fácil junto con todos tus grupos, estudiantes, actividades y calificaciones, por no tener una suscripción activa.')
      : parrafo('Tu cuenta de Evalúa Fácil lleva más de 60 días sin una suscripción activa. Guardamos tu información <strong>90 días</strong> desde que venció — pasado ese plazo se elimina definitivamente y no se puede recuperar.'),
    parrafo('Reactiva tu suscripción para conservar todo tal como lo dejaste.'),
  ].join('')
  const titulo = urgente ? 'Tu cuenta se elimina en 7 días' : 'Tu información se elimina en 30 días'
  return {
    subject: titulo,
    html: armarCorreo({ titulo, cuerpo, accion: boton('Reactivar mi cuenta →', SITIO) }),
  }
}

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'No autorizado' })
    }
  }

  const db = getDb()
  const enviados = { trialTemprano: 0, trialUrgente: 0, subTemprano: 0, subUrgente: 0, retencionTemprano: 0, retencionUrgente: 0 }

  try {
    // Solo 'in' y '==' están permitidos sin índice compuesto — se filtra el
    // resto (días exactos) en memoria.
    const snap = await db.collection('subscriptions')
      .where('status', 'in', ['trial', 'activa', 'vencida', 'cancelada'])
      .get()

    for (const doc of snap.docs) {
      const sub = doc.data()
      if (!sub.docenteId) continue
      const yaEnviados = new Set(sub.remindersSent || [])

      const dias = diasRestantes(vencimientoEfectivo(sub))
      if (dias === null) continue

      let clave = null
      let tipo = null
      let urgente = false

      if (sub.status === 'trial' && dias > 0) {
        if (dias === 6) { clave = CLAVES.TRIAL_TEMPRANO; tipo = 'trial' }
        else if (dias === 1) { clave = CLAVES.TRIAL_URGENTE; tipo = 'trial'; urgente = true }
      } else if (sub.status === 'activa' && dias > 0) {
        if (dias === 7) { clave = CLAVES.SUB_TEMPRANO; tipo = 'sub' }
        else if (dias === 1) { clave = CLAVES.SUB_URGENTE; tipo = 'sub'; urgente = true }
      } else if (dias <= 0) {
        // Vencida (o trial/activa que ya pasó su fecha sin que nadie
        // actualizara el status a mano) — cuenta los 90 días desde aquí.
        const diasVencida = -dias
        if (diasVencida === 60) { clave = CLAVES.RETENCION_TEMPRANO; tipo = 'retencion' }
        else if (diasVencida === 83) { clave = CLAVES.RETENCION_URGENTE; tipo = 'retencion'; urgente = true }
      }

      if (!clave || yaEnviados.has(clave)) continue

      const perfilSnap = await db.collection('users').doc(sub.docenteId).get()
      if (!perfilSnap.exists) continue // cuenta ya no existe, nada que avisar
      const perfil = perfilSnap.data()
      if (!perfil.email) continue

      const nombre = nombreDe(perfil)
      const { subject, html } = tipo === 'trial' ? correoTrial(nombre, urgente)
        : tipo === 'sub' ? correoSuscripcion(nombre, urgente)
        : correoRetencion(nombre, urgente)

      const ok = await enviarCorreo({ to: perfil.email, toName: nombre, subject, html })
      if (ok) {
        await doc.ref.update({ remindersSent: [...yaEnviados, clave] })
        const contador = tipo === 'trial' ? (urgente ? 'trialUrgente' : 'trialTemprano')
          : tipo === 'sub' ? (urgente ? 'subUrgente' : 'subTemprano')
          : (urgente ? 'retencionUrgente' : 'retencionTemprano')
        enviados[contador]++
      }
    }

    return res.status(200).json({ ok: true, enviados })
  } catch (err) {
    console.error('[cron/reminders]', err)
    return res.status(500).json({ error: err.message || 'Error en el cron de recordatorios' })
  }
}
