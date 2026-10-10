import { openStore } from "./store.js";
import { createApi } from "./api.js";

/* Mounts the API into Vite, so `npm run dev` and `npm run preview`
   serve the app and the API from one port. */
export function selaeApi({ dataFile = process.env.SELAE_DATA || "data/selae.json" } = {}) {
  let handle;
  const mount = (server) => {
    handle = handle || createApi(openStore(dataFile));
    server.middlewares.use((req, res, next) => { handle(req, res, next); });
  };
  return { name: "selae-api", configureServer: mount, configurePreviewServer: mount };
}
