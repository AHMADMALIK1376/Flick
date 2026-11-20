export enum IpcChannel {
  TRANSCRIBE = 'transcribe',
  TRANSCRIPTION_STATUS = 'transcription-status',
  TOGGLE_RECORDING = 'toggle-recording',
  GET_SETTINGS = 'get-settings',
  UPDATE_SETTINGS = 'update-settings',
  DOWNLOAD_MODEL = 'download-model',
  DOWNLOAD_PROGRESS = 'download-progress',
  WIDGET_POSITION_SAVE = 'widget-position-save',
  WIDGET_POSITION_LOAD = 'widget-position-load',
  ONBOARDING_COMPLETE = 'onboarding-complete',
  IS_ONBOARDING_DONE = 'is-onboarding-done',
  OPEN_SETTINGS = 'open-settings',
  SHOW_DASHBOARD = 'show-dashboard',
  QUIT_APP = 'quit-app',
  TOAST = 'toast',

  // ── Presentation ──
  /** Pick a .pptx with a file dialog and load it as the active deck. */
  DECK_UPLOAD = 'deck-upload',
  /** Load the presentation currently open in PowerPoint (Windows). */
  DECK_LOAD_FROM_POWERPOINT = 'deck-load-from-powerpoint',
  DECK_LIST = 'deck-list',
  DECK_GET = 'deck-get',
  DECK_ACTIVATE = 'deck-activate',
  DECK_DELETE = 'deck-delete',
  /** Re-run question prediction for a deck. */
  DECK_PREPARE = 'deck-prepare',
  DECK_PREP_PROGRESS = 'deck-prep-progress',
  /** A question, typed or spoken. Returns the answer. */
  ASK = 'ask',
  /** Main → renderers: a new answer is ready (dashboard log + answer card). */
  ANSWER = 'answer',
  /** Main → answer card: Flick is working on a question. */
  THINKING = 'thinking',
  QA_LOG_GET = 'qa-log-get',
  QA_LOG_CLEAR = 'qa-log-clear',
  /** Read text aloud from the widget. */
  SPEAK = 'speak',
  STOP_SPEAKING = 'stop-speaking',
  ANSWER_CARD_HIDE = 'answer-card-hide',
  OPEN_EXTERNAL = 'open-external',
}
