export default {
  title: 'Components/Card',
  parameters: {
    layout: 'centered',
  },
};

export const Standard = {
  render: () => (
    <div className="w-96 bg-surface-card rounded-card shadow-card p-5">
      <h3 className="text-lg font-bold text-on-surface mb-2">Título de la tarjeta</h3>
      <p className="text-sm text-on-surface-variant">
        Este es el contenido de la tarjeta. Puede incluir texto, formularios, imágenes, etc.
      </p>
    </div>
  ),
};

export const WithBorder = {
  render: () => (
    <div className="w-96 bg-surface-card rounded-card border border-outline-variant p-5">
      <h3 className="text-lg font-bold text-on-surface mb-2">Tarjeta con borde</h3>
      <p className="text-sm text-on-surface-variant">Sin sombra, solo borde de contorno.</p>
    </div>
  ),
};

export const ClickableRow = {
  render: () => (
    <button className="w-96 bg-surface-card rounded-card p-3 shadow-card hover:shadow-md transition-shadow flex items-center gap-3 text-left cursor-pointer">
      <div className="w-11 h-11 rounded bg-accent-light flex items-center justify-center">
        📚
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold text-on-surface truncate">Matemáticas 3A</h4>
        {/* text-muted (on-surface-variant) en vez de slate-400: slate-400 no cumple contraste AA (4.5:1) sobre blanco */}
        <p className="text-xs text-muted">Prof. Martínez</p>
      </div>
      <span className="text-muted" aria-hidden="true">›</span>
    </button>
  ),
};

export const Accordion = {
  render: () => (
    <div className="w-96 bg-surface-card rounded-card overflow-hidden shadow-card">
      <button className="w-full px-4 py-2 hover:bg-[var(--accent-medium)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-accent-light rounded flex items-center justify-center text-accent font-bold text-sm">
            1
          </div>
          <span className="text-sm font-semibold">Parcial 1</span>
        </div>
        <span>▼</span>
      </button>
      <div className="px-4 py-3 border-t border-outline-variant bg-surface">
        <p className="text-sm text-on-surface-variant">Contenido del acordeón aquí...</p>
      </div>
    </div>
  ),
};
