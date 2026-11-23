import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  AnswerPayload,
  Deck,
  DeckSummary,
  PrepProgress,
} from '../../shared/types';
import { AnswerEngine, AnswerError, AnswerLLM, WebSearchFn, explainSlide } from './answer-engine';
import { PowerPointBridge } from './powerpoint-bridge';
import { parsePptx } from './pptx-parser';
import { PrepLLM, predictQuestions } from './qa-predictor';
import { cleanQuestion, isBareAddress, isNothingHeard } from './question-text';
import { SlideTarget, parseSlideCommand } from './slide-command';
import { tavilySearch } from './web-search';

/** Minimal key-value persistence — electron-store satisfies it. */
export interface KeyValueStore<T> {
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
}

export interface DeckData {
  decks: Deck[];
  activeDeckId: string | null;
}

export interface LogData {
  entries: AnswerPayload[];
}

export interface PresentationNotifier {
  /** A question arrived and is being answered. */
  onThinking(question: string): void;
  onAnswer(answer: AnswerPayload): void;
  onPrepProgress(progress: PrepProgress): void;
}

export interface PresentationSettings {
  answerMode: 'speak' | 'private';
  tavilyApiKey: string;
}

export interface PresentationDeps {
  llm: AnswerLLM & PrepLLM;
  decks: KeyValueStore<DeckData>;
  log: KeyValueStore<LogData>;
  bridge: PowerPointBridge;
  notifier: PresentationNotifier;
  settings: () => PresentationSettings;
  readFile?: (filePath: string) => Promise<Buffer>;
}

/** Answers kept for review after the talk. */
const MAX_LOG_ENTRIES = 300;
/** Earlier questions given to the model so follow-ups make sense. */
const RECENT_FOR_CONTEXT = 3;
/** Older questions are a different conversation, not context. */
const RECENT_WINDOW_MS = 10 * 60_000;

/**
 * Everything Flick does as a presentation assistant: loading decks, preparing
 * likely questions, and answering live questions.
 */
export class PresentationService {
  private readonly engine: AnswerEngine;
  private readonly preparing = new Set<string>();
  private readonly readFile: (filePath: string) => Promise<Buffer>;

  constructor(private readonly deps: PresentationDeps) {
    this.readFile = deps.readFile ?? ((p) => fs.promises.readFile(p));
    this.engine = new AnswerEngine(deps.llm, () => this.webSearchFn());

    // A prep that was running when the app closed will never finish.
    const decks = this.decks();
    if (decks.some((d) => d.prepStatus === 'preparing')) {
      this.saveDecks(
        decks.map((d) =>
          d.prepStatus === 'preparing'
            ? { ...d, prepStatus: 'error', prepError: 'Preparation was interrupted. Press Prepare to run it again.' }
            : d,
        ),
      );
    }
  }

  // ── Decks ────────────────────────────────────────────────────────────────

  listDecks(): DeckSummary[] {
    const activeId = this.deps.decks.get('activeDeckId');
    return this.decks()
      .map((d) => ({
        id: d.id,
        name: d.name,
        loadedAt: d.loadedAt,
        slideCount: d.slides.length,
        questionCount: d.predicted.length,
        prepStatus: d.prepStatus,
        prepError: d.prepError,
        active: d.id === activeId,
      }))
      .sort((a, b) => b.loadedAt - a.loadedAt);
  }

  getDeck(id: string): Deck | null {
    return this.decks().find((d) => d.id === id) ?? null;
  }

  getActiveDeck(): Deck | null {
    const id = this.deps.decks.get('activeDeckId');
    return id ? this.getDeck(id) : null;
  }

  activateDeck(id: string): void {
    if (this.getDeck(id)) this.deps.decks.set('activeDeckId', id);
  }

  deleteDeck(id: string): void {
    this.saveDecks(this.decks().filter((d) => d.id !== id));
    if (this.deps.decks.get('activeDeckId') === id) {
      this.deps.decks.set('activeDeckId', this.listDecks()[0]?.id ?? null);
    }
  }

