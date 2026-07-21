# Requirements Document

## Introduction

This feature extends the existing voice AI agent Electron application with three capabilities:

1. **Multiple LLM provider support** — The application currently uses OpenAI exclusively (GPT-4o-mini for intent classification, GPT-4o for browser vision). This feature adds Google Gemini and DeepSeek as alternative providers behind a unified provider abstraction, so the agent pipeline does not depend on a specific vendor SDK.
2. **Instant model switching** — When the user changes the selected provider or model in settings, the change applies to the next request without restarting the application.
3. **Text chat window** — A new dashboard panel where the user types commands instead of speaking them. Typed commands flow through the same pipeline as voice commands (Command_Detector → Intent_Classifier → Action_Executor) and the panel displays a conversation history of commands and their results.

The feature also covers per-provider API key management and provider capability handling, since DeepSeek does not support vision tasks required by the browser agent.

## Glossary

- **LLM_Provider**: An abstraction representing a single large language model vendor (OpenAI, Google Gemini, or DeepSeek). Each LLM_Provider exposes a uniform interface for text completion and, where supported, vision completion.
- **LLM_Service**: The main-process module that holds the current provider/model selection and routes each request to the active LLM_Provider. Replaces direct SDK usage in the Intent_Classifier and Page_Analyzer.
- **Provider_Id**: A stable identifier for a provider. Allowed values are "openai", "gemini", and "deepseek".
- **Model_Id**: A provider-specific identifier for a model (e.g., "gpt-4o-mini", "gemini-1.5-flash", "deepseek-chat").
- **Provider_Registry**: A static description of each provider's available models, which models support vision, and the display metadata used to populate the settings dropdowns.
- **Vision_Capability**: A boolean attribute of a Model_Id indicating whether the model can accept image input for browser screenshot analysis.
- **Intent_Classifier**: The existing component that classifies command text into a structured intent. Modified to obtain completions from the LLM_Service instead of the OpenAI SDK directly.
- **Page_Analyzer**: The existing browser-agent component that analyzes page screenshots. Modified to obtain vision completions from the LLM_Service.
- **Command_Detector**: The existing module that classifies input text as a command or dictation using local pattern matching.
- **Action_Executor**: The existing module that executes a classified intent as a system or browser action.
- **Agent_Service**: The existing main-process orchestrator of the Command_Detector → Intent_Classifier → Action_Executor pipeline.
- **Chat_Panel**: The new dashboard panel containing a text input, a send control, and a scrollable conversation history.
- **Chat_Message**: A single entry in the Chat_Panel conversation history, either a user-typed command or an agent response.
- **Settings_Store**: The existing electron-store based persistence layer, extended with provider selection and per-provider API keys.
- **Settings_Panel**: The existing dashboard Settings panel, extended with a provider dropdown, a model dropdown, and per-provider API key fields.
- **Dashboard**: The existing Electron renderer window containing Home, History, Agent, and Settings panels, extended with the Chat_Panel.
- **Active_Selection**: The currently selected Provider_Id and Model_Id used for the next LLM request.

## Requirements

### Requirement 1: Unified LLM Provider Abstraction

**User Story:** As a developer, I want a single provider interface that the agent pipeline calls, so that the classification and vision code does not depend on which vendor is active.

#### Acceptance Criteria

1. THE LLM_Service SHALL expose a text-completion operation that accepts a system prompt, a user message, and a request for JSON-formatted output, and SHALL return the model's text response.
2. THE LLM_Service SHALL expose a vision-completion operation that accepts a system prompt, a user message, and one image, and SHALL return the model's text response.
3. THE LLM_Service SHALL route each text-completion and vision-completion request to the LLM_Provider identified by the Active_Selection.
4. THE Intent_Classifier SHALL obtain command classifications through the LLM_Service text-completion operation rather than through a vendor SDK directly.
5. THE Page_Analyzer SHALL obtain screenshot analyses through the LLM_Service vision-completion operation rather than through a vendor SDK directly.
6. WHERE a new provider is added to the Provider_Registry, THE LLM_Service SHALL route requests to the new provider without changes to the Intent_Classifier or Page_Analyzer source code.
7. THE LLM_Service SHALL provide both the text-completion operation and the vision-completion operation before the LLM_Service is available to handle requests.

