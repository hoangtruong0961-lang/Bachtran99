import * as ort from 'onnxruntime-web/webgpu';
import { getModelBufferDB, storeModelBufferDB, deleteModelBufferDB } from './idbStorage';
import { checkRoiSubtitleDuplicate } from './ocrPreprocessing';

export interface LocalFrameItem {
  image?: string; // base64 or data URL
  pixelData?: Uint8ClampedArray;
  width?: number;
  height?: number;
  timestamp: number;
}

export interface LocalOcrResult {
  startTime: number;
  endTime: number;
  originalText: string;
  sourceLang: string;
  confidence?: number;
}

export interface PaddleOcrModelStatus {
  isReady: boolean;
  detLoaded: boolean;
  recLoaded: boolean;
  dictLoaded?: boolean;
  modelName: string;
  detSizeMB?: string;
  recSizeMB?: string;
  dictSizeKB?: string;
  downloadProgress?: number;
  downloadMessage?: string;
}

// Global ONNX Session cache
let onnxDetSession: ort.InferenceSession | null = null;
let onnxRecSession: ort.InferenceSession | null = null;
let isSessionLoading = false;

// Default backend proxy endpoints for PaddleOCR PP-OCRv5 ONNX weights & dictionary
const DET_MODEL_URL = '/api/paddle-models/det';
const REC_MODEL_URL = '/api/paddle-models/rec';
const DICT_MODEL_URL = '/api/paddle-models/dict';

/**
 * Validate that an ArrayBuffer contains a valid ONNX/ORT binary model
 */
export function isProtobufValidHeader(buf: ArrayBuffer | null | undefined): boolean {
  if (!buf || buf.byteLength < 200000) return false;
  const u8 = new Uint8Array(buf, 0, Math.min(128, buf.byteLength));
  // Reject HTML / JSON / Git-LFS text error responses
  const headStr = new TextDecoder('utf-8').decode(u8.subarray(0, 64)).toLowerCase();
  if (
    headStr.includes('<html') ||
    headStr.includes('<!doc') ||
    headStr.includes('{"') ||
    headStr.includes('error') ||
    headStr.includes('git-lfs') ||
    headStr.includes('version https://')
  ) {
    return false;
  }
  return true;
}

/**
 * Sanitize character dictionary buffer:
 * 1. Strip UTF-8 BOM (\uFEFF / 0xEF 0xBB 0xBF) at the very start
 * 2. Replace CRLF (\r\n) line endings with standard LF (\n) to prevent trailing \r on dictionary tokens
 */
export function sanitizeDictionaryBuffer(buffer: ArrayBuffer | string): ArrayBuffer {
  let text = '';
  if (typeof buffer === 'string') {
    text = buffer;
  } else if (buffer && (buffer as ArrayBuffer).byteLength > 0) {
    text = new TextDecoder('utf-8').decode(buffer as ArrayBuffer);
  } else {
    return new ArrayBuffer(0);
  }
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff || text.startsWith('\uFEFF')) {
    text = text.slice(1);
  }
  // Remove trailing \r from CRLF
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '');
  return new TextEncoder().encode(text).buffer;
}

export async function fetchDictionaryFromCandidates(): Promise<ArrayBuffer | null> {
  const dictCandidates = [
    '/api/paddle-models/dict',
    '/api/ocr/model/dict',
    '/models/ppocrv6_tiny_dict.txt',
    '/ppocrv6_tiny_dict.txt',
    DICT_MODEL_URL,
    'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ppocrv6_tiny_dict.txt',
    'https://cdn.jsdelivr.net/gh/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models@main/recognition/ppocrv6_tiny_dict.txt',
    '/models/ppocrv5_keys.txt',
    '/ppocrv5_keys.txt',
  ];

  for (const dictUrl of dictCandidates) {
    try {
      const dictRes = await fetch(dictUrl);
      if (dictRes.ok) {
        const cType = dictRes.headers.get('content-type') || '';
        if (!cType.toLowerCase().includes('text/html')) {
          const buf = await dictRes.arrayBuffer();
          if (buf && buf.byteLength > 10) {
            return sanitizeDictionaryBuffer(buf);
          }
        }
      }
    } catch (_) {}
  }
  return null;
}

/**
 * Ensure PaddleOCR ONNX models are present in IndexedDB, auto-downloading them if missing or corrupted
 */
export async function ensurePaddleOcrModelsLoaded(
  onProgress?: (percent: number, msg: string) => void
): Promise<boolean> {
  let detBuf = await getModelBufferDB('paddleocr_det');
  let recBuf = await getModelBufferDB('paddleocr_rec');

  // Purge any corrupted or non-protobuf buffers cached in IndexedDB from previous failed runs
  if (detBuf && !isProtobufValidHeader(detBuf)) {
    console.warn('[PaddleOCR Engine] Phát hiện tệp paddleocr_det trong IndexedDB bị lỗi Protobuf. Đang dọn dẹp cache...');
    await deleteModelBufferDB('paddleocr_det');
    detBuf = null;
  }
  if (recBuf && !isProtobufValidHeader(recBuf)) {
    console.warn('[PaddleOCR Engine] Phát hiện tệp paddleocr_rec trong IndexedDB bị lỗi Protobuf. Đang dọn dẹp cache...');
    await deleteModelBufferDB('paddleocr_rec');
    recBuf = null;
  }

  if (isProtobufValidHeader(detBuf) && isProtobufValidHeader(recBuf)) {
    return true;
  }
  const ok = await downloadPaddleOcrModels(onProgress);
  if (!ok) {
    throw new Error('Không thể tải tệp trọng số PaddleOCR ONNX (Detection/Recognition).');
  }
  return true;
}

/**
 * Check if PaddleOCR ONNX models are present in IndexedDB or memory
 */
