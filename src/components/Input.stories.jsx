export default {
  title: 'Components/Input',
  parameters: {
    layout: 'centered',
  },
};

export const Standard = {
  render: () => (
    <div className="w-80">
      <label htmlFor="input-standard" className="block text-sm font-medium text-muted mb-1">Email</label>
      <input
        id="input-standard"
        type="email"
        placeholder="tu@email.com"
        className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
      />
    </div>
  ),
};

export const WithError = {
  render: () => (
    <div className="w-80">
      <label htmlFor="input-error" className="block text-sm font-medium text-muted mb-1">Email</label>
      <input
        id="input-error"
        type="email"
        defaultValue="invalido"
        aria-invalid="true"
        aria-describedby="input-error-msg"
        className="w-full px-4 py-2.5 rounded border border-red-400 focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
      />
      <p id="input-error-msg" className="text-xs text-red-600 mt-1">Email inválido</p>
    </div>
  ),
};

export const Disabled = {
  render: () => (
    <div className="w-80">
      <label htmlFor="input-disabled" className="block text-sm font-medium text-muted mb-1">Email (deshabilitado)</label>
      <input
        id="input-disabled"
        type="email"
        disabled
        defaultValue="ejemplo@email.com"
        className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface disabled:opacity-60"
      />
    </div>
  ),
};

export const Focus = {
  render: () => (
    <div className="w-80">
      <label htmlFor="input-focus" className="block text-sm font-medium text-muted mb-1">Email (focus)</label>
      <input
        id="input-focus"
        type="email"
        autoFocus
        placeholder="tu@email.com"
        className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
      />
    </div>
  ),
};
