# Flick UI (React + Mantine)

All Flick screens. The Electron app shows these pages in its windows; while
building, open them in the browser.

## Run it (Windows, PowerShell)

**Window 1: backend**
```powershell
cd C:\Flick\backend
pip install -r requirements-dev.txt     # first time only
$env:FLICK_TOKEN="flick-dev"
python -m flick --port 8765
```

**Window 2: UI**
```powershell
cd C:\Flick\apps\ui
npm install                              # first time only
copy .env.example .env.local             # first time only
npm run dev
```
Open **http://127.0.0.1:5173**. The sidebar should say **Connected**.

Before you push: `npm run typecheck`, `npm test`, `npm run build` (CI runs these too).

## Where to code

| Issue | Screen | File(s) |
|---|---|---|
| #2 Setup | sidebar, theme, logo | `src/layout/*`, `src/theme.ts` |
| #3 Onboarding | O1–O4 | `src/pages/onboarding/*` |
| #4 Presentation | D1, D3, D2 | `src/pages/presentation/*` |
| #5 Prepared Questions | D4 | `src/pages/questions/*` |
| #6 Q&A Log | D5 | `src/pages/log/*` |
| #7 Settings | D6 | `src/pages/settings/SettingsPage.tsx` |
| #8 Answer card | L2, L4 | `src/windows/card/*` |
| #9 Mic + Presenter | L1, L3 | `src/windows/mic/*`, `src/windows/presenter/*` |

Every file starts with a note: which issue, which design screen, which
endpoints and events it uses. Pages that are not built yet show a dashed
**"To build"** box. Remove it when the page is done.

## Folders

```
src/
  main.tsx          start-up: Mantine, fonts, styles
  App.tsx           all routes (#/presentation, #/card, ...)
  theme.ts          D4 colours + font. Use `colors` from here, no new colours
  api/
    types.ts        data shapes (copy of backend/flick/models.py)
    flick.ts        one function per endpoint: api.listDecks(), api.ask(...)
    client.ts       fetch + token + friendly errors (don't call directly)
    connection.ts   backend port and token
  hooks/
    useEvents.ts    live events: useFlickEvent('answer', (a) => ...)
  layout/           sidebar frame, logo, connection chip
  components/       shared pieces: PageHeader, OriginBadge, TodoPanel
  pages/            main-window pages (with sidebar)
  windows/          separate small windows (no sidebar)
  utils/            formatDuration, formatTime
```

## Rules

- Call the backend only through `api` in `src/api/flick.ts`.
- Show errors with friendly text (`err.message` from `ApiError` is already friendly).
- Never show or log the full API key.
- Use Mantine components first; add a library only after asking in the issue.