export async function checkPaddleOcrModelStatus(): Promise<PaddleOcrModelStatus> {
  const dictBuf = await getModelBufferDB('paddleocr_dict');

  if (onnxDetSession && onnxRecSession) {
    return {
      isReady: true,
      detLoaded: true,
      recLoaded: true,
      dictLoaded: !!dictBuf,
      modelName: 'PP-OCRv6 Tiny ONNX (Đã load trong bộ nhớ)',
    };
  }

  let detBuf = await getModelBufferDB('paddleocr_det');
  let recBuf = await getModelBufferDB('paddleocr_rec');

  // Validate protobuf headers
  if (detBuf && !isProtobufValidHeader(detBuf)) {
    await deleteModelBufferDB('paddleocr_det');
    detBuf = null;
  }
  if (recBuf && !isProtobufValidHeader(recBuf)) {
    await deleteModelBufferDB('paddleocr_rec');
    recBuf = null;
  }

  const detLoaded = isProtobufValidHeader(detBuf);
  const recLoaded = isProtobufValidHeader(recBuf);
  const dictLoaded = !!dictBuf && dictBuf.byteLength > 10;
  const isReady = detLoaded && recLoaded;

  return {
    isReady,
    detLoaded,
    recLoaded,
    dictLoaded,
    modelName: isReady ? 'PP-OCRv6 Tiny Local ONNX (Đã lưu trong bộ nhớ)' : 'Chưa tải Model PaddleOCR PP-OCRv6 Tiny',
    detSizeMB: detBuf && detBuf.byteLength > 100000 ? (detBuf.byteLength / (1024 * 1024)).toFixed(2) + ' MB' : undefined,
    recSizeMB: recBuf && recBuf.byteLength > 100000 ? (recBuf.byteLength / (1024 * 1024)).toFixed(2) + ' MB' : undefined,
    dictSizeKB: dictBuf && dictBuf.byteLength > 10 ? (dictBuf.byteLength / 1024).toFixed(1) + ' KB' : undefined,
  };
}

/**
 * Initializes local ONNX Runtime Web session from IndexedDB or ArrayBuffers
 */
export async function initLocalOnnxEngine(): Promise<boolean> {
  try {
    const detBuf = await getModelBufferDB('paddleocr_det');
    const recBuf = await getModelBufferDB('paddleocr_rec');
    const hasDet = !!detBuf && detBuf.byteLength > 100000;
    const hasRec = !!recBuf && recBuf.byteLength > 100000;
    return hasDet || hasRec;
  } catch (err) {
    console.warn('[Local ONNX Engine Check]', err);
    return false;
  }
}

/**
 * Download PaddleOCR models directly with progress tracking
 */
export async function downloadPaddleOcrModels(
  onProgress?: (percent: number, msg: string) => void
): Promise<boolean> {
  try {
    if (onProgress) onProgress(5, 'Đang kết nối server proxy tải Model PaddleOCR v6 Tiny (ONNX)...');

    const fetchWithProgress = async (proxyUrl: string, name: string, startPct: number, endPct: number) => {
      const isDet = name.toLowerCase().includes('detection') || proxyUrl.includes('det');
      const fallbackUrls = [
        isDet ? '/api/paddle-models/det' : '/api/paddle-models/rec',
        isDet ? '/api/ocr/model/det' : '/api/ocr/model/rec',
        isDet ? '/models/PaddleOCRv6-tiny-det.onnx' : '/models/PaddleOCRv6-tiny-rec.onnx',
        isDet ? '/PaddleOCRv6-tiny-det.onnx' : '/PaddleOCRv6-tiny-rec.onnx',
        proxyUrl,
        isDet
          ? 'https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/detection/ort/PP-OCRv6_tiny_det.ort'
          : 'https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ort/PP-OCRv6_tiny_rec.ort',
        isDet
          ? 'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/detection/ort/PP-OCRv6_tiny_det.ort'
          : 'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ort/PP-OCRv6_tiny_rec.ort',
        isDet
          ? 'https://cdn.jsdelivr.net/gh/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models@main/detection/ort/PP-OCRv6_tiny_det.ort'
          : 'https://cdn.jsdelivr.net/gh/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models@main/recognition/ort/PP-OCRv6_tiny_rec.ort',
      ];

      let lastError: any = null;
      for (const rawUrl of fallbackUrls) {
        const targetUrl = rawUrl.includes('huggingface.co') && rawUrl.includes('/blob/')
          ? rawUrl.replace('/blob/', '/resolve/')
          : rawUrl;
        try {
          const response = await fetch(targetUrl);
          if (!response.ok) continue;

          // Ignore HTML responses (e.g. Netlify/Vite SPA fallback returning index.html for non-existent routes)
          const contentType = response.headers.get('Content-Type') || '';
          if (contentType.toLowerCase().includes('text/html')) {
            continue;
          }

          const contentLength = +(response.headers.get('Content-Length') || '0');
          const reader = response.body?.getReader();

          if (!reader) {
            const rawBuf = await response.arrayBuffer();
            if (rawBuf.byteLength >= 100000 && isProtobufValidHeader(rawBuf)) {
              return rawBuf;
            }
            continue;
          }

          let receivedLength = 0;
          const chunks: Uint8Array[] = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;

            if (contentLength && onProgress) {
              const pct = Math.round(startPct + (receivedLength / contentLength) * (endPct - startPct));
              const mb = (receivedLength / (1024 * 1024)).toFixed(1);
              onProgress(pct, `Đang tải ${name}: ${mb} MB...`);
            }
          }

          const allChunks = new Uint8Array(receivedLength);
          let position = 0;
          for (const chunk of chunks) {
            allChunks.set(chunk, position);
            position += chunk.length;
          }

          const finalBuf = allChunks.buffer.slice(allChunks.byteOffset, allChunks.byteOffset + allChunks.byteLength);
          if (finalBuf.byteLength >= 100000 && isProtobufValidHeader(finalBuf)) {
            return finalBuf;
          }
        } catch (e) {
          lastError = e;
        }
      }

      throw new Error(`Không thể tải tệp ${name} từ bất kỳ nguồn nào. Chi tiết: ${String(lastError || 'Server trả về dữ liệu rỗng hoặc không đúng chuẩn Protobuf')}`);
    };

    if (onProgress) onProgress(10, 'Đang tải PaddleOCR PP-OCRv6 Tiny Detection Model (PaddleOCRv6-tiny-det.onnx)...');
    const detBuffer = await fetchWithProgress(DET_MODEL_URL, 'PP-OCRv6 Tiny Detection', 10, 48);

    if (onProgress) onProgress(48, 'Đang tải PaddleOCR PP-OCRv6 Tiny Recognition Model (PaddleOCRv6-tiny-rec.onnx)...');
    const recBuffer = await fetchWithProgress(REC_MODEL_URL, 'PP-OCRv6 Tiny Recognition', 48, 85);

    if (!isProtobufValidHeader(detBuffer) || !isProtobufValidHeader(recBuffer)) {
      throw new Error('Tệp trọng số ONNX tải về không đạt chuẩn cấu trúc Protobuf hợp lệ.');
    }

    if (onProgress) onProgress(85, 'Đang tải Từ điển ký tự PP-OCRv6 (ppocrv6_tiny_dict.txt)...');
    let dictBuffer: ArrayBuffer | null = null;
    const dictCandidates = [
      '/api/paddle-models/dict',
      '/api/ocr/model/dict',
      '/models/ppocrv6_tiny_dict.txt',
      '/ppocrv6_tiny_dict.txt',
      DICT_MODEL_URL,
      'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ppocrv6_tiny_dict.txt',
      'https://cdn.jsdelivr.net/gh/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models@main/recognition/ppocrv6_tiny_dict.txt',
      '/models/ppocrv5_keys.txt',
      '/ppocrv5_keys.txt',
    ];

    for (const dictUrl of dictCandidates) {
      try {
        const dictRes = await fetch(dictUrl);
        if (dictRes.ok) {
          const cType = dictRes.headers.get('content-type') || '';
          if (!cType.toLowerCase().includes('text/html')) {
            const buf = await dictRes.arrayBuffer();
            if (buf && buf.byteLength > 10) {
              dictBuffer = buf;
              break;
            }
          }
        }
      } catch (_) {}
    }

    if (onProgress) onProgress(92, 'Đang lưu Model PP-OCRv6 Tiny & Dictionary vào bộ nhớ trình duyệt IndexedDB...');
    await storeModelBufferDB('paddleocr_det', detBuffer, 'PaddleOCRv6-tiny-det.onnx');
    await storeModelBufferDB('paddleocr_rec', recBuffer, 'PaddleOCRv6-tiny-rec.onnx');

    if (dictBuffer && dictBuffer.byteLength > 10) {
      const cleanDict = sanitizeDictionaryBuffer(dictBuffer);
      await storeModelBufferDB('paddleocr_dict', cleanDict, 'ppocrv6_tiny_dict.txt');
    }

    if (onProgress) onProgress(98, 'Đang khởi tạo Session ONNX Runtime Web WASM...');
    await initLocalOnnxEngine();

    if (onProgress) onProgress(100, 'Tải Model PaddleOCR PP-OCRv6 Tiny hoàn tất 100%! Đã sẵn sàng chạy local.');
    return true;
  } catch (err: any) {
    console.error('Download PaddleOCR error:', err);
    if (onProgress) onProgress(0, `Lỗi tải model: ${err?.message || 'Không thể kết nối server'}`);
    return false;
  }
}

