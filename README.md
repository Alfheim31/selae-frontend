# SELAE — Smart Event Logistics and Analytics Engine (frontend prototype)

Operator-facing prototype for SELAE: a camera-driven event check-in system.
Built for CSC 0315 Intelligent Systems, BSCS 3-4, PLM.

This is the **interface prototype**. All data lives in memory and resets on
refresh, and there is no Oracle backend. The gate scanner **decodes real barcodes
from the webcam** (Code 128, Code 39, ITF, Codabar, QR) and runs them through the
same registration, duplicate and capacity rules as everything else. The OCR
fallback for unreadable barcodes is still simulated through the demo scenarios.

## Screens

- **Live dashboard** — headcount against capacity, arrivals over time, searchable
  attendee list, feed of recent scans including the ones that failed.
- **Gate scanner** — live webcam feed with real barcode decoding, the
  barcode → OCR → match → result pipeline, manual entry, and a locked gate mode
  for volunteers.
- **Test IDs** — printable barcodes for students in the sample data: some
  registered, some already checked in, some not registered. Use them to test or
  demo the scanner without real student IDs.
- **Analytics** — show-up rate, check-ins over time, attendance by section, a
  breakdown of how each attendee was identified, and CSV export.

## Requirements

- Node.js 20 or newer
- A webcam (the app still works without one — the illustrated ID card stands in)

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:5173

The camera only works on `localhost` or over https. If you run
`npm run dev -- --host` and open the network address on another device, the
browser will refuse to hand over the camera.

## Testing the scanner

1. Open **Test IDs** and either print the page, or run `npm run dev -- --host`
   and open the Network address it prints, followed by `/#testids`, on your phone
   (that page doesn't need a camera, so the network address is fine).
2. On the laptop, open **Gate scanner** and allow the camera.
3. Hold a barcode inside the gold frame. It checks in within about half a second.
   If it doesn't read, move it closer and turn the phone brightness up.

Leaving an ID in front of the camera won't check it in twice: a code has to
leave the frame for 1.5 seconds before it can be read again.

## Building

```bash
npm run build      # outputs to dist/
npm run preview    # serves the built version
```

## Project layout

```
src/
  SELAE_Frontend.jsx   the whole app: dashboard, scanner, analytics, test IDs
  barcode.js           live barcode decoding from the camera (zxing-cpp)
  main.jsx             entry point, renders SELAE_Frontend
  index.css            one line: @import "tailwindcss";
vite.config.js         React + Tailwind plugins
index.html             page shell and the Atkinson Hyperlegible font link
```

## Stack

- React + Vite
- Tailwind CSS 4 (via `@tailwindcss/vite`)
- recharts for charts
- lucide-react for icons
- `getUserMedia` for the live camera
- zxing-wasm (zxing-cpp compiled to WebAssembly) for barcode decoding; the
  `.wasm` file is bundled with the app, so scanning works offline
- JsBarcode for the Test IDs page

## Not built yet

- Exit scanning, so "checked in" counts arrivals, not people currently inside
- OCR of the printed student number when the barcode can't be read (planned:
  Tess4J and OpenCV in the Java build; for barcodes the Java build can use the
  original ZXing library, `com.google.zxing`)
- Registration list import
- Any backend

## Note for the Java build

This prototype exists to settle the interface decisions before the Java version is
written. JavaFX is the closest match — it supports CSS styling and has built-in
charts.
