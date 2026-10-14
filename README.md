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
  barcodes**. When a code won't scan, **Read printed number** reads the student
  number off the ID with OCR, and a Bayesian matcher works out who it is (see
  below). Manual entry, and a locked gate mode for volunteers.
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

## The intelligent component: OCR matching that learns

When a QR ticket or ID barcode can't be read, SELAE reads the printed student
number and decides who the attendee is. OCR under glare makes mistakes, so this
is a decision under uncertainty, not a lookup. It works like an agent:

1. **Perceives.** Tesseract (`src/ocr.js`) reads the frame inside the gold box,
   in the browser and offline. Each frame is read up to three ways (contrast
   stretched, glare-corrected with a local threshold, and binarized) and the
   most number-like result kept, with Tesseract's confidence for each digit.
2. **Knows how OCR fails.** `server/matcher.js` holds a confusion matrix,
   P(read digit | true digit), plus chances of a dropped or extra digit. It
   starts from general OCR knowledge (8 and 3, 1 and 7, 5 and 6 get swapped
   far more than 1 and 0).
3. **Reasons with Bayes' rule.** For everyone on file,
   P(student | read) ∝ P(read | student) × P(student). The likelihood sums over
   every alignment of the read with that student's number (forward algorithm),
   weighting each digit by OCR's confidence in it. The prior comes from the
   event: a registered guest who hasn't arrived is far likelier at the gate than
   someone already inside or not registered. An "unknown person" hypothesis
   takes the probability when the read looks like nobody on file.
4. **Acts on a three-band policy.** At 95% or more it identifies the attendee
   alone; from 40% it shows the operator a short list with probabilities and the
   doubtful digits underlined; below that it sends them to manual entry. Whether
   the person is *admitted* is still decided by the check-in rules (registered,
   not a duplicate, under capacity).
5. **Learns.** When the operator picks a candidate, or types the right student
   after "none of these", the read is aligned with the true number and every
   digit pair is counted into the confusion matrix. The matcher adapts to this
   venue's lighting and this batch of cards. Only a person's answer is learned
   from, never the matcher's own guesses, and an answer that looks nothing like
   the read (a slip) is ignored.

**Analytics → OCR matcher** shows how it's doing: reads decided alone or asked,
how often the right student was ranked first, and the misreads it has learned.

### Evaluating it

```bash
npm test          # unit tests for the matcher
npm run eval      # matcher vs. plain edit distance on a simulated venue
```

`npm run eval` builds 2,000 students on file and a 300-guest event, simulates
OCR misreading numbers at an 11% per-digit error rate with confusions the matcher
doesn't expect at first, and compares (seed 7):

| Matcher | Top-1 right | Decided alone | Wrong when alone | Asked operator |
|---|---|---|---|---|
| Plain edit distance (earlier prototype) | 90.8% | 60.3% | 0.3% | 39.7% |
| Bayesian, before learning | 95.8% | 75.5% | 0.9% | 19.5% |
| Bayesian, after 43 corrections | 98.3% | 83.8% | 1.2% | 13.7% |

It also prints how the 95% threshold trades operator workload against wrong
automatic identifications. Most of those mistakes are people who aren't on file
at all whose number is a digit away from a guest's, which is why the approved
screen shows the name for the volunteer to check.

These numbers are from simulated reads. For the paper, photograph real IDs
(some with glare), run them through **Read printed number**, and record each
read and the true number in a CSV, then:

```bash
npm run eval -- --csv reads.csv --roster roster.txt
```

`reads.csv` has `read,truth[,conf]` per line (conf: per-digit confidences
separated by spaces); `roster.txt` lists the registered student numbers. The
first half of the reads is learned from, the second half is tested.

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

To try OCR, hold a student ID (or a card with a number like 2024-12345 printed
on it) flat inside the gold frame and press **Read printed number**. The demo
scenarios **Glare, OCR succeeds** and **Glare, low-confidence OCR** simulate the
OCR output (the card on screen is a drawing), but the matching, the decision and
the learning are real.

Leaving a code in front of the camera won't check it in twice: it has to leave the
frame for 1.5 seconds before it can be read again.

## Project layout

```
server/
  index.js             venue server: serves dist/ and the API (npm start)
  plugin.js            mounts the API into Vite for npm run dev / preview
  api.js               logical layer: registration, waitlist, check-in rules
  matcher.js           intelligent component: Bayesian OCR matching and learning
  matcher.test.js      unit tests for the matcher (npm test)
  store.js             physical layer: the JSON data file, atomic writes
  seed.js              demo event and student directory for the first run
src/
  SELAE_Frontend.jsx   routing and the organizer console
  public.jsx           events, event page, registration, ticket, create event
  shared.jsx           styles, formatting, QR code component
  camera.jsx           webcam access, beeps, hold-to-exit
  barcode.js           live QR / barcode decoding from the camera (zxing-cpp)
  ocr.js               OCR of the printed student number (Tesseract), with glare correction
  api.js               client for the server API; host keys and tickets per device
  main.jsx             entry point
scripts/
  eval-matcher.js      evaluation: matcher vs. edit distance, threshold sweep (npm run eval)
```

## Stack

- React + Vite, Tailwind CSS 4
- A small Node server (no framework) with a JSON data file
- recharts for charts, lucide-react for icons
- zxing-wasm (zxing-cpp compiled to WebAssembly) for decoding; bundled with the
  app, so scanning works offline
- qrcode for generating QR tickets
- tesseract.js for OCR; its worker, engine and English model are copied into the
  build from node_modules, so OCR also works offline

## Not built yet

- Accounts and passwords; email or SMS confirmations
- Exit scanning, so "checked in" counts arrivals, not people currently inside
- Importing a registration list

## Note for the Java build

This prototype exists to settle the interface and the rules before the Java
version is written. JavaFX is the closest match for the organizer console, and
the original ZXing library (`com.google.zxing`) covers QR and barcode decoding.
Tess4J does the OCR there, and `server/matcher.js` has no dependencies, so it
ports to Java line for line.
