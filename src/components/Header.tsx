import React from 'react';
import { Star, Video, Sparkles, Languages, Cpu, Download, Film, HelpCircle } from 'lucide-react';
import { GeminiModelOption } from '../types';
import { SUPPORTED_LANGUAGES } from '../data/sampleVideos';

interface HeaderProps {
  selectedModel: GeminiModelOption;
  onSelectModel: (model: GeminiModelOption) => void;
  targetLang: string;
  onSelectTargetLang: (langCode: string) => void;
  onOpenSamples: () => void;
  onOpenExport: () => void;
  onOpenHelp: () => void;
  subtitleCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  selectedModel,
  onSelectModel,
  targetLang,
  onSelectTargetLang,
  onOpenSamples,
  onOpenExport,
  onOpenHelp,
  subtitleCount,
}) => {
  return (
    <header className="bg-metallic-panel border-b border-slate-700/60 text-slate-100 sticky top-0 z-40 shadow-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
        {/* Logo & Title */}
        <div className="flex items-center space-x-3">
          <div className="bg-gradient-to-tr from-slate-600 via-slate-300 to-slate-100 p-2.5 rounded-xl shadow-lg shadow-slate-300/20 text-slate-900 flex items-center justify-center border border-white/40">
            <Star className="w-6 h-6 fill-slate-900 text-slate-800 drop-shadow-[0_0_10px_rgba(255,255,255,0.9)]" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-black tracking-wider text-metallic-silver drop-shadow-sm font-sans">
                BachTranslate
              </h1>
              <span className="bg-slate-800/90 text-slate-300 border border-slate-600/70 text-[11px] font-bold px-2 py-0.5 rounded-full shadow-inner">
                OCR & Synced Subtitles
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Dịch thuật video tự động, bóc tách OCR theo vùng chọn & đồng bộ phụ đề
            </p>
          </div>
        </div>

        {/* Configuration Controls */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Model Selector - Default: 3.6 flash */}
          <div className="flex items-center bg-slate-900/80 border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 shadow-inner">
            <Cpu className="w-3.5 h-3.5 text-amber-300 mr-2 flex-shrink-0" />
            <span className="text-slate-400 mr-1.5 font-medium hidden md:inline">Model:</span>
            <select
              value={selectedModel}
              onChange={(e) => onSelectModel(e.target.value as GeminiModelOption)}
              className="bg-transparent text-slate-100 font-medium focus:outline-none cursor-pointer text-xs"
            >
              <option value="gemini-3.6-flash" className="bg-slate-900 text-slate-100">
                Gemini 3.6 Flash (Mặc định - Nhanh)
              </option>
              <option value="gemini-3.1-pro-preview" className="bg-slate-900 text-slate-100">
                Gemini 3.1 Pro (Chính xác cao)
              </option>
              <option value="gemini-3.1-flash-lite" className="bg-slate-900 text-slate-100">
                Gemini 3.1 Flash Lite (Tiết kiệm)
              </option>
            </select>
          </div>

          {/* Target Language */}
          <div className="flex items-center bg-slate-900/80 border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 shadow-inner">
            <Languages className="w-3.5 h-3.5 text-slate-300 mr-2 flex-shrink-0" />
            <span className="text-slate-400 mr-1.5 font-medium hidden md:inline">Dịch sang:</span>
            <select
              value={targetLang}
              onChange={(e) => onSelectTargetLang(e.target.value)}
              className="bg-transparent text-slate-100 font-medium focus:outline-none cursor-pointer text-xs"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.name} className="bg-slate-900 text-slate-100">
                  {lang.flag} {lang.name}
                </option>
              ))}
            </select>
          </div>

          {/* Sample Videos Button */}
          <button
            onClick={onOpenSamples}
            className="flex items-center space-x-1.5 btn-metallic-dark text-xs font-semibold px-3 py-1.5 rounded-xl transition"
            title="Chọn video mẫu để thử nghiệm ngay"
          >
            <Film className="w-3.5 h-3.5 text-slate-300" />
            <span className="hidden sm:inline">Video Mẫu</span>
          </button>

          {/* Export Button */}
          <button
            onClick={onOpenExport}
            disabled={subtitleCount === 0}
            className={`flex items-center space-x-1.5 text-xs font-bold px-3.5 py-1.5 rounded-xl transition shadow-md ${
              subtitleCount > 0
                ? 'btn-metallic'
                : 'bg-slate-900 text-slate-500 border border-slate-800 cursor-not-allowed'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Xuất Phụ Đề ({subtitleCount})</span>
          </button>

          {/* Help Button */}
          <button
            onClick={onOpenHelp}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 rounded-xl transition border border-transparent hover:border-slate-700"
            title="Hướng dẫn sử dụng"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
