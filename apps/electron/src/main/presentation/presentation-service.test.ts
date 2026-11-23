import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import type { AnswerPayload } from '../../shared/types';
import { AnthropicProvider } from '../llm/providers/anthropic-provider';
import { PowerPointBridge } from './powerpoint-bridge';
import {
  DeckData,
  KeyValueStore,
  LogData,
  PresentationService,
} from './presentation-service';

function memoryStore<T extends object>(initial: T): KeyValueStore<T> {
  const data = { ...initial };
  return {
    get: (k) => data[k],
    set: (k, v) => {
      data[k] = v;
    },
  };
}

async function tinyPptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', '<p:presentation><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>');
  zip.file('ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>');
  zip.file(
    'ppt/slides/slide1.xml',
    '<p:sld><p:sp><p:nvPr><p:ph type="title"/></p:nvPr><a:p><a:r><a:t>Transformers</a:t></a:r></a:p></p:sp></p:sld>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

function setup(opts: { answerMode?: 'speak' | 'private'; searchFails?: boolean } = {}) {
  const llm = {
    supportsNativeSearch: () => true,
    textComplete: vi.fn(async () => ({
      ok: true as const,
      text: '{"questions":[{"slide":1,"question":"What is attention?","answer":"PREPARED"}]}',
    })),
    webSearchComplete: vi.fn(async () =>
      opts.searchFails
        ? { ok: false as const, error: { kind: 'missing_key' as const, message: 'No API key' } }
        : { ok: true as const, text: 'LIVE', sources: [], searched: false },
    ),
  };
  const notifier = { onThinking: vi.fn(), onAnswer: vi.fn(), onPrepProgress: vi.fn() };
  const decks = memoryStore<DeckData>({ decks: [], activeDeckId: null });
  const log = memoryStore<LogData>({ entries: [] });
  const bridge = new PowerPointBridge(async () => '', 'linux');
  const pptx = tinyPptx();
  const service = new PresentationService({
    llm,
    decks,
    log,
    bridge,
    notifier,
    settings: () => ({ answerMode: opts.answerMode ?? 'speak', tavilyApiKey: '' }),
    readFile: async () => pptx,
  });
  return { service, llm, notifier, decks, log };
}

describe('PresentationService', () => {
  it('loads a deck, activates it and prepares questions', async () => {
    const { service, notifier } = setup();
    const deck = await service.loadDeckFromFile('/talks/AI.pptx', { prepare: false });
    expect(service.getActiveDeck()?.slides[0].title).toBe('Transformers');

    await service.prepareDeck(deck.id);
    const summary = service.listDecks()[0];
    expect(summary).toMatchObject({ name: 'AI.pptx', slideCount: 1, questionCount: 1, prepStatus: 'ready', active: true });
    expect(notifier.onPrepProgress).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' }));
  });

  it('replaces a deck when the same file is loaded again', async () => {
    const { service } = setup();
    const first = await service.loadDeckFromFile('/talks/AI.pptx', { prepare: false });
    const second = await service.loadDeckFromFile('/talks/AI.pptx', { prepare: false });
    expect(second.id).toBe(first.id);
    expect(service.listDecks()).toHaveLength(1);
  });

  it('refuses files that are not .pptx', async () => {
    const { service } = setup();
    await expect(service.loadDeckFromFile('/talks/old.ppt')).rejects.toThrow(/\.pptx/);
  });

  it('answers from prepared questions and speaks in speak mode', async () => {
    const { service, notifier } = setup();
    const deck = await service.loadDeckFromFile('/talks/AI.pptx', { prepare: false });
    await service.prepareDeck(deck.id);

    const a = (await service.ask('Flick, what is attention?')) as AnswerPayload;
    expect(a).toMatchObject({ question: 'What is attention?', answer: 'PREPARED', origin: 'prepared', speak: true });
    expect(notifier.onThinking).toHaveBeenCalledWith('What is attention?');
    expect(notifier.onAnswer).toHaveBeenCalledWith(a);
    expect(service.getLog()[0].id).toBe(a.id);
  });

  it('does not speak in private mode', async () => {
    const { service } = setup({ answerMode: 'private' });
    const a = await service.ask('What is a GPU?');
    expect(a).toMatchObject({ answer: 'LIVE', speak: false });
  });

  it('gives recent questions to the model so follow-ups make sense', async () => {
    const { service, llm } = setup();
    await service.ask('What is a GPU?');
    await service.ask('Can you explain that more simply?');
    const message = llm.webSearchComplete.mock.calls[1][1] as string;
    expect(message).toContain('<recent_questions>');
    expect(message).toContain('Q: What is a GPU?');
  });

  it('ignores silence and greets on a bare "Flick"', async () => {
    const { service, notifier } = setup();
    expect(await service.ask(' Thank you. ')).toBeNull();
    const greeting = await service.ask('Hey Flick');
    expect(greeting).toMatchObject({ origin: 'greeting', speak: false });
    expect(notifier.onThinking).not.toHaveBeenCalled();
  });

  it('shows a fixable error, and never speaks it', async () => {
    const { service } = setup({ searchFails: true });
    const a = await service.ask('What is a GPU?');
    expect(a).toMatchObject({ origin: 'error', speak: false });
    expect(a?.answer).toMatch(/API key/);
  });

  it('marks a preparation interrupted by an app restart as failed', () => {
    const decks = memoryStore<DeckData>({
      decks: [{ id: 'x', name: 'x', filePath: '/x.pptx', loadedAt: 0, slides: [], predicted: [], prepStatus: 'preparing' }],
      activeDeckId: 'x',
    });
    const service = new PresentationService({
      llm: setup().llm,
      decks,
      log: memoryStore<LogData>({ entries: [] }),
      bridge: new PowerPointBridge(async () => '', 'linux'),
      notifier: { onThinking: vi.fn(), onAnswer: vi.fn(), onPrepProgress: vi.fn() },
      settings: () => ({ answerMode: 'speak', tavilyApiKey: '' }),
    });
    expect(service.listDecks()[0].prepStatus).toBe('error');
  });
});

describe('PowerPointBridge', () => {
  it('returns nothing off Windows without running PowerShell', async () => {
    const run = vi.fn(async () => '5');
    const bridge = new PowerPointBridge(run, 'darwin');
    expect(await bridge.currentSlide()).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('reads and caches the current slide on Windows', async () => {
    let now = 0;
    const run = vi.fn(async () => '7\r\n');
    const bridge = new PowerPointBridge(run, 'win32', () => now);
    expect(await bridge.currentSlide()).toBe(7);
    now = 5_000;
    expect(await bridge.currentSlide()).toBe(7);
    expect(run).toHaveBeenCalledTimes(1);
    now = 30_000;
    await bridge.currentSlide();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('treats no output (PowerPoint closed) as no slide', async () => {
    const bridge = new PowerPointBridge(async () => '', 'win32');
    expect(await bridge.currentSlide()).toBeNull();
    expect(await bridge.activePresentationPath()).toBeNull();
  });
});

describe('AnthropicProvider.parseSearchResponse', () => {
  const provider = new AnthropicProvider();

  it('drops narration before the search and collects cited sources', () => {
    const result = provider.parseSearchResponse([
      { type: 'text', text: 'Let me look that up.', citations: null },
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } },
      {
        type: 'web_search_tool_result',
        tool_use_id: 's1',
        content: [{ type: 'web_search_result', url: 'https://a.com', title: 'A', encrypted_content: '', page_age: null }],
      },
      {
        type: 'text',
        text: 'Dropout was introduced in 2014.',
        citations: [
          { type: 'web_search_result_location', url: 'https://b.com', title: 'B', cited_text: 'x', encrypted_index: '' },
          { type: 'web_search_result_location', url: 'https://b.com', title: 'B', cited_text: 'y', encrypted_index: '' },
        ],
      },
    ] as never);
    expect(result).toEqual({
      ok: true,
      text: 'Dropout was introduced in 2014.',
      sources: [{ url: 'https://b.com', title: 'B' }],
      searched: true,
    });
  });

  it('falls back to search results when nothing is cited, and reports no search when none ran', () => {
    const searched = provider.parseSearchResponse([
      {
        type: 'web_search_tool_result',
        tool_use_id: 's1',
        content: [{ type: 'web_search_result', url: 'https://a.com', title: 'A', encrypted_content: '', page_age: null }],
      },
      { type: 'text', text: 'Answer.', citations: null },
    ] as never);
    expect(searched).toMatchObject({ searched: true, sources: [{ url: 'https://a.com', title: 'A' }] });

    const direct = provider.parseSearchResponse([{ type: 'text', text: 'From slides.', citations: null }] as never);
    expect(direct).toEqual({ ok: true, text: 'From slides.', sources: [], searched: false });
  });
});

describe('Explain this slide', () => {
  async function deckOf(slides: number) {
    const zip = new JSZip();
    zip.file(
      'ppt/presentation.xml',
      '<p:presentation><p:sldIdLst>' +
        Array.from({ length: slides }, (_, i) => `<p:sldId r:id="rId${i + 1}"/>`).join('') +
        '</p:sldIdLst></p:presentation>',
    );
    zip.file(
      'ppt/_rels/presentation.xml.rels',
      '<Relationships>' +
        Array.from({ length: slides }, (_, i) => `<Relationship Id="rId${i + 1}" Target="slides/slide${i + 1}.xml"/>`).join('') +
        '</Relationships>',
    );
    for (let i = 1; i <= slides; i++) {
      zip.file(
        `ppt/slides/slide${i}.xml`,
        `<p:sld><p:sp><p:nvPr><p:ph type="title"/></p:nvPr><a:p><a:r><a:t>Topic ${i}</a:t></a:r></a:p></p:sp></p:sld>`,
      );
    }
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  function setupExplain(opts: { onScreen?: string; platform?: NodeJS.Platform; answerMode?: 'speak' | 'private' } = {}) {
    const llm = {
      supportsNativeSearch: () => true,
      textComplete: vi.fn(async () => ({ ok: true as const, text: 'EXPLANATION' })),
      webSearchComplete: vi.fn(async () => ({ ok: true as const, text: 'ANSWER', sources: [], searched: false })),
    };
    const notifier = { onThinking: vi.fn(), onAnswer: vi.fn(), onPrepProgress: vi.fn() };
    const run = vi.fn(async () => opts.onScreen ?? '');
    const pptx = deckOf(5);
    const service = new PresentationService({
      llm,
      decks: memoryStore<DeckData>({ decks: [], activeDeckId: null }),
      log: memoryStore<LogData>({ entries: [] }),
      bridge: new PowerPointBridge(run, opts.platform ?? 'win32'),
      notifier,
      settings: () => ({ answerMode: opts.answerMode ?? 'private', tavilyApiKey: '' }),
      readFile: async () => pptx,
    });
    return { service, llm, notifier, run };
  }

  it('explains the slide on screen when asked by voice, and always speaks it', async () => {
    const { service, llm, notifier } = setupExplain({ onScreen: '3', answerMode: 'private' });
    await service.loadDeckFromFile('/talks/AI.pptx', { prepare: false });

    const a = await service.ask('Flick, explain this slide to the audience');
    expect(a).toMatchObject({ origin: 'explain', answer: 'EXPLANATION', currentSlide: 3, speak: true });
    expect(a?.question).toBe('Explain slide 3: Topic 3');
    expect(notifier.onThinking).toHaveBeenCalledWith('Explain slide 3: Topic 3');

    const [system, message] = llm.textComplete.mock.calls[0] as unknown as [string, string];
    expect(system).toMatch(/examples/);
    expect(message).toContain('<slide_to_explain>\nSlide 3: Topic 3');
    expect(message).toContain('previous slide 2: Topic 2');
    expect(message).toContain('next slide 4: Topic 4');
    expect(llm.webSearchComplete).not.toHaveBeenCalled();
  });

  it('reads the slide fresh, not from the cache', async () => {
    const { service, run } = setupExplain({ onScreen: '2' });
    await service.loadDeckFromFile('/talks/AI.pptx', { prepare: false });
    await service.explainSlide();
    await service.explainSlide();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('explains a numbered slide, and the next one', async () => {
    const { service } = setupExplain({ onScreen: '2' });
    await service.loadDeckFromFile('/talks/AI.pptx', { prepare: false });
    expect((await service.ask('explain slide 5'))?.currentSlide).toBe(5);
    expect((await service.ask('explain the next slide'))?.currentSlide).toBe(3);
  });

  it('says clearly when it cannot tell which slide, without speaking', async () => {
    const { service } = setupExplain({ onScreen: '' });
    await service.loadDeckFromFile('/talks/AI.pptx', { prepare: false });
    const a = await service.ask('explain this slide');
    expect(a).toMatchObject({ origin: 'error', speak: false });
    expect(a?.answer).toMatch(/slideshow|explain slide 5/);

    const mac = setupExplain({ platform: 'darwin' });
    await mac.service.loadDeckFromFile('/talks/AI.pptx', { prepare: false });
    expect((await mac.service.ask('explain this slide'))?.answer).toMatch(/Windows/);
  });

  it('refuses slides that do not exist, and needs a deck', async () => {
    const { service } = setupExplain();
    expect((await service.ask('explain slide 2'))?.answer).toMatch(/Load your presentation/);
    await service.loadDeckFromFile('/talks/AI.pptx', { prepare: false });
    expect((await service.ask('explain slide 9'))?.answer).toMatch(/has 5 slides/);
  });

  it('keeps explanations out of the follow-up context for questions', async () => {
    const { service, llm } = setupExplain({ onScreen: '1' });
    await service.loadDeckFromFile('/talks/AI.pptx', { prepare: false });
    await service.explainSlide();
    await service.ask('What is a GPU?');
    const message = llm.webSearchComplete.mock.calls[0][1] as string;
    expect(message).not.toContain('<recent_questions>');
  });
});
