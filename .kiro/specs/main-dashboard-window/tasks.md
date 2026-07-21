# Implementation Plan: Main Dashboard Window

## Overview

This plan implements the main dashboard window for the Voice to Text Electron app. The dashboard serves as the central hub — replacing the separate settings window — with sidebar navigation, transcription history, settings panel, and ad space. The implementation follows the existing single-HTML-file pattern (like onboarding.html) with inline CSS/JS, communicating via the `electronAPI` preload bridge.

## Tasks

- [x] 1. Add IPC channel and update preload bridge
  - [x] 1.1 Add SHOW_DASHBOARD channel to ipc-channels.ts
    - Add `SHOW_DASHBOARD = 'show-dashboard'` to the `IpcChannel` enum in `apps/electron/src/shared/ipc-channels.ts`
    - _Requirements: 6.1, 6.2_

  - [x] 1.2 Add showDashboard method to preload.ts
    - Add `showDashboard(): Promise<void>` method to the `electronAPI` object in `apps/electron/src/preload/preload.ts` that invokes `IpcChannel.SHOW_DASHBOARD`
    - _Requirements: 6.1_

- [x] 2. Update TrayManager for dashboard integration
  - [x] 2.1 Refactor TrayManager callbacks and menu
    - Update the `TrayManager.create()` callback interface to accept `onDashboard` instead of `onSettings` and `onHistory`
    - Update the context menu template: add "Open Dashboard" as the first item, remove separate "Settings" and "History" items
    - Add double-click event handler on the tray icon that calls `onDashboard()`
    - File: `apps/electron/src/main/tray-manager.ts`
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 3. Create dashboard window in main process
  - [x] 3.1 Implement createDashboardWindow function in main.ts
    - Add `dashboardWindow` variable to window references (replace `settingsWindow`)
    - Implement `createDashboardWindow()` with: width 1000, height 700, minWidth 900, minHeight 600, center true, frame true, show false, backgroundColor '#0a0a0f', preload path, contextIsolation true
    - Load `dashboard.html` from `renderer/dashboard/dashboard.html`
    - Add hide-on-close behavior (preventDefault + hide when `isQuitting` is false)
    - Show window on `ready-to-show` event
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6_

  - [x] 3.2 Wire dashboard into app lifecycle and IPC
    - Remove `settingsWindow` variable and `createSettingsWindow()` function
    - Update `initTray()` to pass `onDashboard` callback that shows/focuses the dashboard window
    - Add `SHOW_DASHBOARD` IPC handler that shows and focuses the dashboard window
    - Update `OPEN_SETTINGS` IPC handler to show the dashboard window (for backward compatibility from widget)
    - Create the dashboard window in `app.whenReady()` after onboarding is complete (alongside widget creation)
    - Gate dashboard creation behind `onboardingComplete` check — only create when onboarding is done
    - Also create dashboard after `ONBOARDING_COMPLETE` IPC handler fires (for first-launch flow)
    - _Requirements: 1.1, 1.4, 1.5, 6.1, 6.2_

- [x] 4. Checkpoint - Verify main process changes compile
  - Ensure all TypeScript compiles without errors, ask the user if questions arise.

- [x] 5. Create dashboard HTML with layout and navigation
  - [x] 5.1 Create dashboard.html with sidebar layout and navigation
    - Create file `apps/electron/src/renderer/dashboard/dashboard.html`
    - Implement full HTML document with inline `<style>` and `<script>` (matching onboarding.html pattern)
    - Dark theme: background #0a0a0f, white text, Inter font family
    - Sidebar (200px fixed width): app logo/name header, nav items for "History" and "Settings" with icons
    - Main content area (flex: 1): contains section panels and ad space
    - Ad space (90px fixed height at bottom of content area) with placeholder and subtle border separation
    - Navigation switching via JS class toggling (show/hide `<section>` elements), no page reloads
    - Default to History panel active on load
    - Smooth transitions (300ms) when switching panels
    - Hover and active state feedback on interactive elements
    - Responsive down to 700×500px (content scrolls, sidebar stays fixed)
    - Consistent spacing, border-radius (6-8px), subtle transparency effects
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.1, 5.2, 5.3, 5.4, 7.1, 7.2, 7.3, 7.4_

- [x] 6. Implement transcription history panel
  - [x] 6.1 Implement history panel UI and logic in dashboard.html
    - Add history panel section inside the main content area
    - On panel activation, call `electronAPI.getHistory()` and render entries
    - Display entries in reverse chronological order (most recent first)
    - Each entry shows: transcribed text (truncated to ~200 chars with "Show more"), human-readable relative timestamp, duration badge
    - Copy button per entry that calls `electronAPI.copyToClipboard(entry.text)`
    - "Clear History" button with confirmation dialog (`confirm()`) that calls `electronAPI.clearHistory()`
    - Empty state message when no entries exist
    - Poll for new entries every 5 seconds while history panel is active (to catch new transcriptions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 7. Implement settings panel
  - [x] 7.1 Implement settings panel UI and logic in dashboard.html
    - Add settings panel section inside the main content area
    - Hotkey capture input: readonly text field that captures key combinations on focus (keydown listener builds accelerator string like "Ctrl+Shift+A")
    - Model selector dropdown with options: tiny.en, base.en, small.en, medium.en
    - Language selector dropdown
    - Toggle switches for: auto-copy to clipboard, show floating widget, launch at startup
    - On panel activation, call `electronAPI.getSettings()` and populate all fields
    - Save button that calls `electronAPI.updateSettings()` with changed values
    - Success toast/confirmation message displayed for ~2 seconds after successful save
    - Validation: prevent save if hotkey field is empty
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

- [x] 8. Checkpoint - Full integration verification
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Final wiring and cleanup
  - [x] 9.1 Remove obsolete settings window files and references
    - Delete `apps/electron/src/renderer/settings/settings.html` (functionality now lives in dashboard)
    - Remove any remaining references to the old settings window in main.ts
    - Verify the floating widget continues to operate independently when dashboard is visible
    - _Requirements: 1.5, 4.5_

## Notes

- The dashboard uses the same single-HTML-file pattern as onboarding.html — inline CSS and vanilla JS, no build step for the renderer
- The existing `electronAPI` preload bridge already exposes getHistory, clearHistory, getSettings, updateSettings, and copyToClipboard — the dashboard reuses these
- The separate settings.html window is fully replaced by the dashboard's settings panel
- Hide-on-close keeps the app running in the system tray, consistent with the floating widget behavior
- Ad space is a placeholder area for now — actual ad SDK integration is a separate concern

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2"] },
    { "id": 4, "tasks": ["5.1"] },
    { "id": 5, "tasks": ["6.1", "7.1"] },
    { "id": 6, "tasks": ["9.1"] }
  ]
}
```
