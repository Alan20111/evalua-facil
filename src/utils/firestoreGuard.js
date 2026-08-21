import {
  addDoc as _addDoc,
  setDoc as _setDoc,
  updateDoc as _updateDoc,
  deleteDoc as _deleteDoc,
  writeBatch as _writeBatch,
} from 'firebase/firestore'

// Modelo de créditos puros (20-ago-2026): se retira el candado por
// suscripción vencida — todo lo no-IA es gratis para cualquier docente
// autenticado, sin candado alguno (ver docs/ia/PLAN_TECNICO_CREDITOS_PUROS.md
// §2, §7). Este módulo se conserva como punto único de paso de las
// escrituras del docente (más de cien lugares las importan de aquí en vez de
// 'firebase/firestore', mismos nombres/firma) por si un candado amable de
// este tipo hace falta de nuevo — hoy no bloquea nada.
//
// El único candado que sigue vivo es el de Asistencia por saldo de créditos
// IA (saldo == 0 → bloqueada), y vive en la propia pantalla de Asistencia
// (banner + inputs deshabilitados, ver AttendanceTab) usando useCreditosIA —
// no aquí, porque a diferencia de la suscripción vencida (que bloqueaba
// TODA escritura del docente) el saldo de créditos solo bloquea Asistencia,
// nunca el resto de la plataforma. El candado real, servidor, está en
// firestore.rules (saldoIAPositivo) — esto es solo la capa amable.

export function addDoc(...args) { return _addDoc(...args) }
export function setDoc(...args) { return _setDoc(...args) }
export function updateDoc(...args) { return _updateDoc(...args) }
export function deleteDoc(...args) { return _deleteDoc(...args) }
export function writeBatch(db) { return _writeBatch(db) }