### Requirement 2: OpenAI Provider

**User Story:** As a user, I want to keep using OpenAI models, so that my existing setup continues to work after the update.

#### Acceptance Criteria

1. THE Provider_Registry SHALL list "openai" as a provider with models "gpt-4o-mini" and "gpt-4o".
2. WHEN the Active_Selection provider is "openai", THE LLM_Service SHALL send text-completion and vision-completion requests using the OpenAI client configured with the OpenAI API key.
3. THE Provider_Registry SHALL mark the OpenAI models "gpt-4o-mini" and "gpt-4o" as having Vision_Capability true.
4. WHEN the application starts and no provider selection has been persisted, THE Settings_Store SHALL set the Active_Selection to provider "openai" and model "gpt-4o-mini" as the in-memory default and SHALL leave the persisted store empty until the user makes a selection.

### Requirement 3: Google Gemini Provider

**User Story:** As a user, I want to use Google Gemini models, so that I can choose a provider other than OpenAI for classification and vision.

#### Acceptance Criteria

1. THE Provider_Registry SHALL list "gemini" as a provider with models "gemini-1.5-flash", "gemini-1.5-pro", and "gemini-2.0-flash".
2. WHEN the Active_Selection provider is "gemini", THE LLM_Service SHALL send text-completion and vision-completion requests using the Google Generative AI client configured with the Gemini API key.
3. THE Provider_Registry SHALL mark the Gemini models "gemini-1.5-flash", "gemini-1.5-pro", and "gemini-2.0-flash" as having Vision_Capability true.
4. WHEN a Gemini text-completion request specifies JSON-formatted output, THE LLM_Service SHALL configure the Gemini request to return JSON and SHALL return the response text.

### Requirement 4: DeepSeek Provider

**User Story:** As a user, I want to use DeepSeek models for command classification, so that I can use a lower-cost text provider.

#### Acceptance Criteria

1. THE Provider_Registry SHALL list "deepseek" as a provider with model "deepseek-chat".
2. WHEN the Active_Selection provider is "deepseek", THE LLM_Service SHALL send text-completion requests using an OpenAI-compatible client configured with the DeepSeek API key and the DeepSeek base URL.
3. THE Provider_Registry SHALL mark the DeepSeek model "deepseek-chat" as having Vision_Capability false.
4. WHEN a DeepSeek text-completion request specifies JSON-formatted output, THE LLM_Service SHALL instruct DeepSeek to return JSON and SHALL return the response text.

### Requirement 5: Provider and Model Selection

**User Story:** As a user, I want to choose a provider and a model within that provider, so that I control which model handles my commands.

#### Acceptance Criteria

1. THE Settings_Panel SHALL display a provider dropdown populated from the Provider_Registry with options "OpenAI", "Google Gemini", and "DeepSeek".
2. THE Settings_Panel SHALL display a model dropdown populated with the models that the Provider_Registry lists for the currently selected provider.
3. WHEN the user selects a different provider in the provider dropdown, THE Settings_Panel SHALL repopulate the model dropdown with the models for the newly selected provider and SHALL select that provider's first listed model.
4. WHEN the user selects a provider and a model, THE Settings_Store SHALL persist the selected Provider_Id and Model_Id as the Active_Selection.
5. WHEN the Settings_Panel opens, THE Settings_Panel SHALL preselect the provider dropdown and model dropdown to match the persisted Active_Selection.

### Requirement 6: Instant Model Switching

**User Story:** As a user, I want a model change to take effect immediately, so that the next command uses the model I just selected without restarting the application.

#### Acceptance Criteria

