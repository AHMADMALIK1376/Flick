# Requirements Document

## Introduction

This feature extends the existing voice AI agent with browser automation capabilities using Playwright. When the user issues a complex web command (e.g., "go to Azure DevOps and check my active stories"), the agent launches a browser, navigates to the target site, interacts with page elements, and reports findings back to the user. The agent uses GPT-4o with vision to understand page content and a ReAct (Reason + Act) loop to execute multi-step tasks autonomously.

## Glossary

- **Browser_Agent**: The module responsible for managing a Playwright browser instance and executing multi-step web tasks using a ReAct loop
- **ReAct_Loop**: A cyclic process of Plan → Execute → Observe → Decide that drives autonomous multi-step browser interactions
- **Intent_Classifier**: The existing module that classifies user voice commands into structured action types, extended to detect browser tasks
- **Action_Executor**: The existing module that dispatches classified intents to their respective handlers
- **Dashboard**: The Electron renderer window that displays agent activity, logs, and real-time progress
- **Browser_Session**: A persistent Playwright browser context that retains cookies, local storage, and login state across tasks
- **Page_Snapshot**: A screenshot captured by Playwright and sent to GPT-4o vision for page understanding
- **Task_Step**: A single atomic browser action (navigate, click, type, scroll, read, wait) within a multi-step task
- **GPT4o_Vision**: The OpenAI GPT-4o model used with image inputs to interpret page screenshots and decide next actions

## Requirements

### Requirement 1: Browser Task Intent Detection

**User Story:** As a user, I want the agent to recognize when my voice command requires complex web browsing, so that it routes the command to the browser automation system instead of simple URL opening.

#### Acceptance Criteria

1. WHEN a user command describes a multi-step web interaction, THE Intent_Classifier SHALL classify it with action type "browser_task"
2. WHEN a user command is a simple URL navigation (e.g., "open google.com"), THE Intent_Classifier SHALL classify it as "open_url" and not "browser_task"
3. THE Intent_Classifier SHALL classify a command as "browser_task" only when it contains interaction verbs (check, find, look up, submit, fill, click) or explicit multi-step descriptions; commands lacking these indicators SHALL be classified as "open_url"
4. WHEN the Intent_Classifier returns a "browser_task" action, THE Action_Executor SHALL delegate execution to the Browser_Agent module

### Requirement 2: Browser Instance Management

**User Story:** As a user, I want the agent to manage a persistent browser so that I do not have to re-login to websites every time I issue a browser command.

#### Acceptance Criteria

1. WHEN the Browser_Agent receives its first task, THE Browser_Agent SHALL launch a Chromium browser instance via Playwright with a persistent user data directory
2. WHILE a browser instance is already running, THE Browser_Agent SHALL reuse the existing instance for subsequent tasks
3. THE Browser_Agent SHALL store the user data directory in the application's userData path to persist cookies, local storage, and login sessions across application restarts
4. WHEN the Electron application exits, THE Browser_Agent SHALL gracefully close the browser instance and release all resources
5. IF the browser instance crashes or becomes unresponsive, THEN THE Browser_Agent SHALL immediately terminate the stale instance and launch a new one on the next task request

### Requirement 3: ReAct Loop Execution

**User Story:** As a user, I want the agent to autonomously plan and execute multi-step web tasks, so that I can issue high-level commands without specifying each click and navigation step.

#### Acceptance Criteria

1. WHEN the Browser_Agent receives a task, THE Browser_Agent SHALL generate an initial plan by sending the user command to GPT-4o with a planning prompt
2. THE ReAct_Loop SHALL execute each Task_Step sequentially: perform the action, capture a Page_Snapshot, send the snapshot to GPT4o_Vision, and determine the next action
3. WHEN GPT4o_Vision determines the task is complete, THE ReAct_Loop SHALL return the findings to the user before terminating
4. THE ReAct_Loop SHALL limit execution to a maximum of 15 steps per task to prevent infinite loops
5. IF the ReAct_Loop reaches the maximum step limit without completing the task, THEN THE Browser_Agent SHALL report partial results and notify the user that the task could not be fully completed
6. WHEN GPT4o_Vision cannot determine the next action from a Page_Snapshot, THE Browser_Agent SHALL retry the observation once with a higher-resolution screenshot before reporting failure

### Requirement 4: Browser Action Primitives

**User Story:** As a user, I want the agent to perform common browser interactions (clicking, typing, scrolling, reading), so that it can complete a wide variety of web tasks.

#### Acceptance Criteria

1. THE Browser_Agent SHALL support the following action primitives: navigate_to_url, click_element, type_into_element, scroll_page, read_page_content, take_screenshot, and wait_for_load
2. WHEN executing a "navigate_to_url" action, THE Browser_Agent SHALL navigate the active page to the specified URL and wait for the network to become idle
3. WHEN executing a "click_element" action, THE Browser_Agent SHALL locate the element using the selector or description provided by GPT4o_Vision and perform a click; IF the click fails due to the element being obscured or disabled, THEN THE Browser_Agent SHALL report the failure to the ReAct_Loop without retrying
4. WHEN executing a "type_into_element" action, THE Browser_Agent SHALL focus the target input element, clear existing content, and type the specified text; IF the element focus fails, THEN THE Browser_Agent SHALL abort the type operation and report failure to the ReAct_Loop
5. WHEN executing a "scroll_page" action, THE Browser_Agent SHALL scroll the page in the specified direction by a configurable amount
6. WHEN executing a "read_page_content" action, THE Browser_Agent SHALL extract visible text content from the page and return it as a string
7. WHEN executing a "wait_for_load" action, THE Browser_Agent SHALL wait until the page reaches a "networkidle" state or a timeout of 10 seconds elapses
8. IF an element targeted by click_element or type_into_element cannot be found within 5 seconds, THEN THE Browser_Agent SHALL report the failure to the ReAct_Loop for re-evaluation

