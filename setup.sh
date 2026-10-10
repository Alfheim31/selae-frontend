#!/bin/bash
# SELAE setup. Run this inside the repo folder:  bash setup.sh
set -e

echo ""
echo "SELAE setup"
echo "==========="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS installer from nodejs.org, then run this again."
  exit 1
fi

major=$(node -p "process.versions.node.split('.')[0]")
if [ "$major" -lt 20 ]; then
  echo "Node $(node -v) is too old. SELAE needs Node 20 or newer: get the LTS installer from nodejs.org."
  exit 1
fi
echo "Node $(node -v), npm $(npm -v)"

echo ""
echo "Installing dependencies. This takes a minute or two."
npm install

echo ""
echo "Setup complete. Start the app with:"
echo ""
echo "    npm run dev"
echo ""
echo "Open the Local address on this laptop (the camera works there)."
echo "Phones on the same Wi-Fi use the Network address it prints."
echo ""