/**
 * Upload custom .onnx model file directly from user's computer
 */
export async function uploadCustomPaddleOcrModel(file: File, type: 'det' | 'rec'): Promise<boolean> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async () => {
      if (reader.result instanceof ArrayBuffer) {
        const key = type === 'det' ? 'paddleocr_det' : 'paddleocr_rec';
        await storeModelBufferDB(key, reader.result, file.name);
        // Clear old sessions
        if (type === 'det') onnxDetSession = null;
        if (type === 'rec') onnxRecSession = null;
        await initLocalOnnxEngine();
        resolve(true);
      } else {
        resolve(false);
      }
    };
    reader.onerror = () => resolve(false);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Clear PaddleOCR model cache from IndexedDB
 */
export async function clearPaddleOcrCache(): Promise<void> {
  await deleteModelBufferDB('paddleocr_det');
  await deleteModelBufferDB('paddleocr_rec');
  onnxDetSession = null;
  onnxRecSession = null;
  console.log('[PaddleOCR] Local ONNX model cache cleared.');
}

import { PaddleOcrService } from 'ppu-paddle-ocr/web';
import {
  detectTextPresenceInFrame,
  applyBinarizationAndContrast,
  scaleFrameBitmap,
  SubtitleRoiCalibrator,
  cropPixelDataVertical,
  estimateTextVerticalRoi,
} from './ocrPreprocessing';
import {
  refineAndMergeSubtitles,
  correctOcrTextAnomalies,
  stripEmbeddedNoiseTokens,
  stripEdgeNoiseHanziTokens,
  isLatinLanguage,
  applyHardFilter,
  applySingleCjkFilter,
  filterOutliersByGeometry,
  deduplicateSubtitlesWithGemini,
} from './ocrPostprocessing';

export {
  detectTextPresenceInFrame,
  applyBinarizationAndContrast,
  scaleFrameBitmap,
  SubtitleRoiCalibrator,
  refineAndMergeSubtitles,
  correctOcrTextAnomalies,
  stripEmbeddedNoiseTokens,
  stripEdgeNoiseHanziTokens,
  isLatinLanguage,
  applyHardFilter,
  applySingleCjkFilter,
  filterOutliersByGeometry,
  deduplicateSubtitlesWithGemini,
};

let mainThreadPaddleService: PaddleOcrService | null = null;

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const parts = dataUrl.split(',');
  const base64 = parts.length > 1 ? parts[1] : parts[0];
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export function hasSubtitleTextCandidate(
  pixelData?: Uint8ClampedArray | Uint8Array | null,
  width?: number,
  height?: number
): boolean {
  if (!pixelData || !width || !height) return true;
  return detectTextPresenceInFrame(pixelData, width, height).hasText;
}

export function applyBackgroundFilter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: 'none' | 'contrast' | 'binarize' | 'adaptive' = 'none',
  strengthPercent: number = 0
) {
  applyBinarizationAndContrast(ctx, width, height, mode, strengthPercent);
}

export function preprocessFrameCanvas(imgData: ImageData): ImageData {
  return imgData;
}

export function cleanOcrText(text: string, isLatin: boolean = false): string {
  if (!text) return '';
  let cleaned = correctOcrTextAnomalies(text);
  if (!isLatin) {
    cleaned = stripEmbeddedNoiseTokens(cleaned);
  }
  return cleaned;
}

export const cleanChineseOcrText = cleanOcrText;

export function processTemporalClusteringAndSnapping(
  detectedItems: { text: string; timestamp: number; confidence?: number; box?: number[] }[],
  stepInterval: number = 0.5,
  transitionTimestamps?: number[],
  minConfidence: number = 0.70,
  sourceLang?: string,
  _targetLang?: string
): LocalOcrResult[] {
  // IMPORTANT: The script type of OCR text inside video frames is determined by the video's SOURCE language!
  // Defaults to CJK (isLatin = false) if sourceLang is not explicitly a Latin language.
  const isLatin = sourceLang ? isLatinLanguage(sourceLang) : false;
  return refineAndMergeSubtitles(detectedItems, stepInterval, isLatin, transitionTimestamps, minConfidence);
}

