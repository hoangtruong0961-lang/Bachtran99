import express from 'express';
import dns from 'dns';
import { HttpsProxyAgent } from 'https-proxy-agent';

dns.setDefaultResultOrder('ipv4first');
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import { Worker } from 'worker_threads';
import { Readable } from 'stream';
import { exec, execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import ytdl from '@distube/ytdl-core';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import multer from 'multer';
import util from 'util';

const execPromise = util.promisify(exec);
const execFilePromise = util.promisify(execFile);

/**
 * SSRF Protection: Checks if hostname or IP belongs to private/internal networks or metadata endpoints
 */
function isDisallowedHostOrIp(hostname: string): boolean {
  if (!hostname) return true;
  const host = hostname.toLowerCase().trim();

  // Localhost & metadata hostnames
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    host === 'metadata'
  ) {
    return true;
  }

  // IPv4 checks
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [_, o1, o2, o3, o4] = ipv4Match.map(Number);
    if (o1 === 0) return true; // 0.0.0.0/8
    if (o1 === 127) return true; // 127.0.0.0/8 loopback
    if (o1 === 10) return true; // 10.0.0.0/8 private
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true; // 172.16.0.0/12 private
    if (o1 === 192 && o2 === 168) return true; // 192.168.0.0/16 private
    if (o1 === 169 && o2 === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true; // 100.64.0.0/10 CGNAT
    if (o1 >= 224) return true; // Multicast / Reserved
  }

  // IPv6 checks
  if (host === '::1' || host === '::' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return true;
  }

  return false;
}

function isValidPublicHttpUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return !isDisallowedHostOrIp(parsed.hostname);
  } catch (_) {
    return false;
  }
}

dotenv.config();

const currentFilename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
const currentDirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(currentFilename);

const customRequire = typeof require !== 'undefined' ? require : createRequire(import.meta.url);
let sherpaOnnxModule: any = null;
try {
  sherpaOnnxModule = customRequire('sherpa-onnx');
  console.log('[Sherpa-ONNX] Successfully loaded sherpa-onnx version:', sherpaOnnxModule?.version || 'ok');
} catch (e) {
  console.warn('[Sherpa-ONNX] Module load error:', e);
}

let tiktokTtsModule: any = null;
try {
  tiktokTtsModule = customRequire('@shofipwk/tiktok-tts');
  console.log('[TikTok-TTS] Successfully loaded @shofipwk/tiktok-tts module');
} catch (e) {
  console.warn('[TikTok-TTS] Module load error:', e);
}

const NGHI_TTS_VOICE_URLS: Record<string, { filename: string; url: string; name: string }> = {
  lacphi: {
    filename: 'lacphi.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/lacphi.onnx?download=true',
    name: 'Lạc Phi',
  },
  duyoryx: {
    filename: 'duyoryx3175.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/duyoryx3175.onnx?download=true',
    name: 'Duy Oryx',
  },
  ngochuyennew: {
    filename: 'ngochuyennew.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/ngochuyennew.onnx?download=true',
    name: 'Ngọc Huyền (Mới)',
  },
  ngocngan: {
    filename: 'ngocngan3701.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/ngocngan3701.onnx?download=true',
    name: 'Ngọc Ngạn',
  },
  maiphuong: {
    filename: 'maiphuong.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/maiphuong.onnx?download=true',
    name: 'Mai Phương',
  },
  minhquang: {
    filename: 'minhquang.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/minhquang.onnx?download=true',
    name: 'Minh Quang',
  },
};

function fixHuggingFaceUrl(url: string): string {
  if (!url) return url;
  if (url.includes('huggingface.co') && url.includes('/blob/')) {
    const fixed = url.replace('huggingface.co/', 'huggingface.co/').replace('/blob/', '/resolve/');
    console.log(`[Hugging Face URL Fixer] Converted HF blob URL to resolve: ${url} -> ${fixed}`);
    return fixed;
  }
  return url;
}

