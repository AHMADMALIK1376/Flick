# Implementation Plan: Browser Agent

## Overview

This plan implements autonomous browser automation for the existing voice AI agent. The implementation adds a `BrowserAgent` module (Playwright lifecycle + task orchestration), a `ReactLoop` (ReAct cycle execution), and a `PageAnalyzer` (GPT-4o vision integration) to the Electron main process. It extends the existing `IntentClassifier`, `ActionExecutor`, shared types, IPC channels, preload bridge, and dashboard UI to support the new `browser_task` action type.

## Tasks

- [x] 1. Install dependencies and extend shared types/interfaces
  - [x] 1.1 Install Playwright and add browser agent types to shared/types.ts
    - Run `npm install playwright` in `apps/electron/`
    - Add `'browser_task'` to the `ActionType` union in `src/shared/types.ts`
    - Add all new interfaces: `BrowserTaskRequest`, `BrowserTaskResult`, `BrowserAgentConfig`, `BrowserAction`, `BrowserActionType`, `ReactStep`, `ReactLoopStatus`, `BrowserTaskProgressMessage`, `BrowserTaskNotifier`, `BrowserTaskState`, `AnalysisResult`
    - Add `browserAgentHeadless: boolean` to the `Settings` interface (default: `false`)
    - _Requirements: 2.1, 4.1, 5.3, 10.1_

  - [x] 1.2 Add browser agent IPC channels to shared/ipc-channels.ts
    - Add `BROWSER_TASK_PROGRESS`, `BROWSER_TASK_CANCEL`, `BROWSER_TASK_RESULT`, `BROWSER_TASK_LOGIN_REQUIRED`, `BROWSER_TASK_LOGIN_COMPLETE` to the `IpcChannel` enum
    - _Requirements: 6.2, 7.1, 9.2_

  - [x] 1.3 Extend preload.ts with browser agent IPC bridge methods
    - Add `cancelBrowserTask(taskId: string)` invoke method
    - Add `onBrowserTaskProgress(callback)` listener
    - Add `onBrowserTaskResult(callback)` listener
    - Add `onBrowserTaskLoginRequired(callback)` listener
    - Add `completeBrowserLogin(taskId: string)` invoke method
    - Export updated `ElectronAPI` type
    - _Requirements: 6.2, 7.1, 7.2, 9.2, 9.3_

- [x] 2. Implement PageAnalyzer module
  - [x] 2.1 Create page-analyzer.ts with GPT-4o vision integration
    - Create `apps/electron/src/main/agent/page-analyzer.ts`
    - Implement `PageAnalyzer` class with `generatePlan(command)`, `analyzeScreenshot(screenshot, taskContext, previousSteps)`, and `retryWithHighRes(page, taskContext, previousSteps)` methods
    - Use OpenAI GPT-4o with `response_format: { type: 'json_object' }` and base64 image input
    - Parse response into `AnalysisResult` with action, reasoning, isTaskComplete, extractedData, confidence
    - Handle unparseable responses with one retry using explicit format instruction
    - Handle API errors (401, 429, timeout, network) per design error handling table
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 3.1, 3.6_

  - [ ]* 2.2 Write property test for vision response parsing
    - **Property 5: Vision Response Parsing Produces Valid Browser Actions**
    - **Validates: Requirements 5.3**

- [x] 3. Implement ReactLoop module
  - [x] 3.1 Create react-loop.ts with ReAct cycle execution
    - Create `apps/electron/src/main/agent/react-loop.ts`
    - Implement `ReactLoop` class with `run(page, taskCommand, signal, onProgress)` method
    - Execute strict plan→act→observe→decide sequence per iteration
    - Dispatch each `BrowserActionType` to the correct Playwright page action (navigate, click, type, scroll, read, screenshot, wait)
    - Element location: use selector/description from GPT-4o, 5-second timeout for element finding
    - `navigate_to_url`: navigate and wait for networkidle
    - `click_element`: locate and click, report failure if obscured/disabled
    - `type_into_element`: focus, clear, type; abort if focus fails
    - `scroll_page`: scroll in specified direction
    - `read_page_content`: extract visible text
    - `wait_for_load`: wait for networkidle or 10s timeout
    - Terminate on `is_task_complete = true` or after 15 steps (return 'partial' status)
    - Check `AbortSignal` before each step and before each API call
    - Emit progress via `onProgress` callback after each completed step
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 7.2, 7.4_

  - [ ]* 3.2 Write property test for ReAct loop step limit
    - **Property 3: ReAct Loop Never Exceeds Maximum Step Limit**
    - **Validates: Requirements 3.4, 3.5**

  - [ ]* 3.3 Write property test for abort signal cancellation
    - **Property 7: Abort Signal Terminates Loop with Cancelled Status**
    - **Validates: Requirements 7.2**

