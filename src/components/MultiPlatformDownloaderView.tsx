import React, { useState } from 'react';
import {
  ArrowLeft,
  Folder,
  Pencil,
} from 'lucide-react';
import { AppSettings } from '../types';
import { DownloadForm } from './DownloadForm';

interface MultiPlatformDownloaderViewProps {
  onBack: () => void;
  onCreateProject: (videoUrl: string, title?: string, roi?: any, videoFile?: File) => void;
  appSettings: AppSettings;
  onOpenConfig?: () => void;
}

export const MultiPlatformDownloaderView: React.FC<MultiPlatformDownloaderViewProps> = ({
  onBack,
  onCreateProject,
  appSettings,
}) => {
  const [downloadFolder, setDownloadFolder] = useState<string>('Chưa chọn thư mục (Bấm vào đây để chọn)');

  // Choose folder handler
  const handleSelectFolder = async () => {
    try {
      if ('showDirectoryPicker' in window) {
        const dirHandle = await (window as any).showDirectoryPicker();
        if (dirHandle && dirHandle.name) {
          setDownloadFolder(`Thư mục: ${dirHandle.name}`);
        }
      } else {
        const customName = prompt('Nhập tên thư mục muốn lưu trữ:', 'Videos_vTranslate');
        if (customName) {
          setDownloadFolder(`Thư mục: ${customName}`);
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('Directory picker error:', err);
      }
    }
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in text-slate-100 text-xs pb-10">
      
      {/* Top Navigation Header Bar */}
      <div className="flex items-center space-x-3 pb-1 border-b border-slate-800/80">
        <button
          type="button"
          onClick={onBack}
          className="p-2 bg-[#18181c] hover:bg-slate-800 text-slate-200 rounded-full transition border border-slate-800 active:scale-95"
          title="Quay lại Trang Chủ"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-white tracking-wide">
          Tải Video Đa Nền Tảng (GenDownload API)
        </h1>
      </div>

      {/* Standard GenDownload Component */}
      <DownloadForm onSelectVideoForEditor={(url, title) => onCreateProject(url, title)} />

      {/* CARD: THƯ MỤC LƯU TRỮ VIDEO */}
      <div className="bg-metallic-card border-metallic rounded-2xl p-4 shadow-xl space-y-2.5">
        {/* Header Title with Silver Folder Icon */}
        <div className="flex items-center space-x-2">
          <Folder className="w-5 h-5 text-slate-300 fill-slate-300/20" />
          <h2 className="text-sm font-bold text-metallic-silver tracking-wide">
            Thư mục lưu trữ video
          </h2>
        </div>

        {/* Subtitle */}
        <p className="text-xs text-slate-400">
          Vui lòng chọn thư mục để lưu video tải về:
        </p>

        {/* Directory Picker Box with Silver Folder & Pencil Icon */}
        <div
          onClick={handleSelectFolder}
          className="bg-slate-900/80 border border-slate-700/70 rounded-2xl p-3 flex items-center justify-between cursor-pointer hover:border-slate-500 transition"
        >
          <div className="flex items-center space-x-2.5 min-w-0 pr-2">
            <Folder className="w-5 h-5 text-amber-400 fill-amber-400/20 flex-shrink-0" />
            <span className="text-xs font-semibold text-slate-200 truncate">
              {downloadFolder}
            </span>
          </div>
          <Pencil className="w-4 h-4 text-slate-300 flex-shrink-0" />
        </div>
      </div>

      {/* CARD: HƯỚNG DẪN SỬ DỤNG */}
      <div className="bg-metallic-card border-metallic rounded-2xl p-4 shadow-xl space-y-3">
        {/* Amber Header Tag */}
        <div className="text-[11px] font-bold text-metallic-gold uppercase tracking-wider">
          HƯỚNG DẪN SỬ DỤNG
        </div>

        {/* Heading */}
        <h3 className="text-sm font-bold text-white">
          Cách tải video đa nền tảng:
        </h3>

        {/* Numbered Instructions */}
        <ol className="space-y-2.5 text-xs text-slate-300 leading-relaxed">
          <li className="flex items-start space-x-2">
            <span className="font-bold text-sky-400 flex-shrink-0">1.</span>
            <span>
              Mở ứng dụng <strong className="text-slate-100">Douyin, Bilibili, YouTube, Facebook, TikTok, Instagram...</strong> sao chép liên kết (URL) của video bạn muốn tải.
            </span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="font-bold text-sky-400 flex-shrink-0">2.</span>
            <span>
              Dán liên kết vào ô nhập liệu ở trên.
            </span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="font-bold text-sky-400 flex-shrink-0">3.</span>
            <span>
              Nhấn nút <strong className="text-slate-100">Lấy Link</strong> để hệ thống tìm các định dạng file tương thích.
            </span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="font-bold text-sky-400 flex-shrink-0">4.</span>
            <span>
              Chọn định dạng phù hợp (Video có hình, hoặc Audio tách nhạc) và nhấn Tải về hoặc Biên tập.
            </span>
          </li>
        </ol>

        <div className="border-b border-slate-800/80 my-2" />

        {/* Note section */}
        <div className="space-y-1">
          <h4 className="text-xs font-bold text-white">
            Lưu ý về thư mục tải về:
          </h4>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Video/Audio tải về sẽ được lưu tự động vào thư mục đã chọn hoặc bộ nhớ thiết bị của ứng dụng.
          </p>
        </div>
      </div>

    </div>
  );
};