1. WHEN the user changes the Active_Selection in the Settings_Panel, THE LLM_Service SHALL use the newly selected provider and model for the next text-completion or vision-completion request.
2. THE LLM_Service SHALL apply an Active_Selection change without requiring an application restart.
3. WHILE a text-completion or vision-completion request is in progress, THE LLM_Service SHALL complete that in-progress request using the Active_Selection that was current when the request started.
4. WHEN the Active_Selection changes, THE Settings_Store SHALL persist the change so the same selection applies after the next application restart.
5. IF the newly selected provider has no stored API key when a request is made, THEN THE LLM_Service SHALL fail the request and return an error identifying the affected provider and the missing API key.

### Requirement 7: Per-Provider API Key Management

**User Story:** As a user, I want to store a separate API key for each provider, so that I can switch providers without re-entering keys.

#### Acceptance Criteria

1. THE Settings_Panel SHALL display a separate API key field for OpenAI, for Gemini, and for DeepSeek.
2. THE Settings_Store SHALL persist the OpenAI, Gemini, and DeepSeek API keys as separate obfuscated values rather than plain text in the settings file.
3. WHEN the user saves an API key for a provider, THE LLM_Service SHALL use the updated key for that provider's next request without requiring an application restart.
4. WHEN an OpenAI API key exists from a previous version under the prior single-key setting, THE Settings_Store SHALL migrate that value into the OpenAI API key field on first launch after the update, and SHALL perform the migration only when a legacy key value exists.
5. WHILE the Active_Selection provider has no stored API key, THE Agent_Service SHALL display a notification prompting the user to enter an API key for that provider in settings and SHALL process the input as plain dictation.

### Requirement 8: Provider API Key Validation

**User Story:** As a user, I want each provider's API key checked for the correct format, so that I get feedback before a request fails.

#### Acceptance Criteria

1. WHEN the user enters an OpenAI API key, THE Settings_Panel SHALL accept the key when it begins with "sk-" and contains at least 20 characters, and SHALL show a format warning otherwise.
2. WHEN the user enters a Gemini API key, THE Settings_Panel SHALL accept the key when it contains at least 20 characters, and SHALL show a format warning otherwise.
3. WHEN the user enters a DeepSeek API key, THE Settings_Panel SHALL accept the key when it begins with "sk-" and contains at least 20 characters, and SHALL show a format warning otherwise.
4. IF a provider returns an authentication error indicating an invalid key, THEN THE LLM_Service SHALL return an invalid-key error identifying the affected provider.

### Requirement 9: Vision Capability Handling for Browser Tasks

**User Story:** As a user, I want browser vision tasks to keep working even when my selected provider lacks vision support, so that selecting a text-only model does not silently break the browser agent.

#### Acceptance Criteria

1. WHEN a browser task requires a vision-completion request and the Active_Selection model has Vision_Capability true, THE LLM_Service SHALL send the vision request to the Active_Selection provider.
2. IF a browser task requires a vision-completion request and the Active_Selection model has Vision_Capability false, THEN THE LLM_Service SHALL route the vision request to any configured vision-capable provider that has a stored API key, without preference among multiple eligible providers.
3. WHEN a vision request is routed to a fallback provider because the Active_Selection model lacks Vision_Capability, THE LLM_Service SHALL complete the routing to the fallback provider and THE Agent_Service SHALL display a notification stating that the selected model does not support vision and naming the fallback provider used.
4. IF a browser task requires a vision-completion request, the Active_Selection model has Vision_Capability false, and no vision-capable provider has a stored API key, THEN THE Agent_Service SHALL display an error notification stating that the browser task requires a vision-capable provider and SHALL end the browser task with a failed status.

### Requirement 10: Text Chat Panel

**User Story:** As a user, I want a chat window in the dashboard, so that I can type commands instead of speaking them.

#### Acceptance Criteria

1. THE Dashboard SHALL display a Chat_Panel accessible from the sidebar navigation.
2. THE Chat_Panel SHALL display a text input field, a send control, and a scrollable conversation history area.
3. WHEN the user enters text in the input field and activates the send control, THE Chat_Panel SHALL send the entered text to the Agent_Service through a dedicated inter-process channel.
4. WHEN the user presses the Enter key while the input field is focused and the input field is non-empty, THE Chat_Panel SHALL send the entered text through the same channel as the send control.
5. WHEN the user activates the send control while the input field is empty, THE Chat_Panel SHALL take no action.
6. WHEN a typed command has been sent, THE Chat_Panel SHALL clear the input field immediately upon activation of the send control, regardless of delivery status.

