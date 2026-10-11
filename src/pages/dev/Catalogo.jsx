// Catálogo de componentes — SOLO en desarrollo (/dev/componentes; App.jsx no
// lo incluye en el build de producción). Muestra cada pieza de components/ui
// en todos sus estados y en los tres roles, para revisar que todo mida lo
// mismo y se mueva igual (docs/PLAN_NORMALIZACION_UI.md §3, componente 25).
// Al agregar o cambiar un componente de ui/, agrégalo aquí.
import { useState } from 'react'
import { Bell, BookOpen, Cloud, Copy, Inbox, Mail, Pencil, Plus, Search, Settings, Sparkles, Trash2, User } from 'lucide-react'
import {
  Avatar, Badge, Button, Card, Checkbox, Chip, Disclosure, EmptyState, IconButton, IconTile, InfoDisclosure,
  Input, ListGroup, ListRow, RadioGroup, Select, SubTabs, Switch, Tabs, Textarea,
} from '../../components/ui'
import YouTubeIcon from '../../components/YouTubeIcon'

function Seccion({ titulo, children }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-on-surface">{titulo}</h2>
      <Card className="space-y-4">{children}</Card>
    </section>
  )
}
const Fila = ({ children }) => <div className="flex flex-wrap items-center gap-2">{children}</div>

