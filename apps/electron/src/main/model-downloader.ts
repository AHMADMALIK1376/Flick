import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import type { DownloadProgress, DownloadError, ModelFile } from '../shared/types';

// --- Exported helper functions (2.4) ---

/**
 * Calculate download percentage, clamped 0–100.
 */
export function calculatePercentage(bytesDownloaded: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  const pct = Math.round((bytesDownloaded / totalBytes) * 100);
  return Math.max(0, Math.min(100, pct));
}

/**
 * Calculate download speed in bytes per second.
 */
export function calculateSpeed(bytesDownloaded: number, elapsedSeconds: number): number {
  if (elapsedSeconds <= 0) return 0;
  return bytesDownloaded / elapsedSeconds;
}

/**
 * Format a speed value (bytes/sec) into a human-readable string.
 */
export function formatSpeed(speedBps: number): string {
  if (speedBps < 0) speedBps = 0;
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let value = speedBps;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  // Use up to 1 decimal place, but drop trailing .0
  const formatted = unitIndex === 0 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, '');
  return `${formatted} ${units[unitIndex]}`;
}

// --- Constants ---

const HF_BASE_URL = 'https://huggingface.co';

/**
 * Required files for a Whisper ONNX model variant.
 * ONNX weights live under the `onnx/` subfolder on Hugging Face,
 * while config/tokenizer files are at the repo root.
 */
const WHISPER_REQUIRED_FILES: { name: string; hfPath: string }[] = [
  { name: 'onnx/encoder_model_quantized.onnx', hfPath: 'onnx/encoder_model_quantized.onnx' },
  { name: 'onnx/decoder_model_merged_quantized.onnx', hfPath: 'onnx/decoder_model_merged_quantized.onnx' },
  { name: 'tokenizer.json', hfPath: 'tokenizer.json' },
  { name: 'tokenizer_config.json', hfPath: 'tokenizer_config.json' },
  { name: 'config.json', hfPath: 'config.json' },
  { name: 'generation_config.json', hfPath: 'generation_config.json' },
  { name: 'preprocessor_config.json', hfPath: 'preprocessor_config.json' },
];

// --- Interfaces ---

export interface ModelDownloadOptions {
  modelId: string;
  destDir: string;
  onProgress?: (progress: DownloadProgress) => void;
  onError?: (error: DownloadError) => void;
  signal?: AbortSignal;
}

// --- ModelDownloader class ---

export class ModelDownloader {
  private destDir: string;

  constructor(destDir: string) {
    this.destDir = destDir;
  }

  /**
   * Get the model directory path for a given modelId.
   * Uses `--` separator matching @xenova/transformers cache convention.
   */
  private getModelDir(modelId: string): string {
    // Use path.join with the model ID parts to match @xenova/transformers FileCache convention
    // e.g., "Xenova/whisper-small.en" -> path.join(destDir, "Xenova", "whisper-small.en")
    const parts = modelId.split('/');
    return path.join(this.destDir, ...parts);
  }

  /**
   * Get the list of required files for a model variant.
   */
  getRequiredFiles(modelId: string): ModelFile[] {
    return WHISPER_REQUIRED_FILES.map((file) => ({
      name: file.name,
      url: `${HF_BASE_URL}/${modelId}/resolve/main/${file.hfPath}`,
    }));
  }

  /**
   * Check if all required model files exist (no .partial, all present).
   */
  isModelReady(modelId: string): boolean {
    const modelDir = this.getModelDir(modelId);
    if (!fs.existsSync(modelDir)) return false;
    return WHISPER_REQUIRED_FILES.every((file) =>
      fs.existsSync(path.join(modelDir, file.name))
    );
  }

  /**
   * Check available disk space vs required bytes.
   * Returns true if enough space is available.
   */
  async checkDiskSpace(requiredBytes: number): Promise<boolean> {
    return new Promise((resolve) => {
      fs.statfs(this.destDir, (err, stats) => {
        if (err) {
          // If we can't check, assume there's space and let write errors surface later
          resolve(true);
          return;
        }
        const availableBytes = stats.bfree * stats.bsize;
        resolve(availableBytes >= requiredBytes);
      });
    });
  }

