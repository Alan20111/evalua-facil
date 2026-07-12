export default {
  title: 'Components/Button',
  parameters: {
    layout: 'centered',
    design: {
      type: 'figma',
      url: 'https://www.figma.com/design/XXX (copiar URL de Figma cuando esté lista)',
    },
  },
};

export const PrimaryMobile = {
  render: () => (
    <button className="py-2.5 px-4 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
      Guardar
    </button>
  ),
  parameters: {
    viewport: {
      defaultViewport: 'mobile',
    },
  },
};

export const PrimaryTablet = {
  render: () => (
    <button className="py-2.5 px-4 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
      Guardar
    </button>
  ),
  parameters: {
    viewport: {
      defaultViewport: 'tablet',
    },
  },
};

export const PrimaryDesktop = {
  render: () => (
    <button className="py-2.5 px-4 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
      Guardar
    </button>
  ),
  parameters: {
    viewport: {
      defaultViewport: 'desktop',
    },
  },
};

export const Secondary = {
  render: () => (
    <button className="border border-outline-variant rounded font-semibold text-on-surface hover:bg-surface py-2.5 px-4">
      Cancelar
    </button>
  ),
};

export const Destructive = {
  render: () => (
    <button className="bg-red-600 hover:bg-red-700 text-white font-semibold rounded py-2.5 px-4 transition-colors">
      Eliminar
    </button>
  ),
};

export const Disabled = {
  render: () => (
    <button disabled className="py-2.5 px-4 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60">
      Deshabilitado
    </button>
  ),
};
