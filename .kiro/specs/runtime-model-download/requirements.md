# Requirements Document

## Introduction

The Voice to Text Electron app currently bundles Whisper ONNX models and ONNX Runtime native libraries inside the installer, resulting in a ~331 MB installer. This feature moves model acquisition to runtime: the installer ships without models, and on first launch the onboarding flow downloads the required Whisper ONNX model files to the user's local data directory. This reduces the installer to a fraction of its current size while preserving fully-offline transcription after the initial setup.

## Glossary

- **Installer**: The distributable package produced by electron-builder (e.g., NSIS `.exe` on Windows) that a user runs to install the application.
- **Model_Files**: The set of ONNX artifacts required by `@xenova/transformers` to run a specific Whisper variant (encoder, decoder, tokenizer, config).
- **Model_Downloader**: The main-process module responsible for fetching Model_Files from a remote URL and writing them to the Local_Model_Store.
- **Local_Model_Store**: A directory inside the Electron `userData` path where downloaded Model_Files are persisted between sessions.
- **Onboarding_Window**: The existing Electron BrowserWindow (`onboarding.html`) shown on first launch that guides the user through initial setup.
- **Download_Progress_UI**: The visual section within the Onboarding_Window that displays real-time download status to the user.
- **Settings_Store**: The `electron-store` instance that persists user preferences including `onboardingComplete` and `modelName`.
- **Whisper_Service**: The main-process service (`whisper-service.ts`) that loads and runs the Whisper ONNX model for transcription.
- **Build_Config**: The `electron-builder` configuration in `package.json` that controls which files are included in the Installer.

## Requirements

### Requirement 1: Exclude Model Files from Installer

**User Story:** As a user, I want a small installer download, so that I can install the app quickly without downloading hundreds of megabytes of bundled model data.

#### Acceptance Criteria

1. THE Build_Config SHALL exclude all `.onnx` model weight files from the Installer package.
2. THE Build_Config SHALL exclude pre-downloaded Hugging Face cache directories from the Installer package.
3. WHEN the Installer is built, THE Installer SHALL have a total size of less than 100 MB.
4. THE Build_Config SHALL continue to include the `@xenova/transformers` library code (excluding cached models) so that model loading logic remains available at runtime.

### Requirement 2: Download Model Files at Runtime

**User Story:** As a user, I want the app to download the required Whisper model on first launch, so that I get a working transcription setup without manual file management.

#### Acceptance Criteria

1. WHEN the application launches for the first time, THE Model_Downloader SHALL download the Model_Files for the configured Whisper variant to the Local_Model_Store.
2. THE Model_Downloader SHALL download Model_Files from the Hugging Face Hub using HTTPS.
3. WHEN a download is in progress, THE Model_Downloader SHALL report progress events containing the file name, bytes downloaded, total bytes, and percentage complete.
4. WHEN all Model_Files for a variant have been downloaded, THE Model_Downloader SHALL verify that every file exists in the Local_Model_Store before reporting completion.
5. THE Local_Model_Store SHALL persist Model_Files across application restarts so that re-downloading is not required on subsequent launches.
6. WHEN the Model_Files already exist in the Local_Model_Store, THE Model_Downloader SHALL skip the download and report immediate completion.

### Requirement 3: Resume Interrupted Downloads

**User Story:** As a user, I want the download to resume where it left off if my connection drops or I close the app, so that I do not have to re-download the entire model.

#### Acceptance Criteria

1. WHEN a download is interrupted before completion, THE Model_Downloader SHALL retain the partially downloaded files in the Local_Model_Store.
2. WHEN the application restarts after an interrupted download, THE Model_Downloader SHALL resume downloading from the byte offset of the partially downloaded file.
3. IF the remote server does not support range requests, THEN THE Model_Downloader SHALL restart the download from the beginning for that file.

### Requirement 4: Display Download Progress in Onboarding

