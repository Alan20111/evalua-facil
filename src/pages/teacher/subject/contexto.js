// Contexto del componente principal de SubjectPage.jsx: lo que las
// partes extraídas (fase 5 de PLAN_NORMALIZACION_UI) leen de él.
import { createContext, useContext } from 'react'

export const ContextoAsignatura = createContext(null)
export const useAsignatura = () => useContext(ContextoAsignatura)
