import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveModelId, WhisperService } from './whisper-service';

const REQUIRED_FILES = [
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
  'tokenizer.json',
  'tokenizer_config.json',
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
];

/** Creates the full file set that marks a model as downloaded. */
function fakeDownload(cacheDir: string, modelId: string): void {
  const modelDir = path.join(cacheDir, ...modelId.split('/'));
  for (const rel of REQUIRED_FILES) {
    const file = path.join(modelDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
  }
}

describe('resolveModelId', () => {
  it('expands a short name', () => {
    expect(resolveModelId('small')).toBe('Xenova/whisper-small');
  });

  it('passes a full id through unchanged', () => {
    expect(resolveModelId('Xenova/whisper-medium')).toBe('Xenova/whisper-medium');
  });

  it('falls back to the default for undefined', () => {
    expect(resolveModelId(undefined)).toBe('Xenova/whisper-medium');
  });

  it('falls back to the default for an empty string', () => {
    expect(resolveModelId('')).toBe('Xenova/whisper-medium');
  });

  it('never produces an English-only checkpoint from a bare name', () => {
    // .en checkpoints cannot transcribe Urdu at all.
    expect(resolveModelId('medium')).not.toMatch(/\.en$/);
  });
});

describe('WhisperService model discovery', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flick-whisper-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('reports a fully downloaded model as ready', () => {
    fakeDownload(cacheDir, 'Xenova/whisper-small');

    expect(WhisperService.isModelReady(cacheDir, 'Xenova/whisper-small')).toBe(true);
  });

  it('reports a partially downloaded model as not ready', () => {
    const modelDir = path.join(cacheDir, 'Xenova', 'whisper-small');
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, 'config.json'), 'x');

    expect(WhisperService.isModelReady(cacheDir, 'Xenova/whisper-small')).toBe(false);
  });

  it('finds a downloaded model when a different one was requested', () => {
    fakeDownload(cacheDir, 'Xenova/whisper-medium');

    expect(WhisperService.findDownloadedModel(cacheDir)).toBe('Xenova/whisper-medium');
  });

  it('prefers the most capable downloaded model', () => {
    fakeDownload(cacheDir, 'Xenova/whisper-tiny');
    fakeDownload(cacheDir, 'Xenova/whisper-medium');

    expect(WhisperService.findDownloadedModel(cacheDir)).toBe('Xenova/whisper-medium');
  });

  it('returns undefined when nothing is downloaded', () => {
    expect(WhisperService.findDownloadedModel(cacheDir)).toBeUndefined();
  });
});
