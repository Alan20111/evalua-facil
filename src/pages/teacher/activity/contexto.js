// Contexto del componente principal de ActivityPage.jsx: lo que las
// partes extraídas (fase 5 de PLAN_NORMALIZACION_UI) leen de él.
import { createContext, useContext } from 'react'

export const ContextoActividad = createContext(null)
export const useActividad = () => useContext(ContextoActividad)
