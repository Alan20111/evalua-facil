import path from 'path';

export default {
  stories: ['../src/**/*.stories.js', '../src/**/*.stories.jsx'],
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-viewport',
    '@storybook/addon-design',
    '@storybook/addon-interactions',
    '@storybook/addon-essentials',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: async (config) => {
    return {
      ...config,
      resolve: {
        ...config.resolve,
        alias: {
          '@': path.resolve(__dirname, '../src'),
        },
      },
    };
  },
  docs: {
    autodocs: 'tag',
  },
};
