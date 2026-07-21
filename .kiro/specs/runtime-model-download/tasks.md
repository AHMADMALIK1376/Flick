# Implementation Plan: Runtime Model Download

## Overview

Move Whisper ONNX model acquisition from build-time bundling to runtime downloading during onboarding. A new `ModelDownloader` module handles fetching model files from Hugging Face with resume support and progress reporting. The onboarding UI gets a real-time progress bar with speed display, error handling, and retry. `WhisperService` is updated to load models from `userData` instead of the bundled app path, and the `electron-builder` config excludes `.onnx` weights from the installer.

## Tasks

- [x] 1. Define shared types and IPC channels
  - [x] 1.1 Extend `DownloadProgress` type and add new types in `apps/electron/src/shared/types.ts`
    - Add optional `currentFile`, `status`, and `error` fields to `DownloadProgress`
    - Add `DownloadError` interface with `message`, `code`, and `retryable` fields
    - Add `ModelFile` interface with `name`, `url`, and optional `expectedSize` fields
    - _Requirements: 8.1, 8.2, 2.3_

  - [x] 1.2 Verify IPC channels in `apps/electron/src/shared/ipc-channels.ts`
    - Confirm `DOWNLOAD_MODEL` and `DOWNLOAD_PROGRESS` channels exist (already present)
    - No changes needed unless additional channels are required
    - _Requirements: 2.3, 4.1_

- [x] 2. Implement ModelDownloader module
  - [x] 2.1 Create `apps/electron/src/main/model-downloader.ts` with core download logic
    - Implement `ModelDownloader` class with `download()`, `isModelReady()`, `getRequiredFiles()`, and `checkDiskSpace()` methods
    - Define the file manifest for Whisper ONNX models (encoder, decoder, tokenizer, config files)
    - Download files sequentially via HTTPS, writing to `<filename>.partial` then renaming on completion
    - Emit `DownloadProgress` events per chunk with aggregated totals across all files
    - Check disk space before starting download using `fs.statfs` or equivalent
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.3, 5.4_

  - [x] 2.2 Implement HTTP Range resume support in `ModelDownloader`
    - Detect existing `.partial` files and their byte sizes
    - Send `Range: bytes=<offset>-` header for partial files
    - If server returns 200 instead of 206, restart the file download from the beginning
    - Retain partial files on interruption for future resume
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 2.3 Implement error handling in `ModelDownloader`
    - Emit `DownloadError` with `code: 'NETWORK_ERROR'` on connection failures (retryable)
    - Emit `DownloadError` with `code: 'DISK_PERMISSION'` on `EACCES`/`EPERM` (not retryable)
    - Emit `DownloadError` with `code: 'DISK_SPACE'` when insufficient space detected before writing (not retryable)
    - Emit `DownloadError` with `code: 'VERIFICATION_FAILED'` when post-download file check fails (retryable)
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 2.4 Implement percentage calculation and speed formatting helpers
    - Calculate percentage as `Math.round((bytesDownloaded / totalBytes) * 100)` clamped 0–100
    - Calculate `speedBps` as bytes downloaded divided by elapsed seconds
    - Implement `formatSpeed(speedBps)` returning human-readable string (B/s, KB/s, MB/s, GB/s)
    - _Requirements: 8.3, 8.4, 4.4_

  - [ ]* 2.5 Write property test: DownloadProgress round-trip serialization
    - **Property 1: DownloadProgress round-trip serialization**
    - Generate random `DownloadProgress` objects, serialize with `JSON.stringify`, parse with `JSON.parse`, assert deep equality
    - **Validates: Requirements 8.2**

  - [ ]* 2.6 Write property test: Percentage calculation and clamping
    - **Property 2: Percentage calculation and clamping**
    - Generate random `(bytesDownloaded, totalBytes)` pairs, verify formula produces integer 0–100, boundary cases at 0 and totalBytes
    - **Validates: Requirements 8.3**

  - [ ]* 2.7 Write property test: Speed calculation
    - **Property 3: Speed calculation**
    - Generate random `(bytesDownloaded, elapsedSeconds)` pairs, verify `speedBps = bytesDownloaded / elapsedSeconds` is non-negative
    - **Validates: Requirements 8.4**

  - [ ]* 2.8 Write property test: Progress events contain all required fields
    - **Property 4: Progress events contain all required fields**
    - Generate random download states, build progress events, verify all fields present and `bytesDownloaded ≤ totalBytes`, `percentage` in 0–100
    - **Validates: Requirements 2.3, 8.1**

  - [ ]* 2.9 Write property test: Model readiness verification
    - **Property 5: Model readiness verification**
    - Generate random sets of required file names and directory states, verify `isModelReady` returns `true` iff all files exist
    - **Validates: Requirements 2.4**

  - [ ]* 2.10 Write property test: Resume byte offset correctness
    - **Property 6: Resume byte offset correctness**
    - Generate random partial file sizes, verify the Range header value is `bytes=<n>-`
    - **Validates: Requirements 3.2**

  - [ ]* 2.11 Write property test: Speed formatting produces valid human-readable output
    - **Property 7: Speed formatting produces valid human-readable output**
    - Generate random non-negative `speedBps` values, verify formatted string matches `<number> <unit>` with unit in {B/s, KB/s, MB/s, GB/s}
    - **Validates: Requirements 4.4**