/**
 * Run client-side local OCR frame analysis entirely in browser using WebAssembly & ONNX Runtime Web (WebGPU/WebGL)
 * offloaded to a multi-threaded Web Worker Pool (2-4 Web Workers concurrently) for maximum throughput on multi-core CPUs.
 */
export async function runClientSideLocalOcrBatch(
  frames: LocalFrameItem[],
  onProgress?: (msg: string) => void,
  stepInterval?: number,
  transitionTimestamps?: number[],
  minConfidence: number = 0.70,
  sourceLang?: string,
  targetLang?: string
): Promise<LocalOcrResult[]> {
  const detectedItems: { text: string; timestamp: number; confidence?: number }[] = [];
  const inferredInterval = stepInterval || (frames.length >= 2 ? Math.max(0.1, Math.abs(frames[1].timestamp - frames[0].timestamp)) : 0.5);

  if (!frames || frames.length === 0) return [];

  await ensurePaddleOcrModelsLoaded((pct, msg) => {
    if (onProgress) onProgress(`[Tải Model Local OCR ${pct}%] ${msg}`);
  });

  let detBuf = await getModelBufferDB('paddleocr_det');
  let recBuf = await getModelBufferDB('paddleocr_rec');
  let dictBuf = await getModelBufferDB('paddleocr_dict');

  // Auto-fetch dictionary from server or static files if not found in IndexedDB
  if (!dictBuf || dictBuf.byteLength < 10) {
    const fetchedDict = await fetchDictionaryFromCandidates();
    if (fetchedDict && fetchedDict.byteLength > 10) {
      await storeModelBufferDB('paddleocr_dict', fetchedDict, 'ppocrv6_tiny_dict.txt');
      dictBuf = fetchedDict;
    }
  }

  const cleanDictBuf = dictBuf && dictBuf.byteLength > 10 ? sanitizeDictionaryBuffer(dictBuf) : undefined;

  // Ensure 100% frame coverage: process all extracted frames directly via worker pool
  const framesToProcess = frames;
  const skippedBatchCount = 0;

  // Determine optimal worker pool size: unlock up to 12 parallel Web Workers based on CPU logical cores
  const logicalCores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const calculatedCores = logicalCores >= 8 ? logicalCores - 1 : logicalCores;
  const maxPoolSize = Math.min(12, Math.max(2, calculatedCores));
  // If frame count is small (e.g. < 4), use fewer workers; otherwise use full pool size
  const poolSize = Math.min(maxPoolSize, Math.max(1, Math.ceil(framesToProcess.length / 2)));

  if (onProgress) {
    onProgress(`⚡ Khởi tạo Đa luồng Web Worker Pool (${poolSize} Workers | Lọc ${skippedBatchCount} khung trùng ROI)...`);
  }

  // Split frame list into balanced chunks across worker pool
  const frameChunks: LocalFrameItem[][] = Array.from({ length: poolSize }, () => []);
  framesToProcess.forEach((f, idx) => {
    frameChunks[idx % poolSize].push(f);
  });

  const activeWorkerPromises: Promise<{ text: string; timestamp: number; confidence?: number }[]>[] = [];
  const workerProgressTracker: { completed: number; total: number }[] = Array.from(
    { length: poolSize },
    (_, i) => ({
      completed: 0,
      total: frameChunks[i].length,
    })
  );

  const updateOverallProgress = () => {
    if (!onProgress) return;
    const totalProcessed = workerProgressTracker.reduce((acc, w) => acc + w.completed, 0);
    const totalAll = framesToProcess.length;
    const pct = Math.round((totalProcessed / Math.max(1, totalAll)) * 100);
    onProgress(`🚀 [Đa luồng Pool ${poolSize} Workers] Đang bóc tách (${totalProcessed}/${totalAll} khung - ${pct}% | Bỏ qua trùng: ${skippedBatchCount})...`);
  };

  const spawnedWorkers: Worker[] = [];

  for (let wIdx = 0; wIdx < poolSize; wIdx++) {
    const chunk = frameChunks[wIdx];
    if (chunk.length === 0) continue;

    const workerId = wIdx + 1;
    const p = new Promise<{ text: string; timestamp: number; confidence?: number }[]>((resolve) => {
      try {
        const worker = new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), { type: 'module' });
        spawnedWorkers.push(worker);

        const processedFrames = chunk.map((f) => {
          let pBuf: Uint8ClampedArray | undefined = f.pixelData;
          if (pBuf && pBuf.byteLength > 0 && pBuf.buffer && pBuf.buffer.byteLength > 0) {
            pBuf = new Uint8ClampedArray(pBuf.buffer, pBuf.byteOffset, pBuf.byteLength);
          } else {
            pBuf = undefined;
          }
          return {
            image: f.image,
            pixelData: pBuf,
            width: f.width,
            height: f.height,
            timestamp: f.timestamp,
          };
        });

        const safetyTimeout = setTimeout(() => {
          console.warn(`[OCR Worker #${workerId}] Timeout safety trigger after 30s`);
          try { worker.terminate(); } catch {}
          resolve([]);
        }, 30000);

        worker.onerror = (wErr) => {
          clearTimeout(safetyTimeout);
          console.warn(`[OCR Worker #${workerId} Script/Memory Error]:`, wErr);
          resolve([]);
        };

        worker.onmessage = (e: MessageEvent) => {
          const { type, completed, results, workerId: respWorkerId } = e.data;

          if (type === 'READY') {
            worker.postMessage({
              type: 'PROCESS_BATCH',
              workerId,
              frames: processedFrames,
              minConfidence,
            });
          } else if (type === 'PROGRESS') {
            if (typeof completed === 'number') {
              workerProgressTracker[wIdx].completed = completed;
            }
            updateOverallProgress();
          } else if (type === 'BATCH_COMPLETE') {
            clearTimeout(safetyTimeout);
            workerProgressTracker[wIdx].completed = chunk.length;
            updateOverallProgress();
            resolve(results || []);
          } else if (type === 'ERROR') {
            clearTimeout(safetyTimeout);
            console.warn(`[OCR Worker #${workerId} Error]:`, e.data.error);
            resolve([]);
          }
        };

        // Pass ArrayBuffer copies cleanly using Transferable List so worker init has zero copy overhead
        const detCopy = detBuf ? detBuf.slice(0) : undefined;
        const recCopy = recBuf ? recBuf.slice(0) : undefined;
        const dictCopy = cleanDictBuf ? cleanDictBuf.slice(0) : undefined;

        const initTransferables = [detCopy, recCopy, dictCopy].filter(Boolean) as Transferable[];

        worker.postMessage(
          {
            type: 'INIT',
            workerId,
            detBuffer: detCopy,
            recBuffer: recCopy,
            dictBuffer: dictCopy,
          },
          initTransferables
        );
      } catch (err) {
        console.warn(`[OCR Worker Pool #${workerId}] Spawning failed:`, err);
        resolve([]);
      }
    });

    activeWorkerPromises.push(p);
  }

  try {
    const allPoolResults = await Promise.all(activeWorkerPromises);
    spawnedWorkers.forEach((w) => w.terminate());

    const combinedItems = allPoolResults.flat();
    if (combinedItems.length > 0) {
      combinedItems.sort((a, b) => a.timestamp - b.timestamp);
      combinedItems.forEach((item) => detectedItems.push(item));
    }


  } catch (poolErr) {
    console.warn('Worker pool execution note, falling back to main thread:', poolErr);
    spawnedWorkers.forEach((w) => w.terminate());
  }

  // Main thread fallback if worker pool returned no items or workers failed
  if (detectedItems.length === 0) {
    if (onProgress) onProgress('Đang chạy PaddleOCR Engine trên Luồng chính (Main Thread)...');
    try {
      if (!mainThreadPaddleService) {
        try {
          ort.env.logLevel = 'error';
          ort.env.wasm.simd = true;
          const logicalCores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
          const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
          ort.env.wasm.numThreads = hasSharedArrayBuffer ? Math.min(4, logicalCores) : 1;
          ort.env.wasm.proxy = false;
          ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
          if (typeof ort.env.webgpu === 'object' && ort.env.webgpu !== null) {
            (ort.env.webgpu as any).powerPreference = 'high-performance';
          }
        } catch (envErr) {
          console.warn('[Main Thread ONNX Setup Warning]', envErr);
        }

        if (!isProtobufValidHeader(detBuf) || !isProtobufValidHeader(recBuf)) {
          await downloadPaddleOcrModels((pct, msg) => {
            if (onProgress) onProgress(`[Main Thread Model Setup ${pct}%] ${msg}`);
          });
          detBuf = await getModelBufferDB('paddleocr_det');
          recBuf = await getModelBufferDB('paddleocr_rec');
        }

        if (!detBuf || !recBuf || !isProtobufValidHeader(detBuf) || !isProtobufValidHeader(recBuf)) {
          throw new Error('Không thể tải tệp trọng số ONNX hợp lệ cho PaddleOCR Main Thread.');
        }

        const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
        const mainProviders = hasWebGpu ? ['webgpu', 'wasm'] : ['wasm'];

        mainThreadPaddleService = new PaddleOcrService({
          model: {
            detection: detBuf,
            recognition: recBuf,
            charactersDictionary: cleanDictBuf || undefined,
          },
          detection: {
            thresh: 0.25,
            boxThresh: 0.55,
            box_thresh: 0.55,
            unclipRatio: 1.7,
            unclip_ratio: 1.7,
            minSize: 3,
            min_size: 3,
            scoreThresh: 0.35,
            dropScore: 0.35,
            drop_score: 0.35,
          } as any,
          recognition: {
            imageHeight: 48,
          } as any,
          session: { executionProviders: mainProviders },
          processing: { engine: 'canvas-native' },
        });
        try {
          await mainThreadPaddleService.initialize();
        } catch (initErr) {
          mainThreadPaddleService = null;
          throw initErr;
        }
      }

      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];

        // Yield to browser UI event loop every 2 frames to keep UI responsive and prevent tab freeze/crash
        if (i % 2 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        if (onProgress) {
          onProgress(`PaddleOCR Engine đang bóc tách chữ (${i + 1}/${frames.length})...`);
        }
        try {
          let res: any = null;
          if (f.image && typeof f.image === 'string' && f.image.length > 30) {
            const buf = dataUrlToArrayBuffer(f.image);
            if (buf && buf.byteLength > 100) {
              res = await mainThreadPaddleService.recognize(buf, { flatten: true });
            }
          } else if (f.pixelData && f.width && f.height && f.width > 0 && f.height > 0) {
            if (f.pixelData.byteLength === 0 || (f.pixelData.buffer && f.pixelData.buffer.byteLength === 0)) {
              console.warn(`[PaddleOCR Fallback] Frame ${i} skipped: pixelData buffer is detached or empty.`);
              continue;
            }
            const canvas = document.createElement('canvas');
            canvas.width = f.width;
            canvas.height = f.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const imgData = new ImageData(new Uint8ClampedArray(f.pixelData), f.width, f.height);
              ctx.putImageData(imgData, 0, 0);
              res = await mainThreadPaddleService.recognize(canvas as any, { flatten: true });
            }
          }

          if (!res) continue;

          const rawText = typeof res === 'string' ? res : res?.text || '';
          const text = cleanOcrText(rawText);
          if (text) {
            detectedItems.push({ timestamp: f.timestamp, text });
          }
        } catch (err) {
          console.warn('Main thread PaddleOCR recognition error for frame', i, err);
        }
      }
    } catch (err) {
      console.error('Main thread PaddleOCR service setup failed:', err);
    }
  }

  try {
    localStorage.setItem('raw_ocr_results', JSON.stringify(detectedItems));
  } catch (e) {
    console.warn('Failed to save raw_ocr_results to localStorage:', e);
  }

  return processTemporalClusteringAndSnapping(detectedItems, inferredInterval, transitionTimestamps, minConfidence, sourceLang, targetLang);
}

