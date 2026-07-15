import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { buildThemeCss } from './src/theme/themes';

/* Compiles src/theme/themes.ts into a <style> in the document head. Inlining
 * (rather than emitting a stylesheet) is deliberate: the palette vars have to
 * be live on the very first paint, and a <style> in the head cannot be beaten
 * by a network request. ~4KB, so there is nothing to save by splitting it. */
function atlasTheme(): Plugin {
  const SOURCE = /[\\/]src[\\/]theme[\\/]themes\.ts$/;
  return {
    name: 'atlas-theme',
    transformIndexHtml() {
      return [
        {
          tag: 'style',
          attrs: { id: 'atlas-theme' },
          children: buildThemeCss(),
          injectTo: 'head',
        },
      ];
    },
    // the palettes are baked into index.html at transform time, so editing them
    // needs a full reload — an HMR module swap would not touch the <style>
    handleHotUpdate({ file, server }) {
      if (SOURCE.test(file)) server.hot.send({ type: 'full-reload' });
    },
  };
}

export default defineConfig({
  plugins: [react(), atlasTheme()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: 'http://127.0.0.1:5175', changeOrigin: false },
    },
  },
});
