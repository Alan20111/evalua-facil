import { Link } from 'react-router-dom'
import { GraduationCap, BookOpen, ChevronRight } from 'lucide-react'

// Public entry: pick a role. Teacher = blue, Student = orange. No mixed content.
export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface py-10">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-on-surface">Evalúa Fácil</h1>
          <p className="text-muted mt-2">Elige cómo quieres entrar</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {/* Docente */}
          <Link
            to="/docente"
            className="group bg-surface-card rounded-card shadow-card hover:shadow-md transition-shadow p-5 text-center"
          >
            <div className="w-14 h-14 rounded-card bg-blue-600 flex items-center justify-center mx-auto mb-3">
              <GraduationCap size={28} className="text-white" />
            </div>
            <h2 className="text-lg font-bold text-on-surface">Soy Docente</h2>
            <p className="text-sm text-muted mt-1">Administra y evalúa tus asignaturas</p>
            <span className="mt-3 inline-flex items-center gap-1 text-blue-600 font-semibold text-sm group-hover:gap-2 transition-all">
              Entrar <ChevronRight size={18} />
            </span>
          </Link>

          {/* Alumno */}
          <Link
            to="/alumno"
            className="group bg-surface-card rounded-card shadow-card hover:shadow-md transition-shadow p-5 text-center"
          >
            <div className="w-14 h-14 rounded-card bg-orange-500 flex items-center justify-center mx-auto mb-3">
              <BookOpen size={28} className="text-white" />
            </div>
            <h2 className="text-lg font-bold text-on-surface">Soy Estudiante</h2>
            <p className="text-sm text-muted mt-1">Entra a tus asignaturas y entregas</p>
            <span className="mt-3 inline-flex items-center gap-1 text-orange-600 font-semibold text-sm group-hover:gap-2 transition-all">
              Entrar <ChevronRight size={18} />
            </span>
          </Link>
        </div>

        <p className="text-center text-sm text-muted mt-8">
          ¿Eres docente y aún no tienes cuenta?{' '}
          <Link to="/register" className="text-blue-600 font-semibold hover:underline">Crear cuenta</Link>
        </p>
      </div>
    </div>
  )
}