### Requirement 5: Vision-Based Page Understanding

**User Story:** As a user, I want the agent to visually understand web pages like a human would, so that it can interact with any website regardless of its structure.

#### Acceptance Criteria

1. WHEN the ReAct_Loop requires page understanding, THE Browser_Agent SHALL capture a full-page screenshot at 1280x720 resolution
2. THE Browser_Agent SHALL send the Page_Snapshot to GPT4o_Vision along with the current task context and ask for the next action to perform
3. THE GPT4o_Vision response SHALL be a structured JSON object specifying the action type, target element description, and any input values
4. WHEN GPT4o_Vision identifies interactive elements, THE Browser_Agent SHALL use element descriptions (text content, aria labels, position) to locate them on the page via Playwright selectors
5. IF GPT4o_Vision returns an unparseable response, THEN THE Browser_Agent SHALL request a corrected response once before reporting an error to the user

### Requirement 6: Real-Time Progress Reporting

**User Story:** As a user, I want to see what the browser agent is doing in real-time on my dashboard, so that I can monitor progress and understand what the agent found.

#### Acceptance Criteria

1. WHEN the Browser_Agent begins a task, THE Dashboard SHALL display a browser task panel showing the task description and a "Running" status indicator
2. WHEN the ReAct_Loop completes a Task_Step, THE Browser_Agent SHALL send a progress update to the Dashboard via IPC containing the step number, action performed, and a thumbnail of the current Page_Snapshot
3. WHEN the Browser_Agent completes a task, THE Dashboard SHALL display the final result (extracted information or confirmation of actions taken) in the browser task panel
4. THE Dashboard SHALL display the most recent Page_Snapshot as a thumbnail that the user can click to view at full size
5. WHEN the Browser_Agent encounters an error during execution, THE Dashboard SHALL display the error message with the step at which the failure occurred

### Requirement 7: Task Cancellation

**User Story:** As a user, I want to stop a running browser task at any time, so that I can cancel operations that are taking too long or going in the wrong direction.

#### Acceptance Criteria

1. WHILE a browser task is running, THE Dashboard SHALL display a "Cancel" button in the browser task panel
2. WHEN the user clicks the Cancel button, THE Browser_Agent SHALL abort the current ReAct_Loop iteration, stop all pending page actions, and report the task as cancelled
3. WHEN a task is cancelled, THE Browser_Agent SHALL retain both the browser instance and its current page state together for potential follow-up commands
4. THE Browser_Agent SHALL acknowledge cancellation within 2 seconds of the user request

### Requirement 8: Result Reporting and Notifications

**User Story:** As a user, I want the agent to clearly report what it found or accomplished during a browser task, so that I get actionable information without needing to look at the browser myself.

#### Acceptance Criteria

1. WHEN the Browser_Agent completes a task successfully, THE Browser_Agent SHALL send a toast notification to the Dashboard summarizing the result in one sentence
2. WHEN the Browser_Agent extracts information (e.g., a list of active stories), THE Browser_Agent SHALL format the extracted data as structured text and display it in the Dashboard browser task panel
3. IF the Browser_Agent completes a task but the result is ambiguous, THEN THE Browser_Agent SHALL present the extracted information along with a confidence note indicating uncertainty
4. WHEN the Browser_Agent fails to complete a task, THE Browser_Agent SHALL send an error toast notification with a brief explanation of what went wrong

### Requirement 9: Login and Authentication Handling

**User Story:** As a user, I want the agent to handle login pages gracefully, so that it can access authenticated content using my existing sessions or prompt me for credentials.

#### Acceptance Criteria

1. WHEN the Browser_Agent encounters a login page during task execution, THE Browser_Agent SHALL first check if existing session cookies allow automatic authentication
2. IF existing session cookies do not provide access, THEN THE Browser_Agent SHALL pause the task and notify the user via the Dashboard that manual login is required
3. WHEN the user completes manual login in the visible browser window, THE Browser_Agent SHALL detect the successful authentication and resume the paused task; IF the detection mechanism fails, THEN THE Browser_Agent SHALL keep the task paused until authentication is explicitly detected or the user intervenes
4. THE Browser_Agent SHALL persist authentication cookies in the user data directory so that subsequent tasks to the same site do not require re-authentication

### Requirement 10: Browser Visibility Mode

**User Story:** As a user, I want to choose whether the browser runs visibly or in the background, so that I can watch the agent work or let it run silently.

#### Acceptance Criteria

1. THE Browser_Agent SHALL support two visibility modes: "visible" (headed) and "background" (headless)
2. WHEN a task requires manual login, THE Browser_Agent SHALL immediately switch to visible mode regardless of the configured setting as soon as the login requirement is detected
3. THE Dashboard SHALL provide a toggle in the settings to configure the default browser visibility mode
4. WHEN the visibility mode is set to "visible", THE Browser_Agent SHALL launch the Chromium window in a non-fullscreen state at 1280x720 resolution
