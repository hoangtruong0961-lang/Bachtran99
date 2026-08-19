import React, { useState } from 'react';
import { fetchDownloadLinks } from '../apiService';
import { GenDownloadResponse, VideoMedia } from '../types';
import { Download, Film, Loader2, Play, AlertCircle, Sparkles, ExternalLink } from 'lucide-react';

interface DownloadFormProps {
  onSelectVideoForEditor?: (videoUrl: string, title?: string) => void;
}

export const DownloadForm: React.FC<DownloadFormProps> = ({ onSelectVideoForEditor }) => {
  const [inputUrl, setInputUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<GenDownloadResponse | null>(null);

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    setLoading(true);
    setResult(null);

    const data = await fetchDownloadLinks(inputUrl.trim());
    setResult(data);
    setLoading(false);
  };

  // Helper to separate video vs audio formats
  const videoMedias = result?.medias?.filter(
    (m) => !m.isAudioOnly && m.extension.toLowerCase() !== 'mp3' && !m.quality.toLowerCase().includes('audio')
  ) || [];

  const audioMedias = result?.medias?.filter(
    (m) => m.isAudioOnly || m.extension.toLowerCase() === 'mp3' || m.quality.toLowerCase().includes('audio')
  ) || [];

  // Fallback if filter leaves empty video list
  const displayVideoMedias = videoMedias.length > 0 ? videoMedias : (result?.medias || []);

  return (
    <div className="max-w-xl mx-auto my-3 p-4 sm:p-5 bg-metallic-card border-metallic rounded-2xl shadow-2xl font-sans text-slate-100">
      {/* Form Input URL */}
      <form onSubmit={handleDownload} className="mb-5 space-y-2.5">
        <label className="text-xs font-bold text-metallic-silver uppercase tracking-wider flex items-center space-x-1.5">
          <Film className="w-4 h-4 text-slate-300" />
          <span>Nhập URL Video (TikTok, YouTube, Facebook...)</span>
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="Dán link video tại đây..."
            className="flex-1 bg-slate-900/90 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-400 transition shadow-inner"
          />
          <button
            type="submit"
            disabled={loading || !inputUrl.trim()}
            className="btn-metallic active:scale-95 disabled:opacity-50 text-slate-950 font-black px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center justify-center space-x-1.5 text-xs flex-shrink-0 shadow-lg"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-900" />
                <span>Đang xử lý...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Lấy Link</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Error Display */}
      {result && !result.success && (
        <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs flex items-center space-x-2 mb-4">
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{result.error || 'Không thể lấy link tải video.'}</span>
        </div>
      )}

      {/* Result UI matching screenshot */}
      {result && result.success && (
        <div className="space-y-4 animate-fade-in">
          {/* Badge: KẾT QUẢ PHÂN TÍCH */}
          <div className="text-[11px] font-bold text-[#0088ff] uppercase tracking-wider">
            KẾT QUẢ PHÂN TÍCH
          </div>

          {/* Media Header Info Card */}
          <div className="bg-[#1a1b20] border border-slate-800 rounded-xl p-3 flex space-x-3 items-center">
            {/* Thumbnail with central play button overlay */}
            <div className="relative w-28 h-20 bg-gradient-to-br from-slate-900 to-indigo-950 rounded-lg overflow-hidden flex-shrink-0 border border-slate-800 flex items-center justify-center">
              {result.thumbnail ? (
                <img
                  src={result.thumbnail}
                  alt="Thumbnail"
                  className="w-full h-full object-cover rounded-lg"
                />
              ) : null}
              <div className="absolute inset-0 bg-black/25 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-[#0088ff] flex items-center justify-center shadow-lg shadow-sky-500/30 text-white">
                  <Play className="w-4 h-4 fill-white translate-x-0.5" />
                </div>
              </div>
            </div>

            {/* Video Details */}
            <div className="flex-1 min-w-0 space-y-1">
              <h3 className="text-xs sm:text-sm font-bold text-white leading-snug line-clamp-2">
                {result.title || 'Video Tải Từ Link'}
              </h3>
              <p className="text-[11px] text-slate-400 line-clamp-1">
                Nguồn: <span className="text-slate-300 font-medium">{result.source || 'ONLINE'}</span>
                {result.author && <span> · {result.author}</span>}
              </p>
              <p className="text-[11px] text-slate-400">
                {result.duration && <span>Thời lượng: {result.duration}</span>}
                {result.views && <span> · {result.views}</span>}
              </p>
            </div>
          </div>

          {/* Section: BẢN VIDEO (Có hình & tiếng) */}
          {displayVideoMedias.length > 0 && (
            <div className="space-y-2 pt-1">
              <h4 className="text-xs font-bold text-slate-200">
                BẢN VIDEO (Có hình & tiếng)
              </h4>
              <div className="space-y-2">
                {displayVideoMedias.map((media, index) => (
                  <div
                    key={index}
                    className="bg-[#18191e] border border-slate-800/90 rounded-xl p-3 flex items-center justify-between hover:border-slate-700 transition"
                  >
                    <div>
                      <div className="text-xs font-bold text-white">
                        {media.quality.includes('p') || media.quality.includes('MP4')
                          ? media.quality
                          : `${media.quality} (${media.extension.toUpperCase()})`}
                      </div>
                      {media.size && (
                        <div className="text-[11px] text-slate-400 mt-0.5">{media.size}</div>
                      )}
                    </div>

                    <div className="flex items-center space-x-2">
                      {onSelectVideoForEditor && (
                        <button
                          type="button"
                          onClick={() => onSelectVideoForEditor(media.url, result.title)}
                          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold transition border border-slate-700"
                        >
                          Biên Tập
                        </button>
                      )}
                      <a
                        href={media.url}
                        target="_blank"
                        rel="noreferrer"
                        download
                        className="bg-[#0088ff] hover:bg-sky-400 text-white font-bold px-3.5 py-1.5 rounded-lg text-xs transition flex items-center space-x-1 shadow-md"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Tải về</span>
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section: BẢN AUDIO (Chỉ âm thanh) */}
          {audioMedias.length > 0 && (
            <div className="space-y-2 pt-2">
              <h4 className="text-xs font-bold text-slate-200">
                BẢN AUDIO (Chỉ âm thanh)
              </h4>
              <div className="space-y-2">
                {audioMedias.map((media, index) => (
                  <div
                    key={index}
                    className="bg-[#18191e] border border-slate-800/90 rounded-xl p-3 flex items-center justify-between hover:border-slate-700 transition"
                  >
                    <div>
                      <div className="text-xs font-bold text-white">
                        {media.quality.toLowerCase().includes('audio') ? media.quality : `Audio (${media.extension.toUpperCase()})`}
                      </div>
                      {media.size && (
                        <div className="text-[11px] text-slate-400 mt-0.5">{media.size}</div>
                      )}
                    </div>

                    <a
                      href={media.url}
                      target="_blank"
                      rel="noreferrer"
                      download
                      className="bg-[#0088ff] hover:bg-sky-400 text-white font-bold px-3.5 py-1.5 rounded-lg text-xs transition flex items-center space-x-1 shadow-md"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Tải về</span>
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer attribution matching screenshot */}
          <div className="text-center pt-3 border-t border-slate-800/60">
            <span className="text-[11px] text-slate-500">
              Dịch vụ được cung cấp bởi{' '}
              <a
                href="https://gendownload.com"
                target="_blank"
                rel="noreferrer"
                className="text-[#0088ff] underline font-medium hover:text-sky-400 transition inline-flex items-center"
              >
                GenDownload
                <ExternalLink className="w-3 h-3 ml-0.5" />
              </a>
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
