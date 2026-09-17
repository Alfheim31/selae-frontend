#!/bin/bash
# SELAE frontend setup.
# Run this inside your cloned repo folder:  bash setup.sh
set -e

echo ""
echo "SELAE frontend setup"
echo "===================="
echo ""

# --- check node ---------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS installer from nodejs.org, then run this again."
  exit 1
fi
echo "Node $(node -v), npm $(npm -v)"

# --- clean up any half-finished attempt ---------------------------
rm -rf ../selae-temp 2>/dev/null || true
mkdir -p src

# --- find the component if it isn't in place yet ------------------
if [ ! -f src/SELAE_Frontend.jsx ]; then
  for guess in ./SELAE_Frontend.jsx ~/Downloads/SELAE_Frontend.jsx ~/Desktop/SELAE_Frontend.jsx; do
    if [ -f "$guess" ]; then
      mv "$guess" src/SELAE_Frontend.jsx
      echo "Moved SELAE_Frontend.jsx into src/"
      break
    fi
  done
fi

# --- package.json -------------------------------------------------
cat > package.json << 'EOF'
{
  "name": "selae-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
EOF
echo "Wrote package.json"

# --- vite config --------------------------------------------------
cat > vite.config.js << 'EOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
EOF
echo "Wrote vite.config.js"

# --- index.html ---------------------------------------------------
cat > index.html << 'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SELAE — Smart Event Logistics and Analytics Engine</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
EOF
echo "Wrote index.html"

# --- entry point --------------------------------------------------
cat > src/main.jsx << 'EOF'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './SELAE_Frontend.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
EOF
echo "Wrote src/main.jsx"

# --- stylesheet ---------------------------------------------------
printf '@import "tailwindcss";\n' > src/index.css
echo "Wrote src/index.css"

# --- gitignore ----------------------------------------------------
cat > .gitignore << 'EOF'
node_modules
dist
dist-ssr
*.local
.DS_Store
npm-debug.log*
.vscode/*
!.vscode/extensions.json
EOF
echo "Wrote .gitignore"

# --- dependencies -------------------------------------------------
echo ""
echo "Installing dependencies. This takes a minute or two."
npm install react react-dom recharts lucide-react --silent
npm install -D vite @vitejs/plugin-react tailwindcss @tailwindcss/vite --silent

# --- report -------------------------------------------------------
echo ""
if [ -f src/SELAE_Frontend.jsx ]; then
  echo "Setup complete. Start the app with:"
  echo ""
  echo "    npm run dev"
  echo ""
  echo "Then open http://localhost:5173"
else
  echo "Almost there, but src/SELAE_Frontend.jsx is still missing."
  echo "Download it, drop it into this folder, then run:"
  echo ""
  echo "    bash setup.sh"
fi
echo ""
