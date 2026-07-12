import '../src/index.css';

export const parameters = {
  actions: { argTypesRegex: '^on[A-Z].*' },
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/i,
    },
  },
  viewport: {
    viewports: {
      mobile: {
        name: 'Mobile (375px)',
        styles: { width: '375px', height: '812px' },
        type: 'mobile',
      },
      tablet: {
        name: 'Tablet (768px)',
        styles: { width: '768px', height: '1024px' },
        type: 'tablet',
      },
      desktop: {
        name: 'Desktop (1440px)',
        styles: { width: '1440px', height: '900px' },
        type: 'desktop',
      },
    },
  },
  a11y: {
    config: {
      rules: [
        {
          id: 'color-contrast',
          enabled: true,
        },
        {
          id: 'link-name',
          enabled: true,
        },
        {
          id: 'button-name',
          enabled: true,
        },
      ],
    },
  },
};

export const decorators = [
  (Story) => (
    <div data-role="docente" className="bg-surface min-h-screen p-4">
      <Story />
    </div>
  ),
];
