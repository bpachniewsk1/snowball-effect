import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the built site works at a domain root or in a sub-folder
  // (e.g. GitHub Pages' /<repo>/) without changes.
  base: './',
  build: {
    rollupOptions: {
      // The game, the admin dashboard and the privacy page.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
        privacy: fileURLToPath(new URL('./privacy.html', import.meta.url)),
      },
    },
  },
});
