export interface DownloadRequest {
  url: string;
}

export interface VideoMedia {
  quality: string;
  extension: string;
  url: string;
  size?: string;
  isAudioOnly?: boolean;
}

export interface GenDownloadResponse {
  success: boolean;
  title?: string;
  thumbnail?: string;
  duration?: string;
  source?: string;
  author?: string;
  views?: string;
  medias?: VideoMedia[];
  error?: string;
}

export interface GlossaryEntity {
  original: string;
  translated: string;
  type: 'character' | 'location' | 'term' | 'organization' | 'other';
  description?: string;
}

export interface GlobalMovieContext {
  movieGenre: string;
  eraAndSetting: string;
  characterPronounGuide: string;
  summary: string;
  knownEntityGlossary: GlossaryEntity[];
}

export interface WordTimestamp {
  word: string;
  start: number; // in seconds relative to subtitle start
  end: number;   // in seconds relative to subtitle start
}

export interface SubtitleItem {
  id: string;
  startTime: number; // in seconds, e.g. 1.25
  endTime: number;   // in seconds, e.g. 4.50
  originalText: string;
  translatedText: string;
  sourceLang?: string;
  confidence?: number;
  boundingBox?: RegionROI; // Normalized percentage coordinates (x, y, width, height) of detected subtitle box
  audioUrl?: string;       // Base64 or Blob URL of synthesized TTS audio
  duration?: number;       // Exact audio duration in seconds from sample count
  speed?: number;          // Custom speed multiplier for Smart Audio Fit
  timestamps?: WordTimestamp[]; // Word-level timestamps for exact audio sync
}

export interface RegionROI {
  x: number;      // percentage 0 - 100
  y: number;      // percentage 0 - 100
  width: number;  // percentage 0 - 100
  height: number; // percentage 0 - 100
}

export interface SubtitleStyleConfig {
  fontSize: number;          // in px (default 16)
  fontColor: string;         // hex or color name (default #ffffff)
  backgroundColor: string;   // hex or rgba color
  bgOpacity?: number;        // opacity percentage 0 - 100 (default 65)
  borderRadius?: number;     // border radius in px (default 8)
  fontWeight?: 'normal' | 'bold'; // font weight (default 'bold')
  fontStyle?: 'normal' | 'italic'; // font style (default 'normal')
  textTransform?: 'normal' | 'uppercase' | 'lowercase' | 'capitalize'; // text casing
  outlineColor?: string;     // hex color for text stroke/outline (default #000000)
  outlineWidth?: number;     // outline thickness in pixels (default 3)
  secondaryOutlineColor?: string; // hex color for outer sticker border
  secondaryOutlineWidth?: number; // thickness in pixels for outer sticker border
  hasSecondaryOutline?: boolean; // enable/disable double outline (viền kép)
  textShadowColor?: string;  // color for drop shadow / glow
  textShadowBlur?: number;   // blur radius in px
  textShadowOffsetX?: number; // shadow offset X in px
  textShadowOffsetY?: number; // shadow offset Y in px
  textEffect?: string;       // identifier for preset effect
  padding: number;           // in px (default 6)
  position: 'bottom' | 'top' | 'middle';
  bottomOffsetPercentage: number; // 0 - 30%
  maskOriginalSubtitles?: boolean;
  maskColor?: string;
  textOutline: boolean;      // default true
  fontFamily?: string;
  orientation?: 'horizontal' | 'vertical';
  maxCharsHorizontal?: number;
  maxCharsVertical?: number;
  hasBackground?: boolean;
  customUploadedFonts?: { family: string; dataUrl: string }[];
}

export type GeminiModelOption = 
  | 'GEMINI_WEB'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  | 'gemini-2.0-flash'
  | 'gemini-1.5-flash'
  | 'gemini-3.6-flash'
  | 'gemini-3.1-pro-preview'
  | 'gemini-3.1-flash-lite';

export interface AudioOutputHeader {
  sampleRate: number;    // e.g. 22050 or 44100 Hz
  channels: number;      // e.g. 1 (mono) or 2 (stereo)
  bitDepth: number;      // e.g. 16-bit PCM
  duration: number;      // duration in seconds
}

export interface SherpaAudioResult {
  samples: Float32Array; // PCM float samples normalized -1.0 to 1.0
  sampleRate: number;    // Sampling rate in Hz
  channels: number;      // Number of audio channels
  duration: number;      // Audio duration in seconds
}

export interface ONNXSessionOptions {
  executionProviders: ('webgpu' | 'webgl' | 'wasm' | 'cpu')[];
  graphOptimizationLevel?: 'disabled' | 'basic' | 'extended' | 'all';
  freeSessionOnComplete?: boolean;
}

export interface TTSWorkerMessage {
  type: 'GENERATE' | 'PROCESS_AUDIO' | 'RELEASE_SESSION';
  id?: string;
  text?: string;
  voice?: string;
  speed?: number;
  pitch?: number;
  targetDuration?: number;
  duration?: number;
  provider?: TTSProviderOption;
  audioData?: {
    base64?: string;
    buffer?: ArrayBuffer;
    sampleRate?: number;
  };
}