  /**
   * Download all files for a model, resuming partial downloads.
   */
  async download(options: ModelDownloadOptions): Promise<void> {
    const { modelId, destDir, onProgress, onError, signal } = options;
    const modelDir = path.join(destDir, ...modelId.split('/'));

    // Ensure model directory and subdirectories exist
    try {
      fs.mkdirSync(modelDir, { recursive: true });
      fs.mkdirSync(path.join(modelDir, 'onnx'), { recursive: true });
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        onError?.({
          message: `Permission denied creating directory: ${modelDir}`,
          code: 'DISK_PERMISSION',
          retryable: false,
        });
        return;
      }
      throw err;
    }

    const files = this.getRequiredFiles(modelId);

    // Estimate total size: sum of expected sizes or use a rough estimate
    // First pass: get content lengths for all files to compute total
    let totalBytes = 0;
    const fileSizes: number[] = [];
    for (const file of files) {
      const filePath = path.join(modelDir, file.name);
      // If file already fully downloaded, count its size but skip download
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        fileSizes.push(stat.size);
        totalBytes += stat.size;
      } else {
        // Use expectedSize if available, otherwise 0 (will be updated during download)
        fileSizes.push(file.expectedSize ?? 0);
        totalBytes += file.expectedSize ?? 0;
      }
    }

    // Check disk space before starting
    if (totalBytes > 0) {
      const hasSpace = await this.checkDiskSpace(totalBytes);
      if (!hasSpace) {
        onError?.({
          message: `Insufficient disk space. Need approximately ${Math.ceil(totalBytes / (1024 * 1024))} MB.`,
          code: 'DISK_SPACE',
          retryable: false,
        });
        return;
      }
    }

    let overallBytesDownloaded = 0;
    const startTime = Date.now();

    // Count bytes from already-completed files
    for (let i = 0; i < files.length; i++) {
      const filePath = path.join(modelDir, files[i].name);
      if (fs.existsSync(filePath)) {
        overallBytesDownloaded += fileSizes[i];
      }
    }

    // Download each file sequentially
    for (let i = 0; i < files.length; i++) {
      if (signal?.aborted) return;

      const file = files[i];
      const filePath = path.join(modelDir, file.name);
      const partialPath = filePath + '.partial';

      // Skip already completed files
      if (fs.existsSync(filePath)) {
        continue;
      }

      try {
        const downloadedForFile = await this.downloadFile(
          file.url,
          filePath,
          partialPath,
          signal,
          (chunkBytes, fileDownloaded, fileTotal) => {
            // Update total if we now know the real file size
            if (fileSizes[i] === 0 && fileTotal > 0) {
              totalBytes += fileTotal;
              fileSizes[i] = fileTotal;
            }

            overallBytesDownloaded += chunkBytes;
            const elapsedSeconds = (Date.now() - startTime) / 1000 || 0.001;
            onProgress?.({
              modelName: modelId,
              bytesDownloaded: overallBytesDownloaded,
              totalBytes,
              percentage: calculatePercentage(overallBytesDownloaded, totalBytes),
              speedBps: Math.round(calculateSpeed(overallBytesDownloaded, elapsedSeconds)),
              currentFile: file.name,
              status: 'downloading',
            });
          }
        );

        // Account for bytes that were already in the partial file before this download session
        // (they were counted in downloadFile's resume logic but not in overallBytesDownloaded yet)
        // downloadedForFile is the total file size; we already added chunk bytes via callback
        void downloadedForFile;
      } catch (err: unknown) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
          onError?.({
            message: `Permission denied writing file: ${file.name}`,
            code: 'DISK_PERMISSION',
            retryable: false,
          });
          return;
        }
        // Network / other errors
        onError?.({
          message: `Failed to download ${file.name}: ${nodeErr.message || String(err)}`,
          code: 'NETWORK_ERROR',
          retryable: true,
        });
        return;
      }
    }

    // Verification: check all files exist
    onProgress?.({
      modelName: modelId,
      bytesDownloaded: overallBytesDownloaded,
      totalBytes,
      percentage: calculatePercentage(overallBytesDownloaded, totalBytes),
      speedBps: 0,
      status: 'verifying',
    });

    if (!this.isModelReady(modelId)) {
      onError?.({
        message: 'Post-download verification failed: not all model files are present.',
        code: 'VERIFICATION_FAILED',
        retryable: true,
      });
      return;
    }

    // Complete
    onProgress?.({
      modelName: modelId,
      bytesDownloaded: totalBytes,
      totalBytes,
      percentage: 100,
      speedBps: 0,
      status: 'complete',
    });
  }

  /**
   * Download a single file with resume support.
   * Writes to partialPath, renames to filePath on completion.
   * Returns the total file size.
   */
  private downloadFile(
    url: string,
    filePath: string,
    partialPath: string,
    signal: AbortSignal | undefined,
    onChunk: (chunkBytes: number, fileDownloaded: number, fileTotal: number) => void
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      // Detect existing partial file for resume
      let startByte = 0;
      if (fs.existsSync(partialPath)) {
        const stat = fs.statSync(partialPath);
        startByte = stat.size;
      }

      const makeRequest = (requestUrl: string, resumeFrom: number, isRedirect = false) => {
        const headers: Record<string, string> = {};
        // Only send Range header to the original HF URL, not to CDN redirects
        // CDN signed URLs (e.g., Xet/S3) may reject requests with extra headers
        if (resumeFrom > 0 && !isRedirect) {
          headers['Range'] = `bytes=${resumeFrom}-`;
        }

        // Validate URL before making request
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(requestUrl);
        } catch (urlErr) {
          reject(new Error(`Invalid URL: ${requestUrl.substring(0, 100)}`));
          return;
        }

        const req = https.get(parsedUrl, { headers }, (response) => {
          // Handle redirects
          if (
            response.statusCode &&
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            response.resume(); // drain the response
            // Resolve relative redirect URLs against the request URL
            let redirectUrl: string;
            try {
              redirectUrl = new URL(response.headers.location, requestUrl).toString();
            } catch {
              redirectUrl = response.headers.location;
            }
            makeRequest(redirectUrl, resumeFrom, true);
            return;
          }

          // If we requested a range but got 200 (not 206), server doesn't support range
          // Restart from beginning
          if (resumeFrom > 0 && response.statusCode === 200) {
            response.resume();
            // For CDN redirects, 200 is expected — just download from beginning
            if (isRedirect) {
              // CDN doesn't support range, reset startByte and download full file
              resumeFrom = 0;
              try { fs.unlinkSync(partialPath); } catch { /* ignore */ }
            } else {
              // Reset: delete partial and start over
              try {
                fs.unlinkSync(partialPath);
              } catch {
                // ignore if already gone
              }
              makeRequest(requestUrl, 0);
              return;
            }
          }

          if (
            response.statusCode &&
            response.statusCode !== 200 &&
            response.statusCode !== 206
          ) {
            response.resume();
            reject(new Error(`HTTP ${response.statusCode} downloading ${path.basename(filePath)}`));
            return;
          }

          const contentLength = Number(response.headers['content-length'] || 0);
          const fileTotal = resumeFrom + contentLength;
          let fileDownloaded = resumeFrom;

          let fileStream: fs.WriteStream;
          try {
            fileStream = fs.createWriteStream(partialPath, {
              flags: resumeFrom > 0 ? 'a' : 'w',
            });
          } catch (err) {
            reject(err);
            return;
          }

          // Handle abort signal
          const onAbort = () => {
            response.destroy();
            fileStream.close();
          };
          signal?.addEventListener('abort', onAbort, { once: true });

          response.on('data', (chunk: Buffer) => {
            fileDownloaded += chunk.length;
            onChunk(chunk.length, fileDownloaded, fileTotal);
          });

          response.pipe(fileStream);

          fileStream.on('finish', () => {
            signal?.removeEventListener('abort', onAbort);
            // Rename partial to final
            try {
              fs.renameSync(partialPath, filePath);
              resolve(fileTotal);
            } catch (err) {
              reject(err);
            }
          });

          fileStream.on('error', (err) => {
            signal?.removeEventListener('abort', onAbort);
            reject(err);
          });

          response.on('error', (err) => {
            signal?.removeEventListener('abort', onAbort);
            fileStream.close();
            reject(err);
          });
        });

        req.on('error', (err) => {
          reject(err);
        });
      };

      makeRequest(url, startByte);
    });
  }
}
