# Requirements Document

## Introduction

This feature adds an AI agent capability to the existing Voice-to-Text Electron desktop application. After Whisper transcribes the user's speech locally, the transcribed text is analyzed to determine if it represents a command or plain dictation. Commands are sent to OpenAI GPT-4o-mini for intent classification, and the classified intent is executed as a system action (opening applications, navigating URLs, typing text, performing web searches, opening files/folders, or controlling system settings). The feature includes settings for API key management and agent mode toggling, a dashboard action log, and user feedback mechanisms.

## Glossary

- **Agent_Service**: The main-process module responsible for receiving transcribed text, classifying intent via OpenAI, and dispatching system actions.
- **Command_Detector**: The module that analyzes transcribed text to determine whether it is a voice command or plain dictation text.
- **Intent_Classifier**: The component that sends command text to OpenAI GPT-4o-mini and parses the structured JSON response into an actionable intent object.
- **Action_Executor**: The module that receives a classified intent and executes the corresponding system action using Node.js child_process, Electron shell APIs, or keyboard automation libraries.
- **Action_Log**: A persistent record of executed agent commands displayed in the dashboard, showing command text, classified intent, execution status, and timestamp.
- **Settings_Store**: The existing electron-store based settings persistence layer, extended to include AI agent configuration.
- **Dashboard**: The existing Electron renderer window with Home, History, and Settings panels, extended with an Agent Log panel.
- **Toast_Notification**: A transient visual notification displayed in the dashboard or widget to provide feedback on command execution.

## Requirements

### Requirement 1: Command Detection

**User Story:** As a user, I want the system to automatically detect whether my transcribed speech is a command or plain dictation, so that commands are processed by the AI agent and dictation text continues to be handled normally.

#### Acceptance Criteria

1. WHEN AI agent mode is enabled and transcription completes, THE Command_Detector SHALL analyze the transcribed text to classify it as either a command or dictation within 50ms.
2. THE Command_Detector SHALL classify text as a command when it matches common imperative patterns (e.g., starts with action verbs like "open", "go to", "type", "search", "mute", "take").
3. WHEN text is classified as dictation, THE Agent_Service SHALL pass the text through to the normal transcription flow (clipboard copy, history entry) without sending it to OpenAI.
4. WHEN text is classified as a command, THE Agent_Service SHALL forward the text to the Intent_Classifier for processing.
5. WHILE AI agent mode is disabled, THE Agent_Service SHALL skip command detection entirely and process all transcriptions as plain dictation.

### Requirement 2: Intent Classification via OpenAI

**User Story:** As a user, I want my voice commands to be interpreted by GPT-4o-mini, so that the system understands my intent and can execute the correct action.

#### Acceptance Criteria

1. WHEN a command is forwarded for classification, THE Intent_Classifier SHALL send the text to the OpenAI GPT-4o-mini API with a system prompt that instructs the model to return a structured JSON response.
2. THE Intent_Classifier SHALL parse the API response into an intent object containing: action type, target (application name, URL, text, search query, file path, or system control), and confidence score.
3. THE Intent_Classifier SHALL support the following action types: "open_application", "open_url", "type_text", "web_search", "open_path", and "system_control".
4. WHEN the OpenAI API response does not conform to the expected JSON schema, THE Intent_Classifier SHALL return an error result with a descriptive message.
5. WHEN the confidence score returned by the model is below 0.7, THE Intent_Classifier SHALL treat the result as unrecognized and notify the user instead of executing an action.
6. THE Intent_Classifier SHALL complete the API call and response parsing within 5 seconds under normal network conditions.

### Requirement 3: Action Execution — Open Applications

**User Story:** As a user, I want to open applications by voice command, so that I can launch programs hands-free.

#### Acceptance Criteria

1. WHEN the classified intent is "open_application", THE Action_Executor SHALL launch the specified application using the Windows shell (child_process.exec with the "start" command).
2. THE Action_Executor SHALL support common application names by mapping them to their executable paths or shell-recognized names (e.g., "Chrome" → "chrome", "Notepad" → "notepad", "Spotify" → "spotify").
3. IF the specified application cannot be found or fails to launch, THEN THE Action_Executor SHALL return an error status with the failure reason.