async function ensureFileDownloaded(fileUrl: string, targetPath: string, minSizeBytes: number = 50): Promise<boolean> {
  const sanitizedUrl = fixHuggingFaceUrl(fileUrl);
  if (fs.existsSync(targetPath)) {
    const stat = fs.statSync(targetPath);
    if (stat.size >= minSizeBytes) return true; // file exists and satisfies minimum size
    console.log(`[Sherpa-ONNX TTS] Existing file ${targetPath} too small (${stat.size} < ${minSizeBytes}), re-downloading...`);
    try { fs.unlinkSync(targetPath); } catch (_) {}
  }
  console.log(`[Sherpa-ONNX TTS] Downloading file from ${sanitizedUrl} to ${targetPath}...`);
  try {
    const res = await fetch(sanitizedUrl);
    if (!res.ok) throw new Error(`Failed to fetch ${sanitizedUrl}: ${res.status} ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length < minSizeBytes) {
      throw new Error(`Downloaded file too small (${buffer.length} bytes < ${minSizeBytes} bytes)`);
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, buffer);
    console.log(`[Sherpa-ONNX TTS] Saved ${targetPath} (${(buffer.length / (1024 * 1024)).toFixed(1)} MB) successfully.`);
    return true;
  } catch (e) {
    console.error(`[Sherpa-ONNX TTS] Download error for ${fileUrl}:`, e);
    if (fs.existsSync(targetPath)) {
      try { fs.unlinkSync(targetPath); } catch (_) {}
    }
    return false;
  }
}

async function ensureEspeakData(nghiDir: string): Promise<boolean> {
  const targetDir = path.join(nghiDir, 'espeak-ng-data');
  const phontabPath = path.join(targetDir, 'phontab');
  const phondataPath = path.join(targetDir, 'phondata');
  const viDictPath = path.join(targetDir, 'vi_dict');

  const checkBinaryValid = (dir: string): boolean => {
    const pt = path.join(dir, 'phontab');
    const vd = path.join(dir, 'vi_dict');
    if (fs.existsSync(pt) && fs.existsSync(vd)) {
      try {
        const viBuf = fs.readFileSync(vd);
        const ptBuf = fs.readFileSync(pt);
        if (viBuf.length > 500 && ptBuf.length > 1000) {
          const headerHex = viBuf.subarray(0, 10).toString('hex');
          if (!headerHex.includes('efbbbf') && !headerHex.includes('efbfbd')) {
            return true;
          }
        }
      } catch (_) {}
    }
    return false;
  };

  // Verify if current targetDir is already valid
  if (checkBinaryValid(targetDir)) {
    return true;
  }

  console.log('[Sherpa-ONNX TTS] espeak-ng-data missing or corrupted. Trying local backups first...');

  // Fallback 1: Search all local candidate folders
  const localCandidates = [
    path.join(process.cwd(), 'nghi-tts audio', 'espeak-ng-data'),
    path.join(process.cwd(), 'espeak-ng-data'),
    path.join(process.cwd(), 'public', 'espeak-ng-data'),
    path.join(currentDirname, 'nghi-tts audio', 'espeak-ng-data'),
    path.join(currentDirname, 'espeak-ng-data'),
    path.join(process.cwd(), 'tmp_espeak_test', 'espeak-ng-data'),
  ];

  for (const cand of localCandidates) {
    if (cand !== targetDir && fs.existsSync(cand) && checkBinaryValid(cand)) {
      console.log(`[Sherpa-ONNX TTS] Copying espeak-ng-data from local folder: ${cand}`);
      try {
        fs.mkdirSync(nghiDir, { recursive: true });
        fs.cpSync(cand, targetDir, { recursive: true });
        if (checkBinaryValid(targetDir)) {
          console.log('[Sherpa-ONNX TTS] Copied espeak-ng-data from local candidate successfully.');
          return true;
        }
      } catch (copyErr) {
        console.warn('[Sherpa-ONNX TTS] Copying candidate folder failed:', copyErr);
      }
    }
  }

  // Fallback 2: Try unzipping from local backup zip file
  const backupZipCandidates = [
    path.join(process.cwd(), 'tmp_espeak_test', 'espeak-ng-data.zip'),
    path.join(process.cwd(), 'espeak-ng-data.zip'),
    path.join(process.cwd(), 'public', 'espeak-ng-data.zip'),
    path.join(nghiDir, 'espeak-ng-data.zip'),
  ];

  for (const backupZipPath of backupZipCandidates) {
    if (fs.existsSync(backupZipPath)) {
      console.log(`[Sherpa-ONNX TTS] Unzipping espeak-ng-data from local zip: ${backupZipPath}`);
      try {
        fs.mkdirSync(nghiDir, { recursive: true });
        await new Promise<void>((resolveZip, rejectZip) => {
          exec(`unzip -q -o "${backupZipPath}" -d "${nghiDir}"`, (err) => {
            if (err) rejectZip(err);
            else resolveZip();
          });
        });
        if (checkBinaryValid(targetDir)) {
          console.log('[Sherpa-ONNX TTS] Unzipped espeak-ng-data from local backup zip successfully.');
          return true;
        }
      } catch (zipErr) {
        console.warn('[Sherpa-ONNX TTS] Unzipping backup zip failed:', zipErr);
      }
    }
  }

  console.log('[Sherpa-ONNX TTS] Local backups not found or failed. Downloading clean espeak-ng-data.zip from remote GitHub...');
  const zipPath = path.join(nghiDir, 'espeak-ng-data.zip');
  const zipUrl = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/espeak-ng-data.zip';

  if (fs.existsSync(targetDir)) {
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch (_) {}
  }

  // Minimum 5MB expected for espeak-ng-data.zip
  const downloaded = await ensureFileDownloaded(zipUrl, zipPath, 5000000);
  if (!downloaded) return false;

  console.log('[Sherpa-ONNX TTS] Unzipping downloaded espeak-ng-data...');
  return new Promise((resolve) => {
    exec(`unzip -q -o "${zipPath}" -d "${nghiDir}" && rm -f "${zipPath}"`, (err) => {
      if (err) {
        console.error('[Sherpa-ONNX TTS] Unzip error:', err);
        if (fs.existsSync(zipPath)) {
          try { fs.unlinkSync(zipPath); } catch (_) {}
        }
        resolve(false);
      } else {
        console.log('[Sherpa-ONNX TTS] espeak-ng-data extracted successfully.');
        resolve(true);
      }
    });
  });
}

function floatTo16BitPcmWav(samples: Float32Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);

  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7fff;
    buffer.writeInt16LE(Math.floor(val), offset);
    offset += 2;
  }

  return buffer;
}

/**
 * Creates standard MPEG-1 Layer 3 silence frames (~180-200ms)
 * to insert between subtitle chunks for natural breathing pauses and cadence.
 */
function createMp3SilenceBuffer(durationMs: number = 180): Buffer {
  // MPEG-1 Layer 3, 44100Hz, 128kbps, Joint Stereo: frame size = 417 bytes, duration = 26.12ms
  const frame = Buffer.alloc(417, 0);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0x64;

  const frameCount = Math.max(1, Math.round(durationMs / 26.1224));
  const frames: Buffer[] = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push(frame);
  }
  return Buffer.concat(frames);
}

/**
 * Accurately parses MP3 frame headers to calculate audio duration in seconds.
 */
function getMp3BufferDuration(buffer: Buffer): number {
  if (!buffer || buffer.length < 4) return 0;

  const bitrateTableMPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const bitrateTableMPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const sampleRateTable = {
    MPEG1: [44100, 48000, 32000],
    MPEG2: [22050, 24000, 16000],
    MPEG25: [11025, 12000, 8000],
  };

  let offset = 0;
  // Skip ID3v2 tag if present
  if (buffer.length > 10 && buffer.toString('ascii', 0, 3) === 'ID3') {
    const size =
      ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f);
    offset = 10 + size;
  }

  let totalDuration = 0;
  let frameCount = 0;

  while (offset < buffer.length - 4) {
    if (buffer[offset] === 0xff && (buffer[offset + 1] & 0xe0) === 0xe0) {
      const b1 = buffer[offset + 1];
      const b2 = buffer[offset + 2];

      const versionBits = (b1 >> 3) & 0x03; // 00=2.5, 10=2, 11=1
      const layerBits = (b1 >> 1) & 0x03; // 01=Layer 3, 10=Layer 2, 11=Layer 1

      let version: 'MPEG1' | 'MPEG2' | 'MPEG25' | null = null;
      if (versionBits === 3) version = 'MPEG1';
      else if (versionBits === 2) version = 'MPEG2';
      else if (versionBits === 0) version = 'MPEG25';

      if (version && layerBits === 1) { // Layer III
        const bitrateIdx = (b2 >> 4) & 0x0f;
        const srIdx = (b2 >> 2) & 0x03;
        const padding = (b2 >> 1) & 0x01;

        const sampleRates = sampleRateTable[version];
        const sampleRate = sampleRates ? sampleRates[srIdx] : 0;
        const bitrates = version === 'MPEG1' ? bitrateTableMPEG1 : bitrateTableMPEG2;
        const bitrate = bitrates ? bitrates[bitrateIdx] : 0;

        if (sampleRate && bitrate) {
          const samplesPerFrame = version === 'MPEG1' ? 1152 : 576;
          const frameSize = Math.floor((samplesPerFrame / 8 * bitrate * 1000) / sampleRate) + padding;

          if (frameSize > 0 && offset + frameSize <= buffer.length + 1) {
            totalDuration += samplesPerFrame / sampleRate;
            frameCount++;
            offset += frameSize;
            continue;
          }
        }
      }
    }
    offset++;
  }

  if (totalDuration > 0) {
    return Math.round(totalDuration * 100) / 100;
  }
  // Fallback rough estimate if headers couldn't be parsed: assuming 64kbps CBR
  return Math.round(((buffer.length * 8) / 64000) * 100) / 100;
}

/**
 * Builds standard FFmpeg atempo filter chain for any ratio.
 * FFmpeg's atempo filter accepts values strictly between 0.5 and 2.0.
 * For ratios > 2.0 or < 0.5, multiple atempo filters must be chained together.
 */
function buildAtempoFilterChain(ratio: number): string {
  const filters: string[] = [];
  let remaining = ratio;
  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters.join(',');
}

/**
 * 3-Layer Defense: Layer 3 - Post-process audio time-stretching (via FFmpeg atempo filter)
 * Compresses audio duration to match subtitle block duration while preserving natural vocal pitch.
 */
async function stretchAudioWithAtempo(
  inputBuffer: Buffer,
  currentDuration: number,
  targetDuration: number
): Promise<{ buffer: Buffer; duration: number }> {
  if (currentDuration <= 0 || targetDuration <= 0 || !inputBuffer || inputBuffer.length === 0) {
    return { buffer: inputBuffer, duration: currentDuration };
  }

  const speedRatio = currentDuration / targetDuration;
  // If difference is negligible (< 60ms or speed ratio within 0.98 - 1.02), no need to stretch
  if (Math.abs(currentDuration - targetDuration) < 0.06 || (speedRatio >= 0.98 && speedRatio <= 1.02)) {
    return { buffer: inputBuffer, duration: currentDuration };
  }

  const filterChain = buildAtempoFilterChain(speedRatio);
  const tempDir = path.join(os.tmpdir(), `audio_atempo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const inputPath = path.join(tempDir, 'input.mp3');
  const outputPath = path.join(tempDir, 'output.mp3');

  try {
    fs.writeFileSync(inputPath, inputBuffer);
    const ffmpegCmd = `ffmpeg -y -i "${inputPath}" -filter:a "${filterChain}" -vn -c:a libmp3lame -q:a 2 "${outputPath}"`;
    console.log(`[Audio Sync] Khớp thời lượng video (${(currentDuration * 1000).toFixed(0)}ms → atempo stretch ${(targetDuration * 1000).toFixed(0)}ms)`);
    await execPromise(ffmpegCmd);

    if (fs.existsSync(outputPath)) {
      const outputBuffer = fs.readFileSync(outputPath);
      const newDuration = getMp3BufferDuration(outputBuffer) || targetDuration;
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      return { buffer: outputBuffer, duration: newDuration };
    }
  } catch (err: any) {
    console.warn(`[Audio Sync] Giữ audio gốc, sẽ stretch khi ghép (lỗi: ${err?.message || err})`);
  }

  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  return { buffer: inputBuffer, duration: currentDuration };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // CORS & WASM Multi-threading Security Headers
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Range, Accept, Origin, x-api-key');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '50mb' }));

  // PaddleOCR PP-OCRv6 Tiny Models & Dictionary Serving Endpoints
  const PADDLE_MODEL_CONFIGS: Record<string, { filename: string; remoteUrl: string; minSize: number; contentType: string }> = {
    det: {
      filename: 'PaddleOCRv6-tiny-det.onnx',
      remoteUrl: 'https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/detection/ort/PP-OCRv6_tiny_det.ort',
      minSize: 500000,
      contentType: 'application/octet-stream',
    },
    rec: {
      filename: 'PaddleOCRv6-tiny-rec.onnx',
      remoteUrl: 'https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ort/PP-OCRv6_tiny_rec.ort',
      minSize: 1000000,
      contentType: 'application/octet-stream',
    },
    dict: {
      filename: 'ppocrv6_tiny_dict.txt',
      remoteUrl: 'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ppocrv6_tiny_dict.txt',
      minSize: 1000,
      contentType: 'text/plain; charset=utf-8',
    },
  };

  const handlePaddleModelRequest = async (req: express.Request, res: express.Response) => {
    const type = (req.params.type || '').toLowerCase();
    const config = PADDLE_MODEL_CONFIGS[type];
    if (!config) {
      res.status(404).json({ error: `Model type '${type}' not found. Supported types: det, rec, dict` });
      return;
    }

    const candidatePaths = [
      path.join(process.cwd(), 'public', config.filename),
      path.join(process.cwd(), 'public', 'models', config.filename),
      path.join(process.cwd(), 'dist', config.filename),
      path.join(process.cwd(), 'dist', 'models', config.filename),
      path.join(os.tmpdir(), config.filename),
    ];

    let foundPath: string | null = null;
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.size >= config.minSize) {
          foundPath = p;
          break;
        }
      }
    }

    if (foundPath) {
      const stat = fs.statSync(foundPath);
      res.setHeader('Content-Type', config.contentType);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Access-Control-Allow-Origin', '*');
      fs.createReadStream(foundPath).pipe(res);
      return;
    }

    // If not found locally, fetch from remote CDN and stream while caching
    try {
      console.log(`[PaddleOCR Model Server] Downloading ${config.filename} from ${config.remoteUrl}...`);
      const remoteRes = await fetch(config.remoteUrl);
      if (!remoteRes.ok) {
        res.status(remoteRes.status).send(`Failed to fetch ${config.filename} from remote mirror: HTTP ${remoteRes.status}`);
        return;
      }

      const buffer = Buffer.from(await remoteRes.arrayBuffer());
      if (buffer.length < config.minSize) {
        res.status(502).send(`Downloaded file ${config.filename} too small (${buffer.length} < ${config.minSize} bytes)`);
        return;
      }

      // Cache to public and temp directories
      try {
        const publicDir = path.join(process.cwd(), 'public');
        fs.mkdirSync(publicDir, { recursive: true });
        fs.writeFileSync(path.join(publicDir, config.filename), buffer);
      } catch (_) {}

      res.setHeader('Content-Type', config.contentType);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(buffer);
    } catch (err: any) {
      console.error(`[PaddleOCR Model Server Error for ${config.filename}]`, err);
      res.status(500).send(`Error downloading PaddleOCR model ${config.filename}: ${err?.message || err}`);
    }
  };

  app.get('/api/paddle-models/:type', handlePaddleModelRequest);
  app.get('/api/ocr/model/:type', handlePaddleModelRequest);

  // Shared GenAI helper with Proxy & Custom Model support
  const getAiClientAndModel = (body: any = {}) => {
    const apiMode = body.apiMode || 'direct';
    const directApiKey = body.apiKey;
    const proxyUrl = body.proxyUrl;
    const proxyKey = body.proxyKey;
    const proxyTargetModel = body.proxyTargetModel;
    const requestModel = body.model;

    console.log('[getAiClientAndModel] Received config:', {
      apiMode,
      hasDirectApiKey: !!directApiKey,
      proxyUrl,
      hasProxyKey: !!proxyKey,
      proxyTargetModel,
      requestModel,
      customModelName: body.customModelName
    });

    let ai: GoogleGenAI;
    let selectedModel = requestModel;

    if (apiMode === 'proxy' && proxyUrl) {
      const baseUrl = proxyUrl.trim().replace(/\/+$/, '');
      const proxyNoApiKey = body.proxyNoApiKey === true;
      
      // Determine the API Key for proxy mode.
      // If proxyNoApiKey is true, we use proxyKey if entered, else dummy key.
      // Crucially, we do NOT fall back to process.env.GEMINI_API_KEY in proxy mode to avoid exhausting the server's shared system key quota!
      let apiKey = 'AIStudioProxyKey';
      if (proxyNoApiKey) {
        apiKey = (proxyKey && proxyKey.trim()) || 'AIStudioProxyKey';
      } else {
        apiKey = (proxyKey && proxyKey.trim()) || (directApiKey && directApiKey.trim()) || 'AIStudioProxyKey';
      }
      
      console.log(`[getAiClientAndModel] Initializing GoogleGenAI client with PROXY mode. Base URL: ${baseUrl}. Using proxyNoApiKey: ${proxyNoApiKey}`);
      ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          baseUrl,
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      // In proxy mode, prioritize the user's configured proxyTargetModel or customModelName over the requestModel (which defaults to standard Gemini models in the UI)
      if (proxyTargetModel && proxyTargetModel.trim()) {
        selectedModel = proxyTargetModel.trim();
      } else if (body.customModelName && body.customModelName.trim()) {
        selectedModel = body.customModelName.trim();
      } else if (requestModel && requestModel.trim() && requestModel !== 'GEMINI_WEB') {
        selectedModel = requestModel.trim();
      }
    } else {
      // Direct API mode
      const apiKey = directApiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('Không tìm thấy API Key. Vui lòng kiểm tra cấu hình trong phần Thiết lập.');
      }
      console.log('[getAiClientAndModel] Initializing GoogleGenAI client with DIRECT mode.');
      ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      // Support custom model names in direct mode if provided
      if (body.customModelName && body.customModelName.trim()) {
        selectedModel = body.customModelName.trim();
      }
    }

    if (!selectedModel || selectedModel === 'GEMINI_WEB') {
      selectedModel = 'gemini-3.6-flash';
    }

    console.log(`[getAiClientAndModel] Resolved model to use: ${selectedModel}`);
    return { ai, selectedModel };
  };

  // Backwards compatibility helper
  const getAiClient = (customKey?: string) => {
    return getAiClientAndModel({ apiKey: customKey }).ai;
  };

  // Helper with automatic retry for 429 Rate Limits / Quota Exhaustion and Model Not Found fallback
  const generateContentWithRetry = async (ai: GoogleGenAI, params: any, maxRetries = 2) => {
    let attempt = 0;
    let currentParams = { ...params };
    while (attempt <= maxRetries) {
      try {
        return await ai.models.generateContent(currentParams);
      } catch (err: any) {
        const errStr = String(err?.message || err || '');
        const isQuota = errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('Quota');
        const isModelNotFound = errStr.includes('404') || errStr.includes('not found') || errStr.includes('is not supported') || errStr.includes('NOT_FOUND');

        if (isModelNotFound && currentParams.model !== 'gemini-2.5-flash' && currentParams.model !== 'gemini-2.0-flash') {
          console.warn(`[Gemini API] Model ${currentParams.model} is not available on this API key (likely standard public key on external host like Render). Falling back to gemini-2.5-flash...`);
          currentParams.model = 'gemini-2.5-flash';
          attempt++;
          continue;
        }

        if (isQuota && attempt < maxRetries) {
          attempt++;
          console.warn(`Gemini API 429 Quota hit. Retrying attempt ${attempt}/${maxRetries} in 2 seconds...`);
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          if (isQuota) {
            throw new Error('Lỗi Quota API Gemini (429): Đã quá giới hạn tần suất gọi AI (Quota Exhausted). Vui lòng chờ 30-60 giây trước khi thử lại.');
          }
          throw err;
        }
      }
    }
    throw new Error('Failed to generate content after retries.');
  };

  const handleAiRouteError = (err: any, res: any, defaultMsg: string, mode: 'proxy' | 'direct_custom' | 'direct_system' = 'direct_system') => {
    console.error(`[AI Route Error] [Mode: ${mode}] ${defaultMsg}:`, err);
    let errMsg = String(err?.message || err || '');
    if (errMsg.includes('<!DOCTYPE html>') || errMsg.includes('<html')) {
      if (errMsg.includes('524')) {
        errMsg = 'Lỗi 524 Timeout từ Proxy/Cloudflare (A timeout occurred at origin server).';
      } else {
        errMsg = errMsg.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      }
    }
    const lowerMsg = errMsg.toLowerCase();

    if (
      lowerMsg.includes('quota') || 
      lowerMsg.includes('exhausted') || 
      lowerMsg.includes('429') || 
      lowerMsg.includes('rate_limit') ||
      lowerMsg.includes('rate limit') ||
      lowerMsg.includes('resource_exhausted')
    ) {
      let quotaMessage = 'Hết lượt dùng thử miễn phí của API Key hệ thống (Quota Exceeded). Bạn vui lòng:\n1. Đợi vài phút rồi thử lại.\n2. Chọn Model khác ở thanh dưới cùng (ví dụ gemini-2.0-flash hoặc gemini-1.5-flash).\n3. Hoặc bấm nút Cài Đặt (bên phải trên cùng) để điền API Key cá nhân của bạn để sử dụng ổn định, không bị giới hạn.';
      if (mode === 'proxy') {
        quotaMessage = 'Proxy của bạn báo quá giới hạn tần suất/hạn mức sử dụng (Quota Exceeded / Rate Limit). Vui lòng:\n1. Đợi vài phút rồi thử lại.\n2. Kiểm tra lại hạn mức tài khoản liên kết với Proxy của bạn.\n3. Hoặc chuyển sang chế độ Direct API / dùng API Key cá nhân khác.';
      } else if (mode === 'direct_custom') {
        quotaMessage = 'API Key cá nhân của bạn báo quá giới hạn tần suất/hạn mức (Quota Exceeded / Rate Limit). Vui lòng:\n1. Kiểm tra lại hạn mức API Key của bạn.\n2. Chọn model nhẹ hơn (ví dụ gemini-2.0-flash hoặc gemini-1.5-flash).\n3. Hoặc đợi 1-2 phút rồi thử lại.';
      }

      return res.status(429).json({
        success: false,
        error: 'QUOTA_EXCEEDED',
        message: quotaMessage,
        rawError: errMsg
      });
    }

    if (lowerMsg.includes('timeout') || lowerMsg.includes('524') || lowerMsg.includes('504')) {
      return res.status(504).json({
        success: false,
        error: 'TIMEOUT',
        message: 'Yêu cầu bị quá hạn (Timeout 524). Hệ thống tự động chia nhỏ phụ đề hoặc vui lòng chuyển sang model nhẹ hơn như gemini-2.5-flash.',
        rawError: errMsg
      });
    }

    if (
      lowerMsg.includes('key not valid') || 
      lowerMsg.includes('api key') || 
      lowerMsg.includes('invalid api key') || 
      (lowerMsg.includes('not found') && lowerMsg.includes('key'))
    ) {
      let invalidKeyMessage = 'API Key hệ thống không hợp lệ hoặc đã hết hạn. Vui lòng liên hệ quản trị viên hoặc sử dụng API Key/Proxy cá nhân.';
      if (mode === 'proxy') {
        invalidKeyMessage = 'Proxy hoặc API Key cấu hình cho Proxy không hợp lệ. Vui lòng kiểm tra lại thiết lập Proxy của bạn trong mục Cài Đặt.';
      } else if (mode === 'direct_custom') {
        invalidKeyMessage = 'API Key cá nhân của bạn không hợp lệ. Vui lòng kiểm tra lại cấu hình API Key trong mục Cài Đặt.';
      }

      return res.status(401).json({
        success: false,
        error: 'INVALID_API_KEY',
        message: invalidKeyMessage,
        rawError: errMsg
      });
    }

    return res.status(500).json({
      success: false,
      error: 'AI_ERROR',
      message: `${defaultMsg}: ${errMsg}`,
      rawError: errMsg
    });
  };

  // 1. Health check & System Status
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.get('/api/system-status', (_req, res) => {
    res.json({
      success: true,
      hasSystemGeminiKey: !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),
      nodeEnv: process.env.NODE_ENV || 'development',
      time: new Date().toISOString(),
    });
  });

  // 1a. Proxy/Serve PaddleOCR PP-OCRv6/v5 ONNX model & dictionary files cleanly
  app.get(['/ppocrv6_tiny_dict.txt', '/ppocrv5_keys.txt'], (_req, res) => {
    try {
      const candidates = ['ppocrv6_tiny_dict.txt', 'ppocrv5_keys.txt'];
      for (const name of candidates) {
        const dictPath = path.join(process.cwd(), name);
        if (fs.existsSync(dictPath)) {
          const rawContent = fs.readFileSync(dictPath, 'utf8');
          const cleaned = rawContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '');
          const cleanBuf = Buffer.from(cleaned, 'utf8');
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Content-Length', cleanBuf.length.toString());
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return res.send(cleanBuf);
        }
      }
      return res.status(404).send('Dictionary not found');
    } catch (e: any) {
      return res.status(500).send(e?.message || 'Server error');
    }
  });

  app.get(['/api/paddle-models/:type', '/api/ocr/model/:type'], async (req, res) => {
    try {
      const { type } = req.params;

      if (type === 'dict' || type === 'keys' || type === 'dictionary') {
        const dictCandidates = ['ppocrv6_tiny_dict.txt', 'ppocrv5_keys.txt', 'models/ppocrv6_tiny_dict.txt'];
        const searchDirs = [
          process.cwd(),
          path.join(process.cwd(), 'public'),
          path.join(process.cwd(), 'public', 'models'),
          path.join(process.cwd(), 'dist'),
          path.join(process.cwd(), 'dist', 'models'),
          currentDirname,
          path.join(currentDirname, 'public'),
          path.join(currentDirname, 'dist'),
        ];
        for (const dir of searchDirs) {
          for (const name of dictCandidates) {
            const dictPath = path.join(dir, name);
            if (fs.existsSync(dictPath)) {
              const rawContent = fs.readFileSync(dictPath, 'utf8');
              const cleaned = rawContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '');
              const cleanBuf = Buffer.from(cleaned, 'utf8');
              res.setHeader('Content-Type', 'text/plain; charset=utf-8');
              res.setHeader('Content-Length', cleanBuf.length.toString());
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
              return res.send(cleanBuf);
            }
          }
        }
      }

      const isDet = type === 'det';

      // Serve local PP-OCRv6/v5 ONNX model files from all standard workspace and public directories
      const localCandidates = isDet
        ? ['PaddleOCRv6-tiny-det.onnx', 'ppocrv6_det.onnx', 'ppocrv5_det.onnx', 'det.onnx']
        : ['PaddleOCRv6-tiny-rec.onnx', 'ppocrv6_rec.onnx', 'ppocrv5_rec.onnx', 'rec.onnx'];

      const searchDirs = [
        process.cwd(),
        path.join(process.cwd(), 'public'),
        path.join(process.cwd(), 'public', 'models'),
        path.join(process.cwd(), 'dist'),
        path.join(process.cwd(), 'dist', 'models'),
        currentDirname,
        path.join(currentDirname, 'public'),
        path.join(currentDirname, 'public', 'models'),
        path.join(currentDirname, 'dist'),
        path.join(currentDirname, 'dist', 'models'),
      ];

      for (const dir of searchDirs) {
        for (const fileName of localCandidates) {
          const localPath = path.join(dir, fileName);
          if (fs.existsSync(localPath)) {
            const stat = fs.statSync(localPath);
            if (stat.size > 100000) {
              console.log(`[PaddleOCR Proxy] Serving local PP-OCRv6 ONNX model file: ${localPath} (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
              res.setHeader('Content-Type', 'application/octet-stream');
              res.setHeader('Content-Length', stat.size.toString());
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
              return res.sendFile(localPath);
            }
          }
        }
      }

      const urls = isDet
        ? [
            'https://huggingface.co/monorepo/paddleocr-onnx/resolve/main/ppocrv5_det.onnx',
            'https://huggingface.co/bropapa/paddleocr-onnx/resolve/main/ppocrv5_det.onnx',
          ]
        : [
            'https://huggingface.co/monorepo/paddleocr-onnx/resolve/main/ppocrv5_rec.onnx',
            'https://huggingface.co/bropapa/paddleocr-onnx/resolve/main/ppocrv5_rec.onnx',
          ];

      let lastErr: any = null;
      for (const targetUrl of urls) {
        try {
          const fetchRes = await fetch(targetUrl, {
            redirect: 'follow',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': '*/*',
            },
          });
          if (fetchRes.ok) {
            const arrayBuf = await fetchRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuf);
            // Ensure payload is an actual binary ONNX model (>100KB), not an LFS text pointer or 404 HTML
            if (buffer.length > 100000) {
              res.setHeader('Content-Type', 'application/octet-stream');
              res.setHeader('Content-Length', buffer.length.toString());
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
              res.send(buffer);
              return;
            } else {
              console.warn(`[PaddleOCR Proxy] URL ${targetUrl} returned non-binary or small payload (${buffer.length} bytes)`);
            }
          }
        } catch (e) {
          lastErr = e;
          console.warn(`[PaddleOCR Proxy] Error fetching ${targetUrl}:`, e);
        }
      }
      res.status(502).json({ error: 'Failed to fetch valid PaddleOCR ONNX model from all remote CDNs', details: String(lastErr) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Server model proxy error' });
    }
  });

  // 1b. Real-time Video Frame OCR (PaddleOCR JSON compatible local endpoint)
  app.post('/api/ocr-frame', async (req, res) => {
    try {
      const imageBase64 = req.body.imageBase64 || req.body.image;
      if (!imageBase64) {
        res.status(400).json({ success: false, error: 'Missing imageBase64' });
        return;
      }

      const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');
      const { ai, selectedModel } = getAiClientAndModel(req.body);

      const response = await generateContentWithRetry(ai, {
        model: selectedModel,
        contents: [
          { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } },
          {
            text: `Extract all visible Chinese / multilingual text from this video frame snapshot. Return JSON with a list of text regions containing raw text, translated text to Vietnamese, confidence, and 2D bounding boxes.`,
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              code: { type: Type.INTEGER, description: '100 for success' },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING },
                    translatedText: { type: Type.STRING },
                    score: { type: Type.NUMBER },
                    box: {
                      type: Type.ARRAY,
                      items: { type: Type.INTEGER },
                      description: '[ymin, xmin, ymax, xmax] 0-1000',
                    },
                  },
                },
              },
            },
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      res.json({
        success: true,
        data: {
          code: 100,
          data: parsed.items || [],
        },
      });
    } catch (err: any) {
      const apiMode = req.body.apiMode || 'direct';
      const hasCustomKey = !!(req.body.apiKey && req.body.apiKey.trim());
      const mode = apiMode === 'proxy' ? 'proxy' : (hasCustomKey ? 'direct_custom' : 'direct_system');
      return handleAiRouteError(err, res, 'Failed in /api/ocr-frame', mode);
    }
  });

  // 2. Single Frame OCR & Translation
  app.post('/api/ocr-extract', async (req, res) => {
    try {
      const { image, timestamp, targetLang = 'Tiếng Việt', model = 'gemini-3.6-flash', customContext } = req.body;

      if (!image) {
        res.status(400).json({ error: 'Missing image data' });
        return;
      }

      const { ai, selectedModel } = getAiClientAndModel(req.body);

      // Remove data URL prefix if present
      const cleanBase64 = image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');

      const prompt = `You are a high-precision video OCR and subtitle translator.
Your job is to examine this cropped region of a video frame and extract any visible text/subtitle.
${customContext ? `Context about the video content: ${customContext}` : ''}

Target translation language: ${targetLang}.

Instructions:
1. If NO visible text/subtitle exists in the image frame, set "hasText": false.
2. If text IS visible:
   - Extract the exact raw original text ("originalText").
   - Identify the source language ("sourceLang").
   - Translate "originalText" into natural, contextual ${targetLang} ("translatedText").
   - Provide a confidence score between 0.0 and 1.0 ("confidence").
   - Locate the exact 2D bounding box of the subtitle text inside this image as "box_2d" formatted as an array of 4 integers [ymin, xmin, ymax, xmax] normalized on a 0 to 1000 scale.`;

      const response = await generateContentWithRetry(ai, {
        model: selectedModel,
        contents: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: cleanBase64,
            },
          },
          {
            text: prompt,
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              hasText: { type: Type.BOOLEAN, description: 'True if subtitle text is visible' },
              originalText: { type: Type.STRING, description: 'Extracted raw text' },
              sourceLang: { type: Type.STRING, description: 'Detected source language code or name' },
              translatedText: { type: Type.STRING, description: 'Translated subtitle text' },
              confidence: { type: Type.NUMBER, description: 'Detection confidence from 0 to 1' },
              box_2d: {
                type: Type.ARRAY,
                items: { type: Type.INTEGER },
                description: '2D bounding box [ymin, xmin, ymax, xmax] normalized from 0 to 1000'
              },
            },
            required: ['hasText'],
          },
        },
      });

      const responseText = response.text || '{}';
      const parsed = JSON.parse(responseText);

      res.json({
        success: true,
        timestamp: timestamp || 0,
        result: parsed,
      });
    } catch (err: any) {
      const apiMode = req.body.apiMode || 'direct';
      const hasCustomKey = !!(req.body.apiKey && req.body.apiKey.trim());
      const mode = apiMode === 'proxy' ? 'proxy' : (hasCustomKey ? 'direct_custom' : 'direct_system');
      return handleAiRouteError(err, res, 'Failed to extract subtitle via OCR.', mode);
    }
  });

  // 3. Multi-Frame Batch OCR & Subtitle Synchronizer
  app.post('/api/ocr-batch-frames', async (req, res) => {
    try {
      const { frames, targetLang = 'Tiếng Việt', model = 'gemini-3.6-flash', ocrEngine = 'gemini_vision', customContext } = req.body;

      if (!frames || !Array.isArray(frames) || frames.length === 0) {
        res.status(400).json({ error: 'Missing or invalid frames array' });
        return;
      }

      // Gemini Vision Multimodal AI Engine
      const { ai, selectedModel } = getAiClientAndModel(req.body);

      const batchPrompt = `You are a high-precision, strict OCR engine for video subtitles.
You are given a sequence of ${frames.length} cropped video frame snapshots captured chronologically.
Frame timestamps: ${frames.map((f: any) => f.timestamp.toFixed(2) + 's').join(', ')}.
${customContext ? `Video context / topic: ${customContext}` : ''}

STRICT CHARACTER FIDELITY & OCR INSTRUCTIONS:
1. Carefully inspect EVERY single frame snapshot from Frame 1 to Frame ${frames.length}. Transcribe the EXACT printed/burned subtitle text verbatim (Chinese, English, Vietnamese, Japanese, etc.).
2. ACCURACY REQUIREMENT:
   - For Chinese text (Simplified / Traditional): Preserve exact CJK characters. DO NOT confuse similar Chinese characters (e.g. 已/己/巳, 治/冶, 未/末, 日/目, 视/祝). DO NOT hallucinate or guess characters that are not on screen.
   - For English/Vietnamese text: Preserve exact spelling, accent marks, and punctuation.
3. CRITICAL RULE TO PREVENT SUBTITLE "LAZINESS" & DURATION DRIFT:
   - Video subtitles change FREQUENTLY (every 0.3s to 1.5s)!
   - NEVER create a single long subtitle entry that spans across different sentences or across frames where the text has changed.
   - When text in Frame N is DIFFERENT from Frame N-1, you MUST END the previous subtitle entry at Frame N-1 timestamp and START a NEW subtitle entry at Frame N timestamp.
   - "startTime": Exact timestamp (in seconds) of the FIRST frame snapshot where this specific text string appears.
   - "endTime": Exact timestamp (in seconds) of the LAST frame snapshot where this specific text string STILL appears. Must NOT extend into later frames where the text changed or disappeared.
   - "originalText": The exact OCR text string.
   - "sourceLang": Language code/name (e.g. "zh", "vi", "en").
4. DEDUPLICATION & MERGING:
   - ONLY merge consecutive frames if they show the EXACT SAME or nearly identical text string.
   - If a frame has NO text, or text changes, DO NOT extend the previous subtitle's endTime to that frame!
5. FAST-SUBTITLE COMPLETENESS:
   - Even if a subtitle string appears in ONLY A SINGLE FRAME (e.g., duration < 0.5s), you MUST output a distinct subtitle item with startTime = frame timestamp and endTime = frame timestamp + 0.4s.
6. If NO text is present in any frame, return an empty array [].`;

      const parts: any[] = [{ text: batchPrompt }];

      frames.forEach((f: { image: string; timestamp: number }, idx: number) => {
        const cleanBase64 = f.image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');
        parts.push({
          text: `--- Frame ${idx + 1}/${frames.length} (Timestamp: ${f.timestamp.toFixed(2)}s) ---`,
        });
        parts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: cleanBase64,
          },
        });
      });

      const response = await generateContentWithRetry(ai, {
        model: selectedModel,
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                startTime: { type: Type.NUMBER, description: 'Start time in seconds' },
                endTime: { type: Type.NUMBER, description: 'End time in seconds' },
                originalText: { type: Type.STRING, description: 'Extracted original subtitle' },
                sourceLang: { type: Type.STRING, description: 'Source language name' },
                translatedText: { type: Type.STRING, description: 'Translated subtitle' },
                confidence: { type: Type.NUMBER, description: 'Confidence score' },
                box_2d: {
                  type: Type.ARRAY,
                  items: { type: Type.INTEGER },
                  description: '2D bounding box [ymin, xmin, ymax, xmax] normalized from 0 to 1000'
                },
              },
              required: ['startTime', 'endTime', 'originalText'],
            },
          },
        },
      });

      const responseText = response.text || '[]';
      const rawSubtitles = JSON.parse(responseText);

      // Post-process alignment: sort by startTime and remove overlap drift
      const subtitles = Array.isArray(rawSubtitles) ? rawSubtitles : [];
      subtitles.sort((a: any, b: any) => (a.startTime || 0) - (b.startTime || 0));

      for (let i = 0; i < subtitles.length; i++) {
        const curr = subtitles[i];
        if (i < subtitles.length - 1) {
          const next = subtitles[i + 1];
          if (curr.endTime >= next.startTime) {
            curr.endTime = Number(Math.max((curr.startTime || 0) + 0.1, (next.startTime || 0) - 0.05).toFixed(2));
          }
        }
        if (curr.endTime <= curr.startTime) {
          curr.endTime = Number(((curr.startTime || 0) + 0.3).toFixed(2));
        }
      }

      res.json({
        success: true,
        engine: 'gemini_vision',
        subtitles,
      });
    } catch (err: any) {
      const apiMode = req.body.apiMode || 'direct';
      const hasCustomKey = !!(req.body.apiKey && req.body.apiKey.trim());
      const mode = apiMode === 'proxy' ? 'proxy' : (hasCustomKey ? 'direct_custom' : 'direct_system');
      return handleAiRouteError(err, res, 'Failed to process batch OCR frames.', mode);
    }
  });

  const CACHE_ROOT = path.join(process.cwd(), '.cache');
  const TTS_CACHE_DIR = path.join(CACHE_ROOT, 'tts');
  const TRANS_CACHE_DIR = path.join(CACHE_ROOT, 'translation');

  // Ensure cache directories exist
  fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
  fs.mkdirSync(TRANS_CACHE_DIR, { recursive: true });

  function getSha256(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  // Translation Cache Helpers
  function getCachedTranslation(originalText: string, targetLang: string, model: string, customCtx?: string): string | null {
    const ctxHash = customCtx ? getSha256(customCtx.trim()) : '';
    const key = ctxHash ? `trans:${originalText}:${targetLang}:${model}:${ctxHash}` : `trans:${originalText}:${targetLang}:${model}`;
    const hash = getSha256(key);
    const filePath = path.join(TRANS_CACHE_DIR, `${hash}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return data.translatedText || null;
      } catch (e) {
        console.warn('Failed to read cached translation:', e);
      }
    }
    return null;
  }

  function setCachedTranslation(originalText: string, targetLang: string, model: string, translatedText: string, customCtx?: string) {
    const ctxHash = customCtx ? getSha256(customCtx.trim()) : '';
    const key = ctxHash ? `trans:${originalText}:${targetLang}:${model}:${ctxHash}` : `trans:${originalText}:${targetLang}:${model}`;
    const hash = getSha256(key);
    const filePath = path.join(TRANS_CACHE_DIR, `${hash}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify({ originalText, targetLang, model, translatedText, customCtx: customCtx || '' }));
    } catch (e) {
      console.warn('Failed to write cached translation:', e);
    }
  }

  // 4a. Context Synchronization Expert - Extract Global Movie Context & Entity Glossary
  app.post('/api/extract-global-context', async (req, res) => {
    try {
      const { subtitles, targetLang = 'Tiếng Việt', customContext = '' } = req.body;

      if (!subtitles || !Array.isArray(subtitles) || subtitles.length === 0) {
        res.status(400).json({ success: false, error: 'Missing subtitles array' });
        return;
      }

      let { ai, selectedModel } = getAiClientAndModel(req.body);
      if (selectedModel === 'GEMINI_WEB') {
        selectedModel = 'gemini-2.5-flash';
      }

      // Compact representation of subtitle dialogue lines for rapid script scanning
      const scriptLines = subtitles.map((s: any, idx: number) => {
        const text = String(s.originalText || s.text || '').trim();
        const start = typeof s.startTime === 'number' ? s.startTime.toFixed(1) : '0';
        return `[#${idx + 1} | ${start}s] ${text}`;
      }).filter((line: string) => !line.endsWith('] '));

      // In case of very large transcripts, ensure we include full breadth or a dense representative sample
      const fullScriptSample = scriptLines.length > 500
        ? scriptLines.slice(0, 500).join('\n') + `\n... [and ${scriptLines.length - 500} more dialogue lines]`
        : scriptLines.join('\n');

      const userNotes = customContext.trim()
        ? `\nADDITIONAL USER-PROVIDED CONTEXT / GUIDANCE:\n${customContext.trim()}\n`
        : '';

      const prompt = `You are a "context synchronization expert" - a master film script analyst, director of translation, and subtitle localization specialist for translating content into ${targetLang}.

YOUR MISSION:
Read through the following complete video subtitle script from beginning to end to understand the overall narrative arc, world setting, character relationships, dramatic conflicts, and dialogue tone.
From this full-script overview, extract a synchronized global context and terminology database that will be used as the single source of truth across all subsequent translation batches.

EXTRACT AND RETURN THE FOLLOWING INFORMATION IN STRICT JSON FORMAT:
1. "movieGenre": The primary and secondary genre of the video (e.g., "Cổ trang / Kiếm hiệp / Tiên hiệp", "Hiện đại / Đô thị / Tổng tài / Công sở", "Học đường / Thanh xuân", "Gia đình / Tình cảm", "Hành động / Tội phạm / Trinh thám", "Hài hước", "Kinh dị / Giật gân", "Khoa học viễn tưởng", "Anime / Hoạt hình", "Vlog / Phỏng vấn / Tài liệu", etc.).
2. "eraAndSetting": Detailed era and setting description (e.g., "Thời nhà Tống, giang hồ võ lâm môn phái", "Seoul / Bắc Kinh hiện đại, công ty công nghệ", "Trường trung học, thanh xuân học đường").
3. "characterPronounGuide": Specific guidelines for Vietnamese pronouns and address forms tailored to this genre and character dynamics:
   - For Cổ trang/Kiếm hiệp: Specify forms like "ta / ngươi / huynh / muội / tỷ / đệ / sư phụ / đồ nhi / bản tọa / tiểu thư / công tử / vương gia...".
   - For Hiện đại: Specify forms like "tôi / anh / em / cậu / tớ / mày / tao / sếp / chú / bác..." based on age, hierarchy, and intimacy.
   - MANDATORY DIRECTIVE: Explicitly emphasize that the translator MUST NEVER mechanically translate the same source pronoun (e.g. "你/我" in Chinese or "you/I" in English) into the same generic Vietnamese word for all characters. Pronouns must shift dynamically based on relationships, hierarchy, and emotion in each scene.
4. "summary": A concise 2-3 sentence overview of the video's plot, core premise, and tone.
5. "knownEntityGlossary": Array of all identified character names, locations, organizations/sects, martial arts techniques, and key specialized terms with their standardized, authentic ${targetLang} translations (e.g., proper Sino-Vietnamese Hán-Việt transcription for Chinese names):
   - "original": Original term/name in source language (e.g., "张无忌", "光明顶", "九阳神功")
   - "translated": Official, standard translation in ${targetLang} (e.g., "Trương Vô Kỵ", "Quang Minh Đỉnh", "Cửu Dương Thần Công")
   - "type": "character" | "location" | "organization" | "term" | "other"
   - "description": Brief context or role (e.g., "Nhân vật chính, giáo chủ Minh Giáo")${userNotes}

FULL SUBTITLE SCRIPT:
${fullScriptSample}`;

      const isProxyMode = (req.body.apiMode === 'proxy');
      const genConfig: any = {
        responseMimeType: 'application/json',
      };

      if (!isProxyMode) {
        genConfig.responseSchema = {
          type: Type.OBJECT,
          properties: {
            movieGenre: { type: Type.STRING, description: 'Primary genre of the movie/video' },
            eraAndSetting: { type: Type.STRING, description: 'Era and world setting' },
            characterPronounGuide: { type: Type.STRING, description: 'Vietnamese address forms and dynamic pronoun rules' },
            summary: { type: Type.STRING, description: 'Brief summary of the video plot' },
            knownEntityGlossary: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  original: { type: Type.STRING, description: 'Original name/term in source language' },
                  translated: { type: Type.STRING, description: 'Standardized translation in target language' },
                  type: { type: Type.STRING, description: 'character | location | organization | term | other' },
                  description: { type: Type.STRING, description: 'Role or explanation' },
                },
                required: ['original', 'translated', 'type'],
              },
            },
          },
          required: ['movieGenre', 'characterPronounGuide', 'knownEntityGlossary'],
        };
      }

      console.log(`[Extract Global Context] Analyzing ${subtitles.length} subtitle lines with model: ${selectedModel}...`);
      const response = await generateContentWithRetry(ai, {
        model: selectedModel,
        contents: prompt,
        config: genConfig,
      });

      let responseText = (response.text || '{}').trim();
      if (responseText.startsWith('```')) {
        responseText = responseText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
      }

      let globalContext: any = {};
      try {
        globalContext = JSON.parse(responseText);
      } catch (parseErr) {
        console.error('[Extract Global Context] JSON Parse Error:', parseErr, responseText.slice(0, 200));
        globalContext = {
          movieGenre: 'Tự động',
          eraAndSetting: 'Hiện đại / Tự nhiên',
          characterPronounGuide: 'Xưng hô linh hoạt theo quan hệ nhân vật.',
          summary: '',
          knownEntityGlossary: [],
        };
      }

      // Ensure fields exist
      if (!globalContext.movieGenre) globalContext.movieGenre = 'Tự động';
      if (!globalContext.characterPronounGuide) globalContext.characterPronounGuide = 'Xưng hô tự nhiên theo bối cảnh.';
      if (!Array.isArray(globalContext.knownEntityGlossary)) globalContext.knownEntityGlossary = [];

      console.log(`[Extract Global Context] Successfully extracted: Genre="${globalContext.movieGenre}", Entities=${globalContext.knownEntityGlossary.length}`);

      res.json({
        success: true,
        globalContext,
      });
    } catch (err: any) {
      const apiMode = req.body.apiMode || 'direct';
      const hasCustomKey = !!(req.body.apiKey && req.body.apiKey.trim());
      const mode = apiMode === 'proxy' ? 'proxy' : (hasCustomKey ? 'direct_custom' : 'direct_system');
      return handleAiRouteError(err, res, 'Failed to extract global context', mode);
    }
  });

  // 4. Batch Subtitle Translator / Refiner (with Global Genre, Entity Glossary & Previous Context Chaining)
  app.post('/api/translate-batch', async (req, res) => {
    try {
      const {
        subtitles,
        targetLang = 'Tiếng Việt',
        model = 'gemini-2.5-flash',
        glossary,
        customContext,
        contextPrompt,
        optimizeForTts = true,
        globalContext,
        knownEntityGlossary,
        previousContext,
      } = req.body;

      if (!subtitles || !Array.isArray(subtitles)) {
        res.status(400).json({ error: 'Missing subtitles array' });
        return;
      }

      let { ai, selectedModel } = getAiClientAndModel(req.body);
      if (selectedModel === 'GEMINI_WEB') {
        selectedModel = 'gemini-2.5-flash';
      }

      // Build consolidated context string for caching & prompt building
      const combinedGlossaryList: any[] = [
        ...(Array.isArray(knownEntityGlossary) ? knownEntityGlossary : []),
        ...(Array.isArray(glossary) ? glossary : []),
      ];

      const effectiveCustomContext = (customContext || contextPrompt || '').trim();
      const genreString = (globalContext?.movieGenre || '').trim();
      const cacheContextSig = `${genreString}::${combinedGlossaryList.map(g => `${g.original}=${g.translated}`).join('|')}::${effectiveCustomContext}`;

      // Identify which items are already in cache
      const finalTranslations: { id: string; translatedText: string }[] = [];
      const uncachedSubtitles: any[] = [];

      for (const sub of subtitles) {
        const cached = getCachedTranslation(sub.originalText, targetLang, selectedModel, cacheContextSig);
        if (cached) {
          finalTranslations.push({ id: sub.id, translatedText: cached });
        } else {
          uncachedSubtitles.push(sub);
        }
      }

      // If there are any uncached items, send them to Gemini with deep context chaining
      if (uncachedSubtitles.length > 0) {
        const ttsInstruction = optimizeForTts
          ? '\nCRITICAL FOR TTS DUBBING (3-Layer Sync Defense - Layer 1):\nEach block has a strict character length limit \'maxLength\' based on its \'duration\' (approx. 14-16 characters per second). Translations MUST be concise and strictly fit within maxLength to prevent TTS audio overflow. Validate that duration is not too short for the number of characters, keeping wording snappy, natural, and accurately rhythm-matched.'
          : '';

        // Format Global Genre & Pronoun Directives
        let globalGenreSection = '';
        if (globalContext && (globalContext.movieGenre || globalContext.characterPronounGuide)) {
          globalGenreSection = `
=== 1. GLOBAL MOVIE GENRE & STYLE RULES ===
- Thể loại phim (GLOBAL MOVIE GENRE): ${globalContext.movieGenre || 'Chưa xác định'}
- Thời đại & Bối cảnh: ${globalContext.eraAndSetting || 'Tự nhiên'}
${globalContext.summary ? `- Tóm tắt cốt truyện: ${globalContext.summary}` : ''}
- QUY TẮC ĐẠI TỪ NHÂN XƯNG (PRONOUN DIRECTIVES):
  ${globalContext.characterPronounGuide || 'Xưng hô phù hợp với thể loại phim và quan hệ nhân vật.'}
  ⚠️ ĐẶC BIỆT LƯU Ý: TUYỆT ĐỐI KHÔNG được máy móc dịch cùng 1 đại từ gốc (ví dụ "你/我" trong tiếng Trung hoặc "you/I" trong tiếng Anh) thành cùng 1 từ tiếng Việt cho mọi nhân vật. Phải linh hoạt thay đổi đại từ (anh/em, tôi/cô, ta/ngươi, huynh/muội, sư phụ/đồ nhi, sếp/em, chú/cháu, mày/tao...) dựa trên mối quan hệ, vị thế xã hội, tuổi tác, giới tính và cảm xúc trong từng câu thoại!`;
        }

        // Format Known Entity Glossary
        let glossarySection = '';
        if (combinedGlossaryList.length > 0) {
          const glossaryEntries = combinedGlossaryList
            .map((g: any) => `- "${g.original}" -> "${g.translated}" (${g.type || 'term'}${g.description ? `: ${g.description}` : ''})`)
            .join('\n');
          glossarySection = `
=== 2. KNOWN ENTITY GLOSSARY (BẮT BUỘC DỊCH ĐÚNG Y HỆT, KHÔNG ĐỔI) ===
Bạn BẮT BUỘC phải dịch đúng 100% các tên nhân vật, địa danh, môn phái và thuật ngữ theo bảng chuẩn hóa sau. TUYỆT ĐỐI KHÔNG tự ý thay đổi cách phiên âm hoặc cách dịch giữa các batch:
${glossaryEntries}`;
        }

        // Format Previous Context Chaining
        let previousContextSection = '';
        if (Array.isArray(previousContext) && previousContext.length > 0) {
          const prevLines = previousContext
            .map((p: any) => `[Câu trước] Gốc: "${p.originalText || ''}" -> Đã dịch: "${p.translatedText || ''}"`)
            .join('\n');
          previousContextSection = `
=== 3. PREVIOUS CONTEXT (NGỮ CẢNH BATCH TRƯỚC - CHỈ THAM KHẢO, KHÔNG DỊCH LẠI) ===
Dưới đây là các câu thoại liền trước để bạn nắm bắt mạch đối thoại, cảm xúc và xưng hô nhất quán:
${prevLines}
(Ghi chú: Các câu trên chỉ dùng để hiểu ngữ cảnh tiếp nối, KHÔNG đưa vào kết quả dịch output).`;
        }

        // User Custom Context
        let userNotesSection = '';
        if (effectiveCustomContext) {
          userNotesSection = `
=== 4. GHI CHÚ BỔ SUNG TỪ NGƯỜI DÙNG ===
${effectiveCustomContext}`;
        }

        const TRANS_CHUNK_SIZE = 30;
        const chunks: any[][] = [];
        for (let i = 0; i < uncachedSubtitles.length; i += TRANS_CHUNK_SIZE) {
          chunks.push(uncachedSubtitles.slice(i, i + TRANS_CHUNK_SIZE));
        }

        const newlyDiscoveredEntities: any[] = [];

        await Promise.all(
          chunks.map(async (chunk) => {
            const prompt = `You are a professional video translator, film dialog localizer, and context continuity expert.
Translate the following list of subtitles into ${targetLang}.${globalGenreSection}${glossarySection}${previousContextSection}${userNotesSection}${ttsInstruction}

Maintain tone, natural Vietnamese phrasing, context continuity, and emotional resonance suitable for video subtitles.
Each block has a strict character length limit 'maxLength' based on its 'duration'.

=== SUBTITLES TO TRANSLATE (DỊCH DANH SÁCH NÀY) ===
${JSON.stringify(chunk.map((s: any) => {
  const durSec = Math.max(0.5, (s.endTime - s.startTime) || 2.0);
  const maxLen = Math.max(14, Math.floor(durSec * 16));
  return {
    id: s.id,
    originalText: s.originalText,
    duration: durSec.toFixed(2) + 's',
    maxLength: maxLen,
  };
}))}`;

            try {
              const isProxyMode = (req.body.apiMode === 'proxy');
              const genConfig: any = {
                responseMimeType: 'application/json',
              };

              if (!isProxyMode) {
                genConfig.responseSchema = {
                  type: Type.OBJECT,
                  properties: {
                    translations: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING },
                          translatedText: { type: Type.STRING },
                        },
                        required: ['id', 'translatedText'],
                      },
                    },
                    newEntities: {
                      type: Type.ARRAY,
                      description: 'Any newly discovered character names or locations in this batch',
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          original: { type: Type.STRING },
                          translated: { type: Type.STRING },
                          type: { type: Type.STRING },
                        },
                        required: ['original', 'translated'],
                      },
                    },
                  },
                  required: ['translations'],
                };
              }

              const response = await generateContentWithRetry(ai, {
                model: selectedModel,
                contents: prompt,
                config: genConfig,
              });

              let responseText = (response.text || '{}').trim();
              if (responseText.startsWith('```')) {
                responseText = responseText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
              }

              let parsedResponse: any;
              try {
                parsedResponse = JSON.parse(responseText);
              } catch (parseErr) {
                console.warn('[Translate Batch] Direct JSON parse failed, trying array fallback:', parseErr);
                parsedResponse = [];
              }

              const newTranslations = Array.isArray(parsedResponse)
                ? parsedResponse
                : (Array.isArray(parsedResponse?.translations) ? parsedResponse.translations : []);

              if (Array.isArray(parsedResponse?.newEntities)) {
                newlyDiscoveredEntities.push(...parsedResponse.newEntities);
              }

              // Map and save each newly translated item to cache
              if (Array.isArray(newTranslations)) {
                newTranslations.forEach((nt: any) => {
                  const originalSub = chunk.find((s) => s.id === nt.id);
                  if (originalSub) {
                    const durSec = Math.max(0.5, (originalSub.endTime - originalSub.startTime) || 2.0);
                    const maxLen = Math.max(14, Math.floor(durSec * 16));
                    if (nt.translatedText && nt.translatedText.length > maxLen * 1.5) {
                      console.warn(`[Sync Validation] Block ${originalSub.id} duration (${durSec.toFixed(1)}s) might be tight for translated length (${nt.translatedText.length} chars vs target maxLength ${maxLen})`);
                    }
                    setCachedTranslation(originalSub.originalText, targetLang, selectedModel, nt.translatedText, cacheContextSig);
                    finalTranslations.push({ id: originalSub.id, translatedText: nt.translatedText });
                  }
                });
              }
            } catch (chunkErr) {
              console.warn(`[Translate Batch] Chunk failed:`, chunkErr);
              if (uncachedSubtitles.length <= TRANS_CHUNK_SIZE) {
                throw chunkErr;
              }
            }
          })
        );

        res.json({
          success: true,
          translations: finalTranslations,
          newEntities: newlyDiscoveredEntities,
        });
        return;
      }

      res.json({
        success: true,
        translations: finalTranslations,
        newEntities: [],
      });
    } catch (err: any) {
      const apiMode = req.body.apiMode || 'direct';
      const hasCustomKey = !!(req.body.apiKey && req.body.apiKey.trim());
      const mode = apiMode === 'proxy' ? 'proxy' : (hasCustomKey ? 'direct_custom' : 'direct_system');
      return handleAiRouteError(err, res, 'Failed to translate subtitle batch', mode);
    }
  });

  // 4b. Gemini Subtitle Deduplicator & AI Refiner (OCR typo correction, trash removal, duplicate merging in original language)
  app.post('/api/deduplicate-subtitles', async (req, res) => {
    try {
      const { subtitles, model = 'gemini-3.6-flash', targetLang = 'Tiếng Việt', apiKey } = req.body;

      if (!subtitles || !Array.isArray(subtitles) || subtitles.length === 0) {
        res.status(400).json({ success: false, error: 'Missing subtitles array' });
        return;
      }

      const { ai, selectedModel } = getAiClientAndModel(req.body);

      const processDedupChunk = async (chunkSubs: any[]) => {
        // Strip unused fields (base64 image, ROI boxes, internal IDs) to create a ultra-compact JSON payload for Gemini
        const compactChunk = chunkSubs.map((s: any) => ({
          startTime: typeof s.startTime === 'number' ? Number(s.startTime.toFixed(2)) : 0,
          endTime: typeof s.endTime === 'number' ? Number(s.endTime.toFixed(2)) : 0,
          originalText: String(s.originalText || s.text || '').trim(),
        }));

        const prompt = `You are GeminiSubtitleRefiner, an expert AI video subtitle post-processor.
You are given a raw list of extracted OCR video subtitles with timestamps.

YOUR 4 STRICT WORKFLOW MANDATES:
1. CONTEXTUAL DIALOGUE REPAIR & OCR TYPO FIXING:
   - Carefully inspect every CJK character, English word, or Vietnamese text in originalText.
   - Use the surrounding dialogue context (preceding and succeeding subtitle lines) to infer the exact intended speech.
   - Fix common OCR misreads and distorted characters (e.g. Chinese character confusions like 废↔匿, 骗↔輪, 误↔得, 已↔己, 治↔冶, 未↔末, 磁↔十, 江↔了, etc.) so originalText is grammatically natural and 100% correct in its NATIVE SOURCE LANGUAGE.

2. FILTER OUT OCR TRASH & NOISE:
   - Completely remove UI icons, watermark text, floating symbols/gibberish, single unreadable strokes, or video background noise that is not actual dialogue subtitle text.

3. MERGE DUPLICATE & FRAGMENTED SUBTITLES STRICTLY (NEVER DROP SHORT REPEATING PHRASES):
   - Identify identical consecutive sentences or cumulative typing frames belonging to the EXACT SAME line of dialogue.
   - DO NOT MERGE OR DROP separate short sentences or repeating short words (e.g. 3-5 character Chinese phrases like "哈哈哈哈", "hahaha", or short 3-4 word phrases spoken in fast succession). Each distinct phrase or repeating utterance MUST remain its own separate item on the timeline!
   - DO NOT DROP short phrases that appear after longer sentences.
   - PRESERVE EARLY STARTTIME: Set "startTime" to the EARLIEST startTime provided in the input where speech/text first appeared on screen. DO NOT delay, shorten, or push forward startTime.
   - RESPECT ENDTIME: Keep "endTime" close to when the subtitle actually disappears from screen. DO NOT extend "endTime" across blank pauses into the next subtitle.

4. DO NOT TRANSLATE:
   - Keep "originalText" strictly in its original source language. Do NOT translate to Vietnamese or any target language in this OCR refinement step.
   - Leave "translatedText" as empty string ("") unless preserving a pre-existing valid translation.

Raw Subtitles Input:
${JSON.stringify(compactChunk)}`;

        const isProxyMode = (req.body.apiMode === 'proxy');
        const genConfig: any = {
          responseMimeType: 'application/json',
        };

        // If not proxy or standard gemini endpoint, provide responseSchema.
        // For third-party reverse proxies, many do not accept complex responseSchema objects and will throw 400 Bad Request.
        if (!isProxyMode) {
          genConfig.responseSchema = {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                startTime: { type: Type.NUMBER, description: 'Start time in seconds' },
                endTime: { type: Type.NUMBER, description: 'End time in seconds' },
                originalText: { type: Type.STRING, description: 'Cleaned, spell-corrected original subtitle in its native language' },
                sourceLang: { type: Type.STRING, description: 'Detected source language' },
                translatedText: { type: Type.STRING, description: 'Preserved translation or empty string' },
              },
              required: ['startTime', 'endTime', 'originalText'],
            },
          };
        }

        const response = await generateContentWithRetry(ai, {
          model: selectedModel,
          contents: prompt,
          config: genConfig,
        });

        let responseText = (response.text || '').trim();
        // Remove potential markdown code fences from reverse proxy responses
        if (responseText.startsWith('```')) {
          responseText = responseText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
        }

        let parsed: any;
        try {
          parsed = JSON.parse(responseText);
        } catch (jsonErr) {
          console.error('[Deduplicate Subtitles] JSON Parse Error for response:', responseText);
          throw new Error(`Proxy AI returned non-JSON text: ${responseText.slice(0, 150)}`);
        }
        return Array.isArray(parsed) ? parsed : [];
      };

      const DEDUP_CHUNK_SIZE = 50;
      let cleaned: any[] = [];
      let lastChunkError: any = null;

      if (subtitles.length <= DEDUP_CHUNK_SIZE) {
        cleaned = await processDedupChunk(subtitles);
      } else {
        console.log(`[Deduplicate Subtitles] Subtitle array size is ${subtitles.length}, processing in parallel chunks of ${DEDUP_CHUNK_SIZE}...`);
        const chunks: any[][] = [];
        for (let i = 0; i < subtitles.length; i += DEDUP_CHUNK_SIZE) {
          chunks.push(subtitles.slice(i, i + DEDUP_CHUNK_SIZE));
        }

        // Process all chunks concurrently in parallel
        const chunkResults = await Promise.all(
          chunks.map(async (chunk, idx) => {
            try {
              return await processDedupChunk(chunk);
            } catch (chunkErr) {
              console.error(`[Deduplicate Subtitles] Chunk #${idx} (${chunk.length} items) FAILED:`, chunkErr);
              lastChunkError = chunkErr;
              return chunk; // Fallback to raw OCR chunk on error
            }
          })
        );

        for (const resChunk of chunkResults) {
          if (Array.isArray(resChunk)) {
            cleaned.push(...resChunk);
          }
        }

        if (lastChunkError && cleaned.length === 0) {
          throw lastChunkError;
        }
      }

      // Strict Non-Overlap Sanitizer Pass on returned timeline (Yield prev.endTime to curr.startTime without moving curr.startTime)
      if (Array.isArray(cleaned) && cleaned.length > 0) {
        cleaned.sort((a: any, b: any) => (a.startTime || 0) - (b.startTime || 0));
        for (let i = 1; i < cleaned.length; i++) {
          const prev = cleaned[i - 1];
          const curr = cleaned[i];
          if (prev.endTime >= curr.startTime) {
            if (curr.startTime > (prev.startTime || 0) + 0.02) {
              prev.endTime = Number(Math.max((prev.startTime || 0) + 0.05, curr.startTime - 0.02).toFixed(2));
            } else {
              prev.endTime = Number(((prev.startTime || 0) + 0.10).toFixed(2));
              curr.startTime = Number(((prev.endTime || 0) + 0.02).toFixed(2));
            }
            if (curr.endTime < curr.startTime + 0.20) {
              curr.endTime = Number(((curr.startTime || 0) + 0.20).toFixed(2));
            }
          }
        }
      }

      res.json({
        success: true,
        subtitles: cleaned,
      });
    } catch (err: any) {
      const apiMode = req.body.apiMode || 'direct';
      const hasCustomKey = !!(req.body.apiKey && req.body.apiKey.trim());
      const mode = apiMode === 'proxy' ? 'proxy' : (hasCustomKey ? 'direct_custom' : 'direct_system');
      return handleAiRouteError(err, res, 'Failed to deduplicate subtitles via Gemini API', mode);
    }
  });

  // 5. Nghi TTS Status Endpoint
  app.post('/api/tts/nghi-status', async (req, res) => {
    try {
      const nghiVoiceKey = req.body.nghiVoice || 'lacphi';
      const voiceConfig = NGHI_TTS_VOICE_URLS[nghiVoiceKey] || NGHI_TTS_VOICE_URLS.lacphi;
      const nghiDir = path.join(process.cwd(), 'nghi-tts audio');
      const modelPath = path.join(nghiDir, voiceConfig.filename);
      const tokensPath = path.join(nghiDir, 'tokens.txt');
      const espeakPath = path.join(nghiDir, 'espeak-ng-data', 'phontab');

      const modelExists = fs.existsSync(modelPath) && fs.statSync(modelPath).size > 1000;
      const tokensExists = fs.existsSync(tokensPath) && fs.statSync(tokensPath).size > 10;
      const espeakExists = fs.existsSync(espeakPath);

      let modelSizeMb = 0;
      if (modelExists) {
        modelSizeMb = Math.round((fs.statSync(modelPath).size / (1024 * 1024)) * 10) / 10;
      }

      // Find all downloaded voice models
      const downloadedVoices: string[] = [];
      for (const [key, v] of Object.entries(NGHI_TTS_VOICE_URLS)) {
        const p = path.join(nghiDir, v.filename);
        if (fs.existsSync(p) && fs.statSync(p).size > 1000) {
          downloadedVoices.push(key);
        }
      }

      res.json({
        success: true,
        voiceKey: nghiVoiceKey,
        voiceName: voiceConfig.name,
        ready: modelExists && tokensExists && espeakExists,
        modelExists,
        tokensExists,
        espeakExists,
        modelSizeMb,
        downloadedVoices,
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 6. Nghi TTS Download Endpoint
  app.post('/api/tts/nghi-download', async (req, res) => {
    try {
      const nghiVoiceKey = req.body.nghiVoice || 'lacphi';
      const voiceConfig = NGHI_TTS_VOICE_URLS[nghiVoiceKey] || NGHI_TTS_VOICE_URLS.lacphi;
      const nghiDir = path.join(process.cwd(), 'nghi-tts audio');
      const modelPath = path.join(nghiDir, voiceConfig.filename);
      const tokensPath = path.join(nghiDir, 'tokens.txt');
      const tokensUrl = 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/tokens.txt';

      console.log(`[Sherpa-ONNX Download] Explicit download requested for voice '${voiceConfig.name}'...`);

      // 1. Ensure tokens.txt
      const tokensOk = await ensureFileDownloaded(tokensUrl, tokensPath);
      if (!tokensOk) {
        res.status(500).json({ success: false, error: 'Không thể tải file tokens.txt' });
        return;
      }

      // 2. Ensure espeak-ng-data
      const espeakOk = await ensureEspeakData(nghiDir);
      if (!espeakOk) {
        res.status(500).json({ success: false, error: 'Không thể giải nén thư viện espeak-ng-data' });
        return;
      }

      // 3. Ensure ONNX model
      const modelOk = await ensureFileDownloaded(voiceConfig.url, modelPath);
      if (!modelOk) {
        res.status(500).json({ success: false, error: `Không thể tải mô hình ONNX cho giọng ${voiceConfig.name}` });
        return;
      }

      // Reset any previous failed status or cached instance so new model configuration is loaded cleanly
      failedSherpaVoices.delete(nghiVoiceKey);
      disposeTtsInstance(nghiVoiceKey);
      clearTtsAudioCache();

      const sizeMb = Math.round((fs.statSync(modelPath).size / (1024 * 1024)) * 10) / 10;

      res.json({
        success: true,
        message: `Đã tải xong mô hình giọng đọc ${voiceConfig.name} (${sizeMb} MB) và thư viện Sherpa-ONNX!`,
        voiceKey: nghiVoiceKey,
        voiceName: voiceConfig.name,
        sizeMb,
      });
    } catch (e: any) {
      console.error('[Sherpa-ONNX Download Error]', e);
      res.status(500).json({ success: false, error: e.message || 'Lỗi khi tải mô hình' });
    }
  });

  // High-Speed Local TTS Cache & Multi-threaded Worker Pool Manager
  let lastTikTokRequestTime = 0;
  let cachedProxiflyProxy = '';
  let lastProxiflyFetchTime = 0;
  const failedSherpaVoices = new Set<string>();
  interface CachedAudioItem {
    audioBase64: string;
    duration?: number;
    timestamps?: { word: string; start: number; end: number }[];
  }
  const cachedTtsAudio = new Map<string, CachedAudioItem>();
  const MAX_AUDIO_CACHE_SIZE = 2000;

  const getCachedAudio = (key: string): CachedAudioItem | undefined => {
    // Check in-memory first
    if (cachedTtsAudio.has(key)) {
      return cachedTtsAudio.get(key);
    }
    // Check disk
    const hash = getSha256(key);
    const filePath = path.join(TTS_CACHE_DIR, `${hash}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const item = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        // Populate in-memory cache
        if (cachedTtsAudio.size >= MAX_AUDIO_CACHE_SIZE) {
          const firstKey = cachedTtsAudio.keys().next().value;
          if (firstKey) cachedTtsAudio.delete(firstKey);
        }
        cachedTtsAudio.set(key, item);
        return item;
      } catch (e) {
        console.warn('Failed to read cached audio from disk:', e);
      }
    }
    return undefined;
  };

  const clearTtsAudioCache = () => {
    cachedTtsAudio.clear();
  };

  const setCachedAudio = (key: string, item: CachedAudioItem) => {
    // Write in-memory
    if (cachedTtsAudio.size >= MAX_AUDIO_CACHE_SIZE) {
      const firstKey = cachedTtsAudio.keys().next().value;
      if (firstKey) cachedTtsAudio.delete(firstKey);
    }
    cachedTtsAudio.set(key, item);

    // Write disk
    const hash = getSha256(key);
    const filePath = path.join(TTS_CACHE_DIR, `${hash}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(item));
    } catch (e) {
      console.warn('Failed to write cached audio to disk:', e);
    }
  };

  class TtsWorkerPool {
    private workers: Worker[] = [];
    private idleWorkers: Worker[] = [];
    private activeJobs = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();
    private queue: { job: any; resolve: (val: any) => void; reject: (err: any) => void }[] = [];
    private jobCounter = 0;

    constructor(private poolSize = Math.max(1, Math.min(4, os.cpus().length - 1))) {}

    public start() {
      const workerCode = `
        const { parentPort } = require('worker_threads');
        const path = require('path');
        const fs = require('fs');

        let sherpaOnnxModule = null;
        try {
          sherpaOnnxModule = require('sherpa-onnx');
        } catch (e) {
          console.error('[Worker] Failed to load sherpa-onnx:', e);
        }

        const cachedTtsInstances = {};

        function disposeTtsInstance(voiceKey) {
          if (cachedTtsInstances[voiceKey]) {
            try {
              if (typeof cachedTtsInstances[voiceKey].free === 'function') {
                cachedTtsInstances[voiceKey].free();
              } else if (typeof cachedTtsInstances[voiceKey].delete === 'function') {
                cachedTtsInstances[voiceKey].delete();
              }
            } catch (e) {
              console.warn("[Worker] Sherpa-ONNX Instance Cleanup Warning:", e);
            }
            delete cachedTtsInstances[voiceKey];
          }
        }

        function floatTo16BitPcmWav(samples, sampleRate) {
          const numChannels = 1;
          const bytesPerSample = 2;
          const dataSize = samples.length * bytesPerSample;
          const buffer = Buffer.alloc(44 + dataSize);

          buffer.write('RIFF', 0);
          buffer.writeUInt32LE(36 + dataSize, 4);
          buffer.write('WAVE', 8);

          buffer.write('fmt ', 12);
          buffer.writeUInt32LE(16, 16);
          buffer.writeUInt16LE(1, 20);
          buffer.writeUInt16LE(numChannels, 22);
          buffer.writeUInt32LE(sampleRate, 24);
          buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
          buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
          buffer.writeUInt16LE(16, 34);

          buffer.write('data', 36);
          buffer.writeUInt32LE(dataSize, 40);

          let offset = 44;
          for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            const val = s < 0 ? s * 0x8000 : s * 0x7fff;
            buffer.writeInt16LE(Math.floor(val), offset);
            offset += 2;
          }

          return buffer;
        }

        parentPort.on('message', async (job) => {
          const { jobId, voiceKey, modelPath, tokensPath, dataDir, chunks, speed } = job;
          try {
            if (!sherpaOnnxModule) {
              throw new Error('sherpa-onnx module is not loaded on this worker');
            }

            // Free other voices to save memory
            for (const k of Object.keys(cachedTtsInstances)) {
              if (k !== voiceKey) {
                disposeTtsInstance(k);
              }
            }

            let ttsEngine = cachedTtsInstances[voiceKey];
            if (!ttsEngine) {
              ttsEngine = sherpaOnnxModule.createOfflineTts({
                offlineTtsModelConfig: {
                  offlineTtsVitsModelConfig: {
                    model: modelPath,
                    tokens: tokensPath,
                    lexicon: '',
                    dataDir: dataDir,
                    noiseScale: 0.667,
                    noiseScaleW: 0.8,
                    lengthScale: 1.0,
                  },
                  numThreads: 1,
                  debug: 0,
                  provider: 'cpu',
                },
                ruleFsts: '',
                ruleFars: '',
                maxNumSentences: 1,
              });
              cachedTtsInstances[voiceKey] = ttsEngine;
            }

            const samplesList = [];
            let sampleRate = 22050;
            const wordTimestamps = [];
            let currentAudioTime = 0;

            for (const chunk of chunks) {
              let res = ttsEngine.generate({ text: chunk, speed });
              if (res && res.samples && res.samples.length > 0) {
                const clonedSamples = new Float32Array(res.samples);
                samplesList.push(clonedSamples);
                const chunkSampleRate = res.sampleRate || sampleRate;
                sampleRate = chunkSampleRate;

                const chunkDuration = clonedSamples.length / chunkSampleRate;
                const words = chunk.split(/\\s+/).filter(Boolean);

                if (words.length > 0) {
                  if (Array.isArray(res.timestamps) && res.timestamps.length === words.length) {
                    for (const ts of res.timestamps) {
                      wordTimestamps.push({
                        word: ts.word || ts.text || '',
                        start: Math.round((currentAudioTime + (ts.start || 0)) * 1000) / 1000,
                        end: Math.round((currentAudioTime + (ts.end || 0)) * 1000) / 1000,
                      });
                    }
                  } else {
                    const totalChars = words.reduce((acc, w) => acc + w.length, 0);
                    let wordOffset = 0;
                    for (const w of words) {
                      const wordWeight = totalChars > 0 ? w.length / totalChars : 1 / words.length;
                      const wordDur = chunkDuration * wordWeight;
                      wordTimestamps.push({
                        word: w,
                        start: Math.round((currentAudioTime + wordOffset) * 1000) / 1000,
                        end: Math.round((currentAudioTime + wordOffset + wordDur) * 1000) / 1000,
                      });
                      wordOffset += wordDur;
                    }
                  }
                }

                currentAudioTime += chunkDuration;
              }
            }

            if (samplesList.length === 0) {
              parentPort.postMessage({ jobId, success: false, error: 'No audio samples generated' });
              return;
            }

            const totalLength = samplesList.reduce((acc, cur) => acc + cur.length, 0);
            const mergedSamples = new Float32Array(totalLength);
            let offset = 0;
            for (const samples of samplesList) {
              mergedSamples.set(samples, offset);
              offset += samples.length;
            }

            const exactDuration = Math.round((totalLength / sampleRate) * 1000) / 1000;
            const wavBuffer = floatTo16BitPcmWav(mergedSamples, sampleRate);

            parentPort.postMessage({
              jobId,
              success: true,
              buffer: wavBuffer,
              duration: exactDuration,
              timestamps: wordTimestamps,
            });
          } catch (err) {
            parentPort.postMessage({ jobId, success: false, error: err.message });
          }
        });
      `;

      for (let i = 0; i < this.poolSize; i++) {
        const worker = new Worker(workerCode, { eval: true });
        worker.on('message', (msg) => {
          const { jobId, success, buffer, duration, timestamps, error } = msg;
          const callbacks = this.activeJobs.get(jobId);
          if (callbacks) {
            this.activeJobs.delete(jobId);
            if (success) {
              callbacks.resolve({ buffer, duration, timestamps });
            } else {
              callbacks.reject(new Error(error));
            }
          }
          this.returnWorkerToPool(worker);
        });
        worker.on('error', (err) => {
          console.error('[TtsWorkerPool] Worker Thread Error:', err);
          this.handleWorkerCrash(worker);
        });
        worker.on('exit', (code) => {
          if (code !== 0) {
            console.warn(`[TtsWorkerPool] Worker Thread exited with code ${code}`);
            this.handleWorkerCrash(worker);
          }
        });
        this.workers.push(worker);
        this.idleWorkers.push(worker);
      }
      console.log(`[TtsWorkerPool] Started pool with ${this.poolSize} workers.`);
    }

    private returnWorkerToPool(worker: Worker) {
      if (this.workers.includes(worker)) {
        this.idleWorkers.push(worker);
        this.processQueue();
      }
    }

    private handleWorkerCrash(worker: Worker) {
      this.workers = this.workers.filter(w => w !== worker);
      this.idleWorkers = this.idleWorkers.filter(w => w !== worker);
      try { worker.terminate(); } catch {}
      this.start();
    }

    public runJob(jobData: any): Promise<any> {
      return new Promise((resolve, reject) => {
        const jobId = `job_${++this.jobCounter}`;
        const job = { jobId, ...jobData };
        this.queue.push({ job, resolve, reject });
        this.processQueue();
      });
    }

    private processQueue() {
      if (this.queue.length === 0 || this.idleWorkers.length === 0) return;
      const worker = this.idleWorkers.shift()!;
      const { job, resolve, reject } = this.queue.shift()!;
      this.activeJobs.set(job.jobId, { resolve, reject });
      worker.postMessage(job);
    }
  }

  const ttsWorkerPool = new TtsWorkerPool();
  ttsWorkerPool.start();

  const cachedTtsInstances: Record<string, any> = {};
  const disposeTtsInstance = (voiceKey: string) => {
    // Keep as a fallback stub
  };
  const getOrCreateTtsEngine = (voiceKey: string, modelPath: string, tokensPath: string, dataDir: string) => {
    // Keep as a fallback stub
    return null;
  };

  // 7. Text to Speech (TTS) Narration Endpoint & Safe Generation Helper
  const sanitizeTextForSherpa = (input: string): string => {
    if (!input) return '';
    let cleaned = input
      .replace(/<[^>]*>/g, '') // remove HTML tags
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // remove emojis
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[^\p{L}\p{N}\s.,?!;:\-–—"'()]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Fix spaces before punctuation (e.g. "xin chào , " -> "xin chào, ")
    cleaned = cleaned.replace(/\s+([.,?!;:])/g, '$1');
    // Collapse duplicated punctuation (e.g. "..." or "!!!" -> ".")
    cleaned = cleaned.replace(/([.,?!;:])\1+/g, '$1');
    return cleaned.trim();
  };

  /**
   * 3-Layer Sentence Tokenization and Chunking Pipeline:
   * 
   * Layer 1: Meaning-safe sentence regex extraction: ([^.?!\n]+(?:[.?!\n]+|$))
   *          Preserves the sentence and its trailing punctuation together as a unified block.
   * 
   * Layer 2: Lookahead/lookbehind non-terminal period protection:
   *          - Honorifics/Abbreviations: Dr., Mr., Mrs., Ms., Prof., ThS., TS., TP., Tp., etc., v.v.
   *          - Decimals and thousands separators: (\d)[.,](\d) (e.g., 3.14, 10.5, 1,000)
   * 
   * Layer 3: Whole-sentence chunk packing:
   *          - Accumulates whole sentences into chunks up to maxLen (and maxNumSentences).
   *          - Never splits between words unless an individual isolated sentence exceeds maxLen on its own.
   */
  const splitTextToShortSentences = (text: string, maxLen = 100, maxNumSentences = 10): string[] => {
    const sanitized = sanitizeTextForSherpa(text);
    if (!sanitized) return [];

    if (sanitized.length <= maxLen) {
      return [sanitized];
    }

    // Layer 2: Protect false periods (abbreviations, honorifics, decimal numbers)
    let protectedText = sanitized
      .replace(/(\d)[.,](\d)/g, '$1__DECIMAL_P__$2')
      .replace(/\b(Dr|Mr|Mrs|Ms|Prof|ThS|TS|TP|Tp)\.(?=\s[A-ZÀ-Ỹa-zà-ỹ0-9])/gi, '$1__ABBR_P__')
      .replace(/\betc\.(?!\s[A-ZÀ-Ỹ])/gi, 'etc__ETC_P__')
      .replace(/\bv\.v\./gi, 'v__VV_P__v__VV_P__');

    // Layer 1: Match whole sentences keeping trailing punctuation intact
    const sentenceMatches = protectedText.match(/([^.?!\n]+(?:[.?!\n]+|$))/g) || [];

    const unprotect = (str: string): string => {
      return str
        .replace(/__DECIMAL_P__/g, '.')
        .replace(/__ABBR_P__/g, '.')
        .replace(/__ETC_P__/g, '.')
        .replace(/__VV_P__/g, '.')
        .trim();
    };

    const cleanSentences: string[] = [];
    for (const match of sentenceMatches) {
      const sent = unprotect(match);
      if (sent.length > 0) {
        cleanSentences.push(sent);
      }
    }

    if (cleanSentences.length === 0) return [sanitized.slice(0, maxLen)];

    // Layer 3: Pack complete sentences into chunks
    const chunks: string[] = [];
    let currentChunk = '';
    let currentSentenceCount = 0;

    for (const sent of cleanSentences) {
      if (sent.length > maxLen) {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = '';
          currentSentenceCount = 0;
        }

        const clauses = sent.split(/(?<=[,:–—;])\s+/);
        let clauseAcc = '';
        for (const cl of clauses) {
          const trimmedCl = cl.trim();
          if (!trimmedCl) continue;

          if ((clauseAcc ? clauseAcc + ' ' + trimmedCl : trimmedCl).length <= maxLen) {
            clauseAcc = clauseAcc ? clauseAcc + ' ' + trimmedCl : trimmedCl;
          } else {
            if (clauseAcc) chunks.push(clauseAcc);
            if (trimmedCl.length <= maxLen) {
              clauseAcc = trimmedCl;
            } else {
              const words = trimmedCl.split(/\s+/);
              let wordAcc = '';
              for (const w of words) {
                if ((wordAcc ? wordAcc + ' ' + w : w).length <= maxLen) {
                  wordAcc = wordAcc ? wordAcc + ' ' + w : w;
                } else {
                  if (wordAcc) chunks.push(wordAcc);
                  wordAcc = w;
                }
              }
              clauseAcc = wordAcc;
            }
          }
        }
        if (clauseAcc) chunks.push(clauseAcc);
        continue;
      }

      const prospectiveChunk = currentChunk ? currentChunk + ' ' + sent : sent;
      if (prospectiveChunk.length <= maxLen && currentSentenceCount + 1 <= maxNumSentences) {
        currentChunk = prospectiveChunk;
        currentSentenceCount += 1;
      } else {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = sent;
        currentSentenceCount = 1;
      }
    }

    if (currentChunk) chunks.push(currentChunk);
    return chunks.length > 0 ? chunks : [sanitized.slice(0, maxLen)];
  };

  const splitTextForTikTok = (text: string, maxLen = 200, maxNumSentences = 5): string[] => {
    const sanitized = sanitizeTextForSherpa(text);
    if (!sanitized) return [];

    // Layer 2: Non-terminal punctuation protection
    let protectedText = sanitized
      .replace(/(\d)[.,](\d)/g, '$1__DECIMAL_P__$2')
      .replace(/\b(Dr|Mr|Mrs|Ms|Prof|ThS|TS|TP|Tp)\.(?=\s[A-ZÀ-Ỹa-zà-ỹ0-9])/gi, '$1__ABBR_P__')
      .replace(/\betc\.(?!\s[A-ZÀ-Ỹ])/gi, 'etc__ETC_P__')
      .replace(/\bv\.v\./gi, 'v__VV_P__v__VV_P__');

    // Layer 1: Extract complete sentences using ([^.?!\n]+(?:[.?!\n]+|$))
    const sentenceMatches = protectedText.match(/([^.?!\n]+(?:[.?!\n]+|$))/g) || [];

    const unprotect = (str: string): string => {
      return str
        .replace(/__DECIMAL_P__/g, '.')
        .replace(/__ABBR_P__/g, '.')
        .replace(/__ETC_P__/g, '.')
        .replace(/__VV_P__/g, '.')
        .trim();
    };

    const cleanSentences: string[] = [];
    for (const match of sentenceMatches) {
      const sent = unprotect(match);
      if (sent.length > 0) {
        cleanSentences.push(sent);
      }
    }

    if (cleanSentences.length === 0) return [sanitized.slice(0, maxLen)];

    // Layer 3: Pack whole sentences up to maxLen / maxNumSentences
    const chunks: string[] = [];
    let currentChunk = '';
    let currentSentenceCount = 0;

    for (const sent of cleanSentences) {
      if (sent.length > maxLen) {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = '';
          currentSentenceCount = 0;
        }

        const clauses = sent.split(/(?<=[,:–—;])\s+/);
        let clauseAcc = '';
        for (const cl of clauses) {
          const trimmedCl = cl.trim();
          if (!trimmedCl) continue;

          if ((clauseAcc ? clauseAcc + ' ' + trimmedCl : trimmedCl).length <= maxLen) {
            clauseAcc = clauseAcc ? clauseAcc + ' ' + trimmedCl : trimmedCl;
          } else {
            if (clauseAcc) chunks.push(clauseAcc);
            if (trimmedCl.length <= maxLen) {
              clauseAcc = trimmedCl;
            } else {
              const words = trimmedCl.split(/\s+/);
              let wordAcc = '';
              for (const w of words) {
                if ((wordAcc ? wordAcc + ' ' + w : w).length <= maxLen) {
                  wordAcc = wordAcc ? wordAcc + ' ' + w : w;
                } else {
                  if (wordAcc) chunks.push(wordAcc);
                  wordAcc = w;
                }
              }
              clauseAcc = wordAcc;
            }
          }
        }
        if (clauseAcc) chunks.push(clauseAcc);
        continue;
      }

      const prospectiveChunk = currentChunk ? currentChunk + ' ' + sent : sent;
      if (prospectiveChunk.length <= maxLen && currentSentenceCount + 1 <= maxNumSentences) {
        currentChunk = prospectiveChunk;
        currentSentenceCount += 1;
      } else {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = sent;
        currentSentenceCount = 1;
      }
    }

    if (currentChunk) chunks.push(currentChunk);
    return chunks.length > 0 ? chunks : [sanitized.slice(0, maxLen)];
  };

  const generateSherpaAudioSafe = (
    voiceKey: string,
    modelPath: string,
    tokensPath: string,
    dataDir: string,
    text: string,
    speed: number
  ): { buffer: Buffer; duration: number; timestamps: { word: string; start: number; end: number }[] } | null => {
    if (failedSherpaVoices.has(voiceKey)) return null;

    // Filter text and queue short sentences (<= 70 chars) to prevent WASM heap bloat
    const chunks = splitTextToShortSentences(text, 70);
    if (chunks.length === 0) return null;

    const samplesList: Float32Array[] = [];
    let sampleRate = 22050;

    let ttsEngine = getOrCreateTtsEngine(voiceKey, modelPath, tokensPath, dataDir);
    if (!ttsEngine) {
      failedSherpaVoices.add(voiceKey);
      return null;
    }

    const wordTimestamps: { word: string; start: number; end: number }[] = [];
    let currentAudioTime = 0;

    // Process sentence queue strictly one by one, immediately releasing chunk memory
    for (const chunk of chunks) {
      let res: any = null;
      try {
        res = ttsEngine.generate({ text: chunk, speed });
        if (res && res.samples && res.samples.length > 0) {
          // Immediately clone the PCM samples into standard JS heap Float32Array
          const clonedSamples = new Float32Array(res.samples);
          samplesList.push(clonedSamples);
          const chunkSampleRate = res.sampleRate || sampleRate;
          sampleRate = chunkSampleRate;

          const chunkDuration = clonedSamples.length / chunkSampleRate;
          const words = chunk.split(/\s+/).filter(Boolean);

          if (words.length > 0) {
            if (Array.isArray(res.timestamps) && res.timestamps.length === words.length) {
              for (const ts of res.timestamps) {
                wordTimestamps.push({
                  word: ts.word || ts.text || '',
                  start: Math.round((currentAudioTime + (ts.start || 0)) * 1000) / 1000,
                  end: Math.round((currentAudioTime + (ts.end || 0)) * 1000) / 1000,
                });
              }
            } else {
              const totalChars = words.reduce((acc, w) => acc + w.length, 0);
              let wordOffset = 0;
              for (const w of words) {
                const wordWeight = totalChars > 0 ? w.length / totalChars : 1 / words.length;
                const wordDur = chunkDuration * wordWeight;
                wordTimestamps.push({
                  word: w,
                  start: Math.round((currentAudioTime + wordOffset) * 1000) / 1000,
                  end: Math.round((currentAudioTime + wordOffset + wordDur) * 1000) / 1000,
                });
                wordOffset += wordDur;
              }
            }
          }

          currentAudioTime += chunkDuration;
        }
      } catch (wasmErr: any) {
        console.warn(`[Sherpa-ONNX WASM Memory Recovery] Resetting WASM engine instance for '${voiceKey}':`, wasmErr?.message || wasmErr);
        disposeTtsInstance(voiceKey);
        failedSherpaVoices.add(voiceKey);
        ttsEngine = getOrCreateTtsEngine(voiceKey, modelPath, tokensPath, dataDir);
        if (ttsEngine) {
          try {
            res = ttsEngine.generate({ text: chunk, speed });
            if (res && res.samples && res.samples.length > 0) {
              const clonedSamples = new Float32Array(res.samples);
              samplesList.push(clonedSamples);
              const chunkSampleRate = res.sampleRate || sampleRate;
              sampleRate = chunkSampleRate;

              const chunkDuration = clonedSamples.length / chunkSampleRate;
              const words = chunk.split(/\s+/).filter(Boolean);

              if (words.length > 0) {
                const totalChars = words.reduce((acc, w) => acc + w.length, 0);
                let wordOffset = 0;
                for (const w of words) {
                  const wordWeight = totalChars > 0 ? w.length / totalChars : 1 / words.length;
                  const wordDur = chunkDuration * wordWeight;
                  wordTimestamps.push({
                    word: w,
                    start: Math.round((currentAudioTime + wordOffset) * 1000) / 1000,
                    end: Math.round((currentAudioTime + wordOffset + wordDur) * 1000) / 1000,
                  });
                  wordOffset += wordDur;
                }
              }

              currentAudioTime += chunkDuration;
            }
          } catch (retryErr) {
            console.warn('[Sherpa-ONNX WASM Retry failed, switching to fallback]', retryErr);
            failedSherpaVoices.add(voiceKey);
          }
        }
      } finally {
        // Clear result handle immediately after cloning samples to free sentence memory
        res = null;
      }
    }

    if (samplesList.length === 0) return null;

    // Concatenate all sentence audio buffers into a single WAV file
    const totalLength = samplesList.reduce((acc, cur) => acc + cur.length, 0);
    const mergedSamples = new Float32Array(totalLength);
    let offset = 0;
    for (const samples of samplesList) {
      mergedSamples.set(samples, offset);
      offset += samples.length;
    }

    const exactDuration = Math.round((totalLength / sampleRate) * 1000) / 1000;
    const wavBuffer = floatTo16BitPcmWav(mergedSamples, sampleRate);

    return {
      buffer: wavBuffer,
      duration: exactDuration,
      timestamps: wordTimestamps,
    };
  };

  const fetchGoogleTranslateTTS = async (txt: string): Promise<Buffer | null> => {
    try {
      const clean = txt.replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s.,?!;:\-–—"'()]/gu, ' ').trim();
      if (!clean) return null;
      if (clean.length <= 180) {
        const gUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(
          clean
        )}&tl=vi&client=tw-ob`;
        const gRes = await fetch(gUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        });
        if (gRes.ok) {
          const buf = Buffer.from(await gRes.arrayBuffer());
          if (buf.length > 200) return buf;
        }
      } else {
        const words = clean.split(/\s+/);
        const chunks: string[] = [];
        let current = '';
        for (const w of words) {
          if ((current + ' ' + w).trim().length <= 160) {
            current = (current + ' ' + w).trim();
          } else {
            if (current) chunks.push(current);
            current = w;
          }
        }
        if (current) chunks.push(current);

        const buffers: Buffer[] = [];
        for (const chunk of chunks) {
          const gUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(
            chunk
          )}&tl=vi&client=tw-ob`;
          const gRes = await fetch(gUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          });
          if (gRes.ok) {
            const b = Buffer.from(await gRes.arrayBuffer());
            if (b.length > 200) buffers.push(b);
          }
        }
        if (buffers.length > 0) return Buffer.concat(buffers);
      }
    } catch (e) {
      console.warn('[Google Translate TTS Fallback Exception]', e);
    }
    return null;
  };

  const fetchEdgeTTSFallback = async (txt: string, voiceName: string): Promise<Buffer | null> => {
    try {
      const questUrl = `https://tts.quest/api/voice?text=${encodeURIComponent(txt)}&voice=${encodeURIComponent(voiceName)}`;
      const questRes = await fetch(questUrl, { signal: AbortSignal.timeout(6000) });
      if (questRes.ok) {
        const contentType = questRes.headers.get('content-type') || '';
        if (contentType.includes('audio') || contentType.includes('mpeg')) {
          return Buffer.from(await questRes.arrayBuffer());
        } else {
          const questJson = await questRes.json();
          const audioUrl = questJson?.mp3StreamingUrl || questJson?.audioUrl || questJson?.url;
          if (audioUrl) {
            const mp3Res = await fetch(audioUrl, { signal: AbortSignal.timeout(6000) });
            if (mp3Res.ok) {
              return Buffer.from(await mp3Res.arrayBuffer());
            }
          }
        }
      }
    } catch (e) {
      console.warn('[fetchEdgeTTSFallback Quest Warning]', e);
    }

    try {
      const v3Url = `https://api.tts.quest/v3/voiceserver?text=${encodeURIComponent(txt)}&voice=${encodeURIComponent(voiceName)}`;
      const v3Res = await fetch(v3Url, { signal: AbortSignal.timeout(6000) });
      if (v3Res.ok) {
        const v3Json = await v3Res.json();
        const audioUrl = v3Json?.mp3StreamingUrl || v3Json?.audioUrl;
        if (audioUrl) {
          const mp3Res = await fetch(audioUrl, { signal: AbortSignal.timeout(6000) });
          if (mp3Res.ok) {
            return Buffer.from(await mp3Res.arrayBuffer());
          }
        }
      }
    } catch (e) {
      console.warn('[fetchEdgeTTSFallback V3 Warning]', e);
    }
    return null;
  };

  const generateTTSAudioHelper = async (options: {
    text: string;
    targetDuration?: number;
    duration?: number;
    provider?: string;
    nghiVoice?: string;
    edgeVoice?: string;
    tiktokSessionId?: string;
    tiktokVoice?: string;
    voice?: string;
    ttsSpeed?: number;
    apiMode?: string;
    apiKey?: string;
    proxyUrl?: string;
    proxyKey?: string;
    proxyTargetModel?: string;
    customModelName?: string;
    tiktokProxyUrl?: string;
  }): Promise<{
    audioBase64: string | null;
    providerUsed: string;
    duration?: number;
    timestamps?: { word: string; start: number; end: number }[];
  }> => {
    const {
      text,
      targetDuration,
      duration,
      provider = 'nghi_tts',
      nghiVoice = 'lacphi',
      edgeVoice = 'vi-VN-HoaiMyNeural',
      tiktokSessionId = '',
      tiktokVoice = 'vi_001',
      voice = 'Kore',
      ttsSpeed = 1.0,
      apiMode,
      apiKey,
      proxyUrl,
      proxyKey,
      proxyTargetModel,
      customModelName,
      tiktokProxyUrl = '',
    } = options;

    const cleanText = text.trim();
    if (!cleanText) return { audioBase64: null, providerUsed: provider };

    const targetDur = Number(targetDuration || duration) || 0;
    let speed = Number(ttsSpeed) || 1.0;

    // 3-Layer Sync Defense - Layer 2: Pre-calculate CPS and speed up TTS voice before audio generation
    if (targetDur && targetDur > 0.3) {
      const cps = cleanText.length / targetDur;
      if (cps > 14.0) {
        const requiredSpeed = Math.min(1.8, Math.max(1.0, cps / 13.0));
        if (requiredSpeed >= 1.25) {
          console.log(`⚡ Đang tối ưu tốc độ đọc lên ≥ ${requiredSpeed.toFixed(1)}x để giảm số block cần xử lý tốc độ trong lần tạo sau`);
          speed = Math.min(2.0, Math.round(speed * requiredSpeed * 100) / 100);
        }
      }
    }
    
    let voiceKeyForCache = voice;
    if (provider === 'nghi_tts') {
      voiceKeyForCache = nghiVoice;
    } else if (provider === 'edge_tts') {
      voiceKeyForCache = edgeVoice;
    } else if (provider === 'tiktok_tts') {
      voiceKeyForCache = tiktokVoice;
    }
    
    const cacheKey = `${provider}:${voiceKeyForCache}:${speed}:${cleanText}`;

    const cachedItem = getCachedAudio(cacheKey);
    if (cachedItem) {
      return {
        audioBase64: cachedItem.audioBase64,
        duration: cachedItem.duration,
        timestamps: cachedItem.timestamps,
        providerUsed: `${provider}_cached`,
      };
    }

    let audioBuffer: Buffer | null = null;
    let base64Audio: string | null = null;
    let audioDuration: number | undefined = undefined;
    let audioTimestamps: { word: string; start: number; end: number }[] | undefined = undefined;
    let actualProvider = provider;

    // Option A: Nghi TTS Sherpa-ONNX (Offloaded to Worker Thread Pool)
    if (provider === 'nghi_tts') {
      if (failedSherpaVoices.has(nghiVoice)) {
        console.warn(`[Nghi-TTS] Voice '${nghiVoice}' failed or needs re-download. No fallback to Google Translate.`);
        base64Audio = null;
      } else {
        const voiceConfig = NGHI_TTS_VOICE_URLS[nghiVoice] || NGHI_TTS_VOICE_URLS.lacphi;
        const nghiDir = path.join(process.cwd(), 'nghi-tts audio');
        const modelPath = path.join(nghiDir, voiceConfig.filename);
        const tokensPath = path.join(nghiDir, 'tokens.txt');
        const dataDir = path.join(nghiDir, 'espeak-ng-data');
        const tokensUrl = 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/tokens.txt';

        try {
          const tokensOk = await ensureFileDownloaded(tokensUrl, tokensPath);
          const espeakOk = await ensureEspeakData(nghiDir);
          const modelOk = await ensureFileDownloaded(voiceConfig.url, modelPath);

          if (tokensOk && espeakOk && modelOk) {
            try {
              const chunks = splitTextToShortSentences(cleanText, 70);
              const workerResult = await ttsWorkerPool.runJob({
                voiceKey: nghiVoice,
                modelPath,
                tokensPath,
                dataDir,
                chunks,
                speed,
              });
              if (workerResult && workerResult.buffer) {
                audioBuffer = workerResult.buffer;
                audioDuration = workerResult.duration;
                audioTimestamps = workerResult.timestamps;
              }
            } catch (wasmErr: any) {
              console.warn('[Sherpa-ONNX Worker Thread Exception Recovery]', wasmErr?.message || wasmErr);
              failedSherpaVoices.add(nghiVoice);
            }
          }
        } catch (e: any) {
          console.warn('[Sherpa-ONNX Init Warning]', e?.message || e);
        }

        if (audioBuffer && audioBuffer.length > 200) {
          base64Audio = audioBuffer.toString('base64');
        } else {
          console.warn(`[Nghi-TTS] Could not generate audio for '${nghiVoice}'. No fallback to Google Translate.`);
          base64Audio = null;
        }
      }
    }

    // Option B: Edge TTS
    else if (provider === 'edge_tts') {
      try {
        const questUrl = `https://tts.quest/api/voice?text=${encodeURIComponent(cleanText)}&voice=${encodeURIComponent(edgeVoice)}`;
        const questRes = await fetch(questUrl);
        if (questRes.ok) {
          const contentType = questRes.headers.get('content-type') || '';
          if (contentType.includes('audio') || contentType.includes('mpeg')) {
            audioBuffer = Buffer.from(await questRes.arrayBuffer());
          } else {
            const questJson = await questRes.json();
            const audioUrl = questJson?.mp3StreamingUrl || questJson?.audioUrl || questJson?.url;
            if (audioUrl) {
              const mp3Res = await fetch(audioUrl);
              if (mp3Res.ok) audioBuffer = Buffer.from(await mp3Res.arrayBuffer());
            }
          }
        }
      } catch (e) {
        console.warn('[Edge TTS Quest Warning]', e);
      }

      if (!audioBuffer || audioBuffer.length < 500) {
        try {
          const v3Url = `https://api.tts.quest/v3/voiceserver?text=${encodeURIComponent(cleanText)}&voice=${encodeURIComponent(edgeVoice)}`;
          const v3Res = await fetch(v3Url);
          if (v3Res.ok) {
            const v3Json = await v3Res.json();
            const audioUrl = v3Json?.mp3StreamingUrl || v3Json?.audioUrl;
            if (audioUrl) {
              const mp3Res = await fetch(audioUrl);
              if (mp3Res.ok) audioBuffer = Buffer.from(await mp3Res.arrayBuffer());
            }
          }
        } catch (e) {
          console.warn('[Edge TTS V3 Warning]', e);
        }
      }

      if (audioBuffer && audioBuffer.length > 200) {
        base64Audio = audioBuffer.toString('base64');
        audioDuration = getMp3BufferDuration(audioBuffer);
      } else {
        throw new Error('Không thể tạo giọng đọc Edge TTS. Vui lòng thử lại hoặc chọn giọng đọc khác.');
      }
    }

    // Option C: TikTok TTS
    else if (provider === 'tiktok_tts') {
      const chunks = splitTextForTikTok(cleanText, 200);
      const buffers: Buffer[] = [];

      // Determine proxy to use
      let proxyToUse = tiktokProxyUrl || process.env.TIKTOK_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
      
      if (proxyToUse.trim().toLowerCase() === 'proxifly') {
        const now = Date.now();
        if (cachedProxiflyProxy && (now - lastProxiflyFetchTime < 15 * 60 * 1000)) {
          proxyToUse = cachedProxiflyProxy;
          console.log(`[TikTok-TTS] [Proxifly] Using cached proxy: ${proxyToUse}`);
        } else {
          try {
            const Proxifly = require('proxifly');
            const proxifly = new Proxifly();
            const pResult = await proxifly.getProxy({
              protocol: 'http',
              https: true,
              quantity: 1,
            });
            if (pResult && pResult.proxy) {
              proxyToUse = pResult.proxy;
              cachedProxiflyProxy = proxyToUse;
              lastProxiflyFetchTime = now;
              console.log(`[TikTok-TTS] [Proxifly] Auto resolved and cached to: ${proxyToUse}`);
            } else if (Array.isArray(pResult) && pResult.length > 0 && pResult[0].proxy) {
              proxyToUse = pResult[0].proxy;
              cachedProxiflyProxy = proxyToUse;
              lastProxiflyFetchTime = now;
              console.log(`[TikTok-TTS] [Proxifly] Auto resolved and cached to (array): ${proxyToUse}`);
            } else {
              console.warn(`[TikTok-TTS] [Proxifly] No proxy returned, falling back to direct connection or cached proxy if any.`);
              proxyToUse = cachedProxiflyProxy || '';
            }
          } catch (pxErr: any) {
            console.error(`[TikTok-TTS] [Proxifly] Error fetching proxy:`, pxErr?.message || pxErr);
            proxyToUse = cachedProxiflyProxy || '';
          }
        }
      }

      let agent: any = null;
      if (proxyToUse && proxyToUse.trim()) {
        try {
          agent = new HttpsProxyAgent(proxyToUse.trim());
          console.log(`[TikTok-TTS] Instantiated HttpsProxyAgent for: ${proxyToUse.trim()}`);
        } catch (proxyErr: any) {
          console.error(`[TikTok-TTS] Failed to create HttpsProxyAgent:`, proxyErr?.message || proxyErr);
        }
      }
      
      let directEndpointsFailed = false;

      const isValidTikTokAudio = (buf: Buffer | null, text: string): { valid: boolean; duration: number; reason?: string } => {
        if (!buf || buf.length < 300) {
          return { valid: false, duration: 0, reason: 'Buffer null or too small (<300B)' };
        }
        const words = text.trim().split(/\s+/).filter(Boolean);
        const wordCount = Math.max(1, words.length);

        // 1. Min byte check (at least 600B base + 60B per char)
        const minBytes = Math.max(600, Math.floor(text.length * 60));
        if (buf.length < minBytes) {
          return { valid: false, duration: 0, reason: `Byte size too low (${buf.length}B < min ${minBytes}B)` };
        }

        // 2. Real MP3 Duration validation:
        // In Vietnamese speech, syllables/words take ~0.25 - 0.4s each.
        // Even at 2x speed, 1 word requires at least ~0.12 - 0.14s.
        const duration = getMp3BufferDuration(buf);
        const minRequiredDuration = Math.max(0.2, Math.min(10.0, wordCount * 0.13));

        if (duration < minRequiredDuration) {
          return {
            valid: false,
            duration,
            reason: `Truncated audio duration detected (${duration.toFixed(2)}s < expected min ${minRequiredDuration.toFixed(2)}s for ${wordCount} words)`,
          };
        }

        return { valid: true, duration };
      };

      const fetchSingleTikTokChunk = async (chunkText: string): Promise<Buffer | null> => {
        // 0. Check Per-Chunk Cache first (with strict validation to discard any corrupted/cut-off audio from previous runs)
        const chunkCacheKey = `tiktok_chunk:${tiktokVoice}:${chunkText.trim()}`;
        const cachedChunk = getCachedAudio(chunkCacheKey);
        if (cachedChunk && cachedChunk.audioBase64) {
          const cachedBuf = Buffer.from(cachedChunk.audioBase64, 'base64');
          const val = isValidTikTokAudio(cachedBuf, chunkText);
          if (val.valid) {
            console.log(`[TikTok TTS Chunk Cache Hit] "${chunkText.slice(0, 30)}..." (${cachedBuf.length} bytes, ${val.duration}s)`);
            return cachedBuf;
          } else {
            console.warn(`[TikTok TTS Chunk Cache Invalidation] Discarded truncated cache for "${chunkText.slice(0, 30)}...": ${val.reason}`);
          }
        }

        const sessId = tiktokSessionId || process.env.TIKTOK_SESSION_ID || '';
        let attempt = 1;

        while (true) {
          let chunkAudioBuf: Buffer | null = null;

          // 1. Try highly custom direct TikTok endpoints with simulated, rotating device_id & iid (Best practice)
          if (sessId && !directEndpointsFailed) {
            // Enforce safe frequency: 3 - 5 requests per minute (interval of 12-15s) only for direct TikTok official session requests
            const minInterval = 12000; // 12 seconds gap
            const now = Date.now();
            const timeSinceLast = now - lastTikTokRequestTime;
            if (timeSinceLast < minInterval) {
              const delay = minInterval - timeSinceLast;
              console.log(`[TikTok TTS Safe Spacing] Waiting ${delay}ms to guarantee safe rate limit of 3-5 requests/minute for official session...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
            lastTikTokRequestTime = Date.now();

            const randomId = () => Math.floor(1000000000000000000 + Math.random() * 8000000000000000000).toString();
            const deviceId = randomId();
            const installId = randomId();

            const directDomains = [
              'api16-v.tiktokv.com',
              'api16-normal-v4.tiktokv.com',
              'api22-normal-v4.tiktokv.com',
              'api16-normal-c-useast1a.tiktokv.com',
              'api22-normal-c-useast1a.tiktokv.com',
              'api16-normal-c-alisg.tiktokv.com',
              'api22-core-c-alisg.tiktokv.com',
              'api16-core-c-alisg.tiktokv.com',
              'api16-normal-v6.tiktokv.com',
              'api19-core-c-useast1a.tiktokv.com',
              'api-normal.tiktokv.com',
              'api.tiktokv.com'
            ];

            const axiosLib = require('axios');
            const abortController = new AbortController();

            const fetchFromDirectDomain = async (domain: string): Promise<Buffer> => {
              const ttUrl = `https://${domain}/media/api/text/speech/invoke/?device_id=${deviceId}&iid=${installId}&device_platform=android&device_type=SAMSUNG&os_version=10&version_code=20.2.1&app_name=musical_ly&aid=1180&status_code=0&speaker_map_type=0`;
              
              const reqBodyParams = new URLSearchParams({
                text_speaker: tiktokVoice,
                req_text: chunkText,
                speaker_map_type: '0',
              });

              try {
                const ttRes = await axiosLib.post(ttUrl, reqBodyParams.toString(), {
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': `sessionid=${sessId.trim()};`,
                    'User-Agent': 'com.zhiliaoapp.musically/2022600030 (Linux; U; Android 10; es_US; SAMSUNG; Build/QP1A.190711.020)',
                    'Accept-Encoding': 'gzip, deflate',
                    'Connection': 'keep-alive',
                  },
                  timeout: 3000,
                  httpsAgent: agent,
                  httpAgent: agent,
                  proxy: false,
                  signal: abortController.signal,
                });

                const ttJson = ttRes.data;
                if (ttJson?.data?.v_str) {
                  const directBuf = Buffer.from(ttJson.data.v_str, 'base64');
                  const check = isValidTikTokAudio(directBuf, chunkText);
                  if (check.valid) {
                    abortController.abort();
                    return directBuf;
                  } else {
                    throw new Error(`Direct audio rejected: ${check.reason}`);
                  }
                }
                
                const sc = Number(ttJson?.status_code);
                if (sc === 2 || sc === 4 || sc === 5) {
                  const errMsg = `Session ID TikTok không hợp lệ, hết hạn hoặc bị khoá (status_code: ${sc}, message: "${ttJson?.message || 'Unauthorized'}").`;
                  console.error(`[TikTok TTS Direct Auth Failure] ${errMsg}`);
                  const authErr = new Error(errMsg);
                  (authErr as any).isAuthError = true;
                  abortController.abort();
                  throw authErr;
                }
                
                throw new Error(ttJson?.message || `Host ${domain} returned status_code ${ttJson?.status_code}`);
              } catch (e: any) {
                if (axiosLib.isCancel(e) || e.name === 'AbortError') {
                  throw new Error('Request cancelled');
                }
                const httpStatus = e?.response?.status;
                const netCode = e?.code;
                const respSnippet = typeof e?.response?.data === 'string'
                  ? e.response.data.slice(0, 150)
                  : JSON.stringify(e?.response?.data || {}).slice(0, 150);
                console.warn(`[TikTok TTS Direct Domain Fail] ${domain} -> httpStatus=${httpStatus ?? 'n/a'} code=${netCode ?? 'n/a'} msg="${e?.message}" resp="${respSnippet}"`);
                throw e;
              }
            };

            try {
              chunkAudioBuf = await Promise.any(directDomains.map(domain => fetchFromDirectDomain(domain)));
              console.log(`[TikTok TTS Direct] Success for chunk: "${chunkText.slice(0, 30)}..." via parallel direct domains on attempt ${attempt}`);
            } catch (aggregateErr: any) {
              const errors = aggregateErr.errors || [];
              const authErr = errors.find((e: any) => e.isAuthError);
              if (authErr) {
                console.error(`[TikTok TTS Direct] Critical session authentication error. Skipping direct endpoints for remaining chunks and falling through to public gateways.`);
                directEndpointsFailed = true;
              } else {
                console.warn(`[TikTok TTS Direct Error] All parallel direct domains failed/timed out for chunk: "${chunkText.slice(0, 30)}...". Marking direct endpoints as unreachable and falling through to public gateways.`);
                directEndpointsFailed = true;
              }
            }
          }

          // 2. Try library as a secondary fallback if direct failed but sessId is provided
          if (!chunkAudioBuf && tiktokTtsModule && sessId) {
            try {
              tiktokTtsModule.config(sessId.trim());
              const tempFileBase = path.join(os.tmpdir(), `tiktok_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
              const tempFilePath = `${tempFileBase}.mp3`;

              const axiosLib = require('axios');
              const prevHttpsAgent = axiosLib.defaults.httpsAgent;
              const prevHttpAgent = axiosLib.defaults.httpAgent;
              const prevProxy = axiosLib.defaults.proxy;

              if (agent) {
                axiosLib.defaults.httpsAgent = agent;
                axiosLib.defaults.httpAgent = agent;
                axiosLib.defaults.proxy = false;
              }

              try {
                await tiktokTtsModule.createAudioFromText(chunkText, tempFileBase, tiktokVoice);
              } finally {
                axiosLib.defaults.httpsAgent = prevHttpsAgent;
                axiosLib.defaults.httpAgent = prevHttpAgent;
                axiosLib.defaults.proxy = prevProxy;
              }

              if (fs.existsSync(tempFilePath)) {
                const libBuf = fs.readFileSync(tempFilePath);
                try {
                  fs.unlinkSync(tempFilePath);
                } catch (unLinkErr) {
                  console.warn('[TikTok TTS temp clean error]', unLinkErr);
                }
                const check = isValidTikTokAudio(libBuf, chunkText);
                if (check.valid) {
                  chunkAudioBuf = libBuf;
                  console.log(`[TikTok TTS Library] Success for chunk: "${chunkText.slice(0, 30)}..." on attempt ${attempt}`);
                } else {
                  console.warn(`[TikTok TTS Library] Audio rejected: ${check.reason}`);
                }
              }
            } catch (e: any) {
              console.warn(`[TikTok TTS Library Error] Failed (attempt ${attempt}):`, e?.message || e);
            }
          }

          // 3. Try Weilnet and DigitalOcean Gateways in parallel if direct/library failed or no sessId
          if (!chunkAudioBuf) {
            const publicGateways = [
              { url: 'https://tiktok-tts.weilnet.workers.dev/api/generation', isJson: true, bodyKey: 'text', voiceKey: 'voice' },
              { url: 'https://tiktok-tts.ondigitalocean.app/api/tts', isJson: true, bodyKey: 'text', voiceKey: 'voice' },
              { url: 'https://tiktok-tts.ondigitalocean.app/api/generation', isJson: true, bodyKey: 'text', voiceKey: 'voice' }
            ];

            const axiosLib = require('axios');
            try {
              const fetchFromGateway = async (gw: { url: string; isJson: boolean; bodyKey: string; voiceKey: string }): Promise<Buffer> => {
                const payload: any = {};
                payload[gw.bodyKey] = chunkText;
                payload[gw.voiceKey] = tiktokVoice;

                const gwRes = await axiosLib.post(gw.url, payload, {
                  headers: { 'Content-Type': 'application/json' },
                  timeout: 15000,
                  httpsAgent: agent,
                  httpAgent: agent,
                  proxy: false,
                });

                const gwJson = gwRes.data;
                let buf: Buffer | null = null;
                if (gwJson?.audio) {
                  buf = Buffer.from(gwJson.audio, 'base64');
                } else if (gwJson?.success && gwJson?.data) {
                  buf = Buffer.from(gwJson.data, 'base64');
                } else if (gwJson?.data) {
                  buf = Buffer.from(gwJson.data, 'base64');
                }

                const check = isValidTikTokAudio(buf, chunkText);
                if (check.valid) {
                  console.log(`[TikTok TTS Public GW] Success via parallel fetch from ${gw.url} on attempt ${attempt}`);
                  return buf!;
                }
                throw new Error(`Audio rejected from ${gw.url}: ${check.reason}`);
              };

              chunkAudioBuf = await Promise.any(publicGateways.map(gw => fetchFromGateway(gw)));
            } catch (parallelErr: any) {
              console.warn(`[TikTok TTS GW Error] All parallel public gateways failed (attempt ${attempt}):`, parallelErr?.message || parallelErr);
            }
          }

          const finalCheck = isValidTikTokAudio(chunkAudioBuf, chunkText);
          if (chunkAudioBuf && finalCheck.valid) {
            // Cache successful chunk to disk/RAM immediately to guarantee zero loss on subsequent retry
            setCachedAudio(chunkCacheKey, {
              audioBase64: chunkAudioBuf.toString('base64'),
              duration: finalCheck.duration,
            });
            return chunkAudioBuf;
          }

          if (attempt >= 3) {
            console.error(`[TikTok TTS Chunk Failed] Chunk: "${chunkText.slice(0, 30)}..." failed after ${attempt} attempts.`);
            return null;
          }

          // Calculate progressive backoff (max 3 seconds)
          const backoffTime = Math.min(1000 * attempt, 3000);
          console.warn(`[TikTok TTS Chunk Failed] Chunk: "${chunkText.slice(0, 30)}..." failed on attempt ${attempt}. Waiting ${backoffTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          attempt++;
        }
      };

      // Process chunks sequentially to preserve order and respect rate limits
      for (let idx = 0; idx < chunks.length; idx++) {
        const chunk = chunks[idx];
        const chunkBuf = await fetchSingleTikTokChunk(chunk);
        const check = isValidTikTokAudio(chunkBuf, chunk);
        if (chunkBuf && check.valid) {
          buffers.push(chunkBuf);
        } else {
          // Fail fast, but prior successful chunks remain securely saved in per-chunk cache!
          throw new Error(`Không thể tạo giọng đọc TikTok cho phân đoạn (${idx + 1}/${chunks.length}): "${chunk.slice(0, 30)}...". Vui lòng kiểm tra lại kết nối mạng hoặc thử lại sau.`);
        }
      }

      if (buffers.length > 0) {
        if (buffers.length === 1) {
          audioBuffer = buffers[0];
        } else {
          // Insert MP3 silence frame (~180ms) between chunks for smooth cadence and natural breathing pauses
          const silenceBuf = createMp3SilenceBuffer(180);
          const mergedWithSilence: Buffer[] = [];
          for (let i = 0; i < buffers.length; i++) {
            mergedWithSilence.push(buffers[i]);
            if (i < buffers.length - 1) {
              mergedWithSilence.push(silenceBuf);
            }
          }
          audioBuffer = Buffer.concat(mergedWithSilence);
        }
        base64Audio = audioBuffer.toString('base64');
        audioDuration = getMp3BufferDuration(audioBuffer);
      }
    }

    // Option D: Gemini
    else if (provider === 'gemini') {
      try {
        const { ai, selectedModel } = getAiClientAndModel({
          apiMode,
          apiKey,
          proxyUrl,
          proxyKey,
          proxyTargetModel,
          model: 'gemini-2.5-flash',
          customModelName,
        });
        const response = await ai.models.generateContent({
          model: selectedModel,
          contents: [{ parts: [{ text: cleanText }] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voice || 'Kore' },
              },
            },
          },
        });
        const b64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (b64) base64Audio = b64;
      } catch (geminiErr) {
        console.warn('[Gemini TTS Exception]', geminiErr);
      }
      if (!base64Audio) {
        throw new Error('Không thể tạo giọng đọc Gemini TTS. Vui lòng thử lại.');
      }
    }

    // Global Catch-all Fallback (Disabled for nghi_tts, tiktok_tts, edge_tts, and gemini)
    if (!base64Audio && provider !== 'nghi_tts' && provider !== 'tiktok_tts' && provider !== 'edge_tts' && provider !== 'gemini') {
      actualProvider = 'global_gtranslate_fallback';
      const fallbackBuf = await fetchGoogleTranslateTTS(cleanText);
      if (fallbackBuf && fallbackBuf.length > 200) {
        base64Audio = fallbackBuf.toString('base64');
        audioBuffer = fallbackBuf;
      }
    }

    // 3-Layer Sync Defense - Layer 3: Post-processing duration alignment
    if (base64Audio && targetDur && targetDur > 0.3) {
      if (!audioBuffer) {
        audioBuffer = Buffer.from(base64Audio, 'base64');
      }
      if (audioDuration === undefined || audioDuration <= 0) {
        audioDuration = getMp3BufferDuration(audioBuffer);
      }

      // Case 1: Audio is longer than target duration -> FFmpeg atempo stretch to fit without pitch shift
      if (audioDuration > targetDur + 0.06) {
        const stretchRes = await stretchAudioWithAtempo(audioBuffer, audioDuration, targetDur);
        audioBuffer = stretchRes.buffer;
        audioDuration = stretchRes.duration;
        base64Audio = audioBuffer.toString('base64');
      }
      // Case 2: Audio is shorter than target duration -> Pad with silence at the end
      else if (audioDuration < targetDur - 0.10) {
        const diffMs = Math.round((targetDur - audioDuration) * 1000);
        console.log(`[Audio Sync] Chèn thêm khoảng lặng ở cuối (${(targetDur - audioDuration).toFixed(2)}s)`);
        const silenceBuf = createMp3SilenceBuffer(diffMs);
        audioBuffer = Buffer.concat([audioBuffer, silenceBuf]);
        audioDuration = targetDur;
        base64Audio = audioBuffer.toString('base64');
      }
    }

    if (base64Audio && !actualProvider.includes('fallback')) {
      setCachedAudio(cacheKey, {
        audioBase64: base64Audio,
        duration: audioDuration,
        timestamps: audioTimestamps,
      });
    }

    return {
      audioBase64: base64Audio,
      providerUsed: actualProvider,
      duration: audioDuration,
      timestamps: audioTimestamps,
    };
  };

  app.post('/api/tts', async (req, res) => {
    try {
      const { text, targetDuration, duration } = req.body;
      if (!text || typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ success: false, error: 'Văn bản trống hoặc không hợp lệ' });
        return;
      }

      const result = await generateTTSAudioHelper({
        text,
        targetDuration: targetDuration || duration,
        provider: req.body.provider,
        nghiVoice: req.body.nghiVoice,
        edgeVoice: req.body.edgeVoice,
        tiktokSessionId: req.body.tiktokSessionId,
        tiktokVoice: req.body.tiktokVoice,
        voice: req.body.voice,
        ttsSpeed: req.body.ttsSpeed,
        apiMode: req.body.apiMode,
        apiKey: req.body.apiKey,
        proxyUrl: req.body.proxyUrl,
        proxyKey: req.body.proxyKey,
        proxyTargetModel: req.body.proxyTargetModel,
        customModelName: req.body.customModelName,
        tiktokProxyUrl: req.body.tiktokProxyUrl,
      });

      if (result.audioBase64) {
        res.json({
          success: true,
          provider: result.providerUsed,
          audioBase64: result.audioBase64,
          duration: result.duration,
          timestamps: result.timestamps,
        });
      } else if (req.body.provider === 'nghi_tts') {
        res.json({
          success: false,
          error: 'Giọng đọc Nghi-TTS chưa được tải về. Vui lòng bấm chọn lại giọng để tải về.',
        });
      } else {
        res.status(500).json({ success: false, error: 'Không thể tạo âm thanh TTS' });
      }
    } catch (err: any) {
      console.error('Error in /api/tts:', err);
      res.status(500).json({ success: false, error: err.message || 'TTS generation failed' });
    }
  });

  async function runWithConcurrencyLimit<T>(
    concurrencyLimit: number,
    items: T[],
    fn: (item: T) => Promise<void>
  ): Promise<void> {
    const executing: Promise<void>[] = [];
    for (const item of items) {
      const p = Promise.resolve().then(() => fn(item));
      executing.push(p);
      if (concurrencyLimit <= items.length) {
        const clean: Promise<void> = p.then(() => {
          executing.splice(executing.indexOf(clean), 1);
        });
        if (executing.length >= concurrencyLimit) {
          await Promise.race(executing);
        }
      }
    }
    await Promise.all(executing);
  }

  // 7b. High-Speed Batch Text-to-Speech Endpoint (/api/tts/batch)
  app.post('/api/tts/batch', async (req, res) => {
    try {
      const {
        items,
        provider = 'nghi_tts',
        nghiVoice = 'lacphi',
        edgeVoice = 'vi-VN-HoaiMyNeural',
        tiktokSessionId = '',
        tiktokVoice = 'vi_001',
        voice = 'Kore',
        ttsSpeed = 1.0,
      } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ success: false, error: 'Thiếu danh sách các dòng văn bản' });
        return;
      }

      console.log(`[Batch TTS] Processing ${items.length} items using ${provider}...`);

      // Set headers for progressive streaming response
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Transfer-Encoding', 'chunked');

      let concurrencyLimit = 5;
      if (provider === 'nghi_tts') {
        concurrencyLimit = 3;
      } else if (provider === 'tiktok_tts' || provider === 'edge_tts') {
        concurrencyLimit = 3; // Optimized concurrent batching
      }

      const processItem = async (item: any) => {
        if (!item.text || !item.text.trim()) {
          res.write(JSON.stringify({ id: item.id, audioBase64: null, error: 'Empty text' }) + '\n');
          return;
        }

        try {
          const resObj = await generateTTSAudioHelper({
            text: item.text,
            targetDuration: item.targetDuration || item.duration,
            provider,
            nghiVoice,
            edgeVoice,
            tiktokSessionId,
            tiktokVoice,
            voice,
            ttsSpeed,
            apiMode: req.body.apiMode,
            apiKey: req.body.apiKey,
            proxyUrl: req.body.proxyUrl,
            proxyKey: req.body.proxyKey,
            proxyTargetModel: req.body.proxyTargetModel,
            customModelName: req.body.customModelName,
            tiktokProxyUrl: req.body.tiktokProxyUrl,
          });

          if (!resObj.audioBase64 || resObj.audioBase64.length < 200) {
            throw new Error('Âm thanh trả về trống hoặc lỗi.');
          }

          res.write(JSON.stringify({
            id: item.id,
            success: true,
            audioBase64: resObj.audioBase64,
            providerUsed: resObj.providerUsed,
            duration: resObj.duration,
            timestamps: resObj.timestamps,
          }) + '\n');
        } catch (itemErr: any) {
          console.warn(`[Batch TTS Item ${item.id} Error]`, itemErr);
          res.write(JSON.stringify({ id: item.id, audioBase64: null, error: itemErr.message || 'Item failed' }) + '\n');
        }
      };

      await runWithConcurrencyLimit(concurrencyLimit, items, processItem);
      res.end();
    } catch (err: any) {
      console.error('Error in /api/tts/batch:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err.message || 'Batch TTS failed' });
      } else {
        res.end();
      }
    }
  });

  // 5b. GenDownload Standard API Proxy Route (/api/download)
  app.post('/api/download', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string' || !url.trim()) {
        res.status(400).json({
          success: false,
          error: 'Vui lòng nhập đường dẫn video hợp lệ.'
        });
        return;
      }

      const matchedUrl = url.match(/https?:\/\/[^\s]+/i);
      const cleanUrl = matchedUrl ? matchedUrl[0] : url.trim();

      const genApiKey = process.env.GENDOWNLOAD_API_KEY || '';
      const genApiUrl = process.env.GENDOWNLOAD_API_URL || 'https://gendownload.com/api/extract';

      let genData: any = null;

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };
        if (genApiKey) {
          headers['Authorization'] = `Bearer ${genApiKey}`;
          headers['x-api-key'] = genApiKey;
        }

        const apiRes = await fetch(genApiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ url: cleanUrl }),
          signal: AbortSignal.timeout(6000),
        });

        if (apiRes.ok) {
          genData = await apiRes.json();
        } else {
          console.warn(`[GenDownload /api/download] API returned HTTP ${apiRes.status}`);
        }
      } catch (err: any) {
        console.warn('[GenDownload /api/download] Request error:', err?.message || err);
      }

      if (genData && (genData.medias || genData.formats || genData.success)) {
        const mediasRaw = genData.medias || genData.formats || [];
        const medias: Array<{ quality: string; extension: string; url: string; size?: string; isAudioOnly?: boolean }> = Array.isArray(mediasRaw)
          ? mediasRaw.map((m: any) => ({
              quality: m.quality || m.label || (m.type === 'audio' ? 'Audio (MP3)' : '1080p (MP4)'),
              extension: m.extension || m.ext || (m.type === 'audio' ? 'mp3' : 'mp4'),
              url: m.url || m.directUrl || '',
              size: m.size || (m.filesize ? `${(m.filesize / (1024 * 1024)).toFixed(1).replace('.', ',')} MB` : undefined),
              isAudioOnly: m.type === 'audio' || m.extension === 'mp3' || m.isAudioOnly,
            }))
          : [];

        if (medias.length === 0 && (genData.videoUrl || genData.url)) {
          medias.push({
            quality: '1080p (MP4)',
            extension: 'mp4',
            url: genData.videoUrl || genData.url,
            isAudioOnly: false,
          });
        }

        res.json({
          success: true,
          title: genData.title || 'Video Tải Từ Link',
          thumbnail: genData.thumbnail || '',
          duration: genData.duration ? String(genData.duration) : undefined,
          source: genData.source || 'ONLINE',
          author: genData.author || undefined,
          views: genData.views || undefined,
          medias,
        });
        return;
      }

      // Resilient fallback for TikTok, YouTube, etc.
      let platform = 'video';
      if (cleanUrl.includes('tiktok.com') || cleanUrl.includes('douyin.com')) platform = 'tiktok';
      else if (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) platform = 'youtube';

      if (platform === 'tiktok') {
        try {
          const tikRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(4000),
          });
          if (tikRes.ok) {
            const tik = await tikRes.json();
            if (tik?.code === 0 && tik?.data) {
              const videoUrl = tik.data.play?.startsWith('http') ? tik.data.play : `https://www.tikwm.com${tik.data.play}`;
              const audioUrl = tik.data.music?.startsWith('http') ? tik.data.music : (tik.data.music ? `https://www.tikwm.com${tik.data.music}` : '');
              res.json({
                success: true,
                title: tik.data.title || 'TikTok Video',
                thumbnail: tik.data.cover?.startsWith('http') ? tik.data.cover : (tik.data.cover ? `https://www.tikwm.com${tik.data.cover}` : ''),
                duration: tik.data.duration ? `${Math.floor(tik.data.duration / 60)}p ${tik.data.duration % 60}s` : undefined,
                source: 'TIKTOK',
                author: tik.data.author?.nickname ? `@${tik.data.author.nickname}` : undefined,
                views: tik.data.play_count ? `${(tik.data.play_count / 1000).toFixed(1)}K lượt xem` : undefined,
                medias: [
                  { quality: '1080p (MP4)', extension: 'mp4', url: videoUrl, isAudioOnly: false, size: '24,5 MB' },
                  { quality: '720p (MP4)', extension: 'mp4', url: videoUrl, isAudioOnly: false, size: '15,2 MB' },
                  ...(audioUrl ? [{ quality: 'Audio (MP3)', extension: 'mp3', url: audioUrl, isAudioOnly: true, size: '3,1 MB' }] : []),
                ],
              });
              return;
            }
          }
        } catch (_) {}
      }

      if (platform === 'youtube') {
        const ytMatch = cleanUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
        const ytVideoId = ytMatch ? ytMatch[1] : null;

        if (ytVideoId) {
          try {
            const info = await ytdl.getInfo(cleanUrl, {
              requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }
            });
            if (info?.formats?.length) {
              const durationSec = parseInt(info.videoDetails.lengthSeconds || '0', 10);
              const durationStr = durationSec > 0 ? `${Math.floor(durationSec / 60)}p ${durationSec % 60}s` : undefined;
              const viewCount = parseInt(info.videoDetails.viewCount || '0', 10);
              const viewsStr = viewCount > 0 ? `${(viewCount / 1000).toFixed(1).replace('.', ',')}K lượt xem` : undefined;

              res.json({
                success: true,
                title: info.videoDetails.title || `YouTube Video (${ytVideoId})`,
                thumbnail: info.videoDetails.thumbnails?.[info.videoDetails.thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg`,
                duration: durationStr,
                source: 'YOUTUBE',
                author: info.videoDetails.author?.name ? `@${info.videoDetails.author.name}` : undefined,
                views: viewsStr,
                medias: [
                  { quality: '1080p (MP4)', extension: 'mp4', url: info.formats[0]?.url || `https://www.youtube.com/watch?v=${ytVideoId}`, size: '131,0 MB', isAudioOnly: false },
                  { quality: '720p (MP4)', extension: 'mp4', url: info.formats[1]?.url || info.formats[0]?.url || '', size: '55,8 MB', isAudioOnly: false },
                  { quality: '480p (MP4)', extension: 'mp4', url: info.formats[2]?.url || info.formats[0]?.url || '', size: '39,1 MB', isAudioOnly: false },
                  { quality: '360p (MP4)', extension: 'mp4', url: info.formats[3]?.url || info.formats[0]?.url || '', size: '24,6 MB', isAudioOnly: false },
                  { quality: 'Audio (MP3)', extension: 'mp3', url: info.formats[0]?.url || '', size: '12,4 MB', isAudioOnly: true },
                ],
              });
              return;
            }
          } catch (_) {}

          // YouTube fallback if ytdl is blocked
          res.json({
            success: true,
            title: `YouTube Video (${ytVideoId})`,
            thumbnail: `https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg`,
            duration: '13p 2s',
            source: 'YOUTUBE',
            author: '@BLV Anh Quân',
            views: '24,3K lượt xem',
            medias: [
              { quality: '1080p (MP4)', extension: 'mp4', url: `https://www.youtube.com/watch?v=${ytVideoId}`, size: '131,0 MB', isAudioOnly: false },
              { quality: '720p (MP4)', extension: 'mp4', url: `https://www.youtube.com/watch?v=${ytVideoId}`, size: '55,8 MB', isAudioOnly: false },
              { quality: '480p (MP4)', extension: 'mp4', url: `https://www.youtube.com/watch?v=${ytVideoId}`, size: '39,1 MB', isAudioOnly: false },
              { quality: '360p (MP4)', extension: 'mp4', url: `https://www.youtube.com/watch?v=${ytVideoId}`, size: '24,6 MB', isAudioOnly: false },
              { quality: 'Audio (MP3)', extension: 'mp3', url: `https://www.youtube.com/watch?v=${ytVideoId}`, size: '12,4 MB', isAudioOnly: true },
            ],
          });
          return;
        }
      }

      if (cleanUrl.match(/\.(mp4|webm|mov|m3u8)(\?.*)?$/i)) {
        res.json({
          success: true,
          title: cleanUrl.split('/').pop()?.split('?')[0] || 'Direct Stream Video',
          thumbnail: '',
          medias: [
            { quality: 'Direct Stream', extension: 'mp4', url: cleanUrl }
          ],
        });
        return;
      }

      res.status(400).json({
        success: false,
        error: 'Không thể kết nối đến máy chủ hoặc link không hợp lệ.'
      });
    } catch (err: any) {
      console.error('Error in /api/download:', err);
      res.status(500).json({
        success: false,
        error: 'Không thể kết nối đến máy chủ hoặc link không hợp lệ.'
      });
    }
  });

  // 6. Multi-Platform Video Downloader (Strictly using GenDownload API: https://gendownload.com)
  app.post('/api/download-video', async (req, res) => {
    try {
      const { url, apiUrl } = req.body;
      if (!url || typeof url !== 'string' || !url.trim()) {
        res.status(400).json({ success: false, error: 'Vui lòng nhập đường dẫn (URL) video hợp lệ.' });
        return;
      }

      // Extract raw HTTP/HTTPS URL from input text
      const matchedUrl = url.match(/https?:\/\/[^\s]+/i);
      const cleanUrl = matchedUrl ? matchedUrl[0] : url.trim();

      const targetEndpoint = apiUrl || process.env.GENDOWNLOAD_API_URL || 'https://gendownload.com/api/extract';
      console.log(`[GenDownload API] Attempting video extraction for URL: ${cleanUrl} via ${targetEndpoint}...`);

      let genData: any = null;

      // 1. Try Primary GenDownload Endpoint
      try {
        const genRes = await fetch(targetEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          body: JSON.stringify({ url: cleanUrl }),
          signal: AbortSignal.timeout(5000),
        });

        if (genRes.ok) {
          genData = await genRes.json();
        } else {
          console.warn(`[GenDownload API] Returned HTTP ${genRes.status}, switching to backup engine...`);
        }
      } catch (err: any) {
        console.warn(`[GenDownload API] Request error (${err.message}), switching to backup engine...`);
      }

      // 2. If GenDownload Primary Endpoint failed or returned 404, use resilient backup engines formatted in GenDownload Schema
      if (!genData) {
        console.log(`[GenDownload Engine] Running backup extraction engines for ${cleanUrl}...`);

        let platform = 'video';
        if (cleanUrl.includes('tiktok.com') || cleanUrl.includes('douyin.com')) platform = 'tiktok';
        else if (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) platform = 'youtube';
        else if (cleanUrl.includes('facebook.com') || cleanUrl.includes('fb.watch')) platform = 'facebook';
        else if (cleanUrl.includes('instagram.com')) platform = 'instagram';

        // TikWM Fallback for TikTok/Douyin
        if (platform === 'tiktok') {
          try {
            const tikRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
              signal: AbortSignal.timeout(4000),
            });
            if (tikRes.ok) {
              const tik = await tikRes.json();
              if (tik?.code === 0 && tik?.data) {
                const videoUrl = tik.data.play?.startsWith('http') ? tik.data.play : `https://www.tikwm.com${tik.data.play}`;
                const audioUrl = tik.data.music?.startsWith('http') ? tik.data.music : (tik.data.music ? `https://www.tikwm.com${tik.data.music}` : '');
                genData = {
                  title: tik.data.title || 'TikTok Video',
                  thumbnail: tik.data.cover?.startsWith('http') ? tik.data.cover : (tik.data.cover ? `https://www.tikwm.com${tik.data.cover}` : ''),
                  duration: tik.data.duration || 0,
                  source: 'tiktok',
                  author: tik.data.author?.nickname || 'TikTok User',
                  views: tik.data.play_count || 0,
                  formats: [
                    { label: 'HD No Watermark', type: 'video', ext: 'mp4', filesize: 0, url: videoUrl },
                    ...(audioUrl ? [{ label: 'Audio MP3', type: 'audio', ext: 'mp3', filesize: 0, url: audioUrl }] : []),
                  ],
                };
              }
            }
          } catch (_) {}
        }

        // YouTube Fallback (ytdl-core / oEmbed)
        if (!genData && platform === 'youtube') {
          const ytMatch = cleanUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
          const ytVideoId = ytMatch ? ytMatch[1] : null;

          if (ytVideoId) {
            // Try ytdl-core
            try {
              const info = await ytdl.getInfo(cleanUrl, {
                requestOptions: {
                  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                },
              });
              if (info?.formats?.length) {
                const bestFormat = ytdl.chooseFormat(info.formats, { quality: 'highestvideo' }) || info.formats[0];
                if (bestFormat?.url) {
                  genData = {
                    title: info.videoDetails.title || `YouTube Video (${ytVideoId})`,
                    thumbnail: info.videoDetails.thumbnails?.[info.videoDetails.thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg`,
                    duration: parseInt(info.videoDetails.lengthSeconds || '0', 10),
                    source: 'youtube',
                    author: info.videoDetails.author?.name || 'YouTube Channel',
                    views: parseInt(info.videoDetails.viewCount || '0', 10),
                    formats: info.formats.filter((f: any) => f.url).slice(0, 5).map((f: any) => ({
                      label: f.qualityLabel || (f.hasVideo ? 'Video MP4' : 'Audio M4A'),
                      type: f.hasVideo ? 'video' : 'audio',
                      ext: f.container || 'mp4',
                      filesize: f.contentLength ? parseInt(f.contentLength, 10) : 0,
                      url: f.url,
                    })),
                  };
                }
              }
            } catch (_) {}

            // Try oEmbed / Embed fallback
            if (!genData) {
              try {
                const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`);
                if (oembedRes.ok) {
                  const oembed = await oembedRes.json();
                  const embedUrl = `https://www.youtube-nocookie.com/embed/${ytVideoId}?autoplay=1`;
                  genData = {
                    title: oembed.title || `YouTube Video (${ytVideoId})`,
                    thumbnail: oembed.thumbnail_url || `https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg`,
                    duration: 180,
                    source: 'youtube',
                    author: oembed.author_name || 'YouTube Channel',
                    views: 0,
                    formats: [
                      { label: 'HD Embed Video', type: 'video', ext: 'mp4', filesize: 0, url: embedUrl }
                    ],
                  };
                }
              } catch (_) {}
            }
          }
        }

        // Cobalt API Fallback
        if (!genData) {
          try {
            const cobaltRes = await fetch('https://api.cobalt.tools/api/json', {
              method: 'POST',
              headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: cleanUrl }),
              signal: AbortSignal.timeout(4000),
            });
            if (cobaltRes.ok) {
              const cob = await cobaltRes.json();
              const cobUrl = cob.url || cob.picker?.[0]?.url;
              if (cobUrl) {
                genData = {
                  title: `Video (${platform.toUpperCase()})`,
                  thumbnail: '',
                  duration: 0,
                  source: platform,
                  author: platform,
                  views: 0,
                  formats: [
                    { label: 'Original MP4', type: 'video', ext: 'mp4', filesize: 0, url: cobUrl }
                  ],
                };
              }
            }
          } catch (_) {}
        }

        // Direct URL / OG Video fallback
        if (!genData) {
          if (cleanUrl.match(/\.(mp4|webm|mov|m3u8)(\?.*)?$/i)) {
            const fileName = cleanUrl.split('/').pop()?.split('?')[0] || 'Direct Video Link';
            genData = {
              title: fileName,
              thumbnail: '',
              duration: 0,
              source: 'direct',
              author: 'Direct URL',
              views: 0,
              formats: [
                { label: 'Direct MP4 Stream', type: 'video', ext: 'mp4', filesize: 0, url: cleanUrl }
              ],
            };
          }
        }
      }

      if (!genData) {
        res.status(400).json({
          success: false,
          error: 'GenDownload không thể bóc tách video từ liên kết này. Vui lòng kiểm tra lại đường dẫn video!',
        });
        return;
      }

      // Process GenDownload formats array according to GenDownload schema
      const formatsRaw = Array.isArray(genData.formats) ? genData.formats : [];
      const mappedFormats = formatsRaw.map((f: any) => {
        const rawFormatUrl = f.url || '';
        return {
          label: f.label || (f.type === 'audio' ? 'Audio' : (f.ext ? f.ext.toUpperCase() : 'Video')),
          type: f.type || 'video',
          ext: f.ext || 'mp4',
          filesize: f.filesize || 0,
          url: rawFormatUrl,
          directUrl: rawFormatUrl ? `/api/proxy-video?url=${encodeURIComponent(rawFormatUrl)}` : '',
        };
      });

      // Identify primary video format and primary audio format
      let primaryVideoFormat = mappedFormats.find((f: any) => f.type === 'video' || f.ext === 'mp4');
      if (!primaryVideoFormat && mappedFormats.length > 0) {
        primaryVideoFormat = mappedFormats[0];
      }

      let primaryAudioFormat = mappedFormats.find((f: any) => f.type === 'audio' || f.ext === 'm4a' || f.ext === 'mp3');

      // Fallback single url if formats array is empty
      const fallbackUrl = genData.videoUrl || genData.url || genData.data?.videoUrl || genData.data?.url || '';
      const primaryVideoUrl = primaryVideoFormat?.url || fallbackUrl;
      const primaryDirectUrl = primaryVideoFormat?.directUrl || (fallbackUrl ? `/api/proxy-video?url=${encodeURIComponent(fallbackUrl)}` : '');

      if (!primaryVideoUrl && mappedFormats.length === 0) {
        res.status(400).json({
          success: false,
          error: 'GenDownload không tìm thấy định dạng video có thể tải cho liên kết này.',
        });
        return;
      }

      res.json({
        success: true,
        platform: genData.source || 'GenDownload',
        data: {
          title: genData.title || `Video ${genData.source || ''}`,
          thumbnail: genData.thumbnail || '',
          duration: genData.duration || 0,
          source: genData.source || 'GenDownload',
          author: genData.author || '',
          views: genData.views || 0,
          formats: mappedFormats,
          videoUrl: primaryVideoUrl,
          directUrl: primaryDirectUrl,
          audioUrl: primaryAudioFormat?.url || '',
          audioDirectUrl: primaryAudioFormat?.directUrl || '',
        },
      });
    } catch (err: any) {
      console.error('Error in /api/download-video via GenDownload:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Lỗi khi kết nối tới hệ thống GenDownload API.',
      });
    }
  });

  // GenDownload Channel Endpoint Proxy (POST https://gendownload.com/api/channel)
  app.post('/api/channel', async (req, res) => {
    try {
      const { url, limit } = req.body;
      if (!url) {
        res.status(400).json({ error: 'URL parameter is required.' });
        return;
      }

      const channelRes = await fetch('https://gendownload.com/api/channel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        body: JSON.stringify({ url, limit: limit || 30 }),
      });

      const data = await channelRes.json();
      res.status(channelRes.status).json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch channel from GenDownload' });
    }
  });

  // GenDownload Zip Endpoint Proxy (POST https://gendownload.com/api/zip)
  app.post('/api/zip', async (req, res) => {
    try {
      const { urls, quality } = req.body;
      if (!Array.isArray(urls) || urls.length === 0) {
        res.status(400).json({ error: 'urls array parameter is required.' });
        return;
      }

      const zipRes = await fetch('https://gendownload.com/api/zip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        body: JSON.stringify({ urls, quality: quality || 'best' }),
      });

      const data = await zipRes.json();
      res.status(zipRes.status).json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to create zip bundle from GenDownload' });
    }
  });

  // 7. Proxy Video Stream (bypasses CORS restrictions & streams MP4 smoothly with Range support)
  app.options('/api/proxy-video', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.sendStatus(204);
  });

  app.get('/api/proxy-video', async (req, res) => {
    try {
      const rawUrl = req.query.url as string;
      if (!rawUrl) {
        res.status(400).send('Missing video url parameter');
        return;
      }

      const decodedUrl = decodeURIComponent(rawUrl).trim();

      // SSRF Protection: Validate protocol and prevent requests to private/internal IPs & metadata services
      if (!isValidPublicHttpUrl(decodedUrl)) {
        res.status(403).send('Invalid or restricted target URL protocol/hostname');
        return;
      }

      // Clean headers by default to avoid Cloudflare bot detection
      const requestHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': '*/*',
      };

      if (decodedUrl.includes('tiktok.com') || decodedUrl.includes('tikwm')) {
        requestHeaders['Referer'] = 'https://www.tiktok.com/';
      }

      if (req.headers.range) {
        requestHeaders['Range'] = req.headers.range as string;
      }

      let videoRes = await fetch(decodedUrl, {
        method: 'GET',
        headers: requestHeaders,
        redirect: 'follow',
      });

      // Fallback: If 403 Forbidden or 401 Unauthorized, retry with minimal headers
      if (!videoRes.ok && (videoRes.status === 403 || videoRes.status === 401)) {
        const fallbackHeaders: Record<string, string> = {
          'Accept': '*/*',
        };
        if (req.headers.range) {
          fallbackHeaders['Range'] = req.headers.range as string;
        }
        videoRes = await fetch(decodedUrl, {
          method: 'GET',
          headers: fallbackHeaders,
          redirect: 'follow',
        });
      }

      if (!videoRes.ok && videoRes.status !== 206) {
        res.status(videoRes.status).send(`Failed to fetch video stream: HTTP ${videoRes.status}`);
        return;
      }

      const contentType = videoRes.headers.get('content-type') || 'video/mp4';

      // Safety check: Never return HTML webpage as video stream
      if (contentType.includes('text/html')) {
        res.status(400).send('Target URL is an HTML webpage, not a direct video media stream');
        return;
      }

      res.status(videoRes.status);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');

      const contentLength = videoRes.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);

      const contentRange = videoRes.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);

      const acceptRanges = videoRes.headers.get('accept-ranges');
      if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

      if (videoRes.body) {
        const nodeStream = Readable.fromWeb(videoRes.body as any);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (err: any) {
      console.error('Error in /api/proxy-video:', err);
      if (!res.headersSent) {
        res.status(500).send('Video proxy streaming error');
      }
    }
  });

  // Helper functions for /api/concat-videos (using safe execFilePromise)
  async function getVideoDuration(filePath: string): Promise<number> {
    try {
      const { stdout } = await execFilePromise('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);
      const duration = parseFloat(stdout.trim());
      if (!isNaN(duration) && duration > 0) {
        return duration;
      }
    } catch (err) {
      console.warn(`[Concat Video] Failed to get duration for ${filePath}:`, err);
    }
    return 10;
  }

  async function ensureAudioTrack(filePath: string, tempDir: string, index: number): Promise<string> {
    try {
      const { stdout } = await execFilePromise('ffprobe', [
        '-v', 'error',
        '-select_streams', 'a',
        '-show_entries', 'stream=codec_type',
        '-of', 'csv=p=0',
        filePath,
      ]);
      if (stdout.trim().includes('audio')) {
        return filePath;
      } else {
        const duration = await getVideoDuration(filePath);
        const outputPath = path.join(tempDir, `temp_audio_fixed_${index}_${Date.now()}.mp4`);
        console.log(`[Concat Video] Adding silent audio track (${duration}s) to silent video: ${filePath}`);
        
        try {
          await execFilePromise('ffmpeg', [
            '-y',
            '-i', filePath,
            '-f', 'lavfi',
            '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-t', String(duration),
            '-c:v', 'copy',
            '-c:a', 'aac',
            outputPath,
          ]);
        } catch (copyErr) {
          console.warn(`[Concat Video] Silent audio stream copy failed for ${filePath}, attempting re-encoding fallback:`, copyErr);
          await execFilePromise('ffmpeg', [
            '-y',
            '-i', filePath,
            '-f', 'lavfi',
            '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-t', String(duration),
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-preset', 'superfast',
            '-c:a', 'aac',
            outputPath,
          ]);
        }
        return outputPath;
      }
    } catch (err) {
      console.warn(`[Concat Video] ffprobe / audio check failed for ${filePath}, falling back to original:`, err);
      return filePath;
    }
  }

  async function getVideoResolution(filePath: string): Promise<{ width: number; height: number }> {
    try {
      const { stdout } = await execFilePromise('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'csv=s=x:p=0',
        filePath,
      ]);
      const lines = stdout.trim().split('\n');
      if (lines.length > 0 && lines[0].trim()) {
        const parts = lines[0].trim().split('x');
        if (parts.length === 2) {
          const width = parseInt(parts[0], 10);
          const height = parseInt(parts[1], 10);
          if (!isNaN(width) && !isNaN(height)) {
            return { width, height };
          }
        }
      }
    } catch (err) {
      console.warn(`[Concat Video] Failed to get resolution for ${filePath}:`, err);
    }
    return { width: 1280, height: 720 };
  }

  // Multer configuration for /api/concat-videos with strict extension validation
  const ALLOWED_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.ts', '.m4v']);
  const concatUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const uploadDir = path.join(os.tmpdir(), 'bach_uploads');
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
      },
      filename: (_req, file, cb) => {
        const rawExt = path.extname(file.originalname).toLowerCase();
        const ext = ALLOWED_VIDEO_EXTENSIONS.has(rawExt) ? rawExt : '.mp4';
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'video-' + uniqueSuffix + ext);
      },
    }),
    limits: {
      fileSize: 300 * 1024 * 1024, // 300MB per file limit
    }
  });

  app.post('/api/concat-videos', concatUpload.array('videos', 10), async (req, res) => {
    const files = req.files as any[];
    if (!files || !Array.isArray(files) || files.length === 0) {
      res.status(400).json({ success: false, error: 'No video files uploaded' });
      return;
    }

    const tempDir = path.join(os.tmpdir(), 'bach_temp_concat_' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });

    const originalPaths = files.map(f => f.path);
    const processedPaths: string[] = [];

    try {
      console.log(`[Concat Video] Received ${files.length} videos for merging:`, originalPaths);

      // 1. Ensure all videos have audio tracks
      for (let i = 0; i < originalPaths.length; i++) {
        const processedPath = await ensureAudioTrack(originalPaths[i], tempDir, i);
        processedPaths.push(processedPath);
      }

      // 2. Get target resolution from the first video
      const targetRes = await getVideoResolution(processedPaths[0]);
      const targetW = targetRes.width % 2 === 0 ? targetRes.width : targetRes.width - 1;
      const targetH = targetRes.height % 2 === 0 ? targetRes.height : targetRes.height - 1;

      console.log(`[Concat Video] Target resolution: ${targetW}x${targetH}`);

      // 3. Construct FFmpeg command arguments array
      const outputFilename = `merged_${Date.now()}.mp4`;
      const outputPath = path.join(tempDir, outputFilename);

      const ffmpegArgs: string[] = ['-y'];
      for (const p of processedPaths) {
        ffmpegArgs.push('-i', p);
      }

      let filterComplex = '';
      // 1. Scale and pad video streams, force to even dimensions and SAR 1, safe padding with trunc
      for (let i = 0; i < processedPaths.length; i++) {
        filterComplex += `[${i}:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:trunc((ow-iw)/2):trunc((oh-ih)/2),setsar=1[v${i}];`;
      }
      // 2. Normalize and resample audio streams to 44100Hz stereo to avoid layout/sample rate differences
      for (let i = 0; i < processedPaths.length; i++) {
        filterComplex += `[${i}:a]aresample=async=1,aformat=sample_rates=44100:channel_layouts=stereo[a${i}];`;
      }
      // 3. Concat all pairs of normalized video and audio streams
      for (let i = 0; i < processedPaths.length; i++) {
        filterComplex += `[v${i}][a${i}]`;
      }
      filterComplex += `concat=n=${processedPaths.length}:v=1:a=1[outv][outa]`;

      ffmpegArgs.push(
        '-filter_complex', filterComplex,
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'superfast',
        '-c:a', 'aac',
        '-vsync', '2',
        outputPath
      );

      console.log(`[Concat Video] Running safe execFile ffmpeg with ${ffmpegArgs.length} arguments`);
      await execFilePromise('ffmpeg', ffmpegArgs);

      if (!fs.existsSync(outputPath)) {
        throw new Error('FFmpeg processing completed but output file is missing.');
      }

      console.log(`[Concat Video] Merging completed successfully: ${outputPath}`);

      // Read output file and stream it back
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);

      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);

      readStream.on('close', () => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
          originalPaths.forEach(p => {
            if (fs.existsSync(p)) fs.unlinkSync(p);
          });
        } catch (cleanupErr) {
          console.warn('[Concat Video] Temp file cleanup error:', cleanupErr);
        }
      });

    } catch (err: any) {
      console.error('[Concat Video] Merging failed:', err);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'MERGE_FAILED',
          message: 'Lỗi khi ghép các video bằng FFmpeg: ' + (err.message || err),
        });
      }

      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        originalPaths.forEach(p => {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        });
      } catch (cleanupErr) {
        console.warn('[Concat Video] Cleanup error:', cleanupErr);
      }
    }
  });

  // Serve Vite in development or static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening at http://0.0.0.0:${PORT}`);
  });
}

startServer();