  /**
   * Reads a .pptx, makes it the active deck and starts preparing questions in
   * the background. Loading the same file again (after editing the slides)
   * replaces the old copy.
   */
  async loadDeckFromFile(filePath: string, opts: { prepare?: boolean } = {}): Promise<Deck> {
    if (path.extname(filePath).toLowerCase() !== '.pptx') {
      throw new Error('Flick reads PowerPoint .pptx files. Save older .ppt files as .pptx first.');
    }
    const slides = await parsePptx(await this.readFile(filePath));
    const existing = this.decks().find((d) => d.filePath === filePath);

    const deck: Deck = {
      id: existing?.id ?? uuidv4(),
      name: path.basename(filePath),
      filePath,
      loadedAt: Date.now(),
      slides,
      predicted: [],
      prepStatus: 'idle',
    };
    this.saveDecks([...this.decks().filter((d) => d.id !== deck.id), deck]);
    this.deps.decks.set('activeDeckId', deck.id);

    if (opts.prepare !== false) void this.prepareDeck(deck.id);
    return deck;
  }

  /** Loads whatever presentation is open in PowerPoint right now. */
  async loadDeckFromPowerPoint(): Promise<Deck> {
    if (!this.deps.bridge.supported) {
      throw new Error('Reading the open presentation works with PowerPoint on Windows. Use Upload instead.');
    }
    const filePath = await this.deps.bridge.activePresentationPath();
    if (!filePath) {
      throw new Error('No open presentation found. Open your deck in PowerPoint first, or use Upload.');
    }
    if (!path.isAbsolute(filePath)) {
      throw new Error('This presentation has not been saved to disk yet (or lives only in OneDrive). Save it locally, then try again.');
    }
    return this.loadDeckFromFile(filePath);
  }

