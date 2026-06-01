import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://fairground.xyz',
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  // Minimal client JS -- no framework hydration on static sections
  output: 'static',
});