export interface TTSWorkerResponse {
  type: 'AUDIO_READY' | 'PROCESSED' | 'SESSION_RELEASED' | 'ERROR';
  id?: string;
  base64Audio?: string;
  audioHeader?: AudioOutputHeader;
  duration?: number;
  error?: string;
}

export type OCREngineOption = 'paddleocr' | 'gemini_vision';

export type ApiConnectionMode = 'direct' | 'proxy';

export type TTSProviderOption = 'gemini' | 'nghi_tts' | 'edge_tts' | 'tiktok_tts' | 'browser';

export interface AppSettings {
  ocrEngine: OCREngineOption;          // 'paddleocr' | 'gemini_vision'
  apiMode?: ApiConnectionMode;         // 'direct' | 'proxy' (default 'direct')
  apiKey: string;                      // Gemini or custom API Key
  selectedModel: GeminiModelOption;    // Default 'gemini-3.6-flash'
  customModelName?: string;            // Custom model name if entered
  proxyUrl: string;                    // Reverse proxy URL endpoint
  proxyKey: string;                    // Proxy authorization key
  proxyTargetModel?: string;           // Target model for proxy
  proxyModelsList?: string[];          // List of fetched proxy models
  ocrInterval: number;                 // Scan interval in seconds (default 0.5s)
  confidenceThreshold: number;         // Minimum score threshold 0.0 - 1.0 (default 0.7)
  sourceLang: string;                  // Source OCR language (default 'zh_cn')
  targetLang: string;                  // Target translation language (default 'Tiếng Việt')
  autoFilterDuplicates: boolean;       // Filter duplicate/repetitive subtitle lines
  autoIdealPreset: boolean;            // Auto set ideal OCR configs
  genDownloadApiKey?: string;         // GenDownload API Key (https://gendownload.com/)
  videoDownloaderApiUrl?: string;     // Custom Video Downloader API Endpoint
  ttsProvider?: TTSProviderOption;     // 'gemini' | 'nghi_tts' | 'edge_tts' | 'tiktok_tts' | 'browser'
  nghiVoice?: string;                  // Nghi TTS Sherpa voice e.g. lacphi, duyoryx, ngochuyennew, ngocngan, maiphuong, minhquang
  edgeVoice?: string;                  // Edge TTS Voice e.g. vi-VN-HoaiMyNeural or vi-VN-NamMinhNeural
  tiktokSessionId?: string;            // TikTok sessionid cookie value
  tiktokVoice?: string;                // TikTok Voice e.g. vi_001 (Nữ Tiếng Việt)
  tiktokProxyUrl?: string;             // TikTok / Edge proxy URL (HTTP or SOCKS proxy)
  geminiVoice?: string;                // Gemini Voice e.g. Kore or Puck
  ttsSpeed?: number;                   // Speed multiplier 0.5 - 2.0 (default 1.0)
  ttsPitch?: number;                   // Pitch offset -5 to +5 (default 0)
  bgFilterStrength?: number;           // Background text filter strength 0 - 100% (default 30)
  bgFilterMode?: 'none' | 'contrast' | 'binarize' | 'adaptive'; // Background text filter mode (default 'contrast')
  adaptiveSampling?: boolean;          // Auto-increase frame density in fast dialogue zones (default true)
  autoAiRefine?: boolean;              // Auto AI post-filtering: fix typos, remove OCR trash, merge duplicates (default true)
  proxyNoApiKey?: boolean;             // True if proxy does not require an API Key
}

export interface TargetLanguageOption {
  code: string;
  name: string;
  flag: string;
}

export interface OCRFrameRequest {
  image: string; // base64 string without header or data URL
  timestamp: number;
  region?: RegionROI;
  targetLang: string;
  model?: GeminiModelOption;
  customContext?: string;
}

export interface OCRScanProgress {
  status: 'idle' | 'scanning' | 'translating' | 'completed' | 'error';
  currentFrame: number;
  totalFrames: number;
  currentTime: number;
  totalTime: number;
  message: string;
  percentage: number;
  fps?: number;
  cpuUsage?: number;
  activeWorkers?: number;
  totalWorkers?: number;
}

export interface SampleVideo {
  id: string;
  title: string;
  description: string;
  url: string;
  language: string;
  defaultRoi: RegionROI;
}

export interface BlurOverlay {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  blur: number;
  borderRadius: number;
}

export interface LogoOverlay {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}

export interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  color: string;
  backgroundColor: string;
  opacity: number;
}

export interface VideoClip {
  id: string;
  title: string;
  url: string;
  duration: number;
}

export type CapCutTab = 'extract' | 'translate' | 'style' | 'audio' | 'subtitles' | 'filters' | 'config' | 'find_replace' | 'overlays';

export interface Project {
  id: string;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string;
  createdAt: number;
  updatedAt: number;
  duration: number;
  subtitles: SubtitleItem[];
  roi: RegionROI;
  targetLang: string;
  styleConfig: SubtitleStyleConfig;
  blurOverlays?: BlurOverlay[];
  logoOverlays?: LogoOverlay[];
  textOverlays?: TextOverlay[];
  videoVolume?: number;
  videoSpeed?: number;
  clips?: VideoClip[];
  customContext?: string;
  globalContext?: GlobalMovieContext;
}

