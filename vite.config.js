import { defineConfig } from 'vite';

// The dev ports are pinned on purpose. Vite's default (5173) is taken by the DDEV
// router on this machine, which publishes 127.0.0.1:5172-5173 for its own Vite
// service — opening that port shows a DDEV/Traefik 404 instead of the game.
// strictPort makes a port clash fail loudly instead of silently shifting ports.
export default defineConfig({
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
});
