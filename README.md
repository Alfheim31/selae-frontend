# SELAE — Smart Event Logistics and Analytics Engine

Event registration and camera-driven check-in for student organizations, in the
spirit of Luma: anyone can create an event, people register from their phones and
get a QR ticket, and the gate scanner checks them in. Built for CSC 0315
Intelligent Systems, BSCS 3-4, PLM.

Everything runs on **one laptop at the venue**. That laptop hosts the server;
phones on the same Wi-Fi open the event page, register and get their ticket. No
internet connection is needed.

## What it does

**For attendees (on their phones)**
- **Events** — upcoming and past events, with spots left.
- **Event page** — date, venue, host, description, and a registration form. Names
  are standardized to *Surname, Given Name M.* ("DELA CRUZ" becomes "Dela Cruz").
  When the event is full, people join a **waitlist** and move up automatically if
  someone cancels.
- **QR ticket** — shown right after registering, updates live (going, waitlist,
  checked in), and can be cancelled.
- **My tickets** — every ticket registered from that phone.

**For organizers**
- **Create event** — name, host, time, venue, capacity, cover color, public or
  unlisted. Anyone can create one.
- **Live dashboard** — headcount against capacity, arrivals over time, guest list
  with waitlist (move people to going), feed of recent scans including failures.
- **Gate scanner** — live webcam that reads **QR tickets** and **student ID
  barcodes**, the QR → OCR → match → result pipeline, manual entry, and a locked
  gate mode for volunteers.
- **Analytics** — show-up rate, check-ins over time, attendance by section, how
  each attendee was identified, CSV export.
- **Test tickets** — live QR codes for guests, to test or demo the scanner.
- **Invite & settings** — a QR code and link to the registration page, a co-host
  link, and the event details (including closing registration).

## Requirements

- Node.js 20 or newer
- A webcam on the laptop at the gate (the app still works without one: manual
  entry and the demo scenarios cover it)

## Running it

```bash
npm install
npm run dev
```

The terminal prints two addresses:

- **Local** (`http://localhost:5173`) — open this on the laptop. The camera only
  works on localhost, so the gate scanner must run here.
- **Network** (e.g. `http://192.168.1.23:5173`) — phones on the same Wi-Fi use
  this. You don't need to type it: **Invite & settings** shows a QR code that
  already points there.

### At the venue

```bash
npm start
```

This builds the app and serves it from a single Node server on port 8080 (set
`PORT` to change it). It's faster and steadier than the dev server for a real
event.

## Who can manage what

- Anyone on the Wi-Fi can browse public events, register, and view or cancel their
  own ticket.
- An event can be managed from **the device that created it**, from **the laptop
  running the server** (localhost manages every event), or by anyone who opens its
  **co-host link** (Invite & settings).

This keeps a stranger on the same Wi-Fi from opening your gate scanner. It is not
real authentication: there are no accounts or passwords.

## Data

Events, registrations and scans are saved to `data/selae.json` on the laptop
(ignored by git). The first run creates it with a demo event, the CS Department
General Assembly, already 42 minutes into check-in. To start over, stop the server
and delete the file. To keep a different file, set `SELAE_DATA=path/to/file.json`.

## Testing the scanner

1. On your phone (same Wi-Fi), scan the QR code in **Invite & settings** and
   register. You get a QR ticket.
2. On the laptop, open **Gate scanner** and allow the camera.
3. Hold the phone up to the webcam with the ticket inside the gold frame. It checks
   in within about half a second, and the ticket on your phone switches to
   "Checked in". Scan it again and you get "Already checked in".

**Test tickets** has more QR codes to try: guests who will check in, guests already
checked in, waitlisted guests, and plain student numbers that aren't registered.
If a code doesn't read, move it closer and turn the screen brightness up.

Leaving a code in front of the camera won't check it in twice: it has to leave the
frame for 1.5 seconds before it can be read again.

## Project layout

```
server/
  index.js             venue server: serves dist/ and the API (npm start)
  plugin.js            mounts the API into Vite for npm run dev / preview
  api.js               logical layer: registration, waitlist, check-in rules
  store.js             physical layer: the JSON data file, atomic writes
  seed.js              demo event and student directory for the first run
src/
  SELAE_Frontend.jsx   routing and the organizer console
  public.jsx           events, event page, registration, ticket, create event
  shared.jsx           styles, formatting, QR code component
  camera.jsx           webcam access, beeps, hold-to-exit
  barcode.js           live QR / barcode decoding from the camera (zxing-cpp)
  api.js               client for the server API; host keys and tickets per device
  main.jsx             entry point
```

## Stack

- React + Vite, Tailwind CSS 4
- A small Node server (no framework) with a JSON data file
- recharts for charts, lucide-react for icons
- zxing-wasm (zxing-cpp compiled to WebAssembly) for decoding; bundled with the
  app, so scanning works offline
- qrcode for generating QR tickets

## Not built yet

- Accounts and passwords; email or SMS confirmations
- Exit scanning, so "checked in" counts arrivals, not people currently inside
- OCR of the printed student number when a code can't be read (planned: Tess4J
  and OpenCV in the Java build)
- Importing a registration list

## Note for the Java build

This prototype exists to settle the interface and the rules before the Java
version is written. JavaFX is the closest match for the organizer console, and
the original ZXing library (`com.google.zxing`) covers QR and barcode decoding.
