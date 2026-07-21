# Implementation Plan: Voice AI Agent

## Overview

This plan implements an AI agent layer that intercepts transcribed speech, detects commands via local regex, classifies intent via OpenAI GPT-4o-mini, and executes system actions. The implementation builds incrementally: shared types/interfaces first, then core modules, then integration into the existing transcription pipeline, and finally the dashboard UI.

## Tasks

- [x] 1. Set up project structure, dependencies, and shared interfaces
  - [x] 1.1 Install the `openai` npm package and add agent-related type definitions
    - Run `npm install openai` in `apps/electron/`
    - Add to `src/shared/types.ts`: `ActionType`, `ClassifiedIntent`, `ActionLogEntry`, `ToastMessage`, `AgentResult`, `DetectionResult`, `ClassificationResult`, `ClassificationError`, `ExecutionResult` interfaces
    - Extend the `Settings` interface with `aiAgentEnabled: boolean` and `openaiApiKey: string`
    - Update the settings store defaults in `main.ts` to include `aiAgentEnabled: false` and `openaiApiKey: ''`
    - _Requirements: 2.3, 9.1, 10.4, 14.1_

  - [x] 1.2 Add agent IPC channels and preload API extensions
    - Add `AGENT_GET_LOG`, `AGENT_CLEAR_LOG`, `AGENT_TOAST`, `AGENT_ACTION_RESULT` to the `IpcChannel` enum in `src/shared/ipc-channels.ts`
    - Add `getAgentLog()`, `clearAgentLog()`, and `onAgentToast(callback)` methods to the preload API in `src/preload/preload.ts`
    - _Requirements: 11.1, 11.5, 12.1_

- [x] 2. Implement core agent modules
  - [x] 2.1 Create `src/main/agent/command-detector.ts`
    - Implement the `CommandDetector` class with a `detect(text: string): DetectionResult` method
    - Use regex patterns matching imperative verb prefixes: open, go to, type, search, mute, unmute, volume, take, launch, close, find, navigate
    - Apply weighted scoring: pattern match + short utterance heuristic (< 5 words with action verb = higher confidence)
    - Return `{ isCommand: true/false, confidence: number, matchedPattern?: string }`
    - _Requirements: 1.1, 1.2_

  - [x] 2.2 Create `src/main/agent/intent-classifier.ts`
    - Implement the `IntentClassifier` class using the `openai` npm package
    - Use model `gpt-4o-mini` with `response_format: { type: "json_object" }`
    - System prompt instructs the model to return `{ action, target, confidence, parameters }`
    - Implement 10-second timeout via AbortController
    - Parse and validate the response JSON: check for required fields (action, target, confidence), ignore extra fields
    - Return `ClassificationResult` (success with intent or failure with typed error)
    - Handle errors: timeout → `timeout`, network → `network`, 401 → `invalid_key`, other HTTP → `api_error`, bad JSON → `parse_error`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 13.1, 13.2, 13.3, 14.1, 14.2, 14.3, 14.4_

  - [x] 2.3 Create `src/main/agent/action-executor.ts`
    - Implement the `ActionExecutor` class with `execute(intent: ClassifiedIntent): Promise<ExecutionResult>`
    - `open_application`: Use `child_process.exec('start "" "appName"')` with the APP_NAME_MAP lookup
    - `open_url`: Use `shell.openExternal(url)`, prepend `https://` if no protocol
    - `type_text`: Use PowerShell `Add-Type` + `[System.Windows.Forms.SendKeys]::SendWait()` via child_process
    - `web_search`: URL-encode query, open `https://www.google.com/search?q=...` via `shell.openExternal`
    - `open_path`: Resolve folder aliases (documents, downloads, desktop, etc.) using `os.homedir()` + `path.join()`, then `shell.openPath()`
    - `system_control`: Volume up/down/mute via PowerShell media key simulation, screenshot via `ms-screenclip:` URI
    - Include 5-second timeout for child_process operations
    - Return `{ success, action, target, error?, durationMs }`
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 2.4 Create `src/main/agent/agent-store.ts`
    - Implement the `AgentStore` class using electron-store
    - `addEntry(entry: ActionLogEntry)`: Prepend entry to the log array
    - `getEntries(): ActionLogEntry[]`: Return entries in reverse chronological order
    - `clearLog()`: Remove all entries
    - Persist across app restarts
    - _Requirements: 11.2, 11.3, 11.4, 11.5_

  - [x] 2.5 Create `src/main/agent/agent-service.ts` — the orchestrator
    - Implement the `AgentService` class that coordinates: CommandDetector → IntentClassifier → ActionExecutor → AgentStore
    - `process(text: string): Promise<AgentResult>`: Full pipeline
    - If agent mode disabled → return `{ handled: false }` immediately
    - If no API key → notify user, return `{ handled: false }`
    - Run CommandDetector: if dictation → return `{ handled: false }`
    - Run IntentClassifier: if error → notify user, return `{ handled: false }` (fallback to dictation)
    - If confidence < 0.7 → notify unrecognized, return `{ handled: false }`
    - If valid intent → execute action, log result, send toast, return `{ handled: true, action }`
    - On 401 error → disable agent mode, notify user
    - Implement `isEnabled()`, `setEnabled(enabled)`, `setApiKey(key)` methods
    - Implement API key validation: must start with "sk-" and be at least 20 characters
    - Store API key obfuscated (base64) in electron-store
    - _Requirements: 1.3, 1.4, 1.5, 2.5, 9.1, 9.2, 9.3, 9.4, 10.2, 10.3, 12.1, 12.2, 12.3, 13.4, 13.5_

