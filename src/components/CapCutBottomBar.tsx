import React, { useState, useEffect } from 'react';
import {
  Crop,
  Languages,
  Volume2,
  SlidersHorizontal,
  Plus,
  X,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Edit3,
  Palette,
  Trash2,
  Type,
  Check,
  Sparkles,
  Camera,
  Play,
  Mic,
  Sliders,
  Loader2,
  Merge,
  VolumeX,
  Settings,
  RefreshCw,
  Filter,
  Search,
  Layers,
  Image,
  Scissors,
} from 'lucide-react';
import {
  CapCutTab,
  GeminiModelOption,
  RegionROI,
  SubtitleItem,
  SubtitleStyleConfig,
  OCRScanProgress,
  AppSettings,
  TTSProviderOption,
  BlurOverlay,
  LogoOverlay,
  TextOverlay,
  GlobalMovieContext,
  GlossaryEntity,
} from '../types';
import { SUPPORTED_LANGUAGES } from '../data/sampleVideos';
import { SubtitleStylingPanel } from './SubtitleStylingPanel';
import { wrapSubtitleText } from '../utils/srtParser';

interface CapCutBottomBarProps {
  activeTab: CapCutTab | null;
  onSelectTab: (tab: CapCutTab | null) => void;
  // Selected Video Block state
  isVideoSelected?: boolean;
  onSelectVideoBlock?: (selected: boolean) => void;
  onOpenImportModal?: () => void;
  videoVolume?: number;
  onChangeVideoVolume?: (vol: number) => void;
  videoSpeed?: number;
  onChangeVideoSpeed?: (speed: number) => void;
  // Selected Subtitle Block state
  selectedSubtitle: SubtitleItem | null;
  onSelectSubtitle: (sub: SubtitleItem | null) => void;
  onUpdateSubtitle: (updated: SubtitleItem) => void;
  onDeleteSubtitle: (id: string) => void;
  // Extract actions
  onExtractSingleFrame: () => void;
  isExtractingSingle: boolean;
  onStartFullScan: (startTime: number, endTime: number, interval: number, customContext: string) => void;
  scanProgress: OCRScanProgress;
  onCancelScan: () => void;
  onDismissScanProgress?: () => void;
  videoDuration: number;
  // Translate actions
  targetLang: string;
  onSelectTargetLang: (lang: string) => void;
  selectedModel: GeminiModelOption;
  onSelectModel: (model: GeminiModelOption) => void;
  onReTranslateAll: (overrideModel?: GeminiModelOption, optimizeForTts?: boolean, customContext?: string) => void;
  isTranslatingBatch: boolean;
  translationProgressMsg?: string;
  // Audio TTS actions
  activeSubtitle?: SubtitleItem | null;
  appSettings: AppSettings;
  onSaveSettings: (newSettings: AppSettings) => void;
  onPlayTTS: (text: string, speed?: number, pitch?: number, providerOverride?: TTSProviderOption) => void;
  onMergeShortSubtitles: () => void;
  onGenerateAllAudio: () => void;
  isGeneratingAllAudio: boolean;
  audioGenProgress: { current: number; total: number };
  audioPlayWithVideo: boolean;
  onToggleAudioPlayWithVideo: (val: boolean) => void;
  onClearAllAudio: () => void;
  // Subtitles & Styling
  subtitles: SubtitleItem[];
  onAddSubtitle: () => void;
  styleConfig: SubtitleStyleConfig;
  onChangeStyle: (newStyle: SubtitleStyleConfig) => void;
  // Single Audio Generation for selected subtitle
  onGenerateSingleAudio?: (subId: string) => void;
  isGeneratingSingleAudio?: string | null;
  onPlaySingleAudio?: (sub: SubtitleItem) => void;
  onDeleteSingleAudio?: (subId: string) => void;
  // ROI presets
  onChangeRoi: (roi: RegionROI) => void;
  onOpenConfigDrawer?: () => void;
  onReScanSubtitle?: (sub: SubtitleItem) => void;
  onUpdateSubtitles?: (updated: SubtitleItem[]) => void;
  blurOverlays?: BlurOverlay[];
  onChangeBlurOverlays?: (overlays: BlurOverlay[]) => void;
  logoOverlays?: LogoOverlay[];
  onChangeLogoOverlays?: (overlays: LogoOverlay[]) => void;
  textOverlays?: TextOverlay[];
  onChangeTextOverlays?: (overlays: TextOverlay[]) => void;
  showBlurVirtualBorder?: boolean;
  onToggleBlurVirtualBorder?: (val: boolean) => void;
  customContext?: string;
  globalContext?: GlobalMovieContext | null;
}