**User Story:** As a user, I want to see a live progress bar and status text during the model download, so that I know how long the setup will take and that the app is working.

#### Acceptance Criteria

1. WHEN the Onboarding_Window reaches the model download step, THE Download_Progress_UI SHALL display a progress bar reflecting the overall download percentage.
2. WHILE a download is in progress, THE Download_Progress_UI SHALL update the progress bar and percentage text each time a progress event is received from the Model_Downloader.
3. WHILE a download is in progress, THE Download_Progress_UI SHALL display the name of the file currently being downloaded.
4. WHILE a download is in progress, THE Download_Progress_UI SHALL display the download speed in human-readable units (e.g., KB/s or MB/s).
5. WHEN the download completes successfully, THE Download_Progress_UI SHALL display a completion message and automatically advance to the next onboarding step.
6. IF a download fails, THEN THE Download_Progress_UI SHALL display an error message describing the failure and a retry button.

### Requirement 5: Handle Download Errors Gracefully

**User Story:** As a user, I want clear feedback and recovery options when a download fails, so that I can resolve the issue and complete setup.

#### Acceptance Criteria

1. IF a network error occurs during download, THEN THE Model_Downloader SHALL emit an error event containing a human-readable error description.
2. IF a download fails, THEN THE Onboarding_Window SHALL display a "Retry" button that restarts the download from the last successful byte offset.
3. IF the Local_Model_Store directory cannot be created or written to, THEN THE Model_Downloader SHALL emit an error event indicating insufficient disk permissions.
4. IF the disk has insufficient free space to store the Model_Files, THEN THE Model_Downloader SHALL emit an error event before writing partial data.

### Requirement 6: Integrate Downloaded Models with Whisper Service

**User Story:** As a developer, I want the Whisper service to load models from the local data directory instead of the bundled app path, so that runtime-downloaded models are used for transcription.

#### Acceptance Criteria

1. WHEN the Whisper_Service initializes, THE Whisper_Service SHALL load Model_Files from the Local_Model_Store path.
2. WHEN the Whisper_Service initializes and Model_Files are not present in the Local_Model_Store, THE Whisper_Service SHALL return an error indicating that the model must be downloaded first.
3. THE Whisper_Service SHALL use the `@xenova/transformers` cache directory configuration to point to the Local_Model_Store.
4. WHEN a transcription is requested after successful model loading, THE Whisper_Service SHALL produce transcription results identical in format to the current bundled-model behavior.

### Requirement 7: Prevent App Usage Before Model Is Ready

**User Story:** As a user, I want the app to prevent me from attempting transcription before the model is downloaded, so that I do not encounter confusing errors.

#### Acceptance Criteria

1. WHILE Model_Files have not been fully downloaded, THE Whisper_Service SHALL reject transcription requests with a descriptive error message.
2. WHILE the Onboarding_Window is open and the download step has not completed, THE Onboarding_Window SHALL prevent the user from advancing to the final step.
3. WHEN the model download completes and onboarding finishes, THE Settings_Store SHALL persist the `onboardingComplete` flag so that subsequent launches skip the download step.

### Requirement 8: Parse and Format Download Progress Events

**User Story:** As a developer, I want a well-defined progress event structure, so that the renderer can reliably display download status.

#### Acceptance Criteria

1. THE Model_Downloader SHALL emit progress events conforming to the existing `DownloadProgress` type containing `modelName`, `bytesDownloaded`, `totalBytes`, `percentage`, and `speedBps` fields.
2. FOR ALL valid progress events, parsing the event into a `DownloadProgress` object and then serializing it back SHALL produce an equivalent object (round-trip property).
3. THE Model_Downloader SHALL calculate `percentage` as `Math.round((bytesDownloaded / totalBytes) * 100)` and clamp the value between 0 and 100.
4. THE Model_Downloader SHALL calculate `speedBps` as the number of bytes downloaded divided by the elapsed seconds since the download started.