- [x] 3. Checkpoint — ModelDownloader complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update WhisperService to load from Local Model Store
  - [x] 4.1 Modify `apps/electron/src/main/whisper-service.ts` to accept `cacheDir` parameter
    - Set `env.cacheDir` on `@xenova/transformers` to point to `userData/models/onnx/`
    - Set `env.allowLocalModels = true` and `env.allowRemoteModels = false` to prevent network calls
    - Return descriptive error if model files are missing instead of attempting download
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 4.2 Add `isModelReady(cacheDir)` check to `WhisperService`
    - Before loading, verify all required ONNX files exist in the cache directory
    - Throw error with message `"Model files not found. Please complete the model download in onboarding."` if missing
    - Reject transcription requests while model is not loaded with descriptive error
    - _Requirements: 6.2, 7.1_

  - [ ]* 4.3 Write unit tests for WhisperService model loading changes
    - Test that `initialize()` throws when model files are missing
    - Test that `transcribe()` rejects before initialization
    - Test that `env.cacheDir` is set correctly
    - _Requirements: 6.2, 7.1_

- [x] 5. Update IPC handler and main process wiring
  - [x] 5.1 Rewrite `DOWNLOAD_MODEL` IPC handler in `apps/electron/src/main/main.ts`
    - Instantiate `ModelDownloader` with `userData/models/onnx` path
    - Check if model is already downloaded via `isModelReady()` → skip download
    - Check disk space → emit error if insufficient
    - Call `modelDownloader.download()` with progress forwarding to onboarding window via `DOWNLOAD_PROGRESS`
    - On completion, initialize `WhisperService` with the cache dir
    - _Requirements: 2.1, 2.6, 6.1_

  - [x] 5.2 Update `WhisperService` initialization in the `TRANSCRIBE` handler
    - Pass `cacheDir` option when calling `whisperService.initialize()`
    - Ensure transcription uses models from `userData/models/onnx/`
    - _Requirements: 6.1, 6.3, 6.4_

- [x] 6. Update Onboarding UI with enhanced download progress
  - [x] 6.1 Update `apps/electron/src/renderer/onboarding/onboarding.html` Step 3 download UI
    - Display progress bar reflecting overall download percentage
    - Show current file name being downloaded
    - Show download speed in human-readable units (KB/s, MB/s)
    - Show bytes downloaded / total bytes
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 6.2 Add error display and retry button to onboarding download step
    - Display error message in progress stats area on failure
    - Add "Retry" button that re-invokes `downloadModel()` via IPC
    - Retry resumes from partial files automatically
    - _Requirements: 5.1, 5.2, 4.6_

  - [x] 6.3 Prevent advancing past download step while incomplete
    - Disable/hide the "Continue" or next-step navigation until download completes successfully
    - Auto-advance to Step 4 on successful completion
    - _Requirements: 7.2, 4.5_

- [x] 7. Update preload script
  - [x] 7.1 Add `retryDownload()` method to preload API in `apps/electron/src/preload/preload.ts`
    - Expose `retryDownload()` that re-invokes `DOWNLOAD_MODEL` channel
    - Ensure existing `downloadModel()` and `onDownloadProgress()` APIs remain unchanged
    - _Requirements: 5.2_

- [x] 8. Checkpoint — Download flow and UI complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Update electron-builder config to exclude model files
  - [x] 9.1 Modify `build.files` in `apps/electron/package.json`
    - Add `!node_modules/@xenova/transformers/.cache/**/*` to exclude HF cache
    - Add `!node_modules/**/*.onnx` to exclude all ONNX weight files
    - Add `!node_modules/**/onnx/**/*.onnx` to exclude nested ONNX paths
    - Keep `@xenova/transformers` JS library code and `onnxruntime-node` native bindings included
    - _Requirements: 1.1, 1.2, 1.4_

- [x] 10. Wire onboarding completion and settings persistence
  - [x] 10.1 Ensure `onboardingComplete` flag is persisted after successful download and onboarding finish
    - Verify `Settings_Store` sets `onboardingComplete = true` on onboarding completion
    - Verify subsequent launches skip the download step
    - _Requirements: 7.3, 2.5_

- [x] 11. Final checkpoint — All features integrated
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate the 7 correctness properties from the design document using `fast-check`
- Property test files go in `apps/desktop/src/__tests__/properties/`
- Unit tests complement property tests by covering specific examples and edge cases
- The existing `ModelManager` (ggml-based) is not modified; `ModelDownloader` handles ONNX models separately in `userData/models/onnx/`