export const CapCutBottomBar: React.FC<CapCutBottomBarProps> = ({
  activeTab,
  onSelectTab,
  isVideoSelected = false,
  onSelectVideoBlock,
  onOpenImportModal,
  videoVolume = 1.0,
  onChangeVideoVolume,
  videoSpeed = 1.0,
  onChangeVideoSpeed,
  selectedSubtitle,
  onSelectSubtitle,
  onUpdateSubtitle,
  onDeleteSubtitle,
  onExtractSingleFrame,
  isExtractingSingle,
  onStartFullScan,
  scanProgress,
  onCancelScan,
  onDismissScanProgress,
  videoDuration,
  targetLang,
  onSelectTargetLang,
  selectedModel,
  onSelectModel,
  onReTranslateAll,
  isTranslatingBatch,
  translationProgressMsg,
  activeSubtitle,
  appSettings,
  onSaveSettings,
  onPlayTTS,
  onMergeShortSubtitles,
  onGenerateAllAudio,
  isGeneratingAllAudio,
  audioGenProgress,
  audioPlayWithVideo,
  onToggleAudioPlayWithVideo,
  onClearAllAudio,
  subtitles,
  onAddSubtitle,
  styleConfig,
  onChangeStyle,
  onGenerateSingleAudio,
  isGeneratingSingleAudio,
  onPlaySingleAudio,
  onDeleteSingleAudio,
  onChangeRoi,
  onOpenConfigDrawer,
  onReScanSubtitle,
  onUpdateSubtitles,
  blurOverlays = [],
  onChangeBlurOverlays,
  showBlurVirtualBorder = true,
  onToggleBlurVirtualBorder,
  logoOverlays = [],
  onChangeLogoOverlays,
  textOverlays = [],
  onChangeTextOverlays,
  customContext = '',
  globalContext = null,
}) => {
  const [scanStart, setScanStart] = useState<number>(0);
  const [scanEnd, setScanEnd] = useState<number>(Math.min(300, Math.ceil(videoDuration) || 60));
  const [scanInterval, setScanInterval] = useState<number>(() => {
    if (appSettings?.ocrInterval) return appSettings.ocrInterval;
    return videoDuration > 300 ? 0.8 : 0.6;
  });
  const [contextPrompt, setContextPrompt] = useState<string>(customContext || '');
  const [showTranslationContext, setShowTranslationContext] = useState<boolean>(false);

  useEffect(() => {
    if (customContext && !contextPrompt) {
      setContextPrompt(customContext);
    }
  }, [customContext]);

  // Local state for Filter/Watermark/Overlays sub-tabs
  const [filtersSubTab, setFiltersSubTab] = useState<'text' | 'blur' | 'logo' | 'text_overlay'>('text');
  const [filterKeywords, setFilterKeywords] = useState<string>('');
  const [findText, setFindText] = useState<string>('');
  const [replaceText, setReplaceText] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string>('');

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 2000);
  };

  const handleExecuteFilter = (mode: 'delete_sub' | 'strip_text') => {
    if (!onUpdateSubtitles) return;
    const keywords = filterKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    if (keywords.length === 0) return;

    const updated = subtitles.map(sub => {
      let originalText = sub.originalText || '';
      let translatedText = sub.translatedText || '';

      if (mode === 'strip_text') {
        keywords.forEach(kw => {
          const regex = new RegExp(kw, 'gi');
          originalText = originalText.replace(regex, '');
          translatedText = translatedText.replace(regex, '');
        });
        return {
          ...sub,
          originalText: originalText.trim(),
          translatedText: translatedText.trim(),
        };
      } else {
        const hasKeyword = keywords.some(kw => 
          originalText.toLowerCase().includes(kw) || 
          translatedText.toLowerCase().includes(kw)
        );
        return hasKeyword ? null : sub;
      }
    }).filter(Boolean) as SubtitleItem[];

    onUpdateSubtitles(updated);
    triggerToast("Đã lưu thành công");
  };

  const handleExecuteFilterSmart = () => {
    if (!onUpdateSubtitles) return;
    const keywords = filterKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    if (keywords.length === 0) return;

    const updated = subtitles.map(sub => {
      let originalText = sub.originalText || '';
      let translatedText = sub.translatedText || '';

      keywords.forEach(kw => {
        const regex = new RegExp(kw, 'gi');
        originalText = originalText.replace(regex, '');
        translatedText = translatedText.replace(regex, '');
      });

      // If both original and translated become empty, filter out this subtitle entirely
      if (!originalText.trim() && !translatedText.trim()) {
        return null;
      }

      return {
        ...sub,
        originalText: originalText.trim(),
        translatedText: translatedText.trim(),
      };
    }).filter(Boolean) as SubtitleItem[];

    onUpdateSubtitles(updated);
    triggerToast("Đã lưu thành công");
  };

  const handleFindReplace = () => {
    if (!onUpdateSubtitles || !findText) return;
    const regex = new RegExp(findText, 'gi');
    const updated = subtitles.map(sub => ({
      ...sub,
      originalText: sub.originalText.replace(regex, replaceText),
      translatedText: sub.translatedText.replace(regex, replaceText),
    }));
    onUpdateSubtitles(updated);
    triggerToast("Đã lưu thành công");
  };

  const handleSplitMultilineSubtitles = () => {
    if (!onUpdateSubtitles) return;
    const newSubs: SubtitleItem[] = [];
    let splitCount = 0;

    subtitles.forEach(sub => {
      const wrappedOrig = wrapSubtitleText(
        sub.originalText || '',
        styleConfig.orientation || 'horizontal',
        styleConfig.maxCharsHorizontal || 65,
        styleConfig.maxCharsVertical || 36
      );
      const wrappedTrans = wrapSubtitleText(
        sub.translatedText || '',
        styleConfig.orientation || 'horizontal',
        styleConfig.maxCharsHorizontal || 65,
        styleConfig.maxCharsVertical || 36
      );

      const origLines = wrappedOrig.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const transLines = wrappedTrans.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const maxLines = Math.max(origLines.length, transLines.length);

      if (maxLines > 1) {
        splitCount++;
        const duration = sub.endTime - sub.startTime;
        const segmentDuration = duration / maxLines;

        for (let index = 0; index < maxLines; index++) {
          const start = sub.startTime + index * segmentDuration;
          const end = sub.startTime + (index + 1) * segmentDuration;
          
          const origLine = origLines.length === 1 
            ? (index === 0 ? origLines[0] : '') 
            : (origLines[index] || '');
          const transLine = transLines.length === 1 
            ? (index === 0 ? transLines[0] : '') 
            : (transLines[index] || '');

          newSubs.push({
            ...sub,
            id: `${sub.id}_split_${index}_${Date.now()}`,
            startTime: parseFloat(start.toFixed(3)),
            endTime: parseFloat(end.toFixed(3)),
            originalText: origLine,
            translatedText: transLine,
            audioUrl: undefined, // Xóa cache âm thanh cũ vì chữ đã thay đổi
          });
        }
      } else {
        newSubs.push(sub);
      }
    });

    if (splitCount > 0) {
      onUpdateSubtitles(newSubs);
      alert(`Đã phát hiện và tách thành công ${splitCount} phụ đề có nhiều dòng thành các phụ đề đơn lẻ!`);
    } else {
      alert('Không tìm thấy phụ đề nào có nhiều dòng để tách.');
    }
  };

  const handleAddBlurOverlay = () => {
    if (!onChangeBlurOverlays) return;
    const newBlur: BlurOverlay = {
      id: `blur_${Date.now()}`,
      x: 35,
      y: 35,
      width: 30,
      height: 20,
      blur: 15,
      borderRadius: 8,
    };
    onChangeBlurOverlays([...blurOverlays, newBlur]);
  };

  const handleAddLogoOverlay = (file: File) => {
    if (!onChangeLogoOverlays) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      if (url) {
        const newLogo: LogoOverlay = {
          id: `logo_${Date.now()}`,
          url,
          x: 10,
          y: 10,
          width: 20,
          height: 15,
          opacity: 100,
        };
        onChangeLogoOverlays([...logoOverlays, newLogo]);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAddTextOverlay = () => {
    if (!onChangeTextOverlays) return;
    const newText: TextOverlay = {
      id: `text_${Date.now()}`,
      text: 'Chữ chèn video',
      x: 20,
      y: 20,
      width: 60,
      height: 10,
      fontSize: 24,
      color: '#ffffff',
      backgroundColor: '#000000',
      opacity: 80,
    };
    onChangeTextOverlays([...textOverlays, newText]);
  };

  // Audio TTS Local Config
  const [ttsSpeed, setTtsSpeed] = useState<number>(appSettings.ttsSpeed || 1.0);
  const [ttsPitch, setTtsPitch] = useState<number>(appSettings.ttsPitch || 0);
  const [selectedTtsProvider, setSelectedTtsProvider] = useState<TTSProviderOption>(appSettings.ttsProvider || 'nghi_tts');
  const [autoMergeSubtitles, setAutoMergeSubtitles] = useState<boolean>(true);
  const [isTuningCollapsed, setIsTuningCollapsed] = useState<boolean>(false);

  useEffect(() => {
    if (appSettings.ttsProvider) {
      setSelectedTtsProvider(appSettings.ttsProvider);
    }
  }, [appSettings.ttsProvider]);

  // Nghi TTS download & status management
  const [nghiStatus, setNghiStatus] = useState<{ ready: boolean; modelSizeMb: number; downloadedVoices: string[] } | null>(null);
  const [isDownloadingNghi, setIsDownloadingNghi] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState('');

  const checkNghiStatus = async (voiceKey: string, autoDownloadIfMissing = false) => {
    try {
      const res = await fetch('/api/tts/nghi-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nghiVoice: voiceKey }),
      });
      const rawText = await res.text().catch(() => '');
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        data = {};
      }
      if (data.success) {
        setNghiStatus(data);
        if (autoDownloadIfMissing && !data.downloadedVoices?.includes(voiceKey)) {
          handleDownloadNghiModel(voiceKey);
        }
      }
    } catch (e) {
      console.warn('Check Nghi status error:', e);
    }
  };

  const handleDownloadNghiModel = async (voiceKey: string) => {
    const voiceNameMap: Record<string, string> = {
      ngochuyennew: 'Ngọc Huyền',
      lacphi: 'Lạc Phi',
      duyoryx: 'Duy Oryx',
      ngocngan: 'Ngọc Ngạn',
      maiphuong: 'Mai Phương',
      minhquang: 'Minh Quang',
    };
    const voiceName = voiceNameMap[voiceKey] || voiceKey;

    setIsDownloadingNghi(true);
    setDownloadMsg(`⏳ Đang tải về mô hình giọng đọc ${voiceName}... Vui lòng đợi trong giây lát!`);
    try {
      const res = await fetch('/api/tts/nghi-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nghiVoice: voiceKey }),
      });
      const rawText = await res.text().catch(() => '');
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        data = {};
      }
      if (data.success) {
        setDownloadMsg(`✓ Đã tải xong giọng đọc ${voiceName}!`);
        await checkNghiStatus(voiceKey);
      } else {
        setDownloadMsg(`❌ Lỗi tải: ${data.error || rawText.slice(0, 80) || 'Không xác định'}`);
      }
    } catch (e: any) {
      setDownloadMsg(`❌ Lỗi kết nối: ${e.message}`);
    } finally {
      setIsDownloadingNghi(false);
    }
  };

  React.useEffect(() => {
    if (selectedTtsProvider === 'nghi_tts') {
      checkNghiStatus(appSettings.nghiVoice || 'lacphi', true);
    }
  }, [selectedTtsProvider, appSettings.nghiVoice]);

  // Subtitle block edit panel popups
  const [showTextEditor, setShowTextEditor] = useState<boolean>(false);
  const [showConfigPanel, setShowConfigPanel] = useState<boolean>(false);

  // Video speed/volume sub-tabs
  const [activeVideoSubTab, setActiveVideoSubTab] = useState<'volume' | 'speed' | null>(null);

  React.useEffect(() => {
    if (!isVideoSelected) {
      setActiveVideoSubTab(null);
    }
  }, [isVideoSelected]);

  // Editable text state
  const [editTextOriginal, setEditTextOriginal] = useState<string>('');
  const [editTextTranslated, setEditTextTranslated] = useState<string>('');

  // Bottom Sheet animation & collapse/expand state ("Ngạch Ngang" handle bar)
  const [isSheetCollapsed, setIsSheetCollapsed] = useState<boolean>(false);
  const [sourceLang, setSourceLang] = useState<string>('Tiếng Trung');
  const [ocrMode, setOcrMode] = useState<'fast' | 'deep'>('fast');
  const [filterStrength, setFilterStrength] = useState<string>('80%');
  const isAiRefineActive = appSettings?.autoAiRefine !== false;
  const [optimizeForTts, setOptimizeForTts] = useState<boolean>(true);

  const handleToggleAiRefine = (enabled: boolean) => {
    if (onSaveSettings) {
      onSaveSettings({
        ...appSettings,
        autoAiRefine: enabled,
      });
    }
  };

  React.useEffect(() => {
    if (activeTab || showTextEditor || showConfigPanel || activeVideoSubTab) {
      setIsSheetCollapsed(false);
    }
  }, [activeTab, showTextEditor, showConfigPanel, activeVideoSubTab]);

  const isScanning = scanProgress.status === 'scanning' || scanProgress.status === 'translating';

  // Open text edit modal
  const handleOpenTextEditor = () => {
    if (selectedSubtitle) {
      setEditTextOriginal(selectedSubtitle.originalText || '');
      setEditTextTranslated(selectedSubtitle.translatedText || '');
      setShowTextEditor(true);
      setShowConfigPanel(false);
    }
  };

  const handleSaveTextEditor = () => {
    if (selectedSubtitle) {
      onUpdateSubtitle({
        ...selectedSubtitle,
        originalText: editTextOriginal,
        translatedText: editTextTranslated,
      });
      setShowTextEditor(false);
    }
  };

  const activeSheetType = selectedSubtitle && showTextEditor
    ? 'text_editor'
    : (showConfigPanel || activeTab === 'config' || activeTab === 'style')
    ? 'config'
    : activeVideoSubTab === 'volume'
    ? 'video_volume'
    : activeVideoSubTab === 'speed'
    ? 'video_speed'
    : activeTab && !selectedSubtitle
    ? activeTab
    : null;

  return (
    <div className={`bg-[#121215] border-t border-slate-900 shadow-2xl flex flex-col justify-center relative select-none flex-shrink-0 h-[60px] min-h-[60px] max-h-[60px] ${
      activeSheetType && !isSheetCollapsed ? 'z-[210]' : 'z-30'
    }`}>
      {/* ------------------------------------------------------------- */}
      {/* UNIFIED SLIDE-UP BOTTOM SHEET FOR ALL BOTTOM TAB / BLOCK ACTIONS */}
      {/* ------------------------------------------------------------- */}
      {activeSheetType && (
        <React.Fragment>
          {/* Backdrop (Fades out when collapsed so user can interact with video/OCR) */}
          <div
            onClick={() => {
              onSelectTab(null);
              setShowTextEditor(false);
              setShowConfigPanel(false);
            }}
            className={`fixed inset-0 bg-black/70 z-[190] transition-opacity duration-300 ${
              isSheetCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100 backdrop-blur-xs'
            }`}
          />

          {/* Slide-Up Container */}
          <div
            className={`fixed inset-x-0 bottom-0 z-[200] max-w-md mx-auto bg-[#18181c] border-t border-slate-800 rounded-t-3xl shadow-2xl transition-transform duration-300 ease-out flex flex-col max-h-[80vh] ${
              isSheetCollapsed ? 'translate-y-[calc(100%-3.25rem)]' : 'translate-y-0'
            }`}
          >
            {/* Top Horizontal Drag Handle Bar ("Ngạch Ngang") */}
            <div
              onClick={() => setIsSheetCollapsed(!isSheetCollapsed)}
              className="w-full pt-2.5 pb-1 flex flex-col items-center justify-center cursor-pointer select-none group active:scale-95 transition-transform"
              title={isSheetCollapsed ? 'Nhấp vào đây để trồi UI lên' : 'Nhấp ngạch ngang để trồi UI xuống xem video & chỉnh OCR'}
            >
              <div className="w-12 h-1.5 bg-slate-600 group-hover:bg-sky-400 rounded-full transition-colors shadow-sm" />
              {isSheetCollapsed && (
                <div className="flex items-center space-x-1.5 text-xs text-sky-400 font-bold mt-1 animate-pulse">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Trồi UI Lên (Kéo/Chỉnh vùng OCR ở video phía trên)</span>
                </div>
              )}
            </div>

            {/* SHEET CONTENT WRAPPER */}
            <div className="overflow-y-auto max-h-[72vh] p-4 pt-1 custom-scrollbar">

              {/* SHEET 1: INLINE TEXT EDITOR */}
              {activeSheetType === 'text_editor' && selectedSubtitle && (
                <div className="flex flex-col gap-3 text-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <span className="font-bold text-xs text-white uppercase tracking-wider flex items-center space-x-1.5">
                      <Edit3 className="w-4 h-4 text-amber-400" />
                      <span>Sửa Nội Dung Phụ Đề</span>
                    </span>
                    <button
                      onClick={() => setShowTextEditor(false)}
                      className="p-1 text-slate-400 hover:text-white bg-slate-800 rounded-full"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] font-semibold text-slate-400">Văn bản gốc (OCR):</label>
                    <textarea
                      value={editTextOriginal}
                      onChange={(e) => setEditTextOriginal(e.target.value)}
                      rows={2}
                      className="w-full bg-[#101013] border border-slate-700 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-amber-400"
                      placeholder="Nhập chữ gốc..."
                    />

                    <label className="text-[11px] font-semibold text-amber-400 mt-1">Bản dịch (Hiển thị):</label>
                    <textarea
                      value={editTextTranslated}
                      onChange={(e) => setEditTextTranslated(e.target.value)}
                      rows={2}
                      className="w-full bg-[#101013] border border-amber-500/50 rounded-lg p-2 text-xs text-amber-200 font-medium focus:outline-none focus:border-amber-400"
                      placeholder="Nhập bản dịch tiếng Việt..."
                    />
                  </div>

                  <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
                    <button
                      onClick={() => setShowTextEditor(false)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs"
                    >
                      Hủy
                    </button>
                    <button
                      onClick={handleSaveTextEditor}
                      className="px-4 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold rounded-lg text-xs flex items-center space-x-1 shadow-md"
                    >
                      <Check className="w-4 h-4" />
                      <span>Lưu Thay Đổi</span>
                    </button>
                  </div>
                </div>
              )}

              {/* SHEET 2: CONFIG STYLE PANEL */}
              {activeSheetType === 'config' && (
                <div className="flex flex-col gap-3 text-xs">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                    <span className="font-bold text-xs text-white uppercase tracking-wider flex items-center space-x-1.5">
                      <Palette className="w-4 h-4 text-amber-400" />
                      <span>Cấu Hình Kiểu Chữ & Phụ Đề</span>
                    </span>
                    <button
                      onClick={() => {
                        setShowConfigPanel(false);
                        if (activeTab === 'config' || activeTab === 'style') onSelectTab(null);
                      }}
                      className="p-1 text-slate-400 hover:text-white bg-slate-800 rounded-full"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <SubtitleStylingPanel
                    styleConfig={styleConfig}
                    onChangeStyle={onChangeStyle}
                    onClose={() => {
                      setShowConfigPanel(false);
                      if (activeTab === 'config' || activeTab === 'style') onSelectTab(null);
                    }}
                  />
                </div>
              )}

              {/* SHEET 3: TAB EXTRACT (OCR) */}
              {activeSheetType === 'extract' && (
                <div className="flex flex-col gap-3 text-xs">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h3 className="text-sm font-bold text-white flex items-center space-x-1.5">
                      <Crop className="w-4 h-4 text-sky-400" />
                      <span>Bóc tách phụ đề (OCR)</span>
                    </h3>
                    <button
                      onClick={() => onSelectTab(null)}
                      className="p-1 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-full transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Persistent Error Alert if OCR Extraction Failed or Skipped */}
                  {scanProgress.status === 'error' && (
                    <div className="bg-rose-950/70 border border-rose-500/70 p-3 rounded-xl space-y-2 animate-in fade-in">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5 animate-pulse" />
                        <div className="space-y-1">
                          <p className="text-xs text-rose-300 font-bold">Lỗi quét mặt chữ OCR</p>
                          <p className="text-[11px] text-slate-200 leading-snug">{scanProgress.message}</p>
                          <p className="text-[10px] text-slate-400 font-mono">Xem chi tiết trên F12 Console.</p>
                        </div>
                      </div>
                      {onDismissScanProgress && (
                        <button
                          onClick={onDismissScanProgress}
                          className="w-full py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition shadow"
                        >
                          Đóng thông báo lỗi
                        </button>
                      )}
                    </div>
                  )}

                  {isScanning ? (
                    <div className="bg-slate-900 border border-sky-500/30 p-3 rounded-xl space-y-2.5">
                      <div className="flex justify-between items-center text-sky-300 font-semibold text-xs">
                        <span className="truncate pr-2">{scanProgress.message}</span>
                        <span className="font-mono shrink-0">{scanProgress.percentage}%</span>
                      </div>
                      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-sky-400 to-indigo-500 transition-all duration-300"
                          style={{ width: `${scanProgress.percentage}%` }}
                        />
                      </div>

                      {/* Real-time Diagnostics Row */}
                      <div className="flex items-center justify-between text-[10px] bg-[#101013] p-2 rounded-lg border border-slate-800 font-medium">
                        <div className="flex items-center gap-1">
                          <span className="text-amber-400 font-bold">⚡ Tốc độ:</span>
                          <span className="font-mono text-slate-200">
                            {typeof scanProgress.fps === 'number' ? scanProgress.fps.toFixed(1) : '0.0'} FPS
                          </span>
                        </div>
                        <div className="w-1 h-1 rounded-full bg-slate-700" />
                        <div className="flex items-center gap-1">
                          <span className="text-cyan-400 font-bold">💻 CPU bận:</span>
                          <span className="font-mono text-slate-200">
                            {scanProgress.cpuUsage || 0}% ({scanProgress.activeWorkers || 0}/{scanProgress.totalWorkers || 0} luồng)
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={onCancelScan}
                        className="w-full py-1.5 bg-rose-900/40 text-rose-300 border border-rose-700/50 rounded-lg text-xs font-bold hover:bg-rose-800/60"
                      >
                        Hủy quét
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {/* Ngôn ngữ gốc */}
                      <div>
                        <label className="text-xs text-slate-400 block mb-1 font-semibold">Ngôn ngữ gốc của video</label>
                        <select
                          value={sourceLang}
                          onChange={(e) => setSourceLang(e.target.value)}
                          className="w-full bg-[#101013] border border-slate-700 rounded-xl p-2.5 text-xs text-white font-semibold focus:outline-none focus:border-sky-500"
                        >
                          <option value="Tiếng Trung">Tiếng Trung (Trung Quốc)</option>
                          <option value="Tiếng Anh">Tiếng Anh (English)</option>
                          <option value="Tiếng Hàn">Tiếng Hàn (Korean)</option>
                          <option value="Tiếng Nhật">Tiếng Nhật (Japanese)</option>
                          <option value="Tiếng Việt">Tiếng Việt</option>
                          <option value="Tự động phát hiện">Tự động phát hiện AI</option>
                        </select>
                      </div>

                      {/* Chế độ bóc tách & Tần suất lấy mẫu */}
                      <div className="bg-[#101013] border border-slate-800 rounded-xl p-3 flex flex-col gap-2.5">
                        <span className="text-[11px] text-slate-300 font-bold flex items-center justify-between">
                          <span>Tần suất lấy mẫu OCR (Khoảng cách khung hình)</span>
                          <span className="text-sky-400 font-mono font-extrabold">{scanInterval}s / frame</span>
                        </span>
                        
                        <div className="grid grid-cols-3 gap-1.5">
                          <button
                            type="button"
                            onClick={() => { setOcrMode('fast'); setScanInterval(0.40); }}
                            className={`p-2 rounded-xl text-center border text-[11px] font-bold transition flex flex-col items-center gap-0.5 ${
                              scanInterval <= 0.45
                                ? 'bg-sky-500/20 border-sky-400 text-sky-300 shadow-md'
                                : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                            }`}
                          >
                            <span>⚡ 0.40s / khung</span>
                            <span className="text-[9px] text-slate-400 font-normal">Thoại nhanh (Video ngắn)</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => { setOcrMode('fast'); setScanInterval(0.60); }}
                            className={`p-2 rounded-xl text-center border text-[11px] font-bold transition flex flex-col items-center gap-0.5 ${
                              scanInterval > 0.45 && scanInterval <= 0.75
                                ? 'bg-sky-500/20 border-sky-400 text-sky-300 shadow-md'
                                : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                            }`}
                          >
                            <span>🎯 0.60s / khung</span>
                            <span className="text-[9px] text-slate-400 font-normal">Chuẩn (Khuyên dùng tối ưu)</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => { setOcrMode('deep'); setScanInterval(0.90); }}
                            className={`p-2 rounded-xl text-center border text-[11px] font-bold transition flex flex-col items-center gap-0.5 ${
                              scanInterval > 0.75
                                ? 'bg-sky-500/20 border-sky-400 text-sky-300 shadow-md'
                                : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                            }`}
                          >
                            <span>⚖️ 0.90s / khung</span>
                            <span className="text-[9px] text-slate-400 font-normal">Tiết kiệm (Video dài &gt;5p)</span>
                          </button>
                        </div>
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          💡 <b className="text-slate-200">Khoảng cách 0.60s–0.90s:</b> Kết hợp cùng thuật toán phát hiện chuyển cảnh Frame-Diffing giúp bóc tách 100% câu thoại mà không bị dư thừa frame xử lý.
                        </p>
                      </div>

                      {/* Độ mạnh lọc chữ nền */}
                      <div>
                        <label className="text-xs text-slate-400 block mb-1 font-semibold">Độ mạnh lọc chữ nền</label>
                        <select
                          value={filterStrength}
                          onChange={(e) => setFilterStrength(e.target.value)}
                          className="w-full bg-[#101013] border border-slate-700 rounded-xl p-2.5 text-xs text-white font-semibold focus:outline-none focus:border-sky-500"
                        >
                          <option value="50%">50% - Lọc nhẹ</option>
                          <option value="80%">80% - Tiêu chuẩn (Khuyên dùng)</option>
                          <option value="90%">90% - Lọc mạnh</option>
                          <option value="100%">100% - Tuyệt đối</option>
                        </select>
                      </div>

                      {/* Checkbox AI Refine (AI Post-Filtering) */}
                      <label className="flex items-center justify-between space-x-2.5 text-xs text-slate-200 font-semibold cursor-pointer bg-[#101013] p-2.5 rounded-xl border border-slate-800 hover:border-slate-700 transition">
                        <div className="flex flex-col flex-1 pr-2">
                          <div className="flex items-center space-x-1.5">
                            <span>Lọc trùng & nhiễu bằng AI</span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${isAiRefineActive ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
                              {isAiRefineActive ? 'ĐANG BẬT' : 'ĐÃ TẮT'}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-normal mt-0.5 leading-tight">
                            {isAiRefineActive
                              ? 'Tự động gọi Gemini AI sau khi OCR để sửa lỗi chính tả, xóa ký tự rác & gộp câu trùng lặp'
                              : 'Chạy 100% OCR cục bộ offline (siêu nhanh, không tốn quota/token)'}
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={isAiRefineActive}
                          onChange={(e) => handleToggleAiRefine(e.target.checked)}
                          className="accent-sky-500 w-4 h-4 rounded cursor-pointer flex-shrink-0"
                        />
                      </label>

                      {/* Presets vị trí phụ đề */}
                      <div className="flex flex-col gap-1.5 pt-1">
                        <span className="text-[11px] text-slate-400 font-semibold">Vùng gợi ý theo kích thước video:</span>
                        <div className="flex items-center flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => onChangeRoi({ x: 10, y: 76, width: 80, height: 20 })}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-[10px] text-sky-300 font-bold border border-slate-700 transition cursor-pointer"
                          >
                            16:9 Phụ đề dưới
                          </button>
                          <button
                            type="button"
                            onClick={() => onChangeRoi({ x: 5, y: 70, width: 90, height: 22 })}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-[10px] text-emerald-300 font-bold border border-slate-700 transition cursor-pointer"
                          >
                            9:16 TikTok / Shorts
                          </button>
                          <button
                            type="button"
                            onClick={() => onChangeRoi({ x: 8, y: 74, width: 84, height: 22 })}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-[10px] text-purple-300 font-bold border border-slate-700 transition cursor-pointer"
                          >
                            1:1 / 4:5 Vuông & Dọc
                          </button>
                          <button
                            type="button"
                            onClick={() => onChangeRoi({ x: 10, y: 5, width: 80, height: 18 })}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-[10px] text-slate-200 font-bold border border-slate-700 transition cursor-pointer"
                          >
                            Tiêu đề trên
                          </button>
                          <button
                            type="button"
                            onClick={() => onChangeRoi({ x: 2, y: 5, width: 96, height: 90 })}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-[10px] text-amber-300 font-bold border border-slate-700 transition cursor-pointer"
                          >
                            Toàn khung hình
                          </button>
                        </div>
                      </div>

                      {/* Main action buttons */}
                      <div className="flex flex-col gap-2 pt-1">
                        <button
                          onClick={() => onStartFullScan(0, Math.ceil(videoDuration) || 60, scanInterval, contextPrompt)}
                          className="w-full py-3 btn-metallic text-slate-950 font-black text-xs rounded-xl transition shadow-lg active:scale-95 flex items-center justify-center space-x-2 uppercase tracking-wide cursor-pointer"
                        >
                          <Sparkles className="w-4 h-4 text-slate-950" />
                          <span>BẮT ĐẦU BÓC TÁCH TOÀN VIDEO ({scanInterval}s/khung)</span>
                        </button>

                        <button
                          onClick={onExtractSingleFrame}
                          disabled={isExtractingSingle}
                          className="w-full py-2 btn-metallic-dark font-bold rounded-xl text-xs flex items-center justify-center space-x-1.5 transition cursor-pointer"
                        >
                          <Camera className="w-3.5 h-3.5 text-slate-300" />
                          <span>{isExtractingSingle ? 'Đang đọc khung hình...' : 'Đọc OCR Khung Hình Hiện Tại'}</span>
                        </button>
                      </div>

                      <p className="text-[10px] text-slate-400 text-center">
                        ⚠️ Bạn có thể nhấp ngạch ngang ở trên để trồi UI xuống và tự do di chuyển/thu phóng vùng viền nét đứt OCR màu xanh!
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* SHEET 4: TAB TRANSLATE (Dịch thuật AI) */}
              {activeSheetType === 'translate' && (
                <div className="flex flex-col gap-4 p-1">
                  {/* Header */}
                  <div className="flex items-center justify-between pb-1">
                    <div className="flex items-center space-x-2">
                      <h3 className="text-lg font-bold text-white tracking-wide">Dịch thuật AI</h3>
                      <button
                        type="button"
                        onClick={() => setShowTranslationContext(!showTranslationContext)}
                        className={`p-1.5 rounded-lg transition-all duration-200 ${
                          showTranslationContext
                            ? 'text-white bg-emerald-500 shadow-md'
                            : 'text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20'
                        }`}
                        title="Ngữ cảnh dịch thuật chuyên sâu"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      onClick={() => onSelectTab(null)}
                      className="p-1.5 text-zinc-400 hover:text-white rounded-full transition"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Global Movie Context & Entity Glossary Display */}
                  {globalContext ? (
                    <div className="bg-gradient-to-br from-indigo-950/40 via-[#181822] to-purple-950/30 border border-indigo-500/30 rounded-xl p-3.5 space-y-2.5 shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Sparkles className="w-4 h-4 text-indigo-400" />
                          <span className="font-bold text-indigo-200 text-xs tracking-wide">
                            Ngữ Cảnh Phim & Từ Điển Thực Thể
                          </span>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          {globalContext.movieGenre || 'Tự động'}
                        </span>
                      </div>

                      {globalContext.characterPronounGuide && (
                        <p className="text-[11px] text-zinc-300 bg-black/30 rounded-lg p-2 border border-zinc-800/60 leading-relaxed">
                          <strong className="text-indigo-300 font-semibold">Quy tắc xưng hô: </strong>
                          {globalContext.characterPronounGuide}
                        </p>
                      )}

                      {globalContext.knownEntityGlossary && globalContext.knownEntityGlossary.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          <div className="flex items-center justify-between text-[11px] text-zinc-400">
                            <span>Từ điển thực thể ({globalContext.knownEntityGlossary.length} mục):</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                            {globalContext.knownEntityGlossary.map((item, idx) => (
                              <div
                                key={idx}
                                className="text-[10px] px-2 py-1 rounded-md bg-indigo-950/60 border border-indigo-700/50 text-indigo-200 flex items-center space-x-1"
                                title={item.description || `${item.original} -> ${item.translated}`}
                              >
                                <span className="text-zinc-400">{item.original}</span>
                                <span className="text-indigo-400">→</span>
                                <span className="font-bold text-indigo-100">{item.translated}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-[#181822] border border-indigo-500/20 rounded-xl p-3 flex items-start space-x-2.5">
                      <Sparkles className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                      <div className="text-[11px] text-zinc-300 leading-relaxed">
                        <span className="font-bold text-indigo-300">Context Synchronization Expert: </span>
                        AI sẽ đọc lướt toàn bộ phụ đề để rút ra thể loại phim, tên nhân vật và xưng hô chuẩn, sau đó truyền ngữ cảnh liền mạch qua từng batch dịch.
                      </div>
                    </div>
                  )}

                  {/* Deep translation context panel (opens via the green gear button) */}
                  {showTranslationContext && (
                    <div className="bg-[#101013] border border-emerald-500/30 rounded-xl p-3 space-y-2 animate-in slide-in-from-top-2 duration-200">
                      <div className="flex items-center space-x-1.5">
                        <Settings className="w-4 h-4 text-emerald-400 animate-spin-slow" />
                        <span className="font-bold text-emerald-400 text-xs">Ngữ Cảnh Dịch Thuật Chuyên Sâu</span>
                      </div>
                      <textarea
                        value={contextPrompt}
                        onChange={(e) => setContextPrompt(e.target.value)}
                        placeholder="Ví dụ: Video về phim cổ trang Trung Quốc, xưng hô 'Huynh/Đệ/Ta/Nàng'..."
                        className="w-full bg-[#141418] border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-400"
                        rows={3}
                      />
                      <p className="text-[10px] text-slate-500">
                        * Cung cấp thông tin bối cảnh của video (thể loại, cách xưng hô, văn phong...) để bản dịch AI chuẩn xác hơn.
                      </p>
                    </div>
                  )}

                  {/* Engine dịch thuật */}
                  <div className="bg-[#212126] border border-zinc-700/60 rounded-xl p-3 flex flex-col gap-1">
                    <label className="text-[11px] text-zinc-400 font-medium">Engine dịch thuật</label>
                    <div className="relative flex items-center">
                      <select
                        value={appSettings.apiMode === 'proxy' ? (appSettings.proxyTargetModel || appSettings.customModelName || selectedModel) : selectedModel}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (appSettings.apiMode === 'proxy') {
                            onSaveSettings({
                              ...appSettings,
                              proxyTargetModel: val,
                              customModelName: val,
                            });
                            onSelectModel(val as any);
                          } else {
                            onSelectModel(val as any);
                          }
                        }}
                        className="w-full bg-transparent text-sm font-bold text-white focus:outline-none appearance-none pr-6 cursor-pointer"
                      >
                        {appSettings.apiMode === 'proxy' ? (
                          <>
                            {appSettings.proxyModelsList && appSettings.proxyModelsList.length > 0 ? (
                              appSettings.proxyModelsList.map((m) => (
                                <option key={m} value={m} className="bg-[#1c1c21] text-white">
                                  {m} (Proxy)
                                </option>
                              ))
                            ) : (
                              <>
                                {appSettings.proxyTargetModel && (
                                  <option value={appSettings.proxyTargetModel} className="bg-[#1c1c21] text-white">
                                    {appSettings.proxyTargetModel} (Proxy)
                                  </option>
                                )}
                                {appSettings.customModelName && appSettings.customModelName !== appSettings.proxyTargetModel && (
                                  <option value={appSettings.customModelName} className="bg-[#1c1c21] text-white">
                                    {appSettings.customModelName} (Proxy Custom)
                                  </option>
                                )}
                                <option value="gemini-3.6-flash" className="bg-[#1c1c21] text-white">Gemini 3.6 Flash (Proxy Fallback)</option>
                                <option value="gemini-3.1-pro-preview" className="bg-[#1c1c21] text-white">Gemini 3.1 Pro (Proxy Fallback)</option>
                              </>
                            )}
                          </>
                        ) : (
                          <>
                            <option value="GEMINI_WEB" className="bg-[#1c1c21] text-white">GEMINI_WEB</option>
                            <option value="gemini-2.5-flash" className="bg-[#1c1c21] text-white">Gemini 2.5 Flash</option>
                            <option value="gemini-2.5-pro" className="bg-[#1c1c21] text-white">Gemini 2.5 Pro</option>
                            <option value="gemini-2.0-flash" className="bg-[#1c1c21] text-white">Gemini 2.0 Flash</option>
                            <option value="gemini-1.5-flash" className="bg-[#1c1c21] text-white">Gemini 1.5 Flash</option>
                            <option value="gemini-3.6-flash" className="bg-[#1c1c21] text-white">Gemini 3.6 Flash</option>
                            <option value="gemini-3.1-pro-preview" className="bg-[#1c1c21] text-white">Gemini 3.1 Pro Preview</option>
                          </>
                        )}
                      </select>
                      <ChevronDown className="w-4 h-4 text-zinc-400 absolute right-0 pointer-events-none" />
                    </div>
                  </div>

                  {/* Dịch sang ngôn ngữ */}
                  <div className="bg-[#212126] border border-zinc-700/60 rounded-xl p-3 flex flex-col gap-1">
                    <label className="text-[11px] text-zinc-400 font-medium">Dịch sang ngôn ngữ</label>
                    <div className="relative flex items-center">
                      <select
                        value={targetLang}
                        onChange={(e) => {
                          const newLang = e.target.value;
                          onSelectTargetLang(newLang);
                          onSaveSettings({ ...appSettings, targetLang: newLang });
                        }}
                        className="w-full bg-transparent text-sm font-bold text-white focus:outline-none appearance-none pr-6 cursor-pointer"
                      >
                        {SUPPORTED_LANGUAGES.map((lang) => (
                          <option key={lang.code} value={lang.name} className="bg-[#1c1c21] text-white">
                            {lang.flag} {lang.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-4 h-4 text-zinc-400 absolute right-0 pointer-events-none" />
                    </div>
                  </div>

                  {/* Checkbox: Tối ưu hóa cho thuyết minh (TTS) */}
                  <label className="flex items-center space-x-3 cursor-pointer py-1 select-none">
                    <input
                      type="checkbox"
                      checked={optimizeForTts}
                      onChange={(e) => setOptimizeForTts(e.target.checked)}
                      className="w-5 h-5 rounded bg-[#212126] border-zinc-600 text-sky-500 focus:ring-0 accent-sky-500 cursor-pointer"
                    />
                    <span className="text-sm font-medium text-white">Tối ưu hóa cho thuyết minh (TTS)</span>
                  </label>

                  {/* Action Button */}
                  <button
                    onClick={() => onReTranslateAll(selectedModel, optimizeForTts, contextPrompt)}
                    disabled={isTranslatingBatch || subtitles.length === 0}
                    className="w-full mt-2 py-3.5 btn-metallic text-slate-950 disabled:opacity-50 font-black text-sm sm:text-base rounded-xl transition shadow-lg active:scale-98 flex items-center justify-center uppercase tracking-wider cursor-pointer"
                  >
                    {isTranslatingBatch ? (translationProgressMsg || 'Đang dịch lại...') : 'DỊCH LẠI TOÀN BỘ'}
                  </button>
                </div>
              )}

              {/* SHEET 5: TAB AUDIO */}
              {activeSheetType === 'audio' && (
                <div className="flex flex-col gap-3.5 text-xs pb-1">
                  {/* Top Sheet Pill Handle */}
                  <div className="w-10 h-1 bg-zinc-600 rounded-full mx-auto -mt-1 mb-1 opacity-50" />

                  {/* Header Title Bar */}
                  <div className="flex items-center justify-between pb-2">
                    <div className="flex items-center space-x-2">
                      <h3 className="text-base font-extrabold text-white tracking-tight">Tạo Thuyết minh (TTS)</h3>
                      {onOpenConfigDrawer && (
                        <button
                          type="button"
                          onClick={onOpenConfigDrawer}
                          className="p-1 text-sky-400 hover:text-sky-300 rounded-lg hover:bg-zinc-800/60 transition"
                          title="Cấu hình hệ thống"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelectTab(null)}
                      className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* 1. SELECT FIELD: TTS Engine */}
                  <div className="bg-[#242429] border border-zinc-700/60 rounded-2xl px-4 py-3 relative transition focus-within:border-sky-500">
                    <label className="text-[11px] text-zinc-400 font-medium block mb-1">
                      TTS Engine
                    </label>
                    <select
                      value={selectedTtsProvider}
                      onChange={(e) => {
                        const provider = e.target.value as TTSProviderOption;
                        setSelectedTtsProvider(provider);
                        onSaveSettings({ ...appSettings, ttsProvider: provider });
                      }}
                      className="w-full bg-transparent text-sm font-semibold text-white focus:outline-none cursor-pointer appearance-none pr-7"
                    >
                      <option value="nghi_tts" className="bg-[#1e1e24] text-white">Piper TTS (Offline)</option>
                      <option value="edge_tts" className="bg-[#1e1e24] text-white">Edge TTS (Online)</option>
                      <option value="tiktok_tts" className="bg-[#1e1e24] text-white">TikTok TTS (Thuyết Minh TikTok)</option>
                      <option value="gemini" className="bg-[#1e1e24] text-white">Gemini Audio (Google AI)</option>
                    </select>
                    <ChevronDown className="w-4 h-4 text-zinc-400 absolute right-3.5 bottom-3.5 pointer-events-none" />
                  </div>

                  {/* 2. SELECT FIELD: Ngôn ngữ */}
                  <div className="bg-[#242429] border border-zinc-700/60 rounded-2xl px-4 py-3 relative transition focus-within:border-sky-500">
                    <label className="text-[11px] text-zinc-400 font-medium block mb-1">
                      Ngôn ngữ Dịch & Thuyết minh
                    </label>
                    <select
                      value="Tiếng Việt"
                      onChange={(e) => {
                        onSelectTargetLang('Tiếng Việt');
                        onSaveSettings({ ...appSettings, targetLang: 'Tiếng Việt' });
                      }}
                      className="w-full bg-transparent text-sm font-semibold text-white focus:outline-none cursor-pointer appearance-none pr-7"
                    >
                      <option value="Tiếng Việt" className="bg-[#1e1e24] text-white">
                        🇻🇳 Tiếng Việt
                      </option>
                    </select>
                    <ChevronDown className="w-4 h-4 text-zinc-400 absolute right-3.5 bottom-3.5 pointer-events-none" />
                  </div>

                  {/* 3. SELECT FIELD: Giọng thuyết minh */}
                  <div className="bg-[#242429] border border-zinc-700/60 rounded-2xl px-4 py-3 relative transition focus-within:border-sky-500">
                    <label className="text-[11px] text-zinc-400 font-medium block mb-1">
                      Giọng thuyết minh
                    </label>

                    {/* Nghi TTS / Piper Voices */}
                    {selectedTtsProvider === 'nghi_tts' && (
                      <select
                        value={appSettings.nghiVoice || 'ngochuyennew'}
                        onChange={(e) => {
                          const v = e.target.value;
                          onSaveSettings({ ...appSettings, nghiVoice: v });
                          checkNghiStatus(v, true);
                        }}
                        className="w-full bg-transparent text-sm font-semibold text-white focus:outline-none cursor-pointer appearance-none pr-7"
                      >
                        {[
                          { id: 'ngochuyennew', name: 'Ngọc Huyền (Nữ)' },
                          { id: 'lacphi', name: 'Lạc Phi (Nam)' },
                          { id: 'duyoryx', name: 'Duy Oryx (Nam)' },
                          { id: 'ngocngan', name: 'Ngọc Ngạn (Nam)' },
                          { id: 'maiphuong', name: 'Mai Phương (Nữ)' },
                          { id: 'minhquang', name: 'Minh Quang (Nam)' },
                        ].map((v) => {
                          const isDownloaded = nghiStatus?.downloadedVoices?.includes(v.id);
                          return (
                            <option key={v.id} value={v.id} className="bg-[#1e1e24] text-white">
                              {isDownloaded ? `✓ ${v.name} (Đã sẵn sàng)` : `⏳ ${v.name} (Chưa tải - Chọn để tải)`}
                            </option>
                          );
                        })}
                      </select>
                    )}

                    {/* Edge TTS Voices */}
                    {selectedTtsProvider === 'edge_tts' && (
                      <select
                        value={appSettings.edgeVoice || 'vi-VN-HoaiMyNeural'}
                        onChange={(e) => onSaveSettings({ ...appSettings, edgeVoice: e.target.value })}
                        className="w-full bg-transparent text-sm font-semibold text-white focus:outline-none cursor-pointer appearance-none pr-7"
                      >
                        <option value="vi-VN-HoaiMyNeural" className="bg-[#1e1e24] text-white">✓ Hoài Mỹ (Nữ)</option>
                        <option value="vi-VN-NamMinhNeural" className="bg-[#1e1e24] text-white">✓ Nam Minh (Nam)</option>
                      </select>
                    )}

                    {/* TikTok TTS Voices */}
                    {selectedTtsProvider === 'tiktok_tts' && (
                      <select
                        value={appSettings.tiktokVoice || 'BV074_streaming'}
                        onChange={(e) => onSaveSettings({ ...appSettings, tiktokVoice: e.target.value })}
                        className="w-full bg-transparent text-sm font-semibold text-white focus:outline-none cursor-pointer appearance-none pr-7"
                      >
                        <option value="BV074_streaming" className="bg-[#1e1e24] text-white">✓ Giọng Nữ mặc định hệ thống (BV074_streaming)</option>
                        <option value="BV075_streaming" className="bg-[#1e1e24] text-white">✓ Giọng Nam mặc định hệ thống (BV075_streaming)</option>
                      </select>
                    )}

                    {/* Gemini Voices */}
                    {selectedTtsProvider === 'gemini' && (
                      <select
                        value={appSettings.geminiVoice || 'Kore'}
                        onChange={(e) => onSaveSettings({ ...appSettings, geminiVoice: e.target.value })}
                        className="w-full bg-transparent text-sm font-semibold text-white focus:outline-none cursor-pointer appearance-none pr-7"
                      >
                        <option value="Kore" className="bg-[#1e1e24] text-white">✓ Kore (Nữ Truyền Cảm)</option>
                        <option value="Puck" className="bg-[#1e1e24] text-white">✓ Puck (Nam Trầm Ấm)</option>
                        <option value="Charon" className="bg-[#1e1e24] text-white">✓ Charon (Nam Phim)</option>
                        <option value="Aoede" className="bg-[#1e1e24] text-white">✓ Aoede (Nữ Truyện Đọc)</option>
                      </select>
                    )}

                    <ChevronDown className="w-4 h-4 text-zinc-400 absolute right-3.5 bottom-3.5 pointer-events-none" />

                    {/* Active Voice Status Indicator Badge & Download Loading */}
                    {selectedTtsProvider === 'nghi_tts' && (
                      <div className="mt-2.5">
                        {isDownloadingNghi ? (
                          <div className="flex items-center space-x-2.5 bg-sky-950/80 border border-sky-500/50 p-2.5 rounded-xl text-sky-200 text-xs font-semibold animate-pulse">
                            <Loader2 className="w-4 h-4 animate-spin text-sky-400 shrink-0" />
                            <span>{downloadMsg || `Đang tải về mô hình giọng đọc... Vui lòng đợi trong giây lát.`}</span>
                          </div>
                        ) : nghiStatus?.downloadedVoices?.includes(appSettings.nghiVoice || 'ngochuyennew') ? (
                          <div className="flex items-center space-x-1.5 text-xs font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
                            <Check className="w-3.5 h-3.5 text-emerald-400 font-bold shrink-0" />
                            <span>Đã sẵn sàng (Giọng đọc đã tải thành công)</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleDownloadNghiModel(appSettings.nghiVoice || 'ngochuyennew')}
                            className="w-full flex items-center justify-center space-x-2 text-xs font-semibold text-amber-300 bg-amber-950/50 hover:bg-amber-900/60 border border-amber-500/40 px-3 py-2 rounded-xl transition cursor-pointer"
                          >
                            <Loader2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span>Giọng chưa tải — Click để tải về ngay</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 4. CARD BOX: Tùy chỉnh Giọng đọc */}
                  <div className="bg-[#1c1c21] border border-zinc-800/90 rounded-2xl p-4 space-y-3.5">
                    {/* Header Row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <SlidersHorizontal className="w-4 h-4 text-sky-400" />
                        <span className="font-bold text-xs text-white">Tùy chỉnh Giọng đọc</span>
                      </div>

                      <span className="text-[11px] font-mono font-bold text-zinc-300">
                        Speed: {ttsSpeed.toFixed(1).replace('.', ',')}x | Pitch: {(1 + ttsPitch / 10).toFixed(1).replace('.', ',')}x
                      </span>

                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => {
                            const sampleText = activeSubtitle
                              ? (activeSubtitle.translatedText || activeSubtitle.originalText)
                              : "Xin chào, đây là giọng đọc thử nghiệm với tốc độ và cao độ tùy chỉnh.";
                            onPlayTTS(sampleText, ttsSpeed, ttsPitch, selectedTtsProvider);
                          }}
                          className="text-xs font-bold text-sky-400 hover:text-sky-300 flex items-center space-x-1 transition active:scale-95 bg-sky-500/10 px-2.5 py-1 rounded-lg border border-sky-500/20"
                        >
                          <Volume2 className="w-3.5 h-3.5 text-sky-400" />
                          <span>Nghe thử</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setIsTuningCollapsed(!isTuningCollapsed)}
                          className="text-zinc-400 hover:text-white p-0.5"
                        >
                          {isTuningCollapsed ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronUp className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {!isTuningCollapsed && (
                      <div className="space-y-3.5 pt-1 border-t border-zinc-800/80">
                        {/* Speed Slider */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-zinc-300 font-medium">Tốc độ giọng đọc</span>
                            <span className="font-mono text-white font-bold">{ttsSpeed.toFixed(1).replace('.', ',')}x</span>
                          </div>
                          <input
                            type="range"
                            min="0.5"
                            max="2.0"
                            step="0.1"
                            value={ttsSpeed}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setTtsSpeed(val);
                              onSaveSettings({ ...appSettings, ttsSpeed: val });
                            }}
                            className="w-full accent-sky-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                          />
                        </div>

                        {/* Pitch Slider */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-zinc-300 font-medium">Cao độ giọng đọc (Pitch)</span>
                            <span className="font-mono text-white font-bold">{(1 + ttsPitch / 10).toFixed(1).replace('.', ',')}x</span>
                          </div>
                          <input
                            type="range"
                            min="-5"
                            max="5"
                            step="1"
                            value={ttsPitch}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setTtsPitch(val);
                              onSaveSettings({ ...appSettings, ttsPitch: val });
                            }}
                            className="w-full accent-sky-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                          />
                        </div>

                        <p className="text-[11px] text-zinc-400 leading-relaxed pt-1">
                          Chỉnh giọng trầm hơn (0.5x) hoặc thanh bổng hơn (1.5x). Mặc định 1.0x.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 5. CHECKBOX: Gộp phụ đề */}
                  <div className="flex items-start space-x-3 px-1 pt-1">
                    <input
                      type="checkbox"
                      id="merge-subtitles-chk"
                      checked={autoMergeSubtitles}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setAutoMergeSubtitles(checked);
                        if (checked) {
                          onMergeShortSubtitles();
                        }
                      }}
                      className="accent-sky-500 w-4 h-4 rounded cursor-pointer mt-0.5"
                    />
                    <label htmlFor="merge-subtitles-chk" className="cursor-pointer select-none space-y-0.5">
                      <span className="font-bold text-xs text-white block">Gộp phụ đề</span>
                      <span className="text-[11px] text-zinc-400 block">Gộp các đoạn ngắn đứt gãy để audio liền mạch hơn</span>
                    </label>
                  </div>

                  {/* 6. MAIN ACTION BUTTON: TẠO AUDIO */}
                  <div className="pt-2 space-y-2">
                    <button
                      type="button"
                      onClick={async () => {
                        if (autoMergeSubtitles) {
                          onMergeShortSubtitles();
                        }
                        onGenerateAllAudio();
                      }}
                      disabled={isGeneratingAllAudio || subtitles.length === 0}
                      className="w-full py-3.5 bg-[#0088ff] hover:bg-[#0077ee] disabled:opacity-50 text-white font-black text-sm rounded-2xl shadow-lg shadow-sky-500/20 transition active:scale-[0.98] uppercase tracking-wider flex items-center justify-center space-x-2"
                    >
                      {isGeneratingAllAudio ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin text-white" />
                          <span>ĐANG TẠO AUDIO ({audioGenProgress.current}/{audioGenProgress.total})...</span>
                        </>
                      ) : (
                        <span>TẠO AUDIO</span>
                      )}
                    </button>

                    {/* Secondary Playback Options */}
                    <div className="flex items-center justify-between px-1 text-[11px]">
                      <label className="flex items-center space-x-2 cursor-pointer text-zinc-300 font-medium">
                        <input
                          type="checkbox"
                          checked={audioPlayWithVideo}
                          onChange={(e) => onToggleAudioPlayWithVideo(e.target.checked)}
                          className="accent-sky-500 w-3.5 h-3.5 rounded"
                        />
                        <span>Tự phát thuyết minh khi chạy video</span>
                      </label>

                      <button
                        type="button"
                        onClick={onClearAllAudio}
                        className="text-rose-400 hover:text-rose-300 font-medium underline flex items-center space-x-1"
                      >
                        <VolumeX className="w-3.5 h-3.5" />
                        <span>Xóa Audio</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* SHEET 6: TAB FILTERS (Lọc từ khóa / Watermark rác) */}
              {activeSheetType === 'filters' && (
                <div className="flex flex-col gap-3 text-xs max-w-sm mx-auto w-full">
                  {/* Top Bar */}
                  <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
                    <h3 className="text-sm font-bold text-white">Lọc từ khóa / Watermark</h3>
                    <button
                      type="button"
                      onClick={() => onSelectTab(null)}
                      className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="relative">
                      <input
                        type="text"
                        value={filterKeywords}
                        onChange={(e) => setFilterKeywords(e.target.value)}
                        placeholder="Nhập từ khóa cần lọc"
                        className="w-full bg-[#16161a] border border-[#26262b] rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 font-medium"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleExecuteFilterSmart}
                      className="w-full py-2.5 bg-gradient-to-r from-slate-200 via-zinc-100 to-slate-300 hover:from-white hover:via-slate-100 hover:to-zinc-200 text-zinc-900 border border-slate-300/40 shadow-[inset_0_1px_1px_rgba(255,255,255,0.7),0_2px_4px_rgba(0,0,0,0.2)] font-black text-xs uppercase tracking-wider rounded-xl transition-all duration-200 transform active:scale-95 cursor-pointer text-center select-none"
                    >
                      THỰC HIỆN LỌC
                    </button>
                  </div>
                </div>
              )}

              {/* SHEET 7: TAB FIND & REPLACE (Tìm kiếm & Thay thế) */}
              {activeSheetType === 'find_replace' && (
                <div className="flex flex-col gap-3 text-xs max-w-sm mx-auto w-full">
                  {/* Top Bar */}
                  <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
                    <h3 className="text-sm font-bold text-white">Tìm & Thay thế</h3>
                    <button
                      type="button"
                      onClick={() => onSelectTab(null)}
                      className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="relative">
                      <input
                        type="text"
                        value={findText}
                        onChange={(e) => setFindText(e.target.value)}
                        placeholder="Tìm từ"
                        className="w-full bg-[#16161a] border border-[#26262b] rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 font-medium"
                      />
                    </div>

                    <div className="relative">
                      <input
                        type="text"
                        value={replaceText}
                        onChange={(e) => setReplaceText(e.target.value)}
                        placeholder="Thay thế bằng"
                        className="w-full bg-[#16161a] border border-[#26262b] rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 font-medium"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleFindReplace}
                      className="w-full py-2.5 bg-gradient-to-r from-slate-200 via-zinc-100 to-slate-300 hover:from-white hover:via-slate-100 hover:to-zinc-200 text-zinc-900 border border-slate-300/40 shadow-[inset_0_1px_1px_rgba(255,255,255,0.7),0_2px_4px_rgba(0,0,0,0.2)] font-black text-xs uppercase tracking-wider rounded-xl transition-all duration-200 transform active:scale-95 cursor-pointer text-center select-none"
                    >
                      THỰC HIỆN THAY THẾ
                    </button>
                  </div>
                </div>
              )}

              {/* SHEET 8: TAB OVERLAYS (Chèn/Mờ - Làm mờ, Chèn logo, Chèn chữ) */}
              {activeSheetType === 'overlays' && (
                <div className="flex flex-col gap-3 text-xs max-w-sm mx-auto w-full">
                  {/* Top Bar with dynamic title based on filtersSubTab */}
                  <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
                    <h3 className="text-sm font-bold text-white">
                      {filtersSubTab === 'blur' && "Làm mờ (Blur) Video"}
                      {filtersSubTab === 'logo' && "Chèn Logo Thương Hiệu"}
                      {filtersSubTab === 'text_overlay' && "Chèn Văn Bản / Chữ"}
                    </h3>
                    <button
                      type="button"
                      onClick={() => onSelectTab(null)}
                      className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* SUB TAB 1: BLUR OVERLAYS */}
                  {filtersSubTab === 'blur' && (
                    <div className="space-y-3">
                      <div className="space-y-2.5">
                        <p className="text-slate-400 text-[11px] leading-relaxed">
                          Tạo vùng làm mờ (Blur) để che video hoặc logo nhạy cảm. Bạn có thể kéo thả, di chuyển trực tiếp trên khung xem video.
                        </p>

                        {/* Virtual Border Option */}
                        <div className="flex items-center justify-between p-2 bg-[#121216] border border-[#26262b] rounded-xl">
                          <div className="flex items-center space-x-2">
                            <div className={`w-2.5 h-2.5 rounded-full border ${showBlurVirtualBorder ? 'border-sky-400 bg-sky-400/40 shadow-[0_0_6px_rgba(56,189,248,0.6)]' : 'border-slate-600 bg-slate-800'}`} />
                            <div>
                              <span className="text-xs font-bold text-slate-200">Tùy chọn viền ảo</span>
                              <p className="text-[10px] text-slate-400">Khung viền hỗ trợ căn chỉnh trên preview (không xuất vào video)</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onToggleBlurVirtualBorder?.(!showBlurVirtualBorder)}
                            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                              showBlurVirtualBorder ? 'bg-sky-500' : 'bg-slate-700'
                            }`}
                            title="Bật/Tắt viền ảo căn chỉnh vùng mờ"
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                                showBlurVirtualBorder ? 'translate-x-4.5' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={handleAddBlurOverlay}
                          className="w-full py-2.5 bg-gradient-to-r from-slate-200 via-zinc-100 to-slate-300 hover:from-white hover:via-slate-100 hover:to-zinc-200 text-zinc-900 border border-slate-300/40 shadow-[inset_0_1px_1px_rgba(255,255,255,0.7),0_2px_4px_rgba(0,0,0,0.2)] font-black text-xs uppercase tracking-wider rounded-xl transition-all duration-200 transform active:scale-95 cursor-pointer flex items-center justify-center space-x-1.5 select-none"
                        >
                          <Plus className="w-4 h-4 text-zinc-900 stroke-[3px]" />
                          <span>THÊM VÙNG MỜ</span>
                        </button>
                      </div>

                      {blurOverlays.length === 0 ? (
                        <div className="text-center py-4 text-slate-500 text-xs">Chưa có vùng làm mờ nào được tạo</div>
                      ) : (
                        <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                          {blurOverlays.map((blur) => (
                            <div key={blur.id} className="bg-[#141418] border border-[#26262b] p-2.5 rounded-xl flex items-center justify-between space-x-3">
                              <div className="flex-1 space-y-2">
                                <div className="flex justify-between text-[10px] text-slate-400 font-bold">
                                  <span>Mức Blur: {blur.blur}px</span>
                                  <span>Bo góc: {blur.borderRadius}px</span>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <input
                                    type="range"
                                    min="2"
                                    max="40"
                                    value={blur.blur}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value);
                                      onChangeBlurOverlays?.(
                                        blurOverlays.map(b => b.id === blur.id ? { ...b, blur: val } : b)
                                      );
                                    }}
                                    className="flex-1 accent-[#2196F3] h-1"
                                  />
                                  <input
                                    type="range"
                                    min="0"
                                    max="30"
                                    value={blur.borderRadius}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value);
                                      onChangeBlurOverlays?.(
                                        blurOverlays.map(b => b.id === blur.id ? { ...b, borderRadius: val } : b)
                                      );
                                    }}
                                    className="flex-1 accent-[#2196F3] h-1"
                                  />
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => onChangeBlurOverlays?.(blurOverlays.filter(b => b.id !== blur.id))}
                                className="p-1.5 bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 rounded-lg transition"
                                title="Xóa vùng mờ"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* SUB TAB 2: LOGO OVERLAYS */}
                  {filtersSubTab === 'logo' && (
                    <div className="space-y-3">
                      <div className="space-y-2.5">
                        <p className="text-slate-400 text-[11px] leading-relaxed">
                          Chèn logo thương hiệu của bạn lên video. Bạn có thể kéo thả di chuyển và thay đổi độ mờ của logo.
                        </p>
                        <label className="w-full py-2.5 bg-gradient-to-r from-slate-200 via-zinc-100 to-slate-300 hover:from-white hover:via-slate-100 hover:to-zinc-200 text-zinc-900 border border-slate-300/40 shadow-[inset_0_1px_1px_rgba(255,255,255,0.7),0_2px_4px_rgba(0,0,0,0.2)] font-black text-xs uppercase tracking-wider rounded-xl transition-all duration-200 transform active:scale-95 cursor-pointer flex items-center justify-center space-x-1.5 select-none">
                          <Camera className="w-4 h-4 text-zinc-900" />
                          <span>CHỌN ẢNH LOGO</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleAddLogoOverlay(file);
                            }}
                          />
                        </label>
                      </div>

                      {logoOverlays.length === 0 ? (
                        <div className="text-center py-4 text-slate-500 text-xs">Chưa có logo nào được chèn</div>
                      ) : (
                        <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                          {logoOverlays.map((logo) => (
                            <div key={logo.id} className="bg-[#141418] border border-[#26262b] p-2.5 rounded-xl flex items-center space-x-3">
                              <img src={logo.url} className="w-8 h-8 rounded object-cover bg-slate-900 border border-slate-700" alt="logo" referrerPolicy="no-referrer" />
                              <div className="flex-1 space-y-1">
                                <div className="flex justify-between text-[10px] text-slate-400 font-bold">
                                  <span>Độ mờ (Opacity): {logo.opacity}%</span>
                                </div>
                                <input
                                  type="range"
                                  min="10"
                                  max="100"
                                  value={logo.opacity}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value);
                                    onChangeLogoOverlays?.(
                                      logoOverlays.map(l => l.id === logo.id ? { ...l, opacity: val } : l)
                                    );
                                  }}
                                  className="w-full accent-[#2196F3] h-1"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => onChangeLogoOverlays?.(logoOverlays.filter(l => l.id !== logo.id))}
                                className="p-1.5 bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 rounded-lg transition"
                                title="Xóa logo"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* SUB TAB 3: TEXT OVERLAYS */}
                  {filtersSubTab === 'text_overlay' && (
                    <div className="space-y-3">
                      <div className="space-y-2.5">
                        <p className="text-slate-400 text-[11px] leading-relaxed">
                          Chèn chữ tiêu đề hoặc watermark thương hiệu xuyên suốt video. Bạn có thể kéo thả di chuyển trực tiếp trên khung xem video.
                        </p>
                        <button
                          type="button"
                          onClick={handleAddTextOverlay}
                          className="w-full py-2.5 bg-gradient-to-r from-slate-200 via-zinc-100 to-slate-300 hover:from-white hover:via-slate-100 hover:to-zinc-200 text-zinc-900 border border-slate-300/40 shadow-[inset_0_1px_1px_rgba(255,255,255,0.7),0_2px_4px_rgba(0,0,0,0.2)] font-black text-xs uppercase tracking-wider rounded-xl transition-all duration-200 transform active:scale-95 cursor-pointer flex items-center justify-center space-x-1.5 select-none"
                        >
                          <Plus className="w-4 h-4 text-zinc-900 stroke-[3px]" />
                          <span>THÊM CHỮ CHÈN</span>
                        </button>
                      </div>

                      {textOverlays.length === 0 ? (
                        <div className="text-center py-4 text-slate-500 text-xs">Chưa có đoạn chữ nào được chèn</div>
                      ) : (
                        <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                          {textOverlays.map((textItem) => (
                            <div key={textItem.id} className="bg-[#141418] border border-[#26262b] p-3 rounded-xl flex flex-col gap-2">
                              <div className="flex items-center justify-between space-x-2">
                                <input
                                  type="text"
                                  value={textItem.text}
                                  onChange={(e) => {
                                    onChangeTextOverlays?.(
                                      textOverlays.map(t => t.id === textItem.id ? { ...t, text: e.target.value } : t)
                                    );
                                  }}
                                  className="flex-1 bg-[#16161a] border border-[#26262b] rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-zinc-500 focus:outline-none focus:border-[#2196F3] font-medium"
                                  placeholder="Nhập nội dung chữ..."
                                />
                                <button
                                  type="button"
                                  onClick={() => onSelectTab('style')}
                                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition flex-shrink-0"
                                  title="Mở bảng điều chỉnh style chữ"
                                >
                                  <Palette className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onChangeTextOverlays?.(textOverlays.filter(t => t.id !== textItem.id))}
                                  className="p-1.5 bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 rounded-lg transition flex-shrink-0"
                                  title="Xóa đoạn chữ"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <div className="flex items-center space-x-2">
                                <div className="flex items-center space-x-1.5 flex-1">
                                  <span className="text-[10px] text-slate-400 font-medium">Cỡ chữ:</span>
                                  <input
                                    type="range"
                                    min="12"
                                    max="48"
                                    value={textItem.fontSize}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value);
                                      onChangeTextOverlays?.(
                                        textOverlays.map(t => t.id === textItem.id ? { ...t, fontSize: val } : t)
                                      );
                                    }}
                                    className="flex-1 accent-[#2196F3] h-1"
                                  />
                                  <span className="text-[10px] text-slate-300 font-mono w-5 text-right">{textItem.fontSize}</span>
                                </div>
                                <div className="flex items-center space-x-1.5">
                                  <input
                                    type="color"
                                    value={textItem.color}
                                    onChange={(e) => {
                                      onChangeTextOverlays?.(
                                        textOverlays.map(t => t.id === textItem.id ? { ...t, color: e.target.value } : t)
                                      );
                                    }}
                                    className="w-5 h-5 rounded cursor-pointer border border-[#26262b] bg-transparent p-0 overflow-hidden"
                                    title="Màu chữ"
                                  />
                                  <input
                                    type="color"
                                    value={textItem.backgroundColor}
                                    onChange={(e) => {
                                      onChangeTextOverlays?.(
                                        textOverlays.map(t => t.id === textItem.id ? { ...t, backgroundColor: e.target.value } : t)
                                      );
                                    }}
                                    className="w-5 h-5 rounded cursor-pointer border border-[#26262b] bg-transparent p-0 overflow-hidden"
                                    title="Màu nền"
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* SHEET: VIDEO VOLUME */}
              {activeSheetType === 'video_volume' && (
                <div className="flex flex-col gap-3 text-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <span className="font-bold text-xs text-white uppercase tracking-wider flex items-center space-x-1.5">
                      <Volume2 className="w-4 h-4 text-sky-400" />
                      <span>Âm Lượng Video Gốc</span>
                    </span>
                    <button
                      onClick={() => setActiveVideoSubTab(null)}
                      className="p-1 text-slate-400 hover:text-white bg-slate-800 rounded-full"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex flex-col gap-4 py-2">
                    <div className="flex justify-between items-center text-slate-300 font-bold">
                      <span>Âm lượng</span>
                      <span className="text-sky-400 font-mono text-sm">{Math.round(videoVolume * 100)}%</span>
                    </div>

                    <div className="flex items-center space-x-3">
                      <VolumeX className="w-4 h-4 text-slate-400" />
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={videoVolume}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (onChangeVideoVolume) onChangeVideoVolume(val);
                        }}
                        className="flex-1 accent-sky-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                      />
                      <Volume2 className="w-4 h-4 text-sky-400" />
                    </div>

                    <div className="flex justify-between items-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => onChangeVideoVolume && onChangeVideoVolume(0)}
                        className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition ${
                          videoVolume === 0
                            ? 'bg-rose-500/10 border-rose-500 text-rose-400'
                            : 'bg-slate-800/40 border-slate-700 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        Tắt âm
                      </button>
                      <button
                        type="button"
                        onClick={() => onChangeVideoVolume && onChangeVideoVolume(0.5)}
                        className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition ${
                          videoVolume === 0.5
                            ? 'bg-sky-500/10 border-sky-500 text-sky-400'
                            : 'bg-slate-800/40 border-slate-700 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        50%
                      </button>
                      <button
                        type="button"
                        onClick={() => onChangeVideoVolume && onChangeVideoVolume(1.0)}
                        className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition ${
                          videoVolume === 1.0
                            ? 'bg-sky-500/10 border-sky-500 text-sky-400'
                            : 'bg-slate-800/40 border-slate-700 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        100%
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* SHEET: VIDEO SPEED */}
              {activeSheetType === 'video_speed' && (
                <div className="flex flex-col gap-3 text-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <span className="font-bold text-xs text-white uppercase tracking-wider flex items-center space-x-1.5">
                      <Sliders className="w-4 h-4 text-sky-400" />
                      <span>Tốc Độ Phát Video</span>
                    </span>
                    <button
                      onClick={() => setActiveVideoSubTab(null)}
                      className="p-1 text-slate-400 hover:text-white bg-slate-800 rounded-full"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex flex-col gap-4 py-2">
                    <div className="flex justify-between items-center text-slate-300 font-bold">
                      <span>Tốc độ</span>
                      <span className="text-sky-400 font-mono text-sm">{videoSpeed}x</span>
                    </div>

                    <div className="flex items-center space-x-3">
                      <span className="text-[10px] font-mono text-slate-500 w-6">0.2x</span>
                      <input
                        type="range"
                        min="0.2"
                        max="3.0"
                        step="0.05"
                        value={videoSpeed}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (onChangeVideoSpeed) onChangeVideoSpeed(val);
                        }}
                        className="flex-1 accent-sky-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                      />
                      <span className="text-[10px] font-mono text-slate-500 w-6 text-right">3.0x</span>
                    </div>

                    {/* Presets */}
                    <div className="grid grid-cols-5 gap-1.5 pt-2">
                      {[0.5, 0.75, 1.0, 1.5, 2.0].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => onChangeVideoSpeed && onChangeVideoSpeed(preset)}
                          className={`py-1.5 rounded-lg border text-center font-mono text-xs font-bold transition ${
                            videoSpeed === preset
                              ? 'bg-sky-500/10 border-sky-500 text-sky-400'
                              : 'bg-slate-800/40 border-slate-700 text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          {preset}x
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

            </div>

            {toastMessage && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/10 pointer-events-none z-[250]">
                <div className="bg-[#2a2a2f]/95 text-white/95 text-sm px-5 py-3 rounded-lg shadow-2xl flex items-center justify-center border border-zinc-800/80 animate-fade-in backdrop-blur-md">
                  <span className="font-medium text-zinc-300">{toastMessage}</span>
                </div>
              </div>
            )}

          </div>
        </React.Fragment>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 2. DYNAMIC BOTTOM TOOLBAR BAR */}
      {/* (Switches to Block Edit Mode when selectedSubtitle or isVideoSelected is active!) */}
      {/* ------------------------------------------------------------- */}
      {selectedSubtitle ? (
        /* CAPCUT SUBTITLE BLOCK EDIT TOOLBAR (< | Tạo Audio | Nghe thử | Sửa | Quét lại | Config | Xóa) */
        <div className="h-[52px] min-h-[52px] max-h-[52px] my-auto bg-[#141418] mx-1 rounded-2xl px-2 sm:px-3 flex items-center justify-between sm:justify-around border border-slate-600/80 shadow-2xl animate-in fade-in duration-150 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex-shrink-0">
          {/* 1. BACK BUTTON < */}
          <button
            onClick={() => {
              onSelectSubtitle(null);
              setShowTextEditor(false);
              setShowConfigPanel(false);
            }}
            className="flex-1 min-w-[50px] flex flex-col items-center justify-center py-1 px-1 rounded-xl bg-gradient-to-b from-zinc-800 via-zinc-900 to-[#121215] border border-zinc-600/80 text-slate-200 hover:text-white hover:border-slate-300 transition-all h-[42px] min-h-[42px] max-h-[42px] shadow-sm active:scale-95 flex-shrink-0"
            title="Bỏ chọn block phụ đề"
          >
            <ChevronLeft className="w-4 h-4 text-slate-200" />
            <span className="text-[10px] font-bold">Quay lại</span>
          </button>

          {/* 2. TẠO AUDIO RIÊNG CHO PHỤ ĐỀ NÀY */}
          <button
            onClick={() => {
              if (onGenerateSingleAudio && selectedSubtitle) {
                onGenerateSingleAudio(selectedSubtitle.id);
              }
            }}
            disabled={isGeneratingSingleAudio === selectedSubtitle.id}
            className={`flex-1 min-w-[62px] flex flex-col items-center justify-center py-1 px-1.5 rounded-xl transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 shadow-md active:scale-95 border ${
              isGeneratingSingleAudio === selectedSubtitle.id
                ? 'bg-zinc-800 border-zinc-500 text-slate-300 cursor-wait'
                : selectedSubtitle.audioUrl
                ? 'bg-gradient-to-b from-slate-200 via-zinc-300 to-slate-400 text-slate-950 font-bold border-white hover:brightness-110 shadow-slate-300/20'
                : 'bg-gradient-to-b from-slate-100 via-slate-300 to-zinc-400 text-slate-950 font-extrabold border-white hover:brightness-110 shadow-slate-300/30'
            }`}
            title="Tạo file âm thanh đọc riêng cho phụ đề được chọn này"
          >
            {isGeneratingSingleAudio === selectedSubtitle.id ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-200" />
            ) : (
              <Mic className="w-4 h-4 text-slate-950" />
            )}
            <span className="text-[10px] font-extrabold whitespace-nowrap">
              {isGeneratingSingleAudio === selectedSubtitle.id
                ? 'Đang tạo...'
                : selectedSubtitle.audioUrl
                ? 'Tạo lại Audio'
                : 'Tạo Audio'}
            </span>
          </button>

          {/* 3. NGHE THỬ AUDIO RIÊNG (Nếu đã có audio) */}
          {selectedSubtitle.audioUrl && onPlaySingleAudio && (
            <button
              onClick={() => onPlaySingleAudio(selectedSubtitle)}
              className="flex-1 min-w-[52px] flex flex-col items-center justify-center py-1 px-1 rounded-xl bg-gradient-to-b from-zinc-800 via-zinc-900 to-[#121215] border border-slate-400 text-slate-100 hover:text-white hover:border-white transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 shadow-sm active:scale-95"
              title="Nghe thử âm thanh đã tạo của phụ đề này"
            >
              <Play className="w-4 h-4 text-slate-100 fill-slate-100" />
              <span className="text-[10px] font-bold">Nghe thử</span>
            </button>
          )}

          {/* 4. SỬA TEXT */}
          <button
            onClick={handleOpenTextEditor}
            className="flex-1 min-w-[50px] flex flex-col items-center justify-center py-1 px-1 rounded-xl bg-gradient-to-b from-zinc-800 via-zinc-900 to-[#121215] border border-zinc-600/80 text-slate-200 hover:text-white hover:border-slate-300 transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 shadow-sm active:scale-95"
            title="Sửa nội dung văn bản phụ đề"
          >
            <Edit3 className="w-4 h-4 text-slate-200" />
            <span className="text-[10px] font-bold">Sửa</span>
          </button>

          {/* 5. QUÉT LẠI (OCR) */}
          {onReScanSubtitle && (
            <button
              onClick={() => {
                onReScanSubtitle(selectedSubtitle);
              }}
              className="flex-1 min-w-[52px] flex flex-col items-center justify-center py-1 px-1 rounded-xl bg-gradient-to-b from-zinc-800 via-zinc-900 to-[#121215] border border-zinc-600/80 text-slate-200 hover:text-white hover:border-slate-300 transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 shadow-sm active:scale-95"
              title="Quét Lại (OCR lại đoạn thời gian của phụ đề này)"
            >
              <RefreshCw className="w-4 h-4 text-slate-200" />
              <span className="text-[10px] font-bold whitespace-nowrap">Quét Lại</span>
            </button>
          )}

          {/* 6. CONFIG STYLING */}
          <button
            onClick={() => {
              setShowConfigPanel(true);
              setShowTextEditor(false);
            }}
            className="flex-1 min-w-[50px] flex flex-col items-center justify-center py-1 px-1 rounded-xl bg-gradient-to-b from-zinc-800 via-zinc-900 to-[#121215] border border-zinc-600/80 text-slate-200 hover:text-white hover:border-slate-300 transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 shadow-sm active:scale-95"
            title="Chỉnh font chữ, màu sắc, viền, kích thước"
          >
            <Palette className="w-4 h-4 text-slate-200" />
            <span className="text-[10px] font-bold">Config</span>
          </button>

          {/* 7. XÓA SUBTITLE */}
          <button
            onClick={() => {
              onDeleteSubtitle(selectedSubtitle.id);
              onSelectSubtitle(null);
              setShowTextEditor(false);
              setShowConfigPanel(false);
            }}
            className="flex-1 min-w-[46px] flex flex-col items-center justify-center py-1 px-1 rounded-xl bg-gradient-to-b from-zinc-800 via-zinc-900 to-[#121215] border border-rose-900/60 text-rose-300 hover:text-rose-100 hover:bg-rose-950/80 hover:border-rose-500 transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 shadow-sm active:scale-95"
            title="Xóa block phụ đề này"
          >
            <Trash2 className="w-4 h-4 text-rose-400" />
            <span className="text-[10px] font-bold">Xóa</span>
          </button>
        </div>
      ) : isVideoSelected ? (
        /* CONTEXT-SENSITIVE VIDEO BLOCK TOOLBAR (QUAY LẠI, THAY THẾ, ÂM LƯỢNG, TỐC ĐỘ) */
        <div className="h-[52px] min-h-[52px] max-h-[52px] my-auto bg-[#141418] mx-1 rounded-2xl px-2 sm:px-3 flex items-center justify-between sm:justify-around border border-slate-600/80 shadow-2xl animate-in fade-in duration-150 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex-shrink-0">
          {/* 1. BACK BUTTON <- */}
          <button
            onClick={() => {
              if (onSelectVideoBlock) onSelectVideoBlock(false);
            }}
            className="flex-1 min-w-[56px] flex flex-col items-center justify-center py-1 px-1 rounded-xl bg-gradient-to-b from-zinc-800 via-zinc-900 to-[#121215] border border-zinc-600/80 text-slate-200 hover:text-white hover:border-slate-300 transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 shadow-sm active:scale-95"
            title="Bỏ chọn block video"
          >
            <ChevronLeft className="w-4 h-4 text-slate-200" />
            <span className="text-[10px] font-bold">Quay lại</span>
          </button>

          {/* 2. THAY THẾ (REPLACE VIDEO) */}
          <button
            onClick={() => {
              if (onOpenImportModal) onOpenImportModal();
            }}
            className="flex-1 min-w-[56px] flex flex-col items-center justify-center py-1 px-1 rounded-xl bg-gradient-to-b from-zinc-800 via-zinc-900 to-[#121215] border border-zinc-600/80 text-slate-200 hover:text-white hover:border-slate-300 transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 shadow-sm active:scale-95"
            title="Thay thế file video gốc"
          >
            <Camera className="w-4 h-4 text-slate-200" />
            <span className="text-[10px] font-bold">Thay thế</span>
          </button>

          {/* 3. ÂM LƯỢNG (VIDEO VOLUME) */}
          <button
            onClick={() => {
              setActiveVideoSubTab(activeVideoSubTab === 'volume' ? null : 'volume');
            }}
            className={`flex-1 min-w-[56px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 shadow-md active:scale-95 ${
              activeVideoSubTab === 'volume'
                ? 'bg-gradient-to-b from-slate-100 via-slate-300 to-zinc-400 text-slate-950 font-bold border border-white shadow-[0_0_10px_rgba(255,255,255,0.3)]'
                : 'bg-gradient-to-b from-zinc-800 via-zinc-900 to-[#121215] border border-zinc-600/80 text-slate-200 hover:text-white hover:border-slate-300'
            }`}
            title="Chỉnh âm lượng video gốc"
          >
            <Volume2 className="w-4 h-4" />
            <span className="text-[10px] font-bold">
              {videoVolume === 0 ? 'Tắt âm' : `${Math.round(videoVolume * 100)}%`}
            </span>
          </button>

          {/* 4. TỐC ĐỘ (VIDEO SPEED) */}
          <button
            onClick={() => {
              setActiveVideoSubTab(activeVideoSubTab === 'speed' ? null : 'speed');
            }}
            className={`flex-1 min-w-[56px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 shadow-md active:scale-95 ${
              activeVideoSubTab === 'speed'
                ? 'bg-gradient-to-b from-slate-100 via-slate-300 to-zinc-400 text-slate-950 font-bold border border-white shadow-[0_0_10px_rgba(255,255,255,0.3)]'
                : 'bg-gradient-to-b from-zinc-800 via-zinc-900 to-[#121215] border border-zinc-600/80 text-slate-200 hover:text-white hover:border-slate-300'
            }`}
            title="Tốc độ phát video"
          >
            <Sliders className="w-4 h-4" />
            <span className="text-[10px] font-bold">Tốc độ ({videoSpeed}x)</span>
          </button>
        </div>
      ) : (
        /* STANDARD CAPCUT BOTTOM TOOLBAR BUTTONS WITH METALLIC SILVER THEME */
        <div className="h-[52px] min-h-[52px] max-h-[52px] my-auto bg-[#141418] mx-1 rounded-2xl px-2 sm:px-3 flex items-center justify-between sm:justify-around overflow-x-auto border border-slate-600/80 shadow-2xl gap-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex-shrink-0">
          <button
            onClick={() => onSelectTab(activeTab === 'extract' ? null : 'extract')}
            className={`flex-1 min-w-[56px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 active:scale-95 ${
              activeTab === 'extract'
                ? 'bg-gradient-to-b from-slate-100 via-slate-300 to-zinc-400 text-slate-950 font-extrabold border border-white shadow-[0_0_12px_rgba(255,255,255,0.35)] scale-[1.02]'
                : 'bg-gradient-to-b from-zinc-800/90 via-zinc-900/90 to-[#141418] border border-zinc-600/70 text-slate-200 hover:text-white hover:border-slate-300 hover:from-zinc-700 hover:to-zinc-800 shadow-md'
            }`}
          >
            <Crop className="w-4 h-4" />
            <span className="text-[10px] font-bold">Extract</span>
          </button>

          <button
            onClick={() => onSelectTab(activeTab === 'translate' ? null : 'translate')}
            className={`flex-1 min-w-[56px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 active:scale-95 ${
              activeTab === 'translate'
                ? 'bg-gradient-to-b from-slate-100 via-slate-300 to-zinc-400 text-slate-950 font-extrabold border border-white shadow-[0_0_12px_rgba(255,255,255,0.35)] scale-[1.02]'
                : 'bg-gradient-to-b from-zinc-800/90 via-zinc-900/90 to-[#141418] border border-zinc-600/70 text-slate-200 hover:text-white hover:border-slate-300 hover:from-zinc-700 hover:to-zinc-800 shadow-md'
            }`}
          >
            <Languages className="w-4 h-4" />
            <span className="text-[10px] font-bold">Translate</span>
          </button>

          <button
            onClick={() => onSelectTab(activeTab === 'style' ? null : 'style')}
            className={`flex-1 min-w-[56px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 active:scale-95 ${
              activeTab === 'style' || activeTab === 'config'
                ? 'bg-gradient-to-b from-slate-100 via-slate-300 to-zinc-400 text-slate-950 font-extrabold border border-white shadow-[0_0_12px_rgba(255,255,255,0.35)] scale-[1.02]'
                : 'bg-gradient-to-b from-zinc-800/90 via-zinc-900/90 to-[#141418] border border-zinc-600/70 text-slate-200 hover:text-white hover:border-slate-300 hover:from-zinc-700 hover:to-zinc-800 shadow-md'
            }`}
          >
            <Palette className="w-4 h-4" />
            <span className="text-[10px] font-bold whitespace-nowrap">Kiểu chữ</span>
          </button>

          <button
            onClick={() => onSelectTab(activeTab === 'audio' ? null : 'audio')}
            className={`flex-1 min-w-[56px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 active:scale-95 ${
              activeTab === 'audio'
                ? 'bg-gradient-to-b from-slate-100 via-slate-300 to-zinc-400 text-slate-950 font-extrabold border border-white shadow-[0_0_12px_rgba(255,255,255,0.35)] scale-[1.02]'
                : 'bg-gradient-to-b from-zinc-800/90 via-zinc-900/90 to-[#141418] border border-zinc-600/70 text-slate-200 hover:text-white hover:border-slate-300 hover:from-zinc-700 hover:to-zinc-800 shadow-md'
            }`}
          >
            <Volume2 className="w-4 h-4" />
            <span className="text-[10px] font-bold">Audio</span>
          </button>

          <button
            onClick={onAddSubtitle}
            className="flex-1 min-w-[56px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 bg-gradient-to-b from-zinc-800/90 via-zinc-900/90 to-[#141418] border border-zinc-600/70 text-slate-200 hover:text-white hover:border-slate-300 hover:from-zinc-700 hover:to-zinc-800 shadow-md active:scale-95"
          >
            <Plus className="w-4 h-4 text-slate-200" />
            <span className="text-[10px] font-bold whitespace-nowrap">Thêm phụ đề</span>
          </button>

          {/* CHÈN LOGO BUTTON */}
          <button
            type="button"
            onClick={() => {
              const fileInput = document.getElementById('direct-logo-toolbar-input');
              if (fileInput) (fileInput as HTMLInputElement).click();
            }}
            className={`flex-1 min-w-[56px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 active:scale-95 ${
              activeTab === 'overlays' && filtersSubTab === 'logo'
                ? 'bg-gradient-to-b from-slate-100 via-slate-300 to-zinc-400 text-slate-950 font-extrabold border border-white shadow-[0_0_12px_rgba(255,255,255,0.35)] scale-[1.02]'
                : 'bg-gradient-to-b from-zinc-800/90 via-zinc-900/90 to-[#141418] border border-zinc-600/70 text-slate-200 hover:text-white hover:border-slate-300 hover:from-zinc-700 hover:to-zinc-800 shadow-md'
            }`}
            title="Chèn logo hình ảnh đè lên video"
          >
            <Image className="w-4 h-4" />
            <span className="text-[10px] font-bold whitespace-nowrap">Chèn logo</span>
          </button>
          <input
            id="direct-logo-toolbar-input"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                handleAddLogoOverlay(file);
                onSelectTab('overlays');
                setFiltersSubTab('logo');
              }
              e.target.value = '';
            }}
          />

          {/* CHÈN CHỮ BUTTON */}
          <button
            type="button"
            onClick={() => {
              handleAddTextOverlay();
              onSelectTab('overlays');
              setFiltersSubTab('text_overlay');
            }}
            className={`flex-1 min-w-[56px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 active:scale-95 ${
              activeTab === 'overlays' && filtersSubTab === 'text_overlay'
                ? 'bg-gradient-to-b from-slate-100 via-slate-300 to-zinc-400 text-slate-950 font-extrabold border border-white shadow-[0_0_12px_rgba(255,255,255,0.35)] scale-[1.02]'
                : 'bg-gradient-to-b from-zinc-800/90 via-zinc-900/90 to-[#141418] border border-zinc-600/70 text-slate-200 hover:text-white hover:border-slate-300 hover:from-zinc-700 hover:to-zinc-800 shadow-md'
            }`}
            title="Chèn thêm văn bản, chữ trang trí đè lên video"
          >
            <Type className="w-4 h-4" />
            <span className="text-[10px] font-bold whitespace-nowrap">Chèn chữ</span>
          </button>

          {/* TÁCH DÒNG BUTTON */}
          <button
            type="button"
            onClick={handleSplitMultilineSubtitles}
            className="flex-1 min-w-[56px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 bg-gradient-to-b from-zinc-800/90 via-zinc-900/90 to-[#141418] border border-zinc-600/70 text-slate-200 hover:text-white hover:border-slate-300 hover:from-zinc-700 hover:to-zinc-800 shadow-md active:scale-95"
            title="Tự động tách các phụ đề nhiều dòng thành các phụ đề đơn"
          >
            <Scissors className="w-4 h-4" />
            <span className="text-[10px] font-bold whitespace-nowrap">Tách dòng</span>
          </button>

          <button
            onClick={() => onSelectTab(activeTab === 'filters' ? null : 'filters')}
            className={`flex-1 min-w-[56px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 active:scale-95 ${
              activeTab === 'filters'
                ? 'bg-gradient-to-b from-slate-100 via-slate-300 to-zinc-400 text-slate-950 font-extrabold border border-white shadow-[0_0_12px_rgba(255,255,255,0.35)] scale-[1.02]'
                : 'bg-gradient-to-b from-zinc-800/90 via-zinc-900/90 to-[#141418] border border-zinc-600/70 text-slate-200 hover:text-white hover:border-slate-300 hover:from-zinc-700 hover:to-zinc-800 shadow-md'
            }`}
            title="Lọc từ khóa / Watermark rác"
          >
            <Filter className="w-4 h-4" />
            <span className="text-[10px] font-bold whitespace-nowrap">Lọc rác</span>
          </button>

          <button
            onClick={() => onSelectTab(activeTab === 'find_replace' ? null : 'find_replace')}
            className={`flex-1 min-w-[56px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 active:scale-95 ${
              activeTab === 'find_replace'
                ? 'bg-gradient-to-b from-slate-100 via-slate-300 to-zinc-400 text-slate-950 font-extrabold border border-white shadow-[0_0_12px_rgba(255,255,255,0.35)] scale-[1.02]'
                : 'bg-gradient-to-b from-zinc-800/90 via-zinc-900/90 to-[#141418] border border-zinc-600/70 text-slate-200 hover:text-white hover:border-slate-300 hover:from-zinc-700 hover:to-zinc-800 shadow-md'
            }`}
            title="Tìm kiếm và thay thế phụ đề"
          >
            <Search className="w-4 h-4" />
            <span className="text-[10px] font-bold whitespace-nowrap">Tìm & Thay</span>
          </button>

          <button
            onClick={() => {
              onSelectTab(activeTab === 'overlays' ? null : 'overlays');
              setFiltersSubTab('blur');
            }}
            className={`flex-1 min-w-[56px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all h-[42px] min-h-[42px] max-h-[42px] flex-shrink-0 active:scale-95 ${
              activeTab === 'overlays' && filtersSubTab === 'blur'
                ? 'bg-gradient-to-b from-slate-100 via-slate-300 to-zinc-400 text-slate-950 font-extrabold border border-white shadow-[0_0_12px_rgba(255,255,255,0.35)] scale-[1.02]'
                : 'bg-gradient-to-b from-zinc-800/90 via-zinc-900/90 to-[#141418] border border-zinc-600/70 text-slate-200 hover:text-white hover:border-slate-300 hover:from-zinc-700 hover:to-zinc-800 shadow-md'
            }`}
            title="Làm mờ video, chèn logo hình ảnh, chèn chữ"
          >
            <Layers className="w-4 h-4" />
            <span className="text-[10px] font-bold whitespace-nowrap">Chèn/Mờ</span>
          </button>
        </div>
      )}
    </div>
  );
};
