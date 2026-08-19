import { AppSettings } from '../types';
import { saveSettingsToDB } from './idbStorage';

const SETTINGS_STORAGE_KEY = 'subtranslate_app_settings_v1';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  ocrEngine: 'gemini_vision',
  apiMode: 'direct',
  apiKey: '',
  selectedModel: 'gemini-3.6-flash',
  customModelName: '',
  proxyUrl: '',
  proxyKey: '',
  proxyTargetModel: '',
  proxyModelsList: [],
  ocrInterval: 0.7,
  confidenceThreshold: 0.7,
  sourceLang: 'zh_cn',
  targetLang: 'Tiếng Việt',
  autoFilterDuplicates: true,
  autoIdealPreset: true,
  genDownloadApiKey: '',
  videoDownloaderApiUrl: 'https://gendownload.com/api',
  ttsProvider: 'nghi_tts',
  nghiVoice: 'lacphi',
  edgeVoice: 'vi-VN-HoaiMyNeural',
  tiktokSessionId: '',
  tiktokVoice: 'BV074_streaming',
  tiktokProxyUrl: '',
  ttsSpeed: 1.0,
  ttsPitch: 0,
  bgFilterStrength: 0,
  bgFilterMode: 'none',
  adaptiveSampling: true,
  autoAiRefine: true,
  proxyNoApiKey: false,
};

export function getAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Ensure gemini_vision is set as default
      return { ...DEFAULT_APP_SETTINGS, ...parsed, ocrEngine: parsed.ocrEngine || 'gemini_vision' };
    }
  } catch (err) {
    console.warn('Failed to parse app settings from localStorage', err);
  }
  return { ...DEFAULT_APP_SETTINGS };
}

export function saveAppSettings(settings: AppSettings): void {
  try {
    const updated = { ...settings, _hasExplicitOcrSelection: true };
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
    // Persist asynchronously to IndexedDB
    saveSettingsToDB(updated);
  } catch (err) {
    console.error('Failed to save app settings to localStorage', err);
  }
}

