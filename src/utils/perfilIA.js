// Perfil para IA del docente — contexto GENERAL reutilizable por todas las
// funciones de IA (ver docs/ia/PLAN_MAESTRO_IA_EVALUA_FACIL.md, FASE 2-BIS).
// No es planeación didáctica ni contexto de una Asignatura específica.

// Campos mínimos para considerar el perfil "completo": los tres que aportan
// contexto de personalización real. Contexto de escuela y contexto general
// quedan como enriquecimiento opcional (la escuela ya se conoce vía
// escuelaId/schoolName en users/{uid}).
const CAMPOS_REQUERIDOS = ['estiloClase', 'habilidades', 'experiencia']

export function perfilIAVacio() {
  return {
    estiloClase: '',
    habilidades: '',
    experiencia: '',
    contextoEscuela: '',
    contextoGeneral: '',
  }
}

export function isPerfilIACompleto(perfilIA) {
  if (!perfilIA) return false
  return CAMPOS_REQUERIDOS.every((campo) => Boolean(perfilIA[campo]?.trim()))
}