### Requirement 11: Chat Command Processing Through the Agent Pipeline

**User Story:** As a user, I want my typed commands to be handled the same way as voice commands, so that the chat produces the same actions as speaking.

#### Acceptance Criteria

1. WHEN the Agent_Service receives a typed command from the Chat_Panel, THE Agent_Service SHALL process the text through the Command_Detector, then the Intent_Classifier, then the Action_Executor, in that order.
2. WHEN the Command_Detector classifies a typed command as dictation rather than a command, THE Agent_Service SHALL return a chat response indicating the text was not recognized as a command.
3. WHEN the Intent_Classifier returns a confidence score below 0.7 for a typed command, THE Agent_Service SHALL return a chat response indicating the command was not understood.
4. WHEN the Action_Executor completes execution of a typed command, THE Agent_Service SHALL return a chat response containing the execution status and a description of the action taken.
5. WHEN the Agent_Service processes a typed command, THE Agent_Service SHALL record the command in the Action_Log using the same entry structure as voice commands.
6. WHILE AI agent mode is disabled, THE Agent_Service SHALL return a chat response stating that AI agent mode must be enabled to process typed commands.

### Requirement 12: Chat Conversation History

**User Story:** As a user, I want to see a running history of my typed commands and their results, so that I can review what I asked and what happened.

#### Acceptance Criteria

1. WHEN the user sends a typed command, THE Chat_Panel SHALL append a Chat_Message attributed to the user containing the command text to the conversation history.
2. WHEN the Agent_Service returns a chat response, THE Chat_Panel SHALL append a Chat_Message attributed to the agent containing the response text to the conversation history.
3. THE Chat_Panel SHALL display Chat_Messages in chronological order with the most recent message at the bottom.
4. WHEN a new Chat_Message is appended, THE Chat_Panel SHALL scroll the conversation history so the most recent message is visible.
5. WHILE the Agent_Service is processing a typed command, THE Chat_Panel SHALL display a pending indicator until the agent response is appended.

### Requirement 13: Provider and Model Error Handling

**User Story:** As a user, I want provider failures handled gracefully, so that the application stays usable when a provider is unavailable.

#### Acceptance Criteria

1. IF a provider request exceeds 10 seconds for text completion, THEN THE LLM_Service SHALL abort the request and return a timeout error identifying the affected provider.
2. IF a provider returns an HTTP error, THEN THE LLM_Service SHALL return an error result containing the provider identifier and the HTTP status code.
3. IF a provider is unreachable due to a network error, THEN THE LLM_Service SHALL return a network error identifying the affected provider.
4. WHEN an LLM_Service request originating from a voice command fails for any reason, THE Agent_Service SHALL process the original text as plain dictation so the user input is preserved.
5. WHEN an LLM_Service request originating from a typed command fails, THE Agent_Service SHALL return a chat response containing the error description.

### Requirement 14: Provider Response Parsing

**User Story:** As a developer, I want a consistent parsing contract for provider responses, so that intent parsing is reliable across providers.

#### Acceptance Criteria

1. THE Intent_Classifier SHALL parse each provider's text-completion response into an intent object containing an action type, a target, a confidence score, and optional parameters.
2. WHEN a provider response is not valid JSON, THE Intent_Classifier SHALL return a parse error with a descriptive message.
3. WHEN a provider response omits the action, target, or confidence fields, THE Intent_Classifier SHALL return a parse error identifying the missing fields.
4. FOR ALL valid intent objects, serializing the parsed intent to JSON and parsing the result again SHALL produce an equivalent intent object (round-trip property).
5. WHEN a provider response contains fields beyond the known schema, THE Intent_Classifier SHALL ignore the extra fields and process only the known schema fields.