export default function Catalogo() {
  const [rol, setRol] = useState('docente')
  const [tab, setTab] = useState('perfil')
  const [sub, setSub] = useState('datos')
  const [chip, setChip] = useState('todas')
  const [radio, setRadio] = useState('b')
  const [sw, setSw] = useState(true)
  const [sel, setSel] = useState('3')
  const [texto, setTexto] = useState('')

  return (
    <div data-role={rol} className="min-h-dvh bg-surface">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8">
        <header className="space-y-3">
          <h1 className="text-2xl font-bold text-on-surface">Catálogo de componentes</h1>
          <p className="text-sm text-muted">Todo lo que se toca mide una altura de control (h-control). Cambia de rol para ver el acento y la escala de cada uno.</p>
          <SubTabs label="Rol" value={rol} onChange={setRol} options={[{ value: 'docente', label: 'Docente' }, { value: 'alumno', label: 'Alumno' }, { value: 'admin', label: 'Admin' }]} />
        </header>

        <Seccion titulo="Botones — misma altura">
          <Fila>
            <Button icon={Plus}>Primario</Button>
            <Button variant="secondary">Secundario</Button>
            <Button variant="outline-accent">Contorno</Button>
            <Button variant="ghost">Fantasma</Button>
            <Button variant="danger" icon={Trash2}>Eliminar</Button>
            <Button variant="danger-outline">Eliminar cuenta</Button>
          </Fila>
          <Fila>
            <Button size="sm">Chico</Button>
            <Button>Normal</Button>
            <Button size="lg">Grande</Button>
            <Button busy>Guardando</Button>
            <Button disabled>Deshabilitado</Button>
            <Button variant="link">Enlace</Button>
          </Fila>
          <Fila>
            <IconButton icon={Pencil} label="Editar" />
            <IconButton icon={Copy} label="Copiar" />
            <IconButton icon={Trash2} label="Eliminar" variant="danger" />
            <IconButton icon={Plus} label="Agregar" variant="accent" />
            <IconButton icon={Settings} label="Ajustes" size="sm" />
            <Input aria-label="Junto a un campo" className="max-w-[12rem]" />
          </Fila>
          <Button variant="cta-dashed" icon={Plus}>Nueva asignatura</Button>
        </Seccion>

        <Seccion titulo="Pestañas">
          <Tabs label="Secciones" value={tab} onChange={setTab} options={[
            { value: 'perfil', label: 'Perfil', icon: User },
            { value: 'ia', label: 'Créditos IA', shortLabel: 'IA', icon: Sparkles },
            { value: 'ajustes', label: 'Ajustes', icon: Settings },
          ]} />
          <SubTabs label="Partes" value={sub} onChange={setSub} options={[{ value: 'datos', label: 'Datos' }, { value: 'escuela', label: 'Escuela' }, { value: 'cuenta', label: 'Cuenta' }]} />
          <Fila>
            {['todas', 'pendientes', 'calificadas'].map((c) => (
              <Chip key={c} selected={chip === c} onClick={() => setChip(c)}>{c[0].toUpperCase() + c.slice(1)}</Chip>
            ))}
            <Badge tone="accent">Nuevo</Badge>
            <Badge tone="success">Entregado</Badge>
            <Badge tone="warning">Por calificar</Badge>
            <Badge tone="danger">Vencido</Badge>
          </Fila>
        </Seccion>

        <Seccion titulo="Campos">
          <Input label="Nombre" required />
          <Input label="Correo" icon={Mail} hint="Te llegará un aviso aquí." />
          <Input label="Buscar" icon={Search} size="sm" />
          <Input label="Con error" error="Este campo es obligatorio." defaultValue="x" />
          <Select label="Número de parciales" value={sel} onChange={setSel} options={[{ value: '2', label: '2 parciales' }, { value: '3', label: '3 parciales' }, { value: '4', label: '4 parciales' }]} />
          <Textarea label="Descripción" value={texto} onChange={(e) => setTexto(e.target.value)} autoResize showCount maxLength={200} optional />
        </Seccion>

        <Seccion titulo="Elegir">
          <Checkbox label="Los estudiantes pueden ver mi foto" hint="Se marca con palomita que se dibuja." defaultChecked />
          <Checkbox label="Sin marcar" />
          <Checkbox label="Deshabilitada" disabled />
          <RadioGroup label="Tipo de entrega" value={radio} onChange={setRadio} options={[{ value: 'a', label: 'Archivo' }, { value: 'b', label: 'Enlace' }, { value: 'c', label: 'En clase', hint: 'Sin subir nada' }]} />
          <Switch label="Recordatorios" hint="Te avisamos un día antes." checked={sw} onChange={setSw} />
        </Seccion>

        <Seccion titulo="Listas e íconos">
          <Fila>
            <IconTile icon={BookOpen} size="sm" />
            <IconTile icon={BookOpen} />
            <IconTile icon={BookOpen} size="lg" />
            <IconTile icon={Bell} tone="neutral" />
            <IconTile icon={Trash2} tone="danger" />
            <IconTile size="lg"><YouTubeIcon className="w-6 h-auto" /></IconTile>
            <Avatar name="Alan" size="sm" />
            <Avatar name="Alan" />
            <Avatar name="Alan" size="lg" />
          </Fila>
          <ListGroup title="Herramientas">
            <ListRow onClick={() => {}} icon={Cloud} title="Mi espacio" detail="Guarda tus archivos personales aquí" />
            <ListRow onClick={() => {}} icon={Bell} title="Notificaciones" />
            <ListRow href="https://example.com" leading={<YouTubeIcon className="w-5 h-auto flex-shrink-0" />} title="Canal de YouTube" trailing="external" />
          </ListGroup>
          <Disclosure summary={<span className="font-semibold text-on-surface">Parcial 1</span>} buttonClassName="h-control px-3 hover:bg-[var(--accent-tint)]" defaultOpen>
            <p className="px-3 text-sm text-muted">El contenido entra con la altura animada y se queda montado.</p>
          </Disclosure>
          <InfoDisclosure>
            <p className="text-xs text-muted">Explicación que antes aparecía de golpe.</p>
          </InfoDisclosure>
        </Seccion>

        <Seccion titulo="Estado vacío">
          <EmptyState icon={Inbox} title="Aún no hay entregas" action={<Button icon={Plus}>Crear actividad</Button>}>
            Cuando tus estudiantes entreguen, aparecerán aquí.
          </EmptyState>
        </Seccion>
      </div>
    </div>
  )
}
