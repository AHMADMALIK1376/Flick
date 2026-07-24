import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { TranscriptionResult } from '../shared/types';

let transcriber: any = null;
let loading = false;

/** Model id currently held in `transcriber`, so a model switch can reload it. */
let loadedModelId: string | null = null;

/** Default model ID used by the application */
const DEFAULT_MODEL_ID = 'Xenova/whisper-medium';

/**
 * Expands a short model name from settings ("small") into a full Hugging Face
 * id ("Xenova/whisper-small"). Ids that already contain a slash pass through.
 */
export function resolveModelId(name?: string | null): string {
  if (!name) return DEFAULT_MODEL_ID;
  return name.includes('/') ? name : `Xenova/whisper-${name}`;
}

export type TranscribeLanguage = 'en' | 'ur' | 'auto';

/**
 * Coerces the persisted language setting into a value Whisper accepts.
 *
 * Defaults to English rather than auto-detect. Auto-detect drifts badly on
 * South Asian accents — it transcribes English speech into Hindi or Telugu,
 * which downstream detection cannot recover from. Forcing English also happens
 * to be right for code-switched Roman Urdu ("chrome open karo"), since it keeps
 * the output in Latin script where the Roman Urdu matcher can read it.
 */
export function resolveLanguage(value?: string | null): TranscribeLanguage {
  return value === 'ur' || value === 'auto' ? value : 'en';
}

/**
 * Every model the app can load, largest first.
 *
 * Order matters: fallback prefers the most capable model already on disk,
 * since a bigger model is the better answer for Urdu.
 */
const KNOWN_MODEL_IDS = [
  'Xenova/whisper-medium',
  'Xenova/whisper-small',
  'Xenova/whisper-base',
  'Xenova/whisper-tiny',
];

/** Required files for a Whisper ONNX model variant */
const WHISPER_REQUIRED_FILES = [
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
  'tokenizer.json',
  'tokenizer_config.json',
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
];

export interface ProgressData {
  status: string;
  progress?: number;
  file?: string;
}

export class WhisperService {
  private initialized = false;

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Returns the most capable model already present in the cache, or undefined
   * if none are.
   *
   * Selecting a model in Settings does not download it, so the chosen model can
   * legitimately be absent. Falling back beats refusing to transcribe.
   */
  static findDownloadedModel(cacheDir: string): string | undefined {
    return KNOWN_MODEL_IDS.find((id) =>
      WhisperService.isModelReady(cacheDir, id)
    );
  }

  /**
   * Check if all required ONNX model files exist in the cache directory.
   * Uses `--` separator matching @xenova/transformers cache convention.
   */
  static isModelReady(cacheDir: string, modelId: string = DEFAULT_MODEL_ID): boolean {
    const modelDir = path.join(cacheDir, ...modelId.split('/'));
    if (!fs.existsSync(modelDir)) return false;
    return WHISPER_REQUIRED_FILES.every((name) =>
      fs.existsSync(path.join(modelDir, name))
    );
  }

  async initialize(options?: {
    cacheDir?: string;
    modelId?: string;
    onProgress?: (data: ProgressData) => void;
  }): Promise<void> {
    const cacheDir = options?.cacheDir;
    const requested = options?.modelId ?? DEFAULT_MODEL_ID;

    // Resolve the model actually loadable BEFORE the already-loaded check.
    // Doing it after would compare against the requested id rather than the
    // one in memory, and reload on every call whenever a fallback is in use.
    let modelId = requested;
    if (cacheDir && !WhisperService.isModelReady(cacheDir, requested)) {
      const fallback = WhisperService.findDownloadedModel(cacheDir);
      if (!fallback) {
        throw new Error(
          'No Whisper model is downloaded. Complete onboarding to fetch one.'
        );
      }
      console.warn(
        `[Whisper] ${requested} is not downloaded; using ${fallback} instead.`
      );
      modelId = fallback;
    }

    // Already holding this exact model, or a load is in flight.
    if ((this.initialized && loadedModelId === modelId) || loading) return;

    // A different model was requested — drop the old pipeline and reload.
    if (this.initialized && loadedModelId !== modelId) {
      console.log(`[Whisper] Switching model ${loadedModelId} -> ${modelId}`);
      this.initialized = false;
      transcriber = null;
    }

    loading = true;

    try {
      console.log(`[Whisper] Loading model ${modelId}...`);
      const dynamicImport = new Function('specifier', 'return import(specifier)');
      const transformers = await dynamicImport('@xenova/transformers');

      const onProgress = options?.onProgress;

      if (cacheDir) {
        // Point @xenova/transformers at the local model store
        // cacheDir uses the -- separator convention (e.g., Xenova--whisper-small.en)
        transformers.env.cacheDir = cacheDir;
        transformers.env.allowLocalModels = true;
        transformers.env.allowRemoteModels = false;
        transformers.env.useBrowserCache = false;

      } else if (onProgress) {
        // Legacy path: allow local models when progress callback is provided
        transformers.env.allowLocalModels = true;
        transformers.env.useBrowserCache = false;
      }

      transcriber = await transformers.pipeline(
        'automatic-speech-recognition',
        modelId,
        {
          quantized: true,
          progress_callback: onProgress || undefined,
        }
      );
      this.initialized = true;
      loadedModelId = modelId;
      console.log(`[Whisper] Model ${modelId} loaded successfully`);
    } catch (err) {
      console.error('[Whisper] Failed to load model:', err);
      throw err;
    } finally {
      loading = false;
    }
  }

  /**
   * @param language 'auto' lets Whisper detect the language, but see
   * {@link resolveLanguage} — auto-detect is unreliable on South Asian accents
   * and is not the default.
   */
  async transcribe(
    wavFilePath: string,
    language: TranscribeLanguage = 'en'
  ): Promise<TranscriptionResult> {
    if (!this.initialized || !transcriber) {
      throw new Error('WhisperService not initialized');
    }

    const startTime = Date.now();
    try {
      console.log(`[Whisper] Transcribing: ${wavFilePath}`);

      // Read WAV file and extract raw PCM samples as Float32Array
      const wavBuffer = fs.readFileSync(wavFilePath);
      const audioData = this.decodeWav(wavBuffer);

      const result = await transcriber(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
        sampling_rate: 16000,
        ...(language !== 'auto' ? { language, task: 'transcribe' } : {}),
      });
      const text = (result?.text || '').trim();
      const durationMs = Date.now() - startTime;
      console.log(`[Whisper] Result (${durationMs}ms): "${text}"`);
      return { text, durationMs };
    } catch (err) {
      console.error('[Whisper] Transcription error:', err);
      throw err;
    }
  }

  /**
   * Decode a 16-bit PCM WAV buffer into Float32Array samples.
   */
  private decodeWav(buffer: Buffer): Float32Array {
    // Skip 44-byte WAV header, read 16-bit signed PCM
    const dataOffset = 44;
    const numSamples = (buffer.length - dataOffset) / 2;
    const samples = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      const val = buffer.readInt16LE(dataOffset + i * 2);
      samples[i] = val / 32768;
    }
    return samples;
  }

  async transcribeBuffer(wavBuffer: Buffer): Promise<TranscriptionResult> {
    const tmpFile = path.join(os.tmpdir(), `vtt-${Date.now()}.wav`);
    try {
      fs.writeFileSync(tmpFile, wavBuffer);
      return await this.transcribe(tmpFile);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  }
}