- [x] 4. Implement BrowserAgent module
  - [x] 4.1 Create browser-agent.ts with Playwright lifecycle and task orchestration
    - Create `apps/electron/src/main/agent/browser-agent.ts`
    - Implement `BrowserAgent` class with `executeTask(request, signal)`, `ensureBrowser()`, `shutdown()`, `isTaskRunning()`
    - Use Playwright persistent context with user data dir at `app.getPath('userData')/browser-data/`
    - Reuse existing browser instance if already running
    - Support headed (default) and headless modes based on `browserAgentHeadless` setting
    - Viewport 1280×720 for visible mode
    - Detect browser crash via `context.on('close')`, set context to null for recovery on next task
    - Login detection: check URL patterns and page content for login forms, pause task and notify via `BrowserTaskNotifier.sendLoginRequired()`
    - Resume task when login complete signal received
    - Switch to visible mode when login required regardless of headless setting
    - Graceful shutdown on app exit
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 10.4_

- [x] 5. Checkpoint - Ensure core modules compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Extend IntentClassifier and ActionExecutor
  - [x] 6.1 Update IntentClassifier to detect browser_task intent
    - Add `'browser_task'` to `VALID_ACTIONS` array in `intent-classifier.ts`
    - Update `SYSTEM_PROMPT` to include `browser_task` classification with examples:
      - "go to Azure DevOps and check my active stories" → browser_task
      - "find the latest PR on GitHub and summarize it" → browser_task
      - "open google.com" → open_url (simple navigation, no interaction verbs)
    - Add interaction verb heuristic guidance in the prompt (check, find, look up, submit, fill, click)
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 6.2 Update ActionExecutor to route browser_task to BrowserAgent
    - Import `BrowserAgent` in `action-executor.ts`
    - Add `browser_task` case to the `execute()` switch statement
    - Instantiate/reuse `BrowserAgent` with config from settings (apiKey, headless, userDataDir)
    - Create `AbortController` for cancellation support
    - Call `browserAgent.executeTask(request, signal)` and return result
    - Wire up `BrowserTaskNotifier` to send IPC messages to the dashboard window
    - _Requirements: 1.4, 7.2, 7.4_

  - [ ]* 6.3 Write property test for interaction verb heuristic
    - **Property 1: Interaction Verb Heuristic Correctly Gates Browser Task Classification**
    - **Validates: Requirements 1.3**

- [x] 7. Wire IPC handlers and main process integration
  - [x] 7.1 Register browser agent IPC handlers in main.ts
    - Add `BROWSER_TASK_CANCEL` handler: call abort on the active task's AbortController
    - Add `BROWSER_TASK_LOGIN_COMPLETE` handler: signal BrowserAgent to resume paused task
    - Add `browserAgentHeadless` to settings store defaults (default: `false`)
    - Update settings handler to pass `browserAgentHeadless` changes to BrowserAgent
    - Call `browserAgent.shutdown()` in `before-quit` handler
    - _Requirements: 7.2, 9.3, 10.3, 2.4_

- [x] 8. Implement Dashboard browser task UI
  - [x] 8.1 Add browser task progress panel to dashboard.html
    - Add a "Browser Task" section in the Agent panel area
    - Show task description and status indicator (Running/Completed/Failed/Cancelled/Paused)
    - Display step-by-step progress list with step number, action description, and thumbnail
    - Show clickable thumbnail of most recent screenshot (click to view full size)
    - Add "Cancel" button visible while task is running
    - Display final result (structured text) when task completes
    - Display error message with failure step on error
    - Listen to `onBrowserTaskProgress`, `onBrowserTaskResult`, `onBrowserTaskLoginRequired` events
    - Wire Cancel button to `cancelBrowserTask()` IPC call
    - Show login-required notification with instructions when login is needed
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 8.1, 8.2, 8.3, 8.4, 9.2_

  - [x] 8.2 Add browserAgentHeadless toggle to settings section
    - Add a toggle switch in the Settings panel for "Run browser in background (headless)"
    - Wire toggle to `updateSettings({ browserAgentHeadless: value })`
    - _Requirements: 10.3_

- [x] 9. Final checkpoint - Ensure all modules integrate correctly
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The implementation uses TypeScript throughout, matching the existing codebase
- Playwright persistent context ensures login sessions persist across app restarts
- All GPT-4o API calls use mocked responses in tests (no real API calls during testing)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.1"] },
    { "id": 4, "tasks": ["6.1", "6.2"] },
    { "id": 5, "tasks": ["6.3", "7.1"] },
    { "id": 6, "tasks": ["8.1", "8.2"] }
  ]
}
```
