// Cómo se COMPARA el usuario que teclea un estudiante contra el que está
// guardado. Una sola definición, la misma en el navegador y en las funciones
// de Vercel (api/student/[action].js la importa desde aquí).
//
// Por qué vive en su propio archivo y no dentro de generate.js: generate.js
// también CREA usuarios y contraseñas (usa crypto.getRandomValues), y el
// servidor no necesita nada de eso para buscar una cuenta. Separar "cómo se
// genera" de "cómo se compara" es lo que permite que las dos mitades usen
// exactamente el mismo código sin arrastrarse la una a la otra.
//
// El problema que esto cierra (18-sep-2026): desde F-02 la búsqueda previa al
// login dejó de hacerse en el navegador y se movió a /api/student/lookup. El
// cliente SÍ normalizaba ñ y acentos; el servidor no — solo probaba minúsculas
// y MAYÚSCULAS. Resultado: una alumna que se apellida Patiño, Muñoz o Peña y
// escribía su apellido COMO SE ESCRIBE recibía "Usuario no encontrado" aunque
// su cuenta existiera. La normalización se había perdido en la migración sin
// que nadie lo notara, porque cliente y servidor eran dos copias distintas.
// Ahora son una sola, y test/unidad.test.mjs falla si vuelven a separarse.
//
// IMPORTANTE — esto NO cambia la identidad de nadie:
//   · el `username` guardado en Firestore se queda como está;
//   · el correo sintético de Firebase Auth se sigue construyendo igual
//     (studentEmail en generate.js, cuya forma sostiene firestore.rules);
//   · la normalización sirve solo para ENCONTRAR la cuenta que ya existe.

// Los usuarios son identificadores: solo letras, dígitos y el punto que separa
// apellido de nombre. Cualquier otra cosa que venga tecleada (espacios de más,
// un guion, un acento suelto) se descarta al comparar.
const SOLO_IDENTIFICADOR = /[^a-zA-Z0-9.]/g

// La forma canónica de un usuario: minúsculas, sin acentos, con la ñ escrita
// como n — que es exactamente como lo genera generateUsername().
//
// El paso explícito de ñ→n va DESPUÉS de quitar diacríticos y es a propósito
// redundante: NFD ya descompone ñ en n + tilde combinante, pero el regex de
// diacríticos no siempre la alcanzó en el pasado (ver el comentario histórico
// en generate.js). Se queda como cinturón y tirantes.
export function normalizarUsername(input) {
  return String(input ?? '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[ñÑ]/g, 'n')
    .replace(SOLO_IDENTIFICADOR, '')
    .toLowerCase()
}

// Las formas con las que hay que buscar en Firestore, que no puede comparar
// sin distinguir mayúsculas. Son cuatro como mucho:
//
//   1. lo tecleado en minúsculas   — los usuarios nuevos (patino.evelin)
//   2. lo tecleado en MAYÚSCULAS   — los códigos legados de 4 letras (LURC)
//   3. la forma canónica           — "patiño.evelin" → "patino.evelin"
//   4. la forma canónica en MAYÚS. — "JIMÉNEZ.MARTHA" → "JIMENEZ.MARTHA",
//                                     que es como está guardado un legado
//
// Cuando lo tecleado no trae ñ ni acentos, 3 coincide con 1 y 4 con 2, así que
// el Set las colapsa y se hacen las mismas dos consultas de siempre. Solo el
// caso con ñ/acento paga dos consultas más, y es el caso que hoy no funciona.
export function candidatosUsername(input) {
  const tecleado = String(input ?? '').trim()
  if (!tecleado) return []
  const canonico = normalizarUsername(tecleado)
  return [...new Set([
    tecleado.toLowerCase(),
    tecleado.toUpperCase(),
    canonico,
    canonico.toUpperCase(),
  ])].filter(Boolean)
}

// ¿Lo que tecleó el estudiante era ya el usuario correcto, salvo mayúsculas?
//
// Sirve para decirle la verdad en pantalla: si entró porque normalizamos su ñ,
// merece ver cómo se escribe su usuario. Si lo escribió bien, no hay nada que
// enseñarle y no se le dice nada.
export function coincidenciaExacta(tecleado, guardado) {
  return String(tecleado ?? '').trim().toLowerCase() === String(guardado ?? '').toLowerCase()
}
