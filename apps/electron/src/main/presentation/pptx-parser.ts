import JSZip from 'jszip';
import * as path from 'path';
import type { Slide } from '../../shared/types';

/**
 * Reads the text of a PowerPoint (.pptx) file: each slide's title, body and
 * speaker notes, in presentation order.
 *
 * A .pptx is a zip of XML parts. Slide order lives in ppt/presentation.xml
 * (the <p:sldIdLst>), which points through ppt/_rels/presentation.xml.rels to
 * the slide parts — the file names (slide1.xml, slide2.xml…) do NOT reliably
 * match display order once slides have been reordered, so they are not used
 * for ordering. Each slide's notes page is found through the slide's own rels.
 *
 * Text is pulled with targeted regexes rather than a full XML parser: only
 * <a:t> runs inside <a:p> paragraphs are needed, and DrawingML text never
 * nests those elements.
 */

export class PptxParseError extends Error {}

/** Placeholder types PowerPoint uses for a slide's title. */
const TITLE_PLACEHOLDERS = new Set(['title', 'ctrTitle']);

/** Placeholders on a notes page that are not the notes themselves. */
const NOTES_NOISE_PLACEHOLDERS = new Set(['sldNum', 'sldImg', 'hdr', 'ftr', 'dt']);

export async function parsePptx(data: Buffer | Uint8Array): Promise<Slide[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new PptxParseError('This file is not a valid .pptx (it could not be opened as a zip).');
  }

  const presentation = await readPart(zip, 'ppt/presentation.xml');
  const presRels = await readPart(zip, 'ppt/_rels/presentation.xml.rels');
  if (!presentation || !presRels) {
    throw new PptxParseError('This file is not a PowerPoint presentation (ppt/presentation.xml is missing).');
  }

  const relTargets = parseRels(presRels, 'ppt');
  const slidePaths = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
    .map((m) => relTargets.get(m[1]))
    .filter((p): p is string => !!p);

  const slides: Slide[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const slidePath = slidePaths[i];
    const xml = await readPart(zip, slidePath);
    if (!xml) continue;

    const { title, body } = extractSlideText(xml);
    const notes = await readNotes(zip, slidePath);
    slides.push({ number: i + 1, title, body, notes });
  }

  if (slides.length === 0) {
    throw new PptxParseError('No slides were found in this presentation.');
  }
  return slides;
}

/** Title and body text of one slide's XML. */
export function extractSlideText(xml: string): { title: string; body: string } {
  const titleLines: string[] = [];
  const bodyLines: string[] = [];

  for (const shape of shapes(xml)) {
    const type = placeholderType(shape);
    const lines = paragraphs(shape);
    if (lines.length === 0) continue;
    if (type && TITLE_PLACEHOLDERS.has(type)) titleLines.push(...lines);
    else bodyLines.push(...lines);
  }

  // Slides without a title placeholder: treat the first line as the title so
  // every slide has something to refer to it by.
  if (titleLines.length === 0 && bodyLines.length > 0) {
    titleLines.push(bodyLines.shift()!);
  }

  return { title: titleLines.join(' ').trim(), body: bodyLines.join('\n').trim() };
}

/** Speaker notes text of a notes-slide XML, without slide number/image placeholders. */
export function extractNotesText(xml: string): string {
  const lines: string[] = [];
  for (const shape of shapes(xml)) {
    const type = placeholderType(shape);
    if (type && NOTES_NOISE_PLACEHOLDERS.has(type)) continue;
    lines.push(...paragraphs(shape));
  }
  return lines.join('\n').trim();
}

// ── Internals ──────────────────────────────────────────────────────────────

async function readNotes(zip: JSZip, slidePath: string): Promise<string> {
  const relsPath = path.posix.join(
    path.posix.dirname(slidePath),
    '_rels',
    `${path.posix.basename(slidePath)}.rels`,
  );
  const rels = await readPart(zip, relsPath);
  if (!rels) return '';

  const notesRel = [...rels.matchAll(/<Relationship\b[^>]*>/g)]
    .map((m) => m[0])
    .find((tag) => /Type="[^"]*\/notesSlide"/.test(tag));
  const target = notesRel?.match(/Target="([^"]+)"/)?.[1];
  if (!target) return '';

  const notesXml = await readPart(zip, resolveTarget(path.posix.dirname(slidePath), target));
  return notesXml ? extractNotesText(notesXml) : '';
}

/** Map of relationship id → absolute part path inside the zip. */
function parseRels(xml: string, baseDir: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = m[0];
    const id = tag.match(/\bId="([^"]+)"/)?.[1];
    const target = tag.match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) map.set(id, resolveTarget(baseDir, target));
  }
  return map;
}

function resolveTarget(baseDir: string, target: string): string {
  // Targets are relative to the source part's folder, or absolute from the zip root.
  return target.startsWith('/')
    ? target.slice(1)
    : path.posix.normalize(path.posix.join(baseDir, target));
}

async function readPart(zip: JSZip, partPath: string): Promise<string | null> {
  const file = zip.file(partPath);
  return file ? file.async('string') : null;
}

/**
 * Every text-bearing shape in document order: ordinary shapes (<p:sp>, also
 * inside groups) and graphic frames, which is where tables keep their text.
 */
function shapes(xml: string): string[] {
  return [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>|<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g)].map(
    (m) => m[0],
  );
}

function placeholderType(shapeXml: string): string | null {
  const ph = shapeXml.match(/<p:ph\b[^>]*>/)?.[0];
  if (!ph) return null;
  // A placeholder with no type attribute is a body placeholder.
  return ph.match(/\btype="([^"]+)"/)?.[1] ?? 'body';
}

/** Non-empty paragraphs of a shape, each the concatenation of its text runs. */
function paragraphs(shapeXml: string): string[] {
  const out: string[] = [];
  for (const p of shapeXml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
    const text = [...p[1].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
      .map((t) => decodeXml(t[1]))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) out.push(text);
  }
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