### Requirement 4: Action Execution — Open URLs

**User Story:** As a user, I want to open websites by voice command, so that I can navigate to URLs without typing.

#### Acceptance Criteria

1. WHEN the classified intent is "open_url", THE Action_Executor SHALL open the specified URL in the user's default browser using Electron's shell.openExternal API.
2. THE Action_Executor SHALL prepend "https://" to the URL if no protocol is specified in the target.
3. IF the URL is malformed or shell.openExternal fails, THEN THE Action_Executor SHALL return an error status with a descriptive message.

### Requirement 5: Action Execution — Type Text

**User Story:** As a user, I want to dictate text into the currently active window by voice command, so that I can input text hands-free into any application.

#### Acceptance Criteria

1. WHEN the classified intent is "type_text", THE Action_Executor SHALL simulate keyboard input of the specified text into the currently active window using a keyboard automation library (@nut-tree/nut-js).
2. THE Action_Executor SHALL type the text character by character with a configurable delay to ensure compatibility with the target application.
3. IF keyboard simulation fails, THEN THE Action_Executor SHALL return an error status indicating the failure.

### Requirement 6: Action Execution — Web Search

**User Story:** As a user, I want to perform web searches by voice command, so that I can quickly look up information.

#### Acceptance Criteria

1. WHEN the classified intent is "web_search", THE Action_Executor SHALL open the user's default browser with a Google search URL containing the specified search query.
2. THE Action_Executor SHALL URL-encode the search query before constructing the search URL.
3. IF the browser fails to open, THEN THE Action_Executor SHALL return an error status.

### Requirement 7: Action Execution — Open Folders and Files

**User Story:** As a user, I want to open folders and files by voice command, so that I can access my documents hands-free.

#### Acceptance Criteria

