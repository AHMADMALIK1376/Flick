// Sample drawings: for previews (#/canvas?demo=1, #/canvas?demo=2) and tests.
import type { Drawing } from '../../api/types';

export const SAMPLE_DIAGRAM: Drawing = {
  title: 'How row level security works',
  elements: [
    { id: 'sara', type: 'emoji', step: 1, x: 130, y: 250, char: '👩‍🎓', size: 86, label: 'Sara' },
    { id: 'ali', type: 'emoji', step: 1, x: 130, y: 450, char: '👨‍🎓', size: 86, label: 'Ali' },
    { id: 'db', type: 'box', step: 2, x: 390, y: 290, w: 220, h: 120, label: 'Marks table', emoji: '🗄️', color: 'plum' },
    { id: 'rule', type: 'circle', step: 3, x: 500, y: 140, r: 62, label: 'Policy', emoji: '🛡️', color: 'amber' },
    { id: 'saraRows', type: 'box', step: 4, x: 740, y: 190, w: 200, h: 90, label: "Sara's rows", emoji: '', color: 'aqua' },
    { id: 'aliRows', type: 'box', step: 4, x: 740, y: 400, w: 200, h: 90, label: "Ali's rows", emoji: '', color: 'green' },
    { type: 'arrow', step: 2, from: 'sara', to: 'db', label: 'my marks?', dashed: false },
    { type: 'arrow', step: 2, from: 'ali', to: 'db', label: 'my marks?', dashed: false },
    { type: 'arrow', step: 3, from: 'rule', to: 'db', label: 'checks user', dashed: true },
    { type: 'arrow', step: 4, from: 'db', to: 'saraRows', label: '', dashed: false },
    { type: 'arrow', step: 4, from: 'db', to: 'aliRows', label: '', dashed: false },
    { id: 'note', type: 'text', step: 4, x: 500, y: 560, text: 'Same query, different rows!', size: 30, color: 'rose' },
  ],
  steps: [
    { say: 'Here are Sara and Ali, two students.' },
    { say: 'Both ask the same marks table for their marks.' },
    { say: 'A policy checks who is asking.' },
    { say: 'So each one gets only their own rows. Same query, different answers.' },
  ],
};

export const SAMPLE_STORY: Drawing = {
  title: 'Ali at the chai dhaba: caching',
  elements: [
    { id: 'ali', type: 'emoji', step: 1, x: 140, y: 300, char: '🧑', size: 90, label: 'Ali' },
    { id: 'chai', type: 'box', step: 2, x: 380, y: 250, w: 230, h: 110, label: 'Chacha ki dukaan', emoji: '☕', color: 'amber' },
    { id: 'tea', type: 'circle', step: 3, x: 820, y: 170, r: 64, label: 'Ready cups', emoji: '🫖', color: 'aqua' },
    { id: 'fresh', type: 'circle', step: 3, x: 820, y: 430, r: 64, label: 'Fresh brew', emoji: '🔥', color: 'rose' },
    { type: 'arrow', step: 2, from: 'ali', to: 'chai', label: 'one chai!', dashed: false },
    { type: 'arrow', step: 3, from: 'chai', to: 'tea', label: '10 seconds', dashed: false },
    { type: 'arrow', step: 3, from: 'chai', to: 'fresh', label: '5 minutes', dashed: true },
    { id: 'idea', type: 'text', step: 4, x: 500, y: 555, text: 'Cache = chai kept ready', size: 30, color: 'plum' },
  ],
  steps: [
    { say: 'Ali is late for class and wants chai.' },
    { say: 'He runs to the dhaba and asks for one cup.' },
    { say: 'Chacha already has cups ready, so Ali gets it in seconds instead of waiting five minutes.' },
    { say: 'That is a cache: keep what people ask for often ready, so it comes fast.' },
  ],
};