- [x] 3. Checkpoint — Core modules complete
  - Ensure all agent modules compile without errors, ask the user if questions arise.

- [x] 4. Integrate agent into the main process and wire IPC handlers
  - [x] 4.1 Integrate AgentService into `src/main/main.ts`
    - Import and instantiate all agent modules (CommandDetector, IntentClassifier, ActionExecutor, AgentStore, AgentService)
    - Hook into the TRANSCRIBE IPC handler: after `whisperService.transcribe()` returns text, call `agentService.process(result.text)` if agent is enabled
    - If `agentResult.handled === true`, skip the normal clipboard copy and history entry
    - Register IPC handlers for `AGENT_GET_LOG` and `AGENT_CLEAR_LOG`
    - Implement the `AgentNotifier` by sending `AGENT_TOAST` messages to the dashboard window's `webContents`
    - Wire settings changes: when `aiAgentEnabled` or `openaiApiKey` are updated via UPDATE_SETTINGS, propagate to AgentService
    - _Requirements: 1.3, 1.4, 1.5, 10.2, 10.3, 11.1, 11.5, 12.1, 12.2, 12.3, 12.4_

- [x] 5. Checkpoint — Backend integration complete
  - Ensure the app compiles and the agent pipeline is wired end-to-end, ask the user if questions arise.

- [x] 6. Implement dashboard UI for agent features
  - [x] 6.1 Add Agent Log panel and Settings UI to the dashboard
    - Add "Agent" nav item to the sidebar in `src/renderer/dashboard/dashboard.html`
    - Create the Agent Log panel: display action log entries (timestamp, command text, intent type, target, status, error) in reverse chronological order
    - Add "Clear Log" button that calls `electronAPI.clearAgentLog()`
    - Load log entries on panel activation via `electronAPI.getAgentLog()`
    - Add to the Settings panel: "AI Agent Mode" toggle switch with description
    - Add to the Settings panel: OpenAI API Key input field (password type) with format validation (starts with "sk-", min 20 chars)
    - Save settings via `electronAPI.updateSettings()` on change
    - _Requirements: 9.2, 10.1, 11.1, 11.3, 11.5_

  - [x] 6.2 Implement toast notification system in the dashboard
    - Listen for `AGENT_TOAST` IPC messages via `electronAPI.onAgentToast(callback)`
    - Display toast notifications with success/error/warning styling
    - Auto-dismiss after 4 seconds, non-blocking overlay positioning
    - Show action description on success (e.g., "Opened Chrome")
    - Show error message on failure
    - Show "Command not recognized" on low confidence
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 7. Final checkpoint — Full feature complete
  - Ensure the full application compiles, all agent modules are integrated, dashboard UI renders correctly, and toast notifications work. Ask the user if questions arise.

## Notes

- The design uses TypeScript throughout — all implementation follows TypeScript conventions
- The agent hooks into the existing TRANSCRIBE handler after Whisper returns text
- No property-based tests are included per user request for faster implementation
- All system actions target Windows (PowerShell, `start` command, `ms-screenclip:`)
- The `openai` npm package handles API communication; no raw HTTP needed
- API key is stored obfuscated (base64) in electron-store, not plain text
- The agent pipeline is designed to fail gracefully — any error falls back to normal dictation flow

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4"] },
    { "id": 3, "tasks": ["2.5"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["6.1", "6.2"] }
  ]
}
```
