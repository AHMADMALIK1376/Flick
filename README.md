# Voice to Text

Local voice-to-text using OpenAI's Whisper model. Desktop app (Electron) with floating widget + web app.

No cloud services, no API keys — everything runs on your machine.

## Features

- **Desktop app (Electron)** — Floating widget with global hotkey, local Whisper transcription, auto clipboard copy
- **Web app (Next.js)** — Browser-based speech recognition using the Web Speech API
- **Fully offline** — All transcription runs locally, no data leaves your device
- **Auto clipboard** — Transcribed text is automatically copied to your clipboard
- **Multiple Whisper models** — Choose from tiny, base, small, or medium for your speed/accuracy tradeoff
- **System tray integration** — Access settings, history, and controls from the tray
- **Dark theme** — Polished dark UI across all windows

## Quick Start

```bash
# Desktop app (Electron + local Whisper)
git clone https://github.com/YOUR_USERNAME/voice-to-text.git
cd voice-to-text/apps/electron
npm install
npm run dev

# Web app (browser speech recognition)
cd voice-to-text/apps/desktop
npm install
npx next dev
```

## Prerequisites

- **Node.js 18+**
- npm or pnpm

## Installation

### Option 1: Setup script (installs both apps)

```bash
git clone https://github.com/YOUR_USERNAME/voice-to-text.git
cd voice-to-text

# macOS / Linux
chmod +x setup.sh
./setup.sh

# Windows
setup.bat
```

### Option 2: Install individually

**Desktop app (Electron):**

```bash
cd apps/electron
npm install
npm run dev
```

**Web app (Next.js):**

```bash
cd apps/desktop
npm install
npx next dev
```

Then open [http://localhost:3000](http://localhost:3000).

## How It Works

### Desktop App

The Electron app runs a local Whisper model (via `@xenova/transformers`) to transcribe audio. A small floating widget sits on your screen — click it or press `Ctrl+Shift+Space` (`Cmd+Shift+Space` on macOS) to start recording. Speech is captured from your microphone, processed through voice activity detection, and transcribed locally. The result is copied to your clipboard automatically.

### Web App

The web app uses the browser's built-in Web Speech API (`SpeechRecognition`). No backend, no API keys, no servers needed. Everything runs client-side.

## Screenshots

<!-- Add screenshots here -->
<!-- ![Desktop Widget](docs/screenshots/widget.png) -->
<!-- ![Web App](docs/screenshots/web-app.png) -->

## Project Structure

```
voice-to-text/
├── apps/
│   ├── electron/    # Desktop app — Electron + local Whisper
│   └── desktop/     # Web app — Next.js + Web Speech API
├── setup.sh         # Setup script (macOS/Linux)
├── setup.bat        # Setup script (Windows)
└── package.json
```

## License

[MIT](LICENSE)
