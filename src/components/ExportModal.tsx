import React, { useState, useEffect } from 'react';
import {
  X,
  FileText,
  Upload,
  Film,
  Mic,
  Sparkles,
  Loader2,
  Globe,
  Check,
  BarChart2,
} from 'lucide-react';
import { SubtitleItem, SubtitleStyleConfig, BlurOverlay, LogoOverlay, TextOverlay } from '../types';
import { exportToSRT, parseSRT } from '../utils/srtParser';
import { generateVoiceoverWav } from '../utils/audioExporter';
import { renderVideoWithSubtitles, RenderProgress } from '../utils/videoRenderer';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  subtitles: SubtitleItem[];
  onImportSubtitles: (subtitles: SubtitleItem[]) => void;
  videoUrl?: string;
  videoDuration?: number;
  styleConfig?: SubtitleStyleConfig;
  projectTitle?: string;
  onGenerateAllAudio?: () => Promise<void>;
  isGeneratingAllAudio?: boolean;
  ttsSpeed?: number;
  ttsPitch?: number;
  videoVolume?: number;
  blurOverlays?: BlurOverlay[];
  logoOverlays?: LogoOverlay[];
  textOverlays?: TextOverlay[];
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  subtitles,
  onImportSubtitles,
  videoUrl = '',
  videoDuration = 0,
  styleConfig,
  projectTitle = 'imported_video_1785477450498',
  ttsSpeed = 1.0,
  ttsPitch = 0,
  videoVolume = 1.0,
  blurOverlays = [],
  logoOverlays = [],
  textOverlays = [],
}) => {
  const [exportFileName, setExportFileName] = useState<string>(
    projectTitle ? projectTitle.replace(/\.\w+$/, '') : 'imported_video_1785477450498'
  );

  // Checkbox Selection States
  const [exportMergedVideo, setExportMergedVideo] = useState<boolean>(true);
  const [exportFormat, setExportFormat] = useState<'mp4' | 'mediarecorder' | 'webm'>('mp4');
  const [mergeTtsAudioIntoVideo, setMergeTtsAudioIntoVideo] = useState<boolean>(true);
  const [exportOriginalSrt, setExportOriginalSrt] = useState<boolean>(false);
  const [exportTranslatedSrt, setExportTranslatedSrt] = useState<boolean>(false);
  const [exportVoiceoverAudio, setExportVoiceoverAudio] = useState<boolean>(false);
  const [exportConfidenceLog, setExportConfidenceLog] = useState<boolean>(false);

  // Export Progress & Status
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportStatus, setExportStatus] = useState<string>('');
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState<RenderProgress>({
    percentage: 0,
    currentTime: 0,
    duration: videoDuration || 1,
    status: '',
  });

  useEffect(() => {
    if (projectTitle) {
      setExportFileName(projectTitle.replace(/\.\w+$/, ''));
    }
  }, [projectTitle]);

  if (!isOpen) return null;

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const imported = parseSRT(content);
        if (imported.length > 0) {
          onImportSubtitles(imported);
          onClose();
        } else {
          alert('Cấu trúc file SRT/VTT không hợp lệ.');
        }
      }
    };
    reader.readAsText(file);
  };

  const handleStartExport = async () => {
    if (
      !exportMergedVideo &&
      !exportOriginalSrt &&
      !exportTranslatedSrt &&
      !exportVoiceoverAudio &&
      !exportConfidenceLog
    ) {
      alert('Vui lòng chọn ít nhất 1 thành phần để xuất.');
      return;
    }

    setIsExporting(true);
    setExportSuccessMsg(null);
    const cleanFileName = (exportFileName.trim() || 'imported_video').replace(/\s+/g, '_');

    const formatTimeSeconds = (seconds: number) => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const ms = Math.round((seconds % 1) * 1000);
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    };

    const exportToCSV = (subs: SubtitleItem[]) => {
      const headers = ['STT', 'Bat dau', 'Ket thuc', 'Noi dung goc', 'Noi dung dich', 'Do tin cay OCR', 'Danh gia'];
      const rows = subs.map((sub, idx) => {
        const startStr = formatTimeSeconds(sub.startTime);
        const endStr = formatTimeSeconds(sub.endTime);
        const confVal = sub.confidence !== undefined ? `${Math.round(sub.confidence * 100)}%` : 'N/A';
        let status = 'N/A';
        if (sub.confidence !== undefined) {
          if (sub.confidence < 0.6) {
            status = '⚠️ Can kiem tra (Thap)';
          } else if (sub.confidence >= 0.85) {
            status = '✨ Rat tot';
          } else {
            status = '✅ Tot';
          }
        }
        
        const escapeCSV = (text: string) => `"${(text || '').replace(/"/g, '""')}"`;
        
        return [
          idx + 1,
          startStr,
          endStr,
          escapeCSV(sub.originalText || ''),
          escapeCSV(sub.translatedText || ''),
          confVal,
          status
        ].join(',');
      });
      
      return '\uFEFF' + [headers.join(','), ...rows].join('\n');
    };

    try {
      // 1. Export Merged Video
      if (exportMergedVideo) {
        if (!videoUrl) {
          alert('Chưa nạp video nguồn cho dự án.');
        } else {
          setExportStatus('Đang render video kèm phụ đề...');
          const defaultStyle: SubtitleStyleConfig = styleConfig || {
            fontSize: 20,
            fontColor: '#ffffff',
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            padding: 6,
            position: 'bottom',
            bottomOffsetPercentage: 10,
            textOutline: true,
            outlineColor: '#000000',
          };

          const { blob: renderedBlob, formatUsed } = await renderVideoWithSubtitles(
            videoUrl,
            subtitles,
            defaultStyle,
            (p) => setRenderProgress(p),
            exportFormat,
            {
              blurOverlays,
              logoOverlays,
              textOverlays,
              includeVoiceover: mergeTtsAudioIntoVideo,
              ttsSpeed,
              ttsPitch,
              videoVolume,
            }
          );

          const fileExt = formatUsed === 'mp4' ? 'mp4' : 'webm';
          const url = URL.createObjectURL(renderedBlob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${cleanFileName}_subtitles.${fileExt}`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }
      }

      // 2. Export Original Subtitles (.srt)
      if (exportOriginalSrt) {
        setExportStatus('Đang xuất file phụ đề gốc...');
        const content = exportToSRT(subtitles, 'original');
        downloadFile(content, `${cleanFileName}_goc.srt`, 'text/plain');
      }

      // 3. Export Translated Subtitles (.srt)
      if (exportTranslatedSrt) {
        setExportStatus('Đang xuất file phụ đề đã dịch...');
        const content = exportToSRT(subtitles, 'translated');
        downloadFile(content, `${cleanFileName}_dich.srt`, 'text/plain');
      }

      // 4. Export Voiceover Audio (.wav)
      if (exportVoiceoverAudio) {
        setExportStatus('Đang tổng hợp audio thuyết minh...');
        const { blob } = await generateVoiceoverWav(
          subtitles,
          videoDuration || 0,
          ttsSpeed,
          ttsPitch
        );
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${cleanFileName}_thuyet_minh.wav`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      // 5. Export Confidence Log (.csv)
      if (exportConfidenceLog) {
        setExportStatus('Đang xuất nhật ký độ tin cậy...');
        // 5a. Post-merge Subtitles CSV
        const csvContent = exportToCSV(subtitles);
        downloadFile(csvContent, `${cleanFileName}_nhat_ky_do_tin_cay_gop.csv`, 'text/csv;charset=utf-8;');

        // 5b. Raw Pre-merge frame-by-frame OCR CSV (from localStorage)
        try {
          const rawOcrStr = localStorage.getItem('raw_ocr_results');
          if (rawOcrStr) {
            const rawItems: { text: string; timestamp: number; confidence?: number }[] = JSON.parse(rawOcrStr);
            if (rawItems && rawItems.length > 0) {
              const rawHeaders = ['STT', 'Moc thoi gian (s)', 'Moc thoi gian (hh:mm:ss.ms)', 'Noi dung boc tach (Raw)', 'Do tin cay OCR', 'Danh gia'];
              const rawRows = rawItems.map((item, idx) => {
                const timeStr = formatTimeSeconds(item.timestamp);
                const confVal = item.confidence !== undefined ? `${Math.round(item.confidence * 100)}%` : 'N/A';
                let status = 'N/A';
                if (item.confidence !== undefined) {
                  if (item.confidence < 0.6) {
                    status = '⚠️ Can kiem tra (Thap)';
                  } else if (item.confidence >= 0.85) {
                    status = '✨ Rat tot';
                  } else {
                    status = '✅ Tot';
                  }
                }
                const escapeCSV = (text: string) => `"${(text || '').replace(/"/g, '""')}"`;
                return [
                  idx + 1,
                  item.timestamp.toFixed(2),
                  timeStr,
                  escapeCSV(item.text),
                  confVal,
                  status
                ].join(',');
              });
              const rawCsvContent = '\uFEFF' + [rawHeaders.join(','), ...rawRows].join('\n');
              downloadFile(rawCsvContent, `${cleanFileName}_nhat_ky_do_tin_cay_chi_tiet_khung_hinh.csv`, 'text/csv;charset=utf-8;');
            }
          }
        } catch (rawErr) {
          console.warn('Could not parse raw_ocr_results:', rawErr);
        }
      }

      setExportSuccessMsg('Hoàn tất xuất dữ liệu thành công!');
      setTimeout(() => setExportSuccessMsg(null), 3000);
    } catch (err: any) {
      console.error('Export error:', err);
      alert(`Lỗi xuất dữ liệu: ${err?.message || 'Không thể xuất dữ liệu'}`);
    } finally {
      setIsExporting(false);
      setRenderProgress({ percentage: 0, currentTime: 0, duration: 1, status: '' });
      setExportStatus('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      <div className="bg-[#121215] border-metallic rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-700/60 flex items-center justify-between bg-metallic-panel">
          <h3 className="text-sm font-black text-metallic-silver uppercase tracking-wider">
            TÙY CHỌN XUẤT DỰ ÁN
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-full bg-slate-800/80 hover:bg-slate-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Main Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4 bg-[#121215]">
          
          {/* 1. Tên tệp xuất */}
          <div className="relative bg-metallic-card border-metallic rounded-2xl p-3.5 shadow-md space-y-1">
            <label className="text-[11px] font-bold text-slate-400 block uppercase tracking-wider">
              Tên tệp xuất
            </label>
            <input
              type="text"
              value={exportFileName}
              onChange={(e) => setExportFileName(e.target.value)}
              placeholder="imported_video_..."
              className="w-full bg-slate-950/80 border-metallic rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-slate-300 transition shadow-inner"
            />
          </div>

          {/* 2. Xuất video đã merge Checkbox Block */}
          <div
            className={`p-4 rounded-2xl border transition shadow-md space-y-3 ${
              exportMergedVideo
                ? 'bg-metallic-panel border-metallic ring-1 ring-slate-300/30'
                : 'bg-metallic-card/50 border-slate-700/60 hover:border-slate-500'
            }`}
          >
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={exportMergedVideo}
                onChange={(e) => setExportMergedVideo(e.target.checked)}
                className="w-5 h-5 accent-slate-200 rounded cursor-pointer"
              />
              <div className="flex items-center space-x-2">
                <Film className="w-4 h-4 text-sky-400" />
                <span className="text-xs font-bold text-slate-100">Xuất video đã merge phụ đề</span>
              </div>
            </label>

            {exportMergedVideo && (
              <div className="space-y-2.5 pt-1 pl-8">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setExportFormat('mp4')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      exportFormat === 'mp4'
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-400/50 shadow-sm'
                        : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-slate-700/50'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                    <span>MP4 (Mediabunny Worker)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportFormat('mediarecorder')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      exportFormat === 'mediarecorder'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-400/50 shadow-sm'
                        : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-slate-700/50'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                    <span>MediaRecorder (Ghi Canvas)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportFormat('webm')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      exportFormat === 'webm'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/50 shadow-sm'
                        : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-slate-700/50'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    <span>WebM (Định dạng WebM)</span>
                  </button>
                </div>

                <label className="flex items-center space-x-2.5 cursor-pointer pt-1 hover:text-slate-100 transition group">
                  <input
                    type="checkbox"
                    checked={mergeTtsAudioIntoVideo}
                    onChange={(e) => setMergeTtsAudioIntoVideo(e.target.checked)}
                    className="w-4 h-4 accent-sky-400 rounded cursor-pointer"
                  />
                  <span className="text-[11px] font-bold text-slate-300 group-hover:text-slate-100 transition">
                    Ghép cả giọng đọc thuyết minh TTS vào video xuất
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* 3. Xuất các thành phần riêng lẻ Section */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold text-metallic-silver uppercase tracking-wider px-1">
              Xuất các thành phần riêng lẻ
            </div>

            <div className="bg-metallic-card border-metallic rounded-2xl p-2 space-y-1 shadow-md">
              {/* Option A: Phụ đề gốc (.srt) */}
              <label className="flex items-center space-x-3 p-3 rounded-xl hover:bg-slate-800/50 cursor-pointer transition">
                <input
                  type="checkbox"
                  checked={exportOriginalSrt}
                  onChange={(e) => setExportOriginalSrt(e.target.checked)}
                  className="w-4 h-4 accent-slate-200 rounded cursor-pointer"
                />
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-slate-200">Phụ đề gốc (.srt)</span>
                </div>
              </label>

              {/* Option B: Phụ đề đã dịch (.srt) */}
              <label className="flex items-center space-x-3 p-3 rounded-xl hover:bg-slate-800/50 cursor-pointer transition">
                <input
                  type="checkbox"
                  checked={exportTranslatedSrt}
                  onChange={(e) => setExportTranslatedSrt(e.target.checked)}
                  className="w-4 h-4 accent-slate-200 rounded cursor-pointer"
                />
                <div className="flex items-center space-x-2">
                  <Globe className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-slate-200">Phụ đề đã dịch (.srt)</span>
                </div>
              </label>

              {/* Option C: Audio thuyết minh (.wav) */}
              <label className="flex items-center space-x-3 p-3 rounded-xl hover:bg-slate-800/50 cursor-pointer transition">
                <input
                  type="checkbox"
                  checked={exportVoiceoverAudio}
                  onChange={(e) => setExportVoiceoverAudio(e.target.checked)}
                  className="w-4 h-4 accent-slate-200 rounded cursor-pointer"
                />
                <div className="flex items-center space-x-2">
                  <Mic className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold text-slate-200">Audio thuyết minh (.wav)</span>
                </div>
              </label>

              {/* Option D: Nhật ký độ tin cậy (.csv) */}
              <label className="flex items-center space-x-3 p-3 rounded-xl hover:bg-slate-800/50 cursor-pointer transition">
                <input
                  type="checkbox"
                  checked={exportConfidenceLog}
                  onChange={(e) => setExportConfidenceLog(e.target.checked)}
                  className="w-4 h-4 accent-slate-200 rounded cursor-pointer"
                />
                <div className="flex items-center space-x-2">
                  <BarChart2 className="w-4 h-4 text-rose-400" />
                  <span className="text-xs font-bold text-slate-200">Nhật ký độ tin cậy (.csv)</span>
                </div>
              </label>
            </div>
          </div>

          {/* Export Progress Bar & Status */}
          {isExporting && (
            <div className="bg-metallic-panel border-metallic rounded-2xl p-3.5 space-y-2 animate-fade-in shadow-lg">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-slate-200 flex items-center space-x-2">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-200" />
                  <span>{exportStatus}</span>
                </span>
                {renderProgress.percentage > 0 && (
                  <span className="text-metallic-silver font-mono">{renderProgress.percentage}%</span>
                )}
              </div>
              {renderProgress.percentage > 0 && (
                <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="bg-gradient-to-r from-slate-400 via-slate-200 to-white h-full transition-all duration-200 rounded-full"
                    style={{ width: `${renderProgress.percentage}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Success Notification */}
          {exportSuccessMsg && (
            <div className="bg-metallic-card border-metallic p-3 rounded-2xl text-xs font-bold text-metallic-silver flex items-center gap-2 shadow-lg animate-bounce">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>{exportSuccessMsg}</span>
            </div>
          )}

          {/* Action Button: BẮT ĐẦU XUẤT */}
          <button
            onClick={handleStartExport}
            disabled={isExporting}
            className="w-full py-3.5 px-4 btn-metallic text-slate-950 font-black text-sm uppercase tracking-wider rounded-2xl transition shadow-xl flex items-center justify-center space-x-2 cursor-pointer active:scale-98 disabled:opacity-50"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                <span>ĐANG XUẤT DỮ LIỆU...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-slate-950 fill-slate-900" />
                <span>BẮT ĐẦU XUẤT</span>
              </>
            )}
          </button>

          {/* Subtle Import SRT link */}
          <div className="pt-1 flex justify-center">
            <label className="text-[11px] font-bold text-slate-400 hover:text-slate-200 cursor-pointer flex items-center space-x-1.5 transition">
              <Upload className="w-3.5 h-3.5" />
              <span>Nhập file SRT từ máy</span>
              <input
                type="file"
                accept=".srt,.vtt,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

        </div>
      </div>
    </div>
  );
};
