// Parte del render de SubjectPage.jsx (fase 5 de PLAN_NORMALIZACION_UI:
// dividir sin cambio visual). Recibe lo que usa del componente principal por
// el contexto Asignatura.
import { Button, SkeletonList } from '../../../components/ui'
import { Download, ExternalLink, FileSearch, Pencil, Plus, Trash2 } from 'lucide-react'
import { FilePreviewModal, canPreviewFile } from '../../../components/AttachmentList'
import { ICONO } from '../../../config/iconos'
import InfoDisclosure from '../../../components/ui/InfoDisclosure'
import { downloadUrl, isImageDeliveredPdf, pdfPageImageUrl } from '../../../utils/cloudinary'
import { formatFileSize } from '../../../utils/formatBytes'
import { formatResourceDate } from './utilidades'
import { getLinkResourceIcon, getResourceIcon } from '../../../utils/resourceTypes'
import { useAsignatura } from './contexto'

export default function TabRecursos() {
  const {
    activeTab,
    loadingResources,
    openAddResource,
    openEditResource,
    previewResourceId,
    resources,
    resourcesLoaded,
    setDeleteResourceConfirm,
    setPreviewResourceId,
  } = useAsignatura()
  return (
    <>
      {activeTab === 'recursos' && (
        <div className="px-4 py-2 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <InfoDisclosure>
              <p className="text-sm text-muted leading-relaxed">
                Materiales permanentes de toda la asignatura (programa, reglamento, guías, presentaciones, enlaces, videos…), disponibles para tus estudiantes durante todo el semestre. No generan entrega ni calificación.
              </p>
            </InfoDisclosure>
            <Button icon={Plus} iconEffect="gira90" className="flex-shrink-0" onClick={openAddResource}
              data-tooltip="Agregar recurso">
               Agregar recurso
            </Button>
          </div>

          {!resourcesLoaded || loadingResources ? (
            <SkeletonList rows={4} className="py-4" />
          ) : resources.length === 0 ? (
            <div className="text-center py-10 text-hint text-sm">
              Aún no hay recursos en esta asignatura
            </div>
          ) : (
            <div className="space-y-1.5">
              {resources.map((r) => {
                const isLink = r.tipo === 'link'
                const { icon: Icon, color } = isLink ? getLinkResourceIcon(r.url) : getResourceIcon(r.nombreArchivo)
                const isPreviewOpen = previewResourceId === r.id
                return (
                  <div key={r.id} className="bg-surface-card border border-outline-variant rounded-card shadow-card">
                    <div className="flex items-center gap-3 px-3 py-2">
                      <Icon size={ICONO.lg} className={`flex-shrink-0 ${color}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-on-surface truncate">{r.nombre}</p>
                        {r.descripcion && (
                          <p className="text-xs text-muted truncate">{r.descripcion}</p>
                        )}
                        <p className="text-xs text-hint mt-0.5">
                          {isLink ? 'Enlace · ' : `${formatFileSize(r.tamano)}${r.tamano ? ' · ' : ''}`}{formatResourceDate(r.fechaPublicacion)}
                        </p>
                      </div>
                      {!isLink && canPreviewFile(r.nombreArchivo || r.nombre) && (
                        <button type="button" onClick={() => setPreviewResourceId(isPreviewOpen ? null : r.id)}
                          aria-label="Vista previa"
                          data-tooltip="Vista previa"
                          className={`p-2 rounded transition-colors flex-shrink-0 ${isPreviewOpen ? 'text-accent bg-[var(--accent-medium)]' : 'text-hint hover:text-accent hover:bg-[var(--accent-medium)]'}`}>
                          <FileSearch size={ICONO.md} />
                        </button>
                      )}
                      <a href={isLink ? r.url : (isImageDeliveredPdf(r.url) ? pdfPageImageUrl(r.url, 1) : r.url)} target="_blank" rel="noreferrer"
                        aria-label={isLink ? 'Abrir enlace' : (isImageDeliveredPdf(r.url) ? 'Abrir página 1 en pestaña nueva' : 'Abrir en pestaña nueva')}
                        data-tooltip={isLink ? 'Abrir enlace' : (isImageDeliveredPdf(r.url) ? 'Abrir página 1 en pestaña nueva' : 'Abrir en pestaña nueva')}
                        className="p-2 text-hint hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
                        <ExternalLink size={ICONO.md} />
                      </a>
                      {!isLink && (
                        <a href={downloadUrl(r.url, r.nombreArchivo || r.nombre)} download={r.nombreArchivo || r.nombre} rel="noreferrer" aria-label="Descargar" data-tooltip="Descargar"
                          className="p-2 text-hint hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
                          <Download size={ICONO.md} />
                        </a>
                      )}
                      <button type="button" onClick={() => openEditResource(r)} aria-label="Editar" data-tooltip="Editar"
                        className="size-control inline-flex items-center justify-center text-hint hover:text-accent hover:bg-[var(--accent-medium)] rounded-full transition-colors flex-shrink-0">
                        <Pencil size={ICONO.md} />
                      </button>
                      <button type="button" onClick={() => setDeleteResourceConfirm(r)} aria-label="Eliminar" data-tooltip="Eliminar"
                        className="size-control inline-flex items-center justify-center text-hint hover:text-red-500 hover:bg-red-50 rounded-full transition-colors flex-shrink-0">
                        <Trash2 size={ICONO.md} />
                      </button>
                    </div>
                    {isPreviewOpen && !isLink && (
                      <FilePreviewModal
                        url={r.url}
                        nombre={r.nombreArchivo || r.nombre}
                        onClose={() => setPreviewResourceId(null)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </>
  )
}