1. WHEN the classified intent is "open_path", THE Action_Executor SHALL open the specified file or folder using Electron's shell.openPath API.
2. THE Action_Executor SHALL resolve common folder aliases (e.g., "my documents" → user's Documents folder, "downloads" → user's Downloads folder, "desktop" → user's Desktop folder) using Node.js os.homedir() and path.join().
3. IF the specified path does not exist, THEN THE Action_Executor SHALL return an error status indicating the path was not found.

### Requirement 8: Action Execution — System Controls

**User Story:** As a user, I want to control system settings by voice command, so that I can adjust volume, mute audio, or take screenshots hands-free.

#### Acceptance Criteria

1. WHEN the classified intent is "system_control" with target "volume_up", THE Action_Executor SHALL simulate the Volume Up media key press.
2. WHEN the classified intent is "system_control" with target "volume_down", THE Action_Executor SHALL simulate the Volume Down media key press.
3. WHEN the classified intent is "system_control" with target "mute", THE Action_Executor SHALL simulate the Mute media key press.
4. WHEN the classified intent is "system_control" with target "screenshot", THE Action_Executor SHALL execute the Windows Snipping Tool (snippingtool or ms-screenclip:) to initiate a screenshot.
5. IF the system control action fails, THEN THE Action_Executor SHALL return an error status.

### Requirement 9: API Key Management

**User Story:** As a user, I want to securely store my OpenAI API key in the application settings, so that the AI agent can authenticate with the OpenAI API.

#### Acceptance Criteria

1. THE Settings_Store SHALL persist the OpenAI API key using electron-store with the key stored as an obfuscated string (not plain text in the JSON file).
2. WHEN the user enters an API key in the Settings panel, THE Dashboard SHALL validate the key format (starts with "sk-" and has minimum 20 characters) before saving.
3. IF no API key is configured and AI agent mode is enabled, THEN THE Agent_Service SHALL display a notification prompting the user to enter their API key in settings.
4. WHEN the user updates the API key, THE Settings_Store SHALL immediately make the new key available to the Intent_Classifier without requiring an application restart.

### Requirement 10: AI Agent Mode Toggle

**User Story:** As a user, I want to enable or disable the AI agent mode from settings, so that I can choose between command execution and plain transcription.

#### Acceptance Criteria

1. THE Dashboard Settings panel SHALL display a toggle switch labeled "AI Agent Mode" with a description explaining its function.
2. WHEN AI agent mode is toggled off, THE Agent_Service SHALL process all transcriptions as plain dictation (normal clipboard copy and history behavior).
3. WHEN AI agent mode is toggled on and a valid API key is configured, THE Agent_Service SHALL activate command detection for all new transcriptions.
4. THE Settings_Store SHALL persist the AI agent mode state across application restarts.

### Requirement 11: Agent Action Log

**User Story:** As a user, I want to see a log of all commands the AI agent has executed, so that I can review what actions were taken and troubleshoot issues.

#### Acceptance Criteria

1. THE Dashboard SHALL display an "Agent Log" panel accessible from the sidebar navigation.
2. WHEN the Action_Executor completes an action (success or failure), THE Agent_Service SHALL add an entry to the Action_Log containing: timestamp, original command text, classified intent type, target, execution status (success/error), and error message if applicable.
3. THE Action_Log SHALL display entries in reverse chronological order with the most recent entry at the top.
4. THE Action_Log SHALL persist entries across application restarts using electron-store.
5. THE Dashboard SHALL provide a "Clear Log" button to delete all Action_Log entries.

### Requirement 12: User Feedback on Command Execution

**User Story:** As a user, I want visual feedback when the AI agent executes a command, so that I know the command was recognized and what action was taken.

#### Acceptance Criteria

1. WHEN the Action_Executor successfully completes an action, THE Dashboard SHALL display a Toast_Notification with a success message describing the action taken (e.g., "Opened Chrome", "Typed text", "Searching for weather today").
2. WHEN the Action_Executor fails to complete an action, THE Dashboard SHALL display a Toast_Notification with an error message describing the failure.
3. WHEN the Intent_Classifier determines the command is unrecognized (confidence below threshold), THE Dashboard SHALL display a Toast_Notification indicating the command was not understood.
4. THE Toast_Notification SHALL auto-dismiss after 4 seconds and SHALL be non-blocking to the user's workflow.

### Requirement 13: Error Handling for OpenAI API

**User Story:** As a user, I want the application to handle API failures gracefully, so that the app remains functional even when the OpenAI service is unavailable.

#### Acceptance Criteria

1. IF the OpenAI API request times out (exceeds 10 seconds), THEN THE Intent_Classifier SHALL abort the request and return a timeout error to the Agent_Service.
2. IF the OpenAI API returns an HTTP error (4xx or 5xx), THEN THE Intent_Classifier SHALL return a descriptive error including the HTTP status code.
3. IF the OpenAI API is unreachable (network error), THEN THE Intent_Classifier SHALL return a network error and THE Agent_Service SHALL notify the user that the AI agent requires an internet connection.
4. WHEN an API error occurs, THE Agent_Service SHALL fall back to treating the transcription as plain dictation text (clipboard copy and history entry) so the user's speech is not lost.
5. IF the API key is invalid (401 response), THEN THE Agent_Service SHALL disable AI agent mode and notify the user to check their API key in settings.

### Requirement 14: Intent Classification JSON Schema

**User Story:** As a developer, I want a well-defined JSON schema for the OpenAI response, so that intent parsing is reliable and testable.

#### Acceptance Criteria

1. THE Intent_Classifier SHALL send a system prompt instructing GPT-4o-mini to respond with JSON matching this schema: `{ "action": string, "target": string, "confidence": number, "parameters": object }`.
2. THE Intent_Classifier SHALL validate the response against the expected schema before processing.
3. FOR ALL valid command texts, parsing the OpenAI JSON response then serializing it back to JSON SHALL produce an equivalent object (round-trip property).
4. WHEN the response contains unexpected fields, THE Intent_Classifier SHALL ignore extra fields and process only the known schema fields.
