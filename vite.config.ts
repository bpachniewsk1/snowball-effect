import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the built site works at a domain root or in a sub-folder
  // (e.g. GitHub Pages' /<repo>/) without changes.
  base: './',
});
