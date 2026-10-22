import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En desarrollo el proxy evita problemas de CORS: las llamadas a /b/... se
// reenvian a https://panel.lucidsales.co/b/...
// En produccion sirve el build detras de un reverse proxy que haga lo mismo,
// o define VITE_API_BASE apuntando directo a la API (requiere CORS abierto).
const proxy = {
  "/b": {
    target: "https://panel.lucidsales.co",
    changeOrigin: true,
    secure: true,
  },
  // Nuestro backend propio (server/): cambio de estado de pedidos.
  // Arrancalo con `npm run api` (o `npm start` dentro de server/).
  "/api": {
    target: "http://localhost:8787",
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
});
