# Working on Flick together

Ahmad (project owner) creates the issues and assigns them. Each teammate works on their own branch and opens a pull request. Nothing goes into `main` without a pull request, green checks and Ahmad's review.

## The workflow

```
Issue (assigned to you)
  → your branch
  → commits
  → pull request
  → automatic checks (CI)
  → Ahmad reviews
  → merge into main
```

### 1. Get the code (once)

```powershell
git clone https://github.com/AHMADMALIK1376/Flick.git D:\Flick\app
cd D:\Flick\app
```

### 2. Start an issue

Always start from the latest `main`:

```powershell
git checkout main
git pull
git checkout -b feature/12-answer-card
```

Branch name: `type/issue-number-short-name`

| Type | Use for |
|---|---|
| `feature/` | Something new |
| `fix/` | A bug |
| `docs/` | Documents, README, report |
| `test/` | Only tests |

### 3. Commit often, with clear messages

```powershell
git add .
git commit -m "Add Speak button to the answer card"
```

Write what the commit does, in plain words, in under 70 characters.

### 4. Push and open a pull request

```powershell
git push -u origin feature/12-answer-card
```

Then on GitHub, click **Compare & pull request**:
- Base: `main`, compare: your branch
- Fill in the template, and write `Fixes #12` (the issue number). The issue closes automatically when the pull request is merged.

### 5. Checks and review

- **CI** runs the backend and desktop tests on every pull request. If a check is red, click **Details**, fix the problem and push again. The pull request updates by itself.
- Ahmad reviews. If he asks for changes, make them on the same branch and push.
- When it's approved and green, Ahmad merges it. Then delete your branch.

### 6. If `main` changed while you were working

```powershell
git checkout main
git pull
git checkout feature/12-answer-card
git merge main
```

Fix any conflicts, commit, push.

## Run the checks yourself before pushing

```powershell
# Backend (Python)
cd backend
pip install -r requirements-dev.txt
python -m pytest

# Desktop app (Electron)
cd apps/electron
npm ci
npx tsc --noEmit -p .
npx vitest run
```

## Rules

- **Never commit API keys**, passwords, `.env` files or your `flick.db`. Each person uses their own Claude key in Flick's Settings.
- One issue = one branch = one pull request. Keep pull requests small.
- Never push directly to `main`.
- Ask in the issue's comments if something is unclear.

## Where things are

| Folder | What |
|---|---|
| `backend/` | Python AI backend (FastAPI, SQLite). See `backend/README.md` |
| `apps/electron/` | Desktop app (windows, hotkeys, tray) |
| `docs/` | Documentation |