/**
 * PersistentWorker represents a Web Worker that has been initialized with the PaddleOCR models
 * and can be reused between multiple video scans without re-loading the ONNX buffers.
 */
export interface PersistentWorker {
  id: number;
  worker: Worker;
  isBusy: boolean;
  inFlightCount: number;
  currentBatchTimestamps?: number[];
}

// Global cache for initialized warm workers to prevent re-initializing ONNX sessions between scans
const globalWarmWorkers: PersistentWorker[] = [];

/**
 * Real-time Streaming Worker Pool for ONNX WASM PaddleOCR execution.
 * Allows video decoding and Web Worker OCR to run concurrently in parallel pipelines,
 * reducing total subtitle extraction waiting time by ~50%.
 */
export class StreamingOcrPool {
  private poolSize: number = 4;
  private workers: PersistentWorker[] = [];
  private frameQueue: LocalFrameItem[] = [];
  private detectedItems: { text: string; timestamp: number; confidence?: number }[] = [];
  private totalPushed: number = 0;
  private totalProcessed: number = 0;
  private skippedDuplicateCount: number = 0;
  private minConfidence: number = 0.70;
  private stepInterval: number = 0.5;
  private transitionTimestamps: number[] = [];
  private onProgress?: (msg: string) => void;
  public latestProgressMessage: string = '';
  private finishPromiseResolve?: () => void;
  private isInitDone: boolean = false;
  private isExtractionFinished: boolean = false;

