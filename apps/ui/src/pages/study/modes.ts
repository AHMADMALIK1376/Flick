import { IconBook, IconBriefcase, IconPencil, IconTarget, type Icon } from '@tabler/icons-react';

// The four ways Flick can explain a deck to a student.
export interface StudyMode {
  id: 'story' | 'professional' | 'exam' | 'visual';
  icon: Icon;
  name: string;
  tagline: string;
  text: string;
}

export const STUDY_MODES: StudyMode[] = [
  {
    id: 'story',
    icon: IconBook,
    name: 'Story mode',
    tagline: 'Learn it like a story',
    text: 'One continuing story with everyday characters (Ali, Sara, the chai dhaba…). Each slide is the next scene.',
  },
  {
    id: 'professional',
    icon: IconBriefcase,
    name: 'Professional mode',
    tagline: 'Precise, with real examples',
    text: 'Clear and concise, with the right technical terms and a real industry example for each idea.',
  },
  {
    id: 'exam',
    icon: IconTarget,
    name: 'Exam mode',
    tagline: 'Only what gets marks',
    text: 'Key points, definitions, a memory trick, and a likely exam question with a short model answer per slide.',
  },
  {
    id: 'visual',
    icon: IconPencil,
    name: 'Visual mode',
    tagline: 'Every idea, drawn',
    text: 'Each slide is explained with a real-life example that Flick draws step by step on a full-screen whiteboard.',
  },
];

export const QUICK_ASKS = [
  { label: 'Draw this', ask: 'Flick, draw this for me' },
  { label: 'Give an example', ask: 'Give me a real life example' },
  { icon: IconBook, label: 'Tell it as a story', ask: 'Explain this with a story' },
  { label: 'Simpler, please', ask: 'Explain it more simply' },
];
