# EduPilot AI Agent — Complete Implementation Guide

> **Purpose**: This document provides a complete A-to-Z specification for recreating the EduPilot AI Agent system. It includes every file, every class, every method, every prompt, and every configuration needed to build an identical agent from scratch.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [Package Configuration](#4-package-configuration)
5. [TypeScript Configuration](#5-typescript-configuration)
6. [Shared Types](#6-shared-types)
7. [IPC Channels](#7-ipc-channels)
8. [LLM Provider System](#8-llm-provider-system)
   - 8.1 [Provider Interface](#81-provider-interface)
   - 8.2 [Provider Registry](#82-provider-registry)
   - 8.3 [OpenAI Provider](#83-openai-provider)
   - 8.4 [Gemini Provider](#84-gemini-provider)
   - 8.5 [DeepSeek Provider](#85-deepseek-provider)
   - 8.6 [LLM Service (Central Hub)](#86-llm-service-central-hub)
   - 8.7 [Key Validation](#87-key-validation)
9. [Agent Core Modules](#9-agent-core-modules)
   - 9.1 [Command Detector](#91-command-detector)
   - 9.2 [Intent Classifier](#92-intent-classifier)
   - 9.3 [Action Executor](#93-action-executor)
   - 9.4 [Agent Store](#94-agent-store)
   - 9.5 [Agent Service (Orchestrator)](#95-agent-service-orchestrator)
10. [Browser Automation](#10-browser-automation)
    - 10.1 [Page Analyzer](#101-page-analyzer)
    - 10.2 [ReAct Loop](#102-react-loop)
    - 10.3 [Browser Agent](#103-browser-agent)
11. [Academic Assistant](#11-academic-assistant)
12. [Token Budget System](#12-token-budget-system)
13. [Main Process Integration](#13-main-process-integration)
14. [Settings & Configuration](#14-settings--configuration)
15. [Build & Package](#15-build--package)
16. [How It All Connects](#16-how-it-all-connects)

---

## 1. Architecture Overview

The system is a **desktop Electron application** with an AI agent layer that:

1. **Listens** to voice input (via Whisper STT)
2. **Detects** if speech is a command (local regex, no API call)
3. **Classifies** the intent (GPT-4o-mini / Gemini / DeepSeek)
4. **Executes** the action (open apps, URLs, type text, system control, browser automation)
5. **Logs** everything for the user to review

The browser automation sub-system uses a **ReAct (Reason + Act) loop** with GPT-4o vision:
- Takes screenshots → sends to vision model → gets next action → executes → repeats
- Optimized for minimal token usage (reduced resolution, short prompts, budget cap)

The **Academic Assistant** extends the browser agent for university LMS interaction:
- Navigates to LMS → waits for login → extracts assignments → generates answers → creates PDFs

```
┌──────────────────────────────────────────────────────────────────┐
│                         Electron Main Process                     │
│                                                                   │
│  ┌─────────────┐    ┌─────────────────┐    ┌──────────────────┐ │
│  │   Whisper   │───▶│  AgentService   │───▶│  ActionExecutor  │ │
│  │   STT       │    │  (Orchestrator) │    │                  │ │
│  └─────────────┘    └────────┬────────┘    └───────┬──────────┘ │
│                              │                      │            │
│                    ┌─────────┴────────┐   ┌────────┴─────────┐  │
│                    │ CommandDetector   │   │  BrowserAgent    │  │
│                    │ (local regex)     │   │  (Playwright)    │  │
│                    └──────────────────┘   └────────┬─────────┘  │
│                                                     │            │
│                    ┌──────────────────┐   ┌────────┴─────────┐  │
│                    │ IntentClassifier │   │   ReactLoop      │  │
│                    │ (LLM call)       │   │   (vision loop)  │  │
│                    └────────┬─────────┘   └────────┬─────────┘  │
│                             │                      │             │
│                    ┌────────┴──────────────────────┴──────────┐  │
│                    │            LLMService                     │  │
│                    │  (provider-agnostic, budget tracking)     │  │
│                    └────────┬────────────┬───────────┬────────┘  │
│                             │            │           │            │
│                    ┌────────┴──┐  ┌──────┴──┐  ┌────┴────────┐  │
│                    │  OpenAI   │  │  Gemini │  │  DeepSeek   │  │
│                    │  Provider │  │ Provider│  │  Provider   │  │
│                    └───────────┘  └─────────┘  └─────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │               AcademicAssistant                             │  │
│  │  (LMS navigation, assignment extraction, PDF generation)   │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Electron | ^28.0.0 |
| Language | TypeScript | ^5.3.3 |
| Browser Automation | Playwright | ^1.60.0 |
| LLM (OpenAI) | openai SDK | ^6.39.1 |
| LLM (Gemini) | @google/generative-ai | ^0.21.0 |
| PDF Generation | pdfkit | 0.15.0 |
| Storage | electron-store | ^8.1.0 |
| STT | @xenova/transformers (Whisper) | ^2.17.2 |
| Global Hotkey | uiohook-napi | ^1.5.5 |
| Build | electron-builder | ^24.9.1 |
| Module System | CommonJS |  |
| Target | ES2022 |  |

---

## 3. Project Structure

```
apps/electron/
├── package.json
├── tsconfig.json
├── assets/
│   ├── icon.ico
│   ├── icon.png
│   └── icon.svg
├── src/
│   ├── shared/
│   │   ├── types.ts              # All type definitions
│   │   └── ipc-channels.ts       # IPC channel enum
│   ├── main/
│   │   ├── main.ts              # Electron main process entry
│   │   ├── whisper-service.ts   # Whisper STT
│   │   ├── model-downloader.ts  # ONNX model download
│   │   ├── model-manager.ts     # Model file management
│   │   ├── clipboard-manager.ts # Clipboard operations
│   │   ├── settings-store.ts    # Settings persistence
│   │   ├── history-store.ts     # Transcript history
│   │   ├── tray-manager.ts      # System tray
│   │   └── agent/
│   │       ├── command-detector.ts    # Local regex command detection
│   │       ├── intent-classifier.ts   # LLM-based intent classification
│   │       ├── action-executor.ts     # System action execution
│   │       ├── agent-store.ts         # Action log persistence
│   │       ├── agent-service.ts       # Agent orchestrator
│   │       ├── browser-agent.ts       # Playwright browser lifecycle
│   │       ├── react-loop.ts          # ReAct vision loop
│   │       ├── page-analyzer.ts       # Screenshot → action analysis
│   │       ├── academic-assistant.ts  # LMS + PDF generation
│   │       └── llm/
│   │           ├── llm-service.ts       # Central LLM hub + budget
│   │           ├── provider-registry.ts # Model/provider metadata
│   │           ├── key-validation.ts    # API key format validation
│   │           └── providers/
│   │               ├── llm-provider.ts      # Provider interface
│   │               ├── openai-provider.ts   # OpenAI adapter
│   │               ├── gemini-provider.ts   # Gemini adapter
│   │               └── deepseek-provider.ts # DeepSeek adapter
│   ├── preload/
│   │   └── preload.ts           # Preload script (IPC bridge)
│   └── renderer/
│       ├── widget/              # Floating widget UI
│       ├── dashboard/           # Main dashboard UI
│       ├── onboarding/          # First-launch setup
│       └── recorder/            # Audio recorder (hidden)
└── build/                       # Compiled output
```

---

## 4. Package Configuration

```json
{
  "name": "@voice-to-text/electron",
  "version": "1.0.0",
  "private": true,
  "description": "Desktop voice-to-text app using local Whisper model",
  "main": "build/main/main.js",
  "scripts": {
    "dev": "tsc && node scripts/copy-assets.js && electron build/main/main.js",
    "build": "tsc && node scripts/copy-assets.js",
    "package": "tsc && node scripts/copy-assets.js && electron-builder --win"
  },
  "dependencies": {
    "@google/generative-ai": "^0.21.0",
    "@xenova/transformers": "^2.17.2",
    "electron-store": "^8.1.0",
    "openai": "^6.39.1",
    "pdfkit": "0.15.0",
    "playwright": "^1.60.0",
    "uiohook-napi": "^1.5.5",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@types/pdfkit": "0.13.4",
    "@types/uuid": "^9.0.7",
    "electron": "^28.0.0",
    "electron-builder": "^24.9.1",
    "png-to-ico": "^3.0.1",
    "typescript": "^5.3.3"
  },
  "build": {
    "appId": "com.edupilot.voicetotext",
    "productName": "Voice to Text",
    "directories": { "output": "dist" },
    "files": [
      "build/**/*",
      "assets/**/*",
      "node_modules/**/*",
      "!node_modules/@xenova/transformers/.cache/**/*",
      "!node_modules/**/*.onnx",
      "!node_modules/**/onnx/**/*.onnx"
    ],
    "asar": true,
    "asarUnpack": [
      "node_modules/uiohook-napi/**/*",
      "node_modules/@xenova/**/*",
      "node_modules/sharp/**/*",
      "node_modules/onnxruntime-node/**/*"
    ],
    "win": {
      "target": "nsis",
      "icon": "assets/icon.ico",
      "sign": null,
      "verifyUpdateCodeSignature": false
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    }
  }
}
```

---

## 5. TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022", "DOM"],
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "build", "dist"]
}
```

---

## 6. Shared Types

**File: `src/shared/types.ts`**


```typescript
// ── Settings ────────────────────────────────────────────────────────────────

export interface Settings {
  hotkeyAccelerator: string;
  hotkeyMode: 'toggle' | 'push-to-talk';
  modelName: string;
  language: string;
  autoCopyToClipboard: boolean;
  showFloatingWidget: boolean;
  launchAtStartup: boolean;
  silenceDurationMs: number;
  widgetPosition: { x: number; y: number } | null;
  onboardingComplete: boolean;
  aiAgentEnabled: boolean;
  openaiApiKey: string;
  geminiApiKey: string;
  deepseekApiKey: string;
  llmProvider: string;
  llmModel: string;
  browserAgentHeadless: boolean;
}

// ── AI Agent Types ──────────────────────────────────────────────────────────

export type ActionType =
  | 'open_application'
  | 'open_url'
  | 'type_text'
  | 'web_search'
  | 'open_path'
  | 'system_control'
  | 'browser_task';

export interface ClassifiedIntent {
  action: ActionType;
  target: string;
  confidence: number;
  parameters?: Record<string, unknown>;
}

export interface ActionLogEntry {
  id: string;
  timestamp: number;
  commandText: string;
  intentType: ActionType;
  target: string;
  status: 'success' | 'error';
  errorMessage?: string;
  durationMs: number;
}

export interface ToastMessage {
  type: 'success' | 'error' | 'warning';
  message: string;
  autoDismissMs: number;
}

export interface AgentResult {
  handled: boolean;
  action?: ActionLogEntry;
  error?: string;
}

export interface DetectionResult {
  isCommand: boolean;
  confidence: number;
  matchedPattern?: string;
}

export interface ClassificationError {
  type: 'timeout' | 'network' | 'invalid_key' | 'api_error' | 'parse_error';
  message: string;
  httpStatus?: number;
}

export type ClassificationResult =
  | { success: true; intent: ClassifiedIntent }
  | { success: false; error: ClassificationError };

export interface ExecutionResult {
  success: boolean;
  action: ActionType;
  target: string;
  error?: string;
  durationMs: number;
}

// ── Browser Agent Types ─────────────────────────────────────────────────────

export type BrowserActionType =
  | 'navigate_to_url'
  | 'click_element'
  | 'type_into_element'
  | 'scroll_page'
  | 'read_page_content'
  | 'take_screenshot'
  | 'wait_for_load'
  | 'task_complete'
  | 'task_failed';

export interface BrowserAction {
  type: BrowserActionType;
  target?: string;
  value?: string;
  description: string;
}

export interface BrowserTaskRequest {
  command: string;
  taskId: string;
}

export interface BrowserTaskResult {
  taskId: string;
  status: 'completed' | 'cancelled' | 'failed' | 'partial';
  result?: string;
  structuredData?: Record<string, unknown>;
  stepsCompleted: number;
  error?: string;
  confidence?: number;
}

export interface BrowserAgentConfig {
  userDataDir: string;
  headless: boolean;
  viewport: { width: number; height: number };
  maxSteps: number;
}

export interface ReactStep {
  stepNumber: number;
  action: BrowserAction;
  observation: string;
  screenshot?: string;
  timestamp: number;
}

export type ReactLoopStatus =
  | 'planning' | 'acting' | 'observing' | 'deciding' | 'complete' | 'failed';

export interface BrowserTaskProgressMessage {
  taskId: string;
  stepNumber: number;
  totalStepsLimit: number;
  action: string;
  description: string;
  status: ReactLoopStatus;
  thumbnail?: string;
}

export interface BrowserTaskNotifier {
  sendProgress(progress: BrowserTaskProgressMessage): void;
  sendResult(result: BrowserTaskResult): void;
  sendLoginRequired(taskId: string, url: string): void;
  sendToast(message: ToastMessage): void;
}

export interface AnalysisResult {
  action: BrowserAction;
  reasoning: string;
  isTaskComplete: boolean;
  extractedData?: string;
  confidence: number;
}

// ── Chat Types ──────────────────────────────────────────────────────────────

export type ChatRole = 'user' | 'agent';
export type ChatResponseStatus =
  | 'success' | 'error' | 'not_command' | 'low_confidence' | 'disabled';

export interface ChatResponse {
  status: ChatResponseStatus;
  message: string;
  actionType?: string;
}
```

---

## 7. IPC Channels

**File: `src/shared/ipc-channels.ts`**

```typescript
export enum IpcChannel {
  TRANSCRIBE = 'transcribe',
  TRANSCRIPTION_STATUS = 'transcription-status',
  TOGGLE_RECORDING = 'toggle-recording',
  GET_SETTINGS = 'get-settings',
  UPDATE_SETTINGS = 'update-settings',
  GET_HISTORY = 'get-history',
  CLEAR_HISTORY = 'clear-history',
  COPY_TO_CLIPBOARD = 'copy-to-clipboard',
  DOWNLOAD_MODEL = 'download-model',
  DOWNLOAD_PROGRESS = 'download-progress',
  WIDGET_POSITION_SAVE = 'widget-position-save',
  WIDGET_POSITION_LOAD = 'widget-position-load',
  ONBOARDING_COMPLETE = 'onboarding-complete',
  IS_ONBOARDING_DONE = 'is-onboarding-done',
  OPEN_SETTINGS = 'open-settings',
  SHOW_DASHBOARD = 'show-dashboard',
  QUIT_APP = 'quit-app',
  AGENT_GET_LOG = 'agent-get-log',
  AGENT_CLEAR_LOG = 'agent-clear-log',
  AGENT_TOAST = 'agent-toast',
  AGENT_ACTION_RESULT = 'agent-action-result',
  BROWSER_TASK_PROGRESS = 'browser-task-progress',
  BROWSER_TASK_CANCEL = 'browser-task-cancel',
  BROWSER_TASK_RESULT = 'browser-task-result',
  BROWSER_TASK_LOGIN_REQUIRED = 'browser-task-login-required',
  BROWSER_TASK_LOGIN_COMPLETE = 'browser-task-login-complete',
  CHAT_SEND = 'chat-send',
  CHAT_RESPONSE = 'chat-response',
}
```

---

## 8. LLM Provider System

### 8.1 Provider Interface

**File: `src/main/agent/llm/providers/llm-provider.ts`**

```typescript
export type ProviderId = 'openai' | 'gemini' | 'deepseek';

export interface TextCompleteParams {
  apiKey: string;
  modelId: string;
  systemPrompt: string;
  userMessage: string;
  jsonMode: boolean;
  maxTokens?: number;
}

export interface VisionCompleteParams {
  apiKey: string;
  modelId: string;
  systemPrompt: string;
  userMessage: string;
  imageBase64: string;
  jsonMode: boolean;
  maxTokens?: number;
}

export type LLMErrorKind =
  | 'missing_key' | 'invalid_key' | 'http_error' | 'network'
  | 'timeout' | 'empty_response' | 'unsupported' | 'no_vision_provider' | 'parse_error';

export interface LLMError {
  kind: LLMErrorKind;
  message: string;
  providerId?: ProviderId;
  httpStatus?: number;
}

export type LLMResult =
  | { ok: true; text: string }
  | { ok: false; error: LLMError };

export interface LLMProvider {
  readonly id: ProviderId;
  textComplete(params: TextCompleteParams): Promise<LLMResult>;
  visionComplete(params: VisionCompleteParams): Promise<LLMResult>;
}
```

### 8.2 Provider Registry

**File: `src/main/agent/llm/provider-registry.ts`**

```typescript
import { ProviderId } from './providers/llm-provider';

export interface ModelInfo {
  id: string;
  displayName: string;
  vision: boolean;
}

export interface ProviderInfo {
  id: ProviderId;
  displayName: string;
  models: ModelInfo[];
}

export const PROVIDER_REGISTRY: ProviderInfo[] = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    models: [
      { id: 'gpt-4o-mini', displayName: 'GPT-4o mini', vision: true },
      { id: 'gpt-4o', displayName: 'GPT-4o', vision: true },
    ],
  },
  {
    id: 'gemini',
    displayName: 'Google Gemini',
    models: [
      { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', vision: true },
      { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', vision: true },
      { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', vision: true },
    ],
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    models: [
      { id: 'deepseek-chat', displayName: 'DeepSeek Chat', vision: false },
    ],
  },
];

export function getProvider(id: ProviderId): ProviderInfo | undefined {
  return PROVIDER_REGISTRY.find((p) => p.id === id);
}

export function isVisionCapable(providerId: ProviderId, modelId: string): boolean {
  return getProvider(providerId)?.models.find((m) => m.id === modelId)?.vision ?? false;
}

export function visionCapableProviders(): ProviderId[] {
  return PROVIDER_REGISTRY.filter((p) => p.models.some((m) => m.vision)).map((p) => p.id);
}

export const DEFAULT_SELECTION = { provider: 'openai', model: 'gpt-4o-mini' } as const;
```


### 8.3 OpenAI Provider

**File: `src/main/agent/llm/providers/openai-provider.ts`**

Key implementation details:
- Uses `openai` npm package (official SDK)
- Passes `max_tokens` to all API calls
- Maps errors: 401 → `invalid_key`, network → `network`, HTTP → `http_error`
- Vision uses `image_url` content type with base64 data URI
- JSON mode via `response_format: { type: 'json_object' }`

```typescript
import OpenAI from 'openai';

export class OpenAIProvider implements LLMProvider {
  readonly id: ProviderId = 'openai';

  async textComplete(params: TextCompleteParams): Promise<LLMResult> {
    const { apiKey, modelId, systemPrompt, userMessage, jsonMode, maxTokens } = params;
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: modelId,
      response_format: jsonMode ? { type: 'json_object' } : undefined,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });
    return { ok: true, text: response.choices[0].message.content };
  }

  async visionComplete(params: VisionCompleteParams): Promise<LLMResult> {
    const { apiKey, modelId, systemPrompt, userMessage, imageBase64, jsonMode, maxTokens } = params;
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: modelId,
      response_format: jsonMode ? { type: 'json_object' } : undefined,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: userMessage },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
          ],
        },
      ],
    });
    return { ok: true, text: response.choices[0].message.content };
  }
}
```

### 8.4 Gemini Provider

**File: `src/main/agent/llm/providers/gemini-provider.ts`**

Key differences from OpenAI:
- Uses `@google/generative-ai` SDK
- System prompt via `systemInstruction` on model config
- JSON mode via `responseMimeType: 'application/json'`
- max_tokens mapped to `maxOutputTokens` in `generationConfig`
- Images as `inlineData` with raw base64 (no data URI prefix)

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiProvider implements LLMProvider {
  readonly id: ProviderId = 'gemini';

  async textComplete(params: TextCompleteParams): Promise<LLMResult> {
    const { apiKey, modelId, systemPrompt, userMessage, jsonMode, maxTokens } = params;
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelId,
      systemInstruction: systemPrompt,
      generationConfig: {
        ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
        ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
      },
    });
    const result = await model.generateContent(userMessage);
    return { ok: true, text: result.response.text() };
  }

  async visionComplete(params: VisionCompleteParams): Promise<LLMResult> {
    // Same as textComplete but content is array:
    // [userMessage, { inlineData: { mimeType: 'image/png', data: imageBase64 } }]
  }
}
```

### 8.5 DeepSeek Provider

**File: `src/main/agent/llm/providers/deepseek-provider.ts`**

- Uses OpenAI SDK with `baseURL: 'https://api.deepseek.com'`
- Does NOT support vision (returns `unsupported` error)
- JSON mode reinforced with explicit system prompt instruction
- Useful as cheap text-only fallback

### 8.6 LLM Service (Central Hub)

**File: `src/main/agent/llm/llm-service.ts`**

This is the **most important file** — the central routing layer:

```typescript
/** Default max_tokens caps */
const DEFAULT_TEXT_MAX_TOKENS = 500;
const DEFAULT_VISION_MAX_TOKENS = 800;
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_BUDGET_LIMIT_USD = 0.50;

export class LLMService {
  private selection: Selection;          // Active provider + model
  private apiKeys: Record<ProviderId, string>;  // Per-provider keys
  private providers: Record<ProviderId, LLMProvider>;  // Stateless adapters
  readonly budgetTracker: TokenBudgetTracker;  // Cost enforcement

  constructor(providers?, budgetLimitUsd?) { ... }

  // Instant provider/model switching
  setActiveSelection(provider: ProviderId, model: string): void;
  setApiKey(providerId: ProviderId, key: string): void;

  // Core operations with budget enforcement
  async textComplete(systemPrompt, userMessage, jsonMode, maxTokens = 500): Promise<LLMResult>;
  async visionComplete(systemPrompt, userMessage, imageBase64, jsonMode, maxTokens = 800): Promise<VisionResult>;
}
```

**Vision routing logic:**
1. If active model is vision-capable → use it directly
2. If not → find first vision-capable provider with a key → route to it (fallback)
3. If none → return `no_vision_provider` error

**Budget enforcement:**
- Before every request: check if budget exceeded → return error if so
- After every request: estimate cost and add to tracker
- Cost formula: `(inputChars/4)/1000 * $0.005 + (outputChars/4)/1000 * $0.015`
- Vision adds ~1100 image tokens to input

### 8.7 Key Validation

```typescript
export function validateApiKey(providerId: ProviderId, key: string): boolean {
  const trimmed = key.trim();
  switch (providerId) {
    case 'openai':
    case 'deepseek':
      return trimmed.startsWith('sk-') && trimmed.length >= 20;
    case 'gemini':
      return trimmed.length >= 20;
    default:
      return false;
  }
}
```

---

## 9. Agent Core Modules

### 9.1 Command Detector

**File: `src/main/agent/command-detector.ts`**

Local regex-only detection (zero latency, no API call). Detects imperative verbs at start of text:

```typescript
export class CommandDetector {
  private readonly patterns = [
    { regex: /^take\s+a\s+screenshot/i, label: 'take a screenshot' },
    { regex: /^go\s+to/i, label: 'go to' },
    { regex: /^volume\s+(up|down)/i, label: 'volume' },
    { regex: /^open/i, label: 'open' },
    { regex: /^type/i, label: 'type' },
    { regex: /^search/i, label: 'search' },
    { regex: /^mute/i, label: 'mute' },
    { regex: /^unmute/i, label: 'unmute' },
    { regex: /^launch/i, label: 'launch' },
    { regex: /^close/i, label: 'close' },
    { regex: /^find/i, label: 'find' },
    { regex: /^navigate/i, label: 'navigate' },
    { regex: /^play/i, label: 'play' },
    { regex: /^pause/i, label: 'pause' },
    { regex: /^stop/i, label: 'stop' },
  ];

  detect(text: string): DetectionResult {
    // Base confidence: 0.8 for pattern match
    // Bonus: +0.1 if < 6 words (short command heuristic)
    // No match → { isCommand: false, confidence: 0 }
  }
}
```

### 9.2 Intent Classifier

**File: `src/main/agent/intent-classifier.ts`**

Sends text to GPT/Gemini for structured classification. The system prompt is critical:

```
You are a voice command classifier. Given a user's spoken command, classify it into:
- "action": one of open_application, open_url, type_text, web_search, open_path, system_control, browser_task
- "target": the target (app name, URL, text, search query, path, control action, task description)
- "confidence": 0.0-1.0
- "parameters": optional additional context

Key classification rules:
- open_application: ONLY for launching desktop apps with NO web interaction
- open_url: Simple page navigation only
- browser_task: Complex multi-step web interactions (login, click, fill forms, read content)
- If command mentions BOTH opening + doing action → browser_task
- If command mentions web service name + action verb → browser_task
```

### 9.3 Action Executor

**File: `src/main/agent/action-executor.ts`**

Executes classified intents using Windows-specific methods:

| Action | Method |
|--------|--------|
| `open_application` | `start "" "appName"` via child_process |
| `open_url` | `shell.openExternal(url)` |
| `type_text` | PowerShell clipboard + SendKeys Ctrl+V |
| `web_search` | Google search URL via shell.openExternal |
| `open_path` | Folder alias resolution + `shell.openPath` |
| `system_control` | PowerShell WScript.Shell media key simulation |
| `browser_task` | Delegates to BrowserAgent |

**App name map** (spoken name → executable):
```
chrome → chrome, notepad → notepad, calculator → calc,
vscode → code, file explorer → explorer, word → winword,
excel → excel, terminal → wt, task manager → taskmgr
```

**Folder aliases** (resolved relative to `os.homedir()`):
```
documents → ~/Documents, downloads → ~/Downloads,
desktop → ~/Desktop, pictures → ~/Pictures, etc.
```

### 9.4 Agent Store

**File: `src/main/agent/agent-store.ts`**

Simple persistence layer using electron-store:

```typescript
export class AgentStore {
  private store: Store<{ entries: ActionLogEntry[] }>;

  addEntry(entry: ActionLogEntry): void { entries.unshift(entry); }
  getEntries(): ActionLogEntry[] { return store.get('entries'); }
  clearLog(): void { store.set('entries', []); }
}
```

### 9.5 Agent Service (Orchestrator)

**File: `src/main/agent/agent-service.ts`**

The main orchestrator that ties everything together:

```
Pipeline: CommandDetector → IntentClassifier → ActionExecutor → AgentStore

process(text):
  1. If disabled → return { handled: false }
  2. CommandDetector.detect(text) → if not command → return { handled: false }
  3. IntentClassifier.classify(text) → if error → notify, return { handled: false }
  4. If confidence < 0.7 → notify unrecognized, return { handled: false }
  5. ActionExecutor.execute(intent) → log result → return { handled: true }
  6. On 401 → disable agent, notify user
```

---

## 10. Browser Automation

### 10.1 Page Analyzer

**File: `src/main/agent/page-analyzer.ts`**

Analyzes screenshots using vision model. **Token-optimized** with two prompts:

**Initial prompt (step 1 only, ~350 chars):**
```
You are a browser automation agent. Analyze screenshots and decide the next action.

Respond with JSON:
{"action":"<type>","target":"<selector_or_url>","value":"<text>","reasoning":"<brief>",
 "is_task_complete":false,"extracted_data":"","confidence":0.8,"plan":"<2-3 step plan>"}

Actions: navigate_to_url, click_element, type_into_element, scroll_page,
         read_page_content, wait_for_load, task_complete, task_failed
Rules: Use descriptive selectors. Set is_task_complete=true only when done.
       Include a brief plan on first response.
```

**Follow-up prompt (steps 2+, ~230 chars):**
```
Browser automation agent. Analyze screenshot, pick next action.
JSON: {"action":"<type>","target":"<sel>","value":"<txt>","reasoning":"<why>",
       "is_task_complete":false,"extracted_data":"","confidence":0.8}
Actions: navigate_to_url, click_element, type_into_element, scroll_page,
         read_page_content, wait_for_load, task_complete, task_failed
```

**Key behaviors:**
- Plan generation merged into first vision call (no separate API call)
- Only last 3 steps sent as history context
- Step descriptions truncated to 80 chars
- `generatePlan()` is now a no-op for backward compatibility

### 10.2 ReAct Loop

**File: `src/main/agent/react-loop.ts`**

The core automation cycle:

```
For each step (max 15):
  1. Check abort signal
  2. Check token budget
  3. Screenshot at 640×480 (standard resolution)
  4. Send to PageAnalyzer.analyzeScreenshot()
  5. If confidence < 0.4 → retry screenshot at 1280×720
  6. If task_complete → return success
  7. If task_failed → return failure
  8. Execute the browser action
  9. Wait 500ms for page to settle
  10. Emit progress to UI
```

**Token optimization constants:**
```typescript
const STANDARD_RESOLUTION = { width: 640, height: 480 };  // Regular screenshots
const RETRY_RESOLUTION = { width: 1280, height: 720 };    // Only on low confidence retry
const LOW_CONFIDENCE_THRESHOLD = 0.4;                      // Triggers high-res retry
```

**Smart element finding** (in order of priority):
1. CSS selector detection (has `.`, `#`, `[`, `]`, `>`)
2. `page.getByText(target, { exact: false })`
3. `page.getByRole('button', { name: target })`
4. `page.getByRole('link', { name: target })`
5. `page.locator('[aria-label="${target}"]')`

### 10.3 Browser Agent

**File: `src/main/agent/browser-agent.ts`**

Manages the Playwright browser lifecycle:

- **Persistent context** — cookies/sessions survive across tasks (user stays logged in)
- **User data dir** — `%APPDATA%/voice-to-text/browser-data/`
- **Login detection** — checks URL for `/login`, `/signin`, `/auth`, `/sso`, `/oauth` patterns
- **Academic task routing** — detects keywords like "assignment", "lms", "university" and routes to AcademicAssistant
- **Viewport** — 1280×720 for the actual browser, screenshots are captured at smaller sizes

---

## 11. Academic Assistant

**File: `src/main/agent/academic-assistant.ts`**

Full workflow for university LMS interaction:

```
1. Navigate to LMS URL
2. Detect login page → notify user → wait up to 5 minutes
3. Extract course/assignment details via GPT text analysis
4. For each assignment:
   a. Generate academic answer (formal scholarly style)
   b. Create PDF using pdfkit
5. Output PDFs to Documents/EduPilot/Assignments/
```

**LMS detection patterns:**
```
blackboard.com, canvas.instructure.com, moodle, brightspace,
d2l.com, lms., elearning., iqra.edu, portal.
```

**Login page detection:**
```
/login, /signin, /sign-in, /auth, /sso, /oauth,
/authenticate, /account/login, /cas/login
```

**Extraction prompt:**
```
Extract course and assignment details from this page content. Return JSON:
{"courseName":"<name>","courseCode":"<code>","instructor":"<name>",
 "assignments":[{"title":"<title>","description":"<desc>","dueDate":"<date>",
 "points":<pts>,"requirements":["<req1>"],"rubric":"<rubric text>"}]}
```

**Academic writing prompt:**
```
You are an academic writing assistant. Generate well-structured, scholarly answers:
- Use formal academic tone with clear thesis statements
- Include topic sentences for each paragraph
- Support arguments with logical reasoning
- Use transitional phrases between ideas
- Conclude with a summary that reinforces the main argument
- Avoid plagiarism - generate original analysis and synthesis
- Format with clear introduction, body paragraphs, and conclusion
```

**PDF format (A4, 72pt margins):**
- Header: Course name, date
- Title: Assignment title (centered, 16pt)
- Body: Justified text with 36px indent, 4px line gap
- References section (if any)
- Footer: Word count

---

## 12. Token Budget System

**File: Part of `src/main/agent/llm/llm-service.ts`**

```typescript
const PRICING = {
  inputPer1K: 0.005,   // $5 per 1M input tokens
  outputPer1K: 0.015,  // $15 per 1M output tokens
};

export class TokenBudgetTracker {
  private totalEstimatedCost = 0;
  private budgetLimitUsd = 0.50;  // Default $0.50 limit

  recordTextRequest(inputChars, outputChars): void {
    // 1 token ≈ 4 characters (heuristic)
    const inputTokens = inputChars / 4;
    const outputTokens = outputChars / 4;
    const cost = (inputTokens/1000) * 0.005 + (outputTokens/1000) * 0.015;
    this.totalEstimatedCost += cost;
  }

  recordVisionRequest(inputChars, outputChars, imageTokens = 1100): void {
    const inputTokens = inputChars / 4 + imageTokens;
    // ... same formula
  }

  isOverBudget(): boolean { return totalEstimatedCost >= budgetLimitUsd; }
  reset(): void { totalEstimatedCost = 0; }  // Called at start of each task
}
```

**Enforcement points:**
- Before every `textComplete()` call
- Before every `visionComplete()` call
- Before each ReAct loop iteration
- Before each academic answer generation

---

## 13. Main Process Integration

**File: `src/main/main.ts`**

Key wiring in `app.whenReady()`:

```typescript
// 1. Create AgentService with notifier callbacks
const agentService = new AgentService({
  notifySuccess: (msg) => dashboardWindow.webContents.send('agent-toast', { type: 'success', message: msg }),
  notifyError: (msg) => dashboardWindow.webContents.send('agent-toast', { type: 'error', message: msg }),
  notifyUnrecognized: (text) => dashboardWindow.webContents.send('agent-toast', { type: 'warning', message: `Command not recognized: "${text}"` }),
});

// 2. Seed API keys from saved settings
agentService.setProviderApiKey('openai', settingsStore.get('openaiApiKey'));
agentService.setProviderApiKey('gemini', settingsStore.get('geminiApiKey'));
agentService.setProviderApiKey('deepseek', settingsStore.get('deepseekApiKey'));

// 3. Set active provider/model
agentService.setActiveSelection(savedProvider, savedModel);

// 4. Wire browser notifier (IPC to renderer)
agentService.setupBrowserNotifier({
  sendProgress: (p) => dashboardWindow.webContents.send('browser-task-progress', p),
  sendResult: (r) => dashboardWindow.webContents.send('browser-task-result', r),
  sendLoginRequired: (taskId, url) => dashboardWindow.webContents.send('browser-task-login-required', { taskId, url }),
  sendToast: (t) => dashboardWindow.webContents.send('agent-toast', t),
});

// 5. In TRANSCRIBE handler — after Whisper returns text:
if (agentService.isEnabled() && result.text) {
  const agentResult = await agentService.process(result.text);
  if (agentResult.handled) {
    // Skip clipboard copy and history — command was executed
    return result;
  }
}
// Otherwise: normal dictation flow (clipboard + history)
```

---

## 14. Settings & Configuration

Settings are persisted via `electron-store` and synced to the agent on change:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `aiAgentEnabled` | boolean | false | Master toggle for AI agent |
| `openaiApiKey` | string | '' | OpenAI API key (sk-...) |
| `geminiApiKey` | string | '' | Google Gemini API key (AIzaSy...) |
| `deepseekApiKey` | string | '' | DeepSeek API key (sk-...) |
| `llmProvider` | string | '' | Active provider: 'openai'/'gemini'/'deepseek' |
| `llmModel` | string | '' | Active model ID |
| `browserAgentHeadless` | boolean | false | Run Playwright headless |
| `hotkeyMode` | string | 'toggle' | 'toggle' or 'push-to-talk' |
| `hotkeyAccelerator` | string | Ctrl+Shift+Space | Global hotkey |

---

## 15. Build & Package

```bash
# Development (compile + run)
npm run dev

# Build (compile only)
npm run build

# Package as Windows installer (.exe)
npm run package
# Output: dist/Voice to Text Setup 1.0.0.exe
```

---

## 16. How It All Connects

### Voice Command Flow
```
User speaks → Whisper transcribes → CommandDetector (regex) →
  If command: IntentClassifier (GPT) → ActionExecutor → Toast notification
  If dictation: Clipboard + History
```

### Browser Task Flow
```
"go to Azure DevOps and check my stories" →
  IntentClassifier → { action: 'browser_task', target: 'Azure DevOps - check stories' } →
  ActionExecutor.executeBrowserTask() →
  BrowserAgent.executeTask() →
  ReactLoop.run():
    Screenshot(640×480) → PageAnalyzer(vision) → Execute action → Repeat
    (budget check each step, retry at 1280×720 if low confidence)
```

### Academic Task Flow
```
"open university portal and extract assignments" →
  IntentClassifier → { action: 'browser_task', target: '...' } →
  BrowserAgent detects academic keywords →
  AcademicAssistant.runAcademicWorkflow():
    Navigate to LMS → Wait for login → Extract details →
    Generate answers (GPT, 2000 token limit) → Create PDFs (pdfkit)
```

### Provider Switching Flow
```
User changes provider in Settings →
  IPC UPDATE_SETTINGS →
  agentService.setActiveSelection(provider, model) →
  llmService.selection = { provider, model } →
  Next request uses new provider immediately
```

---

## Summary of Token Optimization

| Optimization | Before | After | Savings |
|-------------|--------|-------|---------|
| Screenshot resolution | 1280×720 | 640×480 | ~60% fewer image tokens |
| Retry resolution | 1920×1080 | 1280×720 | ~55% fewer retry tokens |
| History context | All steps | Last 3 steps | ~80% fewer text tokens |
| System prompt (step 1) | ~1100 chars | ~350 chars | ~68% smaller |
| System prompt (step 2+) | ~1100 chars | ~230 chars | ~79% smaller |
| Plan generation | Separate API call | Merged into step 1 | 1 fewer API call |
| Text response cap | Unlimited | 500 tokens | Hard cap |
| Vision response cap | Unlimited | 800 tokens | Hard cap |
| Budget enforcement | None | $0.50 limit | Prevents runaway costs |

---

*End of documentation. This file contains everything needed to recreate the complete EduPilot AI Agent system from scratch.*