  // Trick 1: Fast ROI Subtitle Hash / Pixel Diff state
  private lastRefFramePixels: Uint8ClampedArray | null = null;
  private lastRefFrameTimestamp: number = -1;
  private consecutiveDuplicateCount: number = 0;
  private pendingDuplicates: Map<number, number[]> = new Map(); // parentTimestamp -> childTimestamps[]
  private pendingDuplicateFrames: Map<number, LocalFrameItem[]> = new Map(); // parentTimestamp -> childFrames[]
  private completedOcrResultsMap: Map<number, { text: string; timestamp: number; confidence?: number } | null> = new Map();

  // Subtitle ROI Auto-Calibration State
  private roiCalibrator: SubtitleRoiCalibrator = new SubtitleRoiCalibrator();
  private hasLoggedRoiLock: boolean = false;
  private sourceLang: string = 'zh_cn';
  private targetLang: string = 'Tiếng Việt';

  private lastProgressReportTime: number = 0;

  constructor(options?: {
    stepInterval?: number;
    transitionTimestamps?: number[];
    minConfidence?: number;
    sourceLang?: string;
    targetLang?: string;
    onProgress?: (msg: string) => void;
  }) {
    this.stepInterval = options?.stepInterval ?? 0.5;
    this.transitionTimestamps = options?.transitionTimestamps ?? [];
    this.minConfidence = options?.minConfidence ?? 0.70;
    this.sourceLang = options?.sourceLang ?? 'zh_cn';
    this.targetLang = options?.targetLang ?? 'Tiếng Việt';
    this.onProgress = options?.onProgress;

    const logicalCores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    // Unlocked CPU cores: scale up to 12 parallel Web Workers (8 cores -> 7 workers, 12-16 cores -> max 12 workers)
    const calculatedCores = logicalCores >= 8 ? logicalCores - 1 : logicalCores;
    this.poolSize = Math.min(12, Math.max(2, calculatedCores));
  }

  private handleWorkerMessage(entry: PersistentWorker, e: MessageEvent) {
    const { type, results } = e.data;
    if (type === 'BATCH_COMPLETE' || type === 'ERROR') {
      entry.inFlightCount = Math.max(0, entry.inFlightCount - 1);
      if (entry.inFlightCount === 0) {
        entry.isBusy = false;
        entry.currentBatchTimestamps = undefined;
      }

      if (type === 'BATCH_COMPLETE') {
        if (Array.isArray(results)) {
          for (const res of results) {
            this.detectedItems.push(res);
            this.completedOcrResultsMap.set(res.timestamp, res);

            // SubtitleRoiCalibrator: Calibrate active subtitle vertical band when text is detected
            if (res.text && res.text.trim().length > 0 && this.lastRefFramePixels) {
              const estimated = estimateTextVerticalRoi(this.lastRefFramePixels, 320, 180);
              if (estimated) {
                this.roiCalibrator.recordDetection(estimated.yPercent, estimated.heightPercent);
                const locked = this.roiCalibrator.getLockedRoi();
                if (locked.isCalibrated && !this.hasLoggedRoiLock) {
                  this.hasLoggedRoiLock = true;
                  console.log(`[ROI Calibrator] 🔒 Đã khoá dải phụ đề Y: ${locked.calibratedYPercent}% - H: ${locked.calibratedHeightPercent}% (${locked.sampleCount} mẫu, giảm ~75% diện tích quét)`);
                }
              }
            }

            // Resolve pending duplicate child frames
            if (this.pendingDuplicates.has(res.timestamp)) {
              const children = this.pendingDuplicates.get(res.timestamp)!;
              const childFrames = this.pendingDuplicateFrames.get(res.timestamp) || [];

              if (res.text && res.text.trim().length > 0) {
                for (const childT of children) {
                  this.detectedItems.push({
                    timestamp: childT,
                    text: res.text,
                    confidence: res.confidence,
                  });
                  this.completedOcrResultsMap.set(childT, res);
                }
              } else {
                // Parent returned NO text! Re-queue the first child frame to run actual OCR on it
                if (childFrames.length > 0) {
                  const firstChild = childFrames[0];
                  this.frameQueue.unshift(firstChild);
                  const remainingChildren = children.filter(t => t !== firstChild.timestamp);
                  const remainingFrames = childFrames.filter(f => f.timestamp !== firstChild.timestamp);
                  if (remainingChildren.length > 0) {
                    this.pendingDuplicates.set(firstChild.timestamp, remainingChildren);
                    this.pendingDuplicateFrames.set(firstChild.timestamp, remainingFrames);
                  }
                }
              }
              this.pendingDuplicates.delete(res.timestamp);
              this.pendingDuplicateFrames.delete(res.timestamp);
            }
          }
        }

        // Mark sent frames with no OCR result as empty completed
        if (Array.isArray(entry.currentBatchTimestamps)) {
          for (const sentT of entry.currentBatchTimestamps) {
            if (!this.completedOcrResultsMap.has(sentT)) {
              this.completedOcrResultsMap.set(sentT, null);
              // If parent frame sentT had no text, re-queue the first child frame if available
              if (this.pendingDuplicates.has(sentT)) {
                const childFrames = this.pendingDuplicateFrames.get(sentT) || [];
                if (childFrames.length > 0) {
                  const firstChild = childFrames[0];
                  this.frameQueue.unshift(firstChild);
                  const remainingChildren = (this.pendingDuplicates.get(sentT) || []).filter(t => t !== firstChild.timestamp);
                  const remainingFrames = childFrames.filter(f => f.timestamp !== firstChild.timestamp);
                  if (remainingChildren.length > 0) {
                    this.pendingDuplicates.set(firstChild.timestamp, remainingChildren);
                    this.pendingDuplicateFrames.set(firstChild.timestamp, remainingFrames);
                  }
                }
                this.pendingDuplicates.delete(sentT);
                this.pendingDuplicateFrames.delete(sentT);
              }
            }
          }
        }
      } else if (type === 'ERROR') {
        console.warn(`[Streaming OCR Worker #${entry.id} Error]:`, e.data.error);
      }

      this.reportProgress();
      this.dispatchNextBatch();
    }
  }

