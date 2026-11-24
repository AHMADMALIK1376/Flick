# Flick desktop app (Electron)

A thin shell around the other two parts:

1. starts the **Python backend** (`backend/`) with a private port and token,
2. shows the **React UI** (`apps/ui`) in its windows,
3. registers the **global hotkeys** and keeps them in sync with Settings.

| Window | Route | What |
|---|---|---|
| Dashboard | `#/` | main window with the sidebar (closing it keeps Flick in the tray) |
| Answer card | `#/card` | floating card above the PowerPoint slide show; appears when there is an answer |
| Mic | `#/mic` | small floating mic button (bottom right); hide it in Settings |
| Presenter view | `#/presenter` | from the tray menu, for a second screen |

**Hotkeys** (change them in Settings → Voice):
- **Ctrl+Shift+Space**: start / stop recording a question
- **Ctrl+Shift+E**: Flick explains the slide on screen, out loud

Answers are spoken aloud by the answer card with the Windows voice, sentence by sentence as they stream in. Errors are never spoken.

## Run it (Windows, PowerShell)

First time:
```powershell
cd C:\Flick\backend
pip install -r requirements.txt

cd C:\Flick\apps\ui
npm install
npm run build          # the desktop app loads the built screens

cd C:\Flick\apps\electron
npm install
```

Every time:
```powershell
cd C:\Flick\apps\electron
npm start
```
Flick starts the backend by itself: you don't need to run `python -m flick` separately.

**While working on screens** (live reload): run `npm run dev` in `apps/ui`, then `npm run dev` here.

If Python is not on the PATH, point to it: `$env:FLICK_PYTHON="C:\Path\To\python.exe"`.

## Files

| File | What |
|---|---|
| `src/main/main.ts` | start-up, windows, tray, settings sync |
| `src/main/sidecar.ts` | starts / restarts / stops the Python backend |
| `src/main/windows.ts` | the 4 windows and where they sit on screen |
| `src/main/hotkeys.ts` | global hotkeys |
| `src/main/backend-client.ts` | the few backend calls the shell needs |
| `src/preload/preload.ts` | `window.flick` bridge used by the UI (`apps/ui/src/desktop.ts`) |
