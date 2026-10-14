import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { selaeApi } from './server/plugin.js'

// The OCR engine (Tesseract) loads its worker, WebAssembly core and English
// model at runtime. Copy them from node_modules into public/tesseract so they
// are served by the app itself and OCR works without internet at the venue.
function tesseractAssets() {
  const copy = () => {
    const out = path.resolve('public/tesseract')
    const files = [
      ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
      ...fs.readdirSync('node_modules/tesseract.js-core')
        .filter((f) => /^tesseract-core.*lstm\.wasm\.js$/.test(f))
        .map((f) => [`node_modules/tesseract.js-core/${f}`, `core/${f}`]),
      ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
    ]
    for (const [from, to] of files) {
      const dest = path.join(out, to)
      if (fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(from).size) continue
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(from, dest)
    }
  }
  return { name: 'tesseract-assets', config: copy }
}

export default defineConfig({
  plugins: [tesseractAssets(), react(), tailwindcss(), selaeApi()],
  // Listen on the local network too, so phones on the same Wi-Fi can open event pages and register
  server: { host: true },
  preview: { host: true },
})