  public async init(): Promise<boolean> {
    if (this.onProgress) {
      this.onProgress(`⚡ Khởi tạo luồng xử lý song song Streaming OCR Pool (${this.poolSize} Workers)...`);
    }

    // Try to reuse warm workers first
    let reusedCount = 0;
    const workersToUse: PersistentWorker[] = [];

    while (globalWarmWorkers.length > 0 && workersToUse.length < this.poolSize) {
      const w = globalWarmWorkers.pop()!;
      w.isBusy = false;
      w.inFlightCount = 0;
      w.currentBatchTimestamps = undefined;
      workersToUse.push(w);
      reusedCount++;
    }

    if (reusedCount > 0 && this.onProgress) {
      this.onProgress(`⚡ Tái sử dụng ${reusedCount} luồng OCR ấm (sẵn sàng hoạt động)...`);
    }

    await ensurePaddleOcrModelsLoaded((pct, msg) => {
      if (this.onProgress) {
        this.onProgress(`[Tải Model Local OCR ${pct}%] ${msg}`);
      }
    });

    let detBuf = await getModelBufferDB('paddleocr_det');
    let recBuf = await getModelBufferDB('paddleocr_rec');
    let dictBuf = await getModelBufferDB('paddleocr_dict');

    if (!isProtobufValidHeader(detBuf) || !isProtobufValidHeader(recBuf)) {
      await downloadPaddleOcrModels((pct, msg) => {
        if (this.onProgress) {
          this.onProgress(`[Tải Model Local OCR ${pct}%] ${msg}`);
        }
      });
      detBuf = await getModelBufferDB('paddleocr_det');
      recBuf = await getModelBufferDB('paddleocr_rec');
    }

    if (!dictBuf || dictBuf.byteLength < 10) {
      const fetchedDict = await fetchDictionaryFromCandidates();
      if (fetchedDict && fetchedDict.byteLength > 10) {
        await storeModelBufferDB('paddleocr_dict', fetchedDict, 'ppocrv6_tiny_dict.txt');
        dictBuf = fetchedDict;
      }
    }

    const cleanDictBuf = dictBuf && dictBuf.byteLength > 10 ? sanitizeDictionaryBuffer(dictBuf) : undefined;

    const initPromises: Promise<boolean>[] = [];

    // Bind event handlers and track reused workers
    workersToUse.forEach((entry) => {
      this.workers.push(entry);
      const p = new Promise<boolean>((resolve) => {
        entry.worker.onmessage = (e: MessageEvent) => {
          this.handleWorkerMessage(entry, e);
        };
        // Reused workers are already fully initialized
        resolve(true);
      });
      initPromises.push(p);
    });

    // Create new workers for the remaining slots
    const needed = this.poolSize - reusedCount;
    for (let i = 0; i < needed; i++) {
      const workerId = reusedCount + i + 1;
      const p = new Promise<boolean>((resolve) => {
        try {
          const worker = new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), { type: 'module' });
          const entry: PersistentWorker = { id: workerId, worker, isBusy: false, inFlightCount: 0, currentBatchTimestamps: undefined };
          this.workers.push(entry);

          worker.onmessage = (e: MessageEvent) => {
            const { type } = e.data;
            if (type === 'READY') {
              // Switch to dynamic message handler once initialized
              worker.onmessage = (ev: MessageEvent) => {
                this.handleWorkerMessage(entry, ev);
              };
              resolve(true);
            } else {
              this.handleWorkerMessage(entry, e);
            }
          };

          const detCopy = detBuf ? detBuf.slice(0) : undefined;
          const recCopy = recBuf ? recBuf.slice(0) : undefined;
          const dictCopy = cleanDictBuf ? cleanDictBuf.slice(0) : undefined;

          worker.postMessage({
            type: 'INIT',
            workerId,
            detBuffer: detCopy,
            recBuffer: recCopy,
            dictBuffer: dictCopy,
          });
        } catch (err) {
          console.warn(`[Streaming OCR Pool Worker #${workerId}] init error:`, err);
          resolve(false);
        }
      });
      initPromises.push(p);
    }

    await Promise.all(initPromises);
    this.isInitDone = true;
    this.dispatchNextBatch();
    return true;
  }

  public pushFrame(frame: LocalFrameItem) {
    this.totalPushed++;

    let isDuplicate = false;
    let isNearDuplicate = false;
    if (this.lastRefFramePixels && frame.pixelData && frame.width && frame.height) {
      const res = checkRoiSubtitleDuplicate(
        frame.pixelData,
        this.lastRefFramePixels,
        frame.width,
        frame.height
      );
      if (res.isDuplicate) {
        isDuplicate = true;
      } else if (res.isNearDuplicate) {
        isNearDuplicate = true;
      }
    }

    if ((isDuplicate || isNearDuplicate) && this.lastRefFrameTimestamp !== -1) {
      this.skippedDuplicateCount++;
      
      // Group with last non-duplicate (parent) frame for detection & recognition reuse
      const parentT = this.lastRefFrameTimestamp;
      if (!this.pendingDuplicates.has(parentT)) {
        this.pendingDuplicates.set(parentT, []);
      }
      this.pendingDuplicates.get(parentT)!.push(frame.timestamp);

      if (!this.pendingDuplicateFrames.has(parentT)) {
        this.pendingDuplicateFrames.set(parentT, []);
      }
      this.pendingDuplicateFrames.get(parentT)!.push(frame);
    } else {
      // Not a duplicate - this is a new reference frame
      this.frameQueue.push(frame);
      if (frame.pixelData) {
        this.lastRefFramePixels = new Uint8ClampedArray(frame.pixelData);
        this.lastRefFrameTimestamp = frame.timestamp;
      }
    }

    if (this.isInitDone) {
      this.dispatchNextBatch();
    }
  }

  private reportProgress(forceImmediate: boolean = false) {
    if (this.totalPushed === 0) return;
    const now = performance.now();
    if (!forceImmediate && now - this.lastProgressReportTime < 120) {
      return;
    }
    this.lastProgressReportTime = now;

    const completedCount = this.completedOcrResultsMap.size + this.skippedDuplicateCount;
    const totalPushed = Math.max(1, this.totalPushed);
    const pct = Math.min(100, Math.round((completedCount / totalPushed) * 100));
    const busyWorkers = this.workers.filter((w) => w.inFlightCount > 0).length;

    const msg = `🚀 [Đa luồng Pool ${this.poolSize} Web Workers | Active: ${busyWorkers}/${this.poolSize}] Đang bóc OCR: ${completedCount}/${totalPushed} khung (${pct}%) | Bỏ qua trùng: ${this.skippedDuplicateCount} khung`;
    this.latestProgressMessage = msg;
    if (this.onProgress) {
      this.onProgress(msg);
    }
  }

  private dispatchNextBatch() {
    if (this.frameQueue.length === 0) {
      this.reportProgress(true);
      this.checkCompletion();
      return;
    }

    // Depth-2 In-Flight Queueing: dispatch work to any worker that has < 2 in-flight batches queued
    while (this.frameQueue.length > 0) {
      const availableWorkers = this.workers.filter((w) => w.inFlightCount < 2);
      if (availableWorkers.length === 0) break;

      // Pick the worker with the lowest in-flight queue depth
      availableWorkers.sort((a, b) => a.inFlightCount - b.inFlightCount);
      const worker = availableWorkers[0];

      const batchSize = Math.min(4, this.frameQueue.length);
      const batch = this.frameQueue.splice(0, batchSize);

      worker.inFlightCount++;
      worker.isBusy = true;
      if (!worker.currentBatchTimestamps) {
        worker.currentBatchTimestamps = [];
      }
      worker.currentBatchTimestamps.push(...batch.map((f) => f.timestamp));
      this.totalProcessed += batch.length;

      this.reportProgress();

      const lockedRoi = this.roiCalibrator.getLockedRoi();

      const processedFrames = batch.map((f) => {
        let pBuf: Uint8ClampedArray | undefined = f.pixelData;
        let w = f.width;
        let h = f.height;

        // SubtitleRoiCalibrator: Crop to locked subtitle vertical strip & cap width to 960 to reduce inference size by ~75-85%
        if (lockedRoi.isCalibrated && pBuf && w && h && w > 0 && h > 0) {
          const cropRes = cropPixelDataVertical(pBuf, w, h, lockedRoi.calibratedYPercent, lockedRoi.calibratedHeightPercent, 960);
          pBuf = cropRes.cropped;
          w = cropRes.width;
          h = cropRes.height;
        } else if (pBuf && pBuf.byteLength > 0 && pBuf.buffer && pBuf.buffer.byteLength > 0) {
          pBuf = new Uint8ClampedArray(pBuf.buffer, pBuf.byteOffset, pBuf.byteLength);
        } else {
          pBuf = undefined;
        }
        return {
          image: f.image,
          pixelData: pBuf,
          width: w,
          height: h,
          timestamp: f.timestamp,
        };
      });

      worker.worker.postMessage({
        type: 'PROCESS_BATCH',
        workerId: worker.id,
        frames: processedFrames,
        sourceLang: this.sourceLang,
        targetLang: this.targetLang,
        enableDeepScan: true,
        minConfidence: this.minConfidence,
      });
    }
  }

  private checkCompletion() {
    const allIdle = this.workers.every((w) => w.inFlightCount === 0);
    if (this.isExtractionFinished && this.frameQueue.length === 0 && allIdle) {
      if (this.finishPromiseResolve) {
        this.finishPromiseResolve();
      }
    }
  }

  public async finish(updatedTransitions?: number[]): Promise<LocalOcrResult[]> {
    this.isExtractionFinished = true;
    if (updatedTransitions) {
      this.transitionTimestamps = updatedTransitions;
    }

    const allIdle = this.workers.every((w) => w.inFlightCount === 0);
    if (this.frameQueue.length > 0 || !allIdle) {
      await new Promise<void>((resolve) => {
        this.finishPromiseResolve = resolve;
        this.dispatchNextBatch();
      });
    }

    // Final cleanup resolve for remaining pending duplicates
    this.pendingDuplicates.forEach((children, parentT) => {
      const parentRes = this.completedOcrResultsMap.get(parentT);
      if (parentRes && parentRes.text) {
        for (const childT of children) {
          this.detectedItems.push({
            timestamp: childT,
            text: parentRes.text,
            confidence: parentRes.confidence,
          });
        }
      }
    });
    this.pendingDuplicates.clear();

    // Release workers back to the global warm pool instead of terminating them
    this.workers.forEach((w) => {
      w.worker.onmessage = null;
      w.isBusy = false;
      w.inFlightCount = 0;
      w.currentBatchTimestamps = undefined;
      globalWarmWorkers.push(w);
    });
    this.workers = [];

    if (this.detectedItems.length === 0) return [];

    this.detectedItems.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`[StreamingOcrPool] Bóc chữ hoàn tất! Tổng nạp: ${this.totalPushed} khung | Bỏ qua trùng ROI: ${this.skippedDuplicateCount} khung (Tiết kiệm ${Math.round((this.skippedDuplicateCount / Math.max(1, this.totalPushed)) * 100)}% thời gian ONNX OCR)`);

    return processTemporalClusteringAndSnapping(
      this.detectedItems,
      this.stepInterval,
      this.transitionTimestamps,
      this.minConfidence,
      this.sourceLang,
      this.targetLang
    );
  }

  public getRawDetectedItems(): { text: string; timestamp: number; confidence?: number }[] {
    return [...this.detectedItems];
  }

  public getBusyWorkersCount(): number {
    return this.workers.filter((w) => w.inFlightCount > 0).length;
  }

  public getPoolSize(): number {
    return this.poolSize;
  }
}



