# SellerPilot – Electron Desktop Build

## Voraussetzungen
- Node.js 18+
- npm oder yarn

## Setup nach GitHub-Klon

```bash
# 1. Dependencies installieren
npm install

# 2. Electron + Builder installieren
npm install --save-dev electron electron-builder concurrently wait-on

# 3. Diese Scripts in package.json einfügen:
```

Füge folgende Scripts in deine `package.json` ein:

```json
{
  "main": "electron/main.js",
  "scripts": {
    "electron:dev": "concurrently \"npm run dev\" \"wait-on http://localhost:8080 && electron .\"",
    "electron:build": "npm run build && electron-builder --config electron-builder.yml",
    "electron:build:win": "npm run build && electron-builder --win --config electron-builder.yml"
  }
}
```

## Entwicklung

```bash
npm run electron:dev
```

Startet Vite + Electron gleichzeitig mit Hot Reload.

## .exe bauen

```bash
npm run electron:build:win
```

Die fertige `.exe` findest du im `release/` Ordner.

## Hinweise
- Die App nutzt die gleiche Codebasis wie die Web-Version
- Supabase/Cloud-Verbindung funktioniert auch in der Desktop-App
- Für macOS: `npm run electron:build` erzeugt eine `.dmg`