  /** Predicts likely audience questions for a deck. Safe to call repeatedly. */
  async prepareDeck(id: string): Promise<void> {
    const deck = this.getDeck(id);
    if (!deck || this.preparing.has(id)) return;
    this.preparing.add(id);

    const progress = (p: Omit<PrepProgress, 'deckId'>) =>
      this.deps.notifier.onPrepProgress({ deckId: id, ...p });

    try {
      this.updateDeck(id, { prepStatus: 'preparing', prepError: undefined });
      progress({ status: 'preparing', done: 0, total: 1, message: 'Predicting audience questions…' });

      const outcome = await predictQuestions(this.deps.llm, deck.name, deck.slides, (done, total) =>
        progress({ status: 'preparing', done, total }),
      );

      if (outcome.error) {
        this.updateDeck(id, { prepStatus: 'error', prepError: outcome.error });
        progress({ status: 'error', done: 0, total: 0, message: outcome.error });
        return;
      }
      this.updateDeck(id, { prepStatus: 'ready', predicted: outcome.questions });
      progress({
        status: 'ready',
        done: 1,
        total: 1,
        message: `${outcome.questions.length} questions prepared.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.updateDeck(id, { prepStatus: 'error', prepError: message });
      progress({ status: 'error', done: 0, total: 0, message });
    } finally {
      this.preparing.delete(id);
    }
  }

  // ── Live questions ───────────────────────────────────────────────────────

  /** Call when the presenter starts speaking, to look up the slide early. */
  questionStarting(): void {
    this.deps.bridge.prefetchCurrentSlide();
  }

  /**
   * Answers a spoken or typed question. Returns null when there was nothing
   * to answer (silence, or a Whisper artefact).
   */
  async ask(raw: string): Promise<AnswerPayload | null> {
    if (isNothingHeard(raw)) return null;

    const started = Date.now();
    const base = {
      id: uuidv4(),
      timestamp: started,
      sources: [],
      currentSlide: null,
    };

    if (isBareAddress(raw)) {
      const payload: AnswerPayload = {
        ...base,
        question: raw.trim(),
        answer: "I'm here. Press the hotkey and ask the question.",
        origin: 'greeting',
        durationMs: 0,
        speak: false,
      };
      this.deps.notifier.onAnswer(payload);
      return payload;
    }

    const question = cleanQuestion(raw);

    // "Flick, explain this slide" is a request to present, not a question.
    const command = parseSlideCommand(question);
    if (command) return this.explainSlide(command, question);

    this.deps.notifier.onThinking(question);

    const deck = this.getActiveDeck();
    const currentSlide = deck ? await this.deps.bridge.currentSlide() : null;

    let payload: AnswerPayload;
    try {
      const result = await this.engine.answer({
        question,
        deck,
        currentSlide,
        recent: this.recentExchanges(),
      });
      payload = {
        ...base,
        question,
        answer: result.answer,
        origin: result.origin,
        sources: result.sources,
        currentSlide,
        durationMs: Date.now() - started,
        speak: this.deps.settings().answerMode === 'speak',
      };
    } catch (err) {
      payload = {
        ...base,
        question,
        answer: friendlyError(err),
        origin: 'error',
        currentSlide,
        durationMs: Date.now() - started,
        // Never read an error message aloud to the audience.
        speak: false,
      };
    }

    this.appendLog(payload);
    this.deps.notifier.onAnswer(payload);
    return payload;
  }

  /**
   * Explains a slide to the audience, with examples, and always speaks it:
   * the presenter asked Flick to talk to the room, whatever the answer mode.
   */
  async explainSlide(
    target: SlideTarget = { kind: 'current' },
    request = 'Explain this slide to the audience.',
  ): Promise<AnswerPayload> {
    const started = Date.now();
    const deck = this.getActiveDeck();
    const base = { id: uuidv4(), timestamp: started, sources: [], origin: 'explain' as const };
    const fail = (message: string, slide: number | null, label = request): AnswerPayload => {
      const payload: AnswerPayload = {
        ...base,
        question: label,
        answer: message,
        origin: 'error',
        currentSlide: slide,
        durationMs: Date.now() - started,
        speak: false,
      };
      this.appendLog(payload);
      this.deps.notifier.onAnswer(payload);
      return payload;
    };

    if (!deck) {
      return fail('Load your presentation first, so I know what is on the slides.', null);
    }

    let slideNumber: number | null;
    if (target.kind === 'number') {
      slideNumber = target.number;
    } else {
      const onScreen = await this.deps.bridge.currentSlide({ fresh: true });
      slideNumber = onScreen === null ? null : onScreen + (target.kind === 'relative' ? target.offset : 0);
    }
    if (slideNumber === null) {
      return fail(
        this.deps.bridge.supported
          ? "I can't see which slide is on screen. Start the slideshow in PowerPoint, or say \"explain slide 5\"."
          : 'I can only see the current slide in PowerPoint on Windows. Say "explain slide 5" instead.',
        null,
      );
    }

    const slide = deck.slides.find((s) => s.number === slideNumber);
    const label = slide ? `Explain slide ${slideNumber}: ${slide.title || 'untitled'}` : `Explain slide ${slideNumber}`;
    if (!slide) {
      return fail(`This presentation has ${deck.slides.length} slides, so there is no slide ${slideNumber}.`, slideNumber, label);
    }

    this.deps.notifier.onThinking(label);
    let payload: AnswerPayload;
    try {
      const text = await explainSlide(this.deps.llm, { deck, slideNumber, request });
      payload = {
        ...base,
        question: label,
        answer: text,
        currentSlide: slideNumber,
        durationMs: Date.now() - started,
        speak: true,
      };
    } catch (err) {
      return fail(friendlyError(err), slideNumber, label);
    }

    this.appendLog(payload);
    this.deps.notifier.onAnswer(payload);
    return payload;
  }

  getLog(): AnswerPayload[] {
    return [...this.deps.log.get('entries')].reverse();
  }

  clearLog(): void {
    this.deps.log.set('entries', []);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private webSearchFn(): WebSearchFn {
    const key = this.deps.settings().tavilyApiKey.trim();
    return key ? (query) => tavilySearch(key, query) : null;
  }

  private recentExchanges() {
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    return this.deps.log
      .get('entries')
      .filter((e) => e.timestamp >= cutoff && !['error', 'greeting', 'explain'].includes(e.origin))
      .slice(-RECENT_FOR_CONTEXT)
      .map((e) => ({ question: e.question, answer: e.answer }));
  }

  private appendLog(entry: AnswerPayload): void {
    const entries = [...this.deps.log.get('entries'), entry];
    this.deps.log.set('entries', entries.slice(-MAX_LOG_ENTRIES));
  }

  private decks(): Deck[] {
    return this.deps.decks.get('decks') ?? [];
  }

  private saveDecks(decks: Deck[]): void {
    this.deps.decks.set('decks', decks);
  }

  private updateDeck(id: string, patch: Partial<Deck>): void {
    this.saveDecks(this.decks().map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }
}

/** Turns a model/API failure into something the presenter can act on. */
export function friendlyError(err: unknown): string {
  const kind = err instanceof AnswerError ? err.kind : '';
  const message = err instanceof Error ? err.message : String(err);
  switch (kind) {
    case 'missing_key':
      return "I can't answer yet: add an API key for your AI provider in Flick's Settings.";
    case 'invalid_key':
      return 'Your API key was rejected. Check it in Settings.';
    case 'network':
      return "I couldn't reach the AI service. Check the internet connection.";
    case 'timeout':
      return message.includes('budget')
        ? 'The spending limit for this session was reached. Restart Flick to reset it.'
        : 'That took too long to answer. Try asking again.';
    default:
      return `Something went wrong: ${message}`;
  }
}
