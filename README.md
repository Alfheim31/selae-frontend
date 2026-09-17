# SELAE — Smart Event Logistics and Analytics Engine (frontend prototype)

Operator-facing prototype for SELAE: a camera-driven event check-in system.
Built for CSC 0315 Intelligent Systems, BSCS 3-4, PLM.

This is the **interface prototype only**. All data lives in memory and resets on
refresh. There is no Oracle backend and no barcode or OCR decoding yet — the
camera feed is live, but identification runs through the demo scenarios.

## Screens

- **Live dashboard** — headcount against capacity, arrivals over time, searchable
  attendee list, feed of recent scans including the ones that failed.
- **Gate scanner** — live webcam feed, the barcode → OCR → match → result pipeline,
  manual entry, and a locked gate mode for volunteers.
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

## Building

```bash
npm run build      # outputs to dist/
npm run preview    # serves the built version
```

## Project layout

```
src/
  SELAE_Frontend.jsx   the whole app: dashboard, scanner, analytics
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

## Not built yet

- Exit scanning, so "checked in" counts arrivals, not people currently inside
- Barcode and OCR decoding (planned: ZXing, then Tess4J and OpenCV in the Java build)
- Registration list import
- Any backend

## Note for the Java build

This prototype exists to settle the interface decisions before the Java version is
written. JavaFX is the closest match — it supports CSS styling and has built-in
charts.
