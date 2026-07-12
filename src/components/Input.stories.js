export default {
  title: 'Components/Input',
  parameters: {
    layout: 'centered',
  },
};

export const Standard = {
  render: () => (
    <div className="w-80">
      <label className="block text-sm font-medium text-muted mb-1">Email</label>
      <input
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
      <label className="block text-sm font-medium text-muted mb-1">Email</label>
      <input
        type="email"
        value="invalido"
        className="w-full px-4 py-2.5 rounded border border-red-400 focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
      />
      <p className="text-xs text-red-600 mt-1">Email inválido</p>
    </div>
  ),
};

export const Disabled = {
  render: () => (
    <div className="w-80">
      <label className="block text-sm font-medium text-muted mb-1">Email (deshabilitado)</label>
      <input
        type="email"
        disabled
        value="ejemplo@email.com"
        className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface disabled:opacity-60"
      />
    </div>
  ),
};

export const Focus = {
  render: () => (
    <div className="w-80">
      <label className="block text-sm font-medium text-muted mb-1">Email (focus)</label>
      <input
        type="email"
        autoFocus
        placeholder="tu@email.com"
        className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
      />
    </div>
  ),
};
