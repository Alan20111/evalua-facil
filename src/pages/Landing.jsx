import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import EFLogo from '../components/EFLogo'

// Public entry: pick a role. Teacher = blue, Student = orange. No mixed content.
export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface py-10">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-10">
          {/* Logotipo completo de la marca en lugar del texto "Evalúa Fácil" */}
          <EFLogo className="mx-auto w-64 sm:w-80 h-auto" />
          <p className="text-muted mt-4">Elige cómo quieres entrar</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {/* Landing no tiene rol activo (data-role) — estos colores literales representan cada rol antes de que el usuario elija, deben coincidir a mano con --accent de cada rol (#2563EB docente / #F97316 alumno) si esos tokens cambian */}
          {/* Docente */}
          <Link
            to="/docente"
            className="group bg-surface-card rounded-card shadow-card hover:shadow-md transition-shadow p-5 text-center"
          >
            {/* Mismo ícono de la marca para ambos roles */}
            <EFLogo subtitle={false} className="w-14 h-14 mx-auto mb-3" />
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
            {/* Mismo ícono de la marca para ambos roles */}
            <EFLogo subtitle={false} className="w-14 h-14 mx-auto mb-3" />
            <h2 className="text-lg font-bold text-on-surface">Soy Estudiante</h2>
            <p className="text-sm text-muted mt-1">Entra a tus asignaturas y entregas</p>
            <span className="mt-3 inline-flex items-center gap-1 text-orange-600 font-semibold text-sm group-hover:gap-2 transition-all">
              Entrar <ChevronRight size={18} />
            </span>
          </Link>
        </div>
      </div>
    </div>
  )
}
