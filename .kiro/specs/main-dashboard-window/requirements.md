# Requirements Document

## Introduction

The Voice to Text Electron application currently launches with only a small floating widget icon visible. Users have no central "home base" window to manage settings, view transcription history, or interact with the app as a proper desktop application. This feature introduces a main dashboard window that serves as the primary interface — a beautiful, minimalistic dark-themed window that opens on app launch, provides a settings panel, displays transcription history, includes an ad space for monetization, and coexists with the existing floating widget.

## Glossary

- **Dashboard_Window**: The main application window that serves as the central hub for the Voice to Text app, displaying transcription history, settings, and ad content
- **Floating_Widget**: The existing small transparent always-on-top window used for quick recording toggle
- **Settings_Panel**: A section within the Dashboard_Window where users can adjust application preferences such as hotkey, model, language, and behavior toggles
- **Transcription_History**: A scrollable list within the Dashboard_Window showing past transcription entries with text, timestamp, and duration
- **Ad_Space**: A designated area within the Dashboard_Window reserved for displaying advertisements for monetization
- **System_Tray_Icon**: The existing notification area icon that provides a context menu for quick access to app functions
- **App_Launcher**: The operating system's application search and launch mechanism (e.g., Windows Start Menu search)

## Requirements

### Requirement 1: Dashboard Window Creation and Launch

**User Story:** As a user, I want a main dashboard window to open when I launch the app, so that I have a central place to interact with Voice to Text as a proper desktop application.

#### Acceptance Criteria

1. WHEN the application is launched and onboarding is complete, THE Dashboard_Window SHALL be created and displayed as the primary visible window
2. THE Dashboard_Window SHALL have a minimum size of 900×600 pixels and be resizable
3. THE Dashboard_Window SHALL be centered on the primary display when first opened
4. WHEN the Dashboard_Window close button is clicked, THE Dashboard_Window SHALL hide to the system tray instead of quitting the application
5. WHILE the Dashboard_Window is visible, THE Floating_Widget SHALL continue to operate independently on top of other windows
6. THE Dashboard_Window SHALL use a dark theme with background color #0a0a0f, white text, and the Inter font family consistent with the existing onboarding window styling

### Requirement 2: Navigation and Layout Structure

**User Story:** As a user, I want a clean sidebar navigation in the dashboard, so that I can easily switch between history, settings, and other sections.

#### Acceptance Criteria

1. THE Dashboard_Window SHALL display a sidebar navigation with sections for Transcription History and Settings
2. THE Dashboard_Window SHALL display the application name and logo in the sidebar header area
3. WHEN a navigation item is clicked, THE Dashboard_Window SHALL display the corresponding content panel without a full page reload
4. THE Dashboard_Window SHALL default to showing the Transcription History section when opened

### Requirement 3: Transcription History Display

**User Story:** As a user, I want to see my past transcriptions in the dashboard, so that I can review, copy, or reference previous recordings.

#### Acceptance Criteria

1. THE Transcription_History SHALL display entries in reverse chronological order with the most recent entry at the top
2. WHEN the Transcription_History is displayed, each entry SHALL show the transcribed text, a human-readable timestamp, and the recording duration
3. WHEN a user clicks a copy button on a history entry, THE Dashboard_Window SHALL copy that entry's text to the system clipboard
4. WHEN a new transcription is completed while the Dashboard_Window is open, THE Transcription_History SHALL update to include the new entry without requiring a manual refresh
5. WHEN the user clicks a "Clear History" button, THE Dashboard_Window SHALL remove all entries from the Transcription_History after displaying a confirmation prompt
6. IF the Transcription_History contains no entries, THEN THE Dashboard_Window SHALL display an empty state message indicating no transcriptions have been recorded yet

### Requirement 4: Settings Panel

**User Story:** As a user, I want to adjust my preferences directly in the dashboard, so that I do not need a separate settings window.

#### Acceptance Criteria

1. THE Settings_Panel SHALL allow the user to configure the global hotkey accelerator by capturing key combinations
2. THE Settings_Panel SHALL allow the user to select the Whisper model from available options (tiny.en, base.en, small.en, medium.en)
3. THE Settings_Panel SHALL allow the user to select the transcription language
4. THE Settings_Panel SHALL provide toggles for auto-copy to clipboard, show floating widget, and launch at startup preferences
5. WHEN the user modifies a setting and clicks Save, THE Settings_Panel SHALL persist the changes and apply them immediately
6. WHEN settings are saved successfully, THE Settings_Panel SHALL display a brief confirmation message
7. THE Settings_Panel SHALL load and display the current saved settings when the section is navigated to

### Requirement 5: Ad Space Integration

**User Story:** As a developer, I want a designated ad space in the dashboard, so that I can monetize the application through advertisements.

#### Acceptance Criteria

1. THE Dashboard_Window SHALL reserve a fixed-height area for the Ad_Space within the main content layout
2. THE Ad_Space SHALL be visually separated from the main content using a subtle border or background differentiation
3. THE Ad_Space SHALL have a minimum height of 90 pixels and span the full width of the content area
4. WHILE no ad content is loaded, THE Ad_Space SHALL display a placeholder that maintains the layout dimensions

### Requirement 6: System Tray Integration

**User Story:** As a user, I want to open the dashboard from the system tray icon, so that I can quickly access it after minimizing or closing the window.

#### Acceptance Criteria

1. WHEN the user clicks "Open Dashboard" in the System_Tray_Icon context menu, THE Dashboard_Window SHALL be shown and brought to focus
2. WHEN the user double-clicks the System_Tray_Icon, THE Dashboard_Window SHALL be shown and brought to focus
3. THE System_Tray_Icon context menu SHALL include an "Open Dashboard" option above the existing menu items

### Requirement 7: Visual Design and Responsiveness

**User Story:** As a user, I want the dashboard to look beautiful and feel responsive, so that the app feels polished and professional.

#### Acceptance Criteria

1. THE Dashboard_Window SHALL use smooth transitions (200-400ms duration) when switching between navigation sections
2. THE Dashboard_Window SHALL use consistent spacing, border-radius (6-8px), and subtle transparency effects matching the existing onboarding and settings window design language
3. THE Dashboard_Window SHALL remain responsive and usable when resized down to 700×500 pixels
4. THE Dashboard_Window SHALL display interactive elements (buttons, toggles, list items) with hover and active state feedback
