import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { PptxParseError, extractNotesText, extractSlideText, parsePptx } from './pptx-parser';

const NS = 'xmlns:a="a" xmlns:p="p" xmlns:r="r"';

function shape(text: string[], placeholder?: string): string {
  const ph = placeholder === undefined ? '' : placeholder === 'body' ? '<p:ph idx="1"/>' : `<p:ph type="${placeholder}"/>`;
  const paras = text.map((t) => `<a:p><a:pPr lvl="0"/><a:r><a:rPr/><a:t>${t}</a:t></a:r></a:p>`).join('');
  return `<p:sp><p:nvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paras}</p:txBody></p:sp>`;
}

function slideXml(...shapes: string[]): string {
  return `<?xml version="1.0"?><p:sld ${NS}><p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld></p:sld>`;
}

/**
 * Builds a minimal .pptx. Slide files are deliberately numbered against
 * display order, the way they end up after reordering slides in PowerPoint.
 */
async function buildPptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<Relationships>
      <Relationship Id="rId1" Type="http://x/slideMaster" Target="slideMasters/slideMaster1.xml"/>
      <Relationship Id="rId2" Type="http://x/slide" Target="slides/slide1.xml"/>
      <Relationship Id="rId3" Type="http://x/slide" Target="slides/slide2.xml"/>
    </Relationships>`,
  );
  // Displayed first.
  zip.file(
    'ppt/slides/slide2.xml',
    slideXml(shape(['Neural Networks'], 'ctrTitle'), shape(['An introduction'], 'subTitle')),
  );
  // Displayed second, with notes and an escaped character.
  zip.file(
    'ppt/slides/slide1.xml',
    slideXml(shape(['Backpropagation'], 'title'), shape(['Chain rule', 'Gradients &amp; weights'], 'body')),
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<Relationships><Relationship Id="rId2" Type="http://x/notesSlide" Target="../notesSlides/notesSlide7.xml"/></Relationships>`,
  );
  zip.file(
    'ppt/notesSlides/notesSlide7.xml',
    slideXml(shape([], 'sldImg'), shape(['Explain with a worked example.'], 'body'), shape(['2'], 'sldNum')),
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('parsePptx', () => {
  it('reads slides in presentation order, not file-name order', async () => {
    const slides = await parsePptx(await buildPptx());
    expect(slides.map((s) => s.title)).toEqual(['Neural Networks', 'Backpropagation']);
    expect(slides.map((s) => s.number)).toEqual([1, 2]);
  });

  it('separates title, body and speaker notes', async () => {
    const [, backprop] = await parsePptx(await buildPptx());
    expect(backprop.body).toBe('Chain rule\nGradients & weights');
    expect(backprop.notes).toBe('Explain with a worked example.');
  });

  it('rejects a file that is not a zip', async () => {
    await expect(parsePptx(Buffer.from('not a pptx'))).rejects.toBeInstanceOf(PptxParseError);
  });

  it('rejects a zip that is not a presentation', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w/>');
    await expect(parsePptx(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(/not a PowerPoint/);
  });
});

describe('extractSlideText', () => {
  it('uses the first line as the title when there is no title placeholder', () => {
    const r = extractSlideText(slideXml(shape(['Key idea', 'Detail one'])));
    expect(r).toEqual({ title: 'Key idea', body: 'Detail one' });
  });

  it('joins text runs inside one paragraph', () => {
    const xml = slideXml(
      '<p:sp><p:txBody><a:p><a:r><a:t>Deep </a:t></a:r><a:r><a:t>learning</a:t></a:r></a:p></p:txBody></p:sp>',
    );
    expect(extractSlideText(xml).title).toBe('Deep learning');
  });

  it('reads table text from graphic frames', () => {
    const xml = slideXml(
      shape(['Results'], 'title'),
      '<p:graphicFrame><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Accuracy 94%</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></p:graphicFrame>',
    );
    expect(extractSlideText(xml).body).toBe('Accuracy 94%');
  });
});

describe('extractNotesText', () => {
  it('drops slide-number and slide-image placeholders', () => {
    const xml = slideXml(shape(['3'], 'sldNum'), shape(['Mention the 2019 paper.'], 'body'));
    expect(extractNotesText(xml)).toBe('Mention the 2019 paper.');
  });
});
