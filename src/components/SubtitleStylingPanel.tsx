import React, { useState, useEffect } from 'react';
import {
  Palette,
  Eye,
  Type,
  MoveHorizontal,
  MoveVertical,
  Bold,
  Italic,
  RotateCcw,
  Check,
  Plus,
  X,
  Upload,
} from 'lucide-react';
import { SubtitleStyleConfig } from '../types';
import { buildTextShadowStyle, getSubtitleCssStyle } from '../utils/textEffectUtils';
import { OutlinedSubtitleText } from './OutlinedSubtitleText';

interface SubtitleStylingPanelProps {
  styleConfig: SubtitleStyleConfig;
  onChangeStyle: (newStyle: SubtitleStyleConfig) => void;
  onClose?: () => void;
}

interface FontOption {
  label: string;
  value: string;
  fontWeight?: string;
  fontStyle?: string;
}

const PRESET_COLORS = [
  { name: 'Trắng', hex: '#ffffff' },
  { name: 'Đen', hex: '#000000' },
  { name: 'Vàng', hex: '#facc15' },
  { name: 'Vàng nhạt', hex: '#fef08a' },
  { name: 'Vàng ròng', hex: '#eab308' },
  { name: 'Cam', hex: '#f97316' },
  { name: 'Cam nhạt', hex: '#ffb74d' },
  { name: 'Đỏ', hex: '#ef4444' },
  { name: 'Hồng đậm', hex: '#f43f5e' },
  { name: 'Hồng nhạt', hex: '#fbcfe8' },
  { name: 'Xanh dương', hex: '#38bdf8' },
  { name: 'Xanh cyan', hex: '#06b6d4' },
  { name: 'Lục bảo', hex: '#10b981' },
  { name: 'Tím', hex: '#a855f7' },
];

const INITIAL_FONTS: FontOption[] = [
  { label: 'Mặc định', value: 'system-ui, sans-serif' },
  { label: 'Barlow Condensed', value: "'Barlow Condensed', sans-serif", fontWeight: '700' },
  { label: 'Charm Bold', value: "'Charm', serif", fontWeight: '700' },
  { label: 'Charm Regular', value: "'Charm', serif", fontWeight: '400' },
  { label: 'Cherry Bomb One', value: "'Cherry Bomb One', cursive" },
  { label: 'Comforter Brush', value: "'Comforter Brush', cursive" },
  { label: 'Fira Sans Bold', value: "'Fira Sans', sans-serif", fontWeight: '700' },
  { label: 'Fira Sans Italic', value: "'Fira Sans', sans-serif", fontStyle: 'italic' },
  { label: 'Fira Sans Regular', value: "'Fira Sans', sans-serif", fontWeight: '400' },
  { label: 'IBM Plex Sans', value: "'IBM Plex Sans', sans-serif" },
  { label: 'Plus Jakarta Sans', value: "'Plus Jakarta Sans', sans-serif" },
  { label: 'Playfair Display', value: "'Playfair Display', serif" },
];

export const SubtitleStylingPanel: React.FC<SubtitleStylingPanelProps> = ({
  styleConfig,
  onChangeStyle,
  onClose,
}) => {
  // Main tabs: 'font' | 'style' | 'format' | 'preview'
  const [activeTab, setActiveTab] = useState<'font' | 'style' | 'format' | 'preview'>('font');
  
  // Style sub-tabs: 'text' | 'border' | 'secondaryBorder' | 'bg'
  const [styleSubTab, setStyleSubTab] = useState<'text' | 'border' | 'secondaryBorder' | 'bg'>('text');

  // Preview helper state
  const [previewText, setPreviewText] = useState<string>('Xin chào! Đây là mẫu phụ đề xem trước.');
  const [previewBgMode, setPreviewBgMode] = useState<'dark' | 'bright' | 'video'>('dark');

  // Dynamic loaded custom fonts
  const [customFonts, setCustomFonts] = useState<FontOption[]>([]);
  const [isAddingFont, setIsAddingFont] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Helper to wrap style changes and inject customUploadedFonts
  const handleStyleChange = (newStyle: SubtitleStyleConfig) => {
    const customUploadedFonts = customFonts
      .filter((f) => (f as any).dataUrl)
      .map((f) => {
        const familyName = f.value.split(',')[0].replace(/['"]/g, '');
        return { family: familyName, dataUrl: (f as any).dataUrl };
      });
    onChangeStyle({
      ...newStyle,
      customUploadedFonts: customUploadedFonts.length > 0 ? customUploadedFonts : undefined,
    });
  };

  // Load custom fonts from localStorage on mount and register Google Web Fonts
  useEffect(() => {
    // 1. Google Fonts
    const linkId = 'capcut-custom-fonts-bundle';
    if (!document.getElementById(linkId)) {
      const link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700&family=Charm:wght@400;700&family=Cherry+Bomb+One&family=Comforter+Brush&family=Fira+Sans:ital,wght@0,400;0,700;1,400&family=IBM+Plex+Sans:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap';
      document.head.appendChild(link);
    }

    // 2. Local Custom Fonts
    try {
      const saved = localStorage.getItem('capcut_custom_uploaded_fonts');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setCustomFonts(parsed);
          parsed.forEach(async (font: any) => {
            if (font.dataUrl) {
              try {
                const fontName = font.value.split(',')[0].replace(/['"]/g, '');
                const fontFace = new FontFace(fontName, `url(${font.dataUrl})`);
                const loaded = await fontFace.load();
                document.fonts.add(loaded);
              } catch (err) {
                console.warn('[FontLoader] Failed to load saved custom font:', font.label, err);
              }
            }
          });
        }
      }
    } catch (err) {
      console.warn('Failed to load saved custom fonts from localStorage:', err);
    }
  }, []);

  // Helper to handle custom local font file upload
  const handleFontFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (< 1.5MB) to avoid localStorage quota limits
    const maxSizeBytes = 1.5 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      setErrorMsg('Tệp phông chữ quá lớn. Vui lòng chọn tệp dưới 1.5MB (định dạng .woff2 thường rất nhẹ).');
      return;
    }

    const fileExt = file.name.split('.').pop()?.toLowerCase();
    const validExtensions = ['ttf', 'otf', 'woff', 'woff2'];
    if (!fileExt || !validExtensions.includes(fileExt)) {
      setErrorMsg('Định dạng tệp không hợp lệ. Vui lòng chọn tệp phông chữ .ttf, .otf, .woff hoặc .woff2.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) {
        setErrorMsg('Không thể đọc tệp phông chữ.');
        return;
      }

      const rawName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
      const fontName = rawName.replace(/[^a-zA-Z0-9\-_]/g, '_');

      try {
        const fontFace = new FontFace(fontName, `url(${dataUrl})`);
        const loaded = await fontFace.load();
        document.fonts.add(loaded);

        const newOption: FontOption = {
          label: rawName,
          value: `"${fontName}", sans-serif`,
        };

        const updatedCustom = [...customFonts, { ...newOption, dataUrl }];
        setCustomFonts(updatedCustom);

        // Try writing to localStorage
        try {
          localStorage.setItem('capcut_custom_uploaded_fonts', JSON.stringify(updatedCustom));
        } catch (storageErr) {
          console.warn('Could not persist font to localStorage due to quota limit:', storageErr);
        }

        // Apply style change
        const customUploadedFonts = updatedCustom
          .filter((f) => (f as any).dataUrl)
          .map((f) => {
            const familyName = f.value.split(',')[0].replace(/['"]/g, '');
            return { family: familyName, dataUrl: (f as any).dataUrl };
          });

        onChangeStyle({
          ...styleConfig,
          fontFamily: newOption.value,
          customUploadedFonts: customUploadedFonts.length > 0 ? customUploadedFonts : undefined,
        });

        setIsAddingFont(false);
        setErrorMsg('');
      } catch (err: any) {
        setErrorMsg('Lỗi khi nạp phông chữ: ' + (err.message || 'Kiểm tra tệp phông chữ.'));
      }
    };
    reader.readAsDataURL(file);
  };

  // Helper to convert hex to RGBA
  const getRgba = (hexColor: string, opacityPercent: number = 65) => {
    if (!hexColor) return `rgba(0, 0, 0, ${opacityPercent / 100})`;
    if (hexColor.startsWith('rgba')) return hexColor;
    let hex = hexColor.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((x) => x + x).join('');
    const num = parseInt(hex, 16);
    if (isNaN(num)) return `rgba(0, 0, 0, ${opacityPercent / 100})`;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${(opacityPercent / 100).toFixed(2)})`;
  };

  const handleResetToDefault = () => {
    onChangeStyle({
      fontSize: 16,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      bgOpacity: 65,
      borderRadius: 8,
      fontWeight: 'bold',
      fontStyle: 'normal',
      textTransform: 'normal',
      outlineColor: '#000000',
      outlineWidth: 3,
      padding: 6,
      position: 'bottom',
      bottomOffsetPercentage: 10,
      textOutline: true,
      fontFamily: 'system-ui, sans-serif',
      orientation: 'horizontal',
      maxCharsHorizontal: 65,
      maxCharsVertical: 36,
      hasBackground: false,
    });
  };

  const outlineCol = styleConfig.outlineColor || '#000000';
  const outlineWidth = styleConfig.outlineWidth ?? 3;
  const textShadowStyle = buildTextShadowStyle(styleConfig);

  const textCasingCss = styleConfig.textTransform === 'uppercase'
    ? 'uppercase'
    : styleConfig.textTransform === 'lowercase'
    ? 'lowercase'
    : styleConfig.textTransform === 'capitalize'
    ? 'capitalize'
    : 'none';

  return (
    <div className="bg-[#121316] text-slate-200 rounded-2xl p-4 sm:p-5 border border-slate-800/80 shadow-2xl flex flex-col gap-4">
      
      {/* 1. Grab handle bar and Top Tab Header */}
      <div className="flex flex-col gap-2">
        {/* Grab bar */}
        <div className="w-12 h-1 bg-slate-800 rounded-full mx-auto mb-1" />

        {/* Tab Headers and close checkmark */}
        <div className="flex items-center justify-between border-b border-slate-800/50 pb-2 overflow-x-auto scrollbar-none">
          <div className="flex items-center space-x-3.5 sm:space-x-4">
            <button
              onClick={() => setActiveTab('font')}
              className={`relative py-1.5 text-sm transition-all font-semibold whitespace-nowrap ${
                activeTab === 'font' ? 'text-white font-bold' : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              <span>Phông chữ</span>
              {activeTab === 'font' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2196F3] rounded-full" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('style')}
              className={`relative py-1.5 text-sm transition-all font-semibold whitespace-nowrap ${
                activeTab === 'style' ? 'text-white font-bold' : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              <span>Kiểu dáng</span>
              {activeTab === 'style' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2196F3] rounded-full" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('format')}
              className={`relative py-1.5 text-sm transition-all font-semibold whitespace-nowrap ${
                activeTab === 'format' ? 'text-white font-bold' : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              <span>Định dạng</span>
              {activeTab === 'format' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2196F3] rounded-full" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('preview')}
              className={`relative py-1.5 text-sm transition-all font-semibold whitespace-nowrap ${
                activeTab === 'preview' ? 'text-white font-bold' : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              <span>Xem trước</span>
              {activeTab === 'preview' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2196F3] rounded-full" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 3. TAB: PREVIEW (XEM TRƯỚC) */}
      {activeTab === 'preview' && (
        <div className="flex flex-col gap-3">
          {/* Live Preview Monitor */}
          <div
            className={`relative h-28 sm:h-32 rounded-xl border border-slate-800 flex items-center justify-center p-4 overflow-hidden transition-all ${
              previewBgMode === 'bright'
                ? 'bg-gradient-to-br from-slate-200 via-slate-100 to-slate-200'
                : previewBgMode === 'video'
                ? 'bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:16px_16px] bg-[#1e222b]'
                : 'bg-black'
            }`}
          >
            {previewBgMode === 'video' && (
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-black/30 pointer-events-none" />
            )}

            {/* Simulated overlay guides */}
            <div className="absolute top-2 left-2 text-[8px] text-slate-500 font-mono select-none">
              LIVE SUBTITLE PREVIEW MOCK
            </div>

            <div className="relative z-10 text-center max-w-full px-2">
              <OutlinedSubtitleText
                text={previewText || 'Xem trước phụ đề'}
                styleConfig={styleConfig}
              />
            </div>
          </div>

          {/* Edit preview text input and background toggles */}
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
            <input
              type="text"
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              placeholder="Nhập nội dung gõ thử để xem trước..."
              className="flex-1 bg-[#18191c] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#2196F3]"
            />
            
            <div className="flex items-center space-x-1 bg-[#18191c] p-0.5 rounded-lg border border-slate-800 text-[10px] self-end sm:self-auto">
              <button
                onClick={() => setPreviewBgMode('dark')}
                className={`px-2.5 py-1 rounded-md transition ${
                  previewBgMode === 'dark' ? 'bg-[#2196F3] text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                Nền tối
              </button>
              <button
                onClick={() => setPreviewBgMode('bright')}
                className={`px-2.5 py-1 rounded-md transition ${
                  previewBgMode === 'bright' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Nền sáng
              </button>
              <button
                onClick={() => setPreviewBgMode('video')}
                className={`px-2.5 py-1 rounded-md transition ${
                  previewBgMode === 'video' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Video mẫu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. TAB: FORMAT (ĐỊNH DẠNG VĂN BẢN) */}
      {activeTab === 'format' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Bold / Italic formatting */}
            <div className="bg-[#18191c] p-3.5 rounded-xl border border-slate-800/60 flex flex-col gap-2.5">
              <span className="text-xs font-bold text-slate-400">Định dạng kiểu</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    onChangeStyle({
                      ...styleConfig,
                      fontWeight: (styleConfig.fontWeight || 'bold') === 'bold' ? 'normal' : 'bold',
                    })
                  }
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-bold flex items-center justify-center space-x-1.5 transition ${
                    (styleConfig.fontWeight || 'bold') === 'bold'
                      ? 'bg-slate-800 text-[#2196F3] border-[#2196F3]/50 font-black shadow-md'
                      : 'bg-[#121316] text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  <Bold className="w-4 h-4" />
                  <span>In đậm</span>
                </button>

                <button
                  onClick={() =>
                    onChangeStyle({
                      ...styleConfig,
                      fontStyle: styleConfig.fontStyle === 'italic' ? 'normal' : 'italic',
                    })
                  }
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-bold flex items-center justify-center space-x-1.5 transition ${
                    styleConfig.fontStyle === 'italic'
                      ? 'bg-slate-800 text-[#2196F3] border-[#2196F3]/50 font-black shadow-md'
                      : 'bg-[#121316] text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  <Italic className="w-4 h-4" />
                  <span>In nghiêng</span>
                </button>
              </div>
            </div>

            {/* Casing style */}
            <div className="bg-[#18191c] p-3.5 rounded-xl border border-slate-800/60 flex flex-col gap-2.5">
              <span className="text-xs font-bold text-slate-400">Kiểu chữ hoa/thường</span>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { value: 'normal', label: 'Mặc định' },
                  { value: 'uppercase', label: 'IN HOA' },
                  { value: 'lowercase', label: 'in thường' },
                  { value: 'capitalize', label: 'Hoa Đầu' },
                ].map((item) => (
                  <button
                    key={item.value}
                    onClick={() => onChangeStyle({ ...styleConfig, textTransform: item.value as any })}
                    className={`py-1.5 px-2 rounded-lg text-[11px] border text-center transition ${
                      (styleConfig.textTransform || 'normal') === item.value
                        ? 'bg-slate-800 text-[#2196F3] border-[#2196F3]/50 font-bold'
                        : 'bg-[#121316] text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Writing Orientation */}
            <div className="bg-[#18191c] p-3.5 rounded-xl border border-slate-800/60 flex flex-col gap-2.5">
              <span className="text-xs font-bold text-slate-400">Hướng chữ hiển thị</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => onChangeStyle({ ...styleConfig, orientation: 'horizontal' })}
                  className={`py-2 px-3 rounded-lg text-xs font-bold border flex items-center justify-center space-x-1.5 transition ${
                    (styleConfig.orientation || 'horizontal') === 'horizontal'
                      ? 'bg-slate-800 text-[#2196F3] border-[#2196F3]/50 shadow-md'
                      : 'bg-[#121316] text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  <MoveHorizontal className="w-3.5 h-3.5" />
                  <span>Ngang (Horizontal)</span>
                </button>
                <button
                  onClick={() => onChangeStyle({ ...styleConfig, orientation: 'vertical' })}
                  className={`py-2 px-3 rounded-lg text-xs font-bold border flex items-center justify-center space-x-1.5 transition ${
                    styleConfig.orientation === 'vertical'
                      ? 'bg-slate-800 text-[#2196F3] border-[#2196F3]/50 shadow-md'
                      : 'bg-[#121316] text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  <MoveVertical className="w-3.5 h-3.5" />
                  <span>Dọc (Vertical)</span>
                </button>
              </div>
            </div>

            {/* Characters per line constraints */}
            <div className="bg-[#18191c] p-3.5 rounded-xl border border-slate-800/60 flex flex-col gap-2">
              <div className="flex justify-between items-center text-xs font-bold text-slate-400">
                <span>Số ký tự xuống dòng tối đa</span>
                <span className="text-[#2196F3] font-mono font-bold">
                  {styleConfig.orientation === 'vertical'
                    ? `${styleConfig.maxCharsVertical || 36} ký tự`
                    : `${styleConfig.maxCharsHorizontal || 65} ký tự`}
                </span>
              </div>
              <input
                type="range"
                min="10"
                max={styleConfig.orientation === 'vertical' ? "60" : "120"}
                value={
                  styleConfig.orientation === 'vertical'
                    ? (styleConfig.maxCharsVertical || 36)
                    : (styleConfig.maxCharsHorizontal || 65)
                }
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (styleConfig.orientation === 'vertical') {
                    onChangeStyle({ ...styleConfig, maxCharsVertical: val });
                  } else {
                    onChangeStyle({ ...styleConfig, maxCharsHorizontal: val });
                  }
                }}
                className="w-full accent-[#2196F3] cursor-pointer mt-1"
              />
            </div>
          </div>
        </div>
      )}

      {/* 4. TAB: FONT (PHÔNG CHỮ) */}
      {activeTab === 'font' && (
        <div className="flex flex-col gap-3">
          {/* Dynamic font uploader form overlay/inline */}
          {isAddingFont ? (
            <div className="bg-[#18191c] p-3.5 rounded-xl border border-dashed border-[#2196F3]/50 space-y-2 mb-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">Nhập phông chữ từ máy tính (.ttf, .otf, .woff2)</span>
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingFont(false);
                    setErrorMsg('');
                  }}
                  className="p-1 hover:bg-slate-800 rounded-full text-slate-400 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[10px] text-slate-400">Hỗ trợ các định dạng font Việt hóa hoặc font thiết kế riêng. Hãy dùng tệp dưới 1.5MB để đảm bảo hiệu suất tốt nhất.</p>
              <div className="flex items-center justify-center border-2 border-dashed border-slate-800 hover:border-slate-700 bg-black/40 rounded-lg p-4 cursor-pointer relative transition">
                <input
                  type="file"
                  accept=".ttf,.otf,.woff2,.woff"
                  onChange={handleFontFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="text-center flex flex-col items-center gap-1.5 pointer-events-none">
                  <Upload className="w-5 h-5 text-[#2196F3]" />
                  <span className="text-xs text-slate-300 font-medium">Bấm vào đây để chọn tệp font...</span>
                  <span className="text-[9px] text-slate-500">Hỗ trợ .ttf, .otf, .woff2</span>
                </div>
              </div>
              {errorMsg && <p className="text-[10px] text-red-400 font-medium leading-normal">{errorMsg}</p>}
            </div>
          ) : null}

          {/* Grid list of Fonts */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-[190px] overflow-y-auto pr-1">
            {/* Add custom font option */}
            <button
              type="button"
              onClick={() => setIsAddingFont(true)}
              className="h-14 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 hover:bg-slate-900/80 transition flex flex-col items-center justify-center text-xs font-semibold text-[#2196F3] gap-1 group cursor-pointer"
            >
              <Plus className="w-4 h-4 text-[#2196F3] group-hover:scale-110 transition" />
              <span>Thêm font</span>
            </button>

            {/* Standard preloaded fonts & Custom ones */}
            {[...INITIAL_FONTS, ...customFonts].map((font, idx) => {
              const isSelected = styleConfig.fontFamily === font.value &&
                (!font.fontWeight || styleConfig.fontWeight === font.fontWeight) &&
                (!font.fontStyle || styleConfig.fontStyle === font.fontStyle);

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    handleStyleChange({
                      ...styleConfig,
                      fontFamily: font.value,
                      fontWeight: font.fontWeight as any || styleConfig.fontWeight || 'bold',
                      fontStyle: font.fontStyle as any || styleConfig.fontStyle || 'normal',
                    });
                  }}
                  className={`h-14 rounded-xl border px-2 flex items-center justify-center text-center transition-all ${
                    isSelected
                      ? 'border-[#2196F3] bg-[#2196F3]/10 text-[#2196F3] font-bold shadow-lg shadow-blue-500/10'
                      : 'border-slate-800 hover:border-slate-700 bg-[#18191c] text-slate-300 hover:text-white'
                  }`}
                  style={{
                    fontFamily: font.value,
                    fontWeight: font.fontWeight || 'normal',
                    fontStyle: font.fontStyle || 'normal',
                  }}
                >
                  <span className="text-xs truncate max-w-full block select-none">
                    {font.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. TAB: STYLE (KIỂU DÁNG) */}
      {activeTab === 'style' && (
        <div className="flex flex-col gap-4">
          
          {/* Sub Tab Segmented Control */}
          <div className="grid grid-cols-4 gap-1 bg-[#18191c] p-0.5 rounded-xl border border-slate-800/60 max-w-md mx-auto w-full">
            <button
              onClick={() => setStyleSubTab('text')}
              className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                styleSubTab === 'text'
                  ? 'bg-[#2196F3] text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Màu chữ
            </button>
            <button
              onClick={() => setStyleSubTab('border')}
              className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                styleSubTab === 'border'
                  ? 'bg-[#2196F3] text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Viền chính
            </button>
            <button
              onClick={() => setStyleSubTab('secondaryBorder')}
              className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                styleSubTab === 'secondaryBorder'
                  ? 'bg-[#2196F3] text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Viền kép
            </button>
            <button
              onClick={() => setStyleSubTab('bg')}
              className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                styleSubTab === 'bg'
                  ? 'bg-[#2196F3] text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Màu nền
            </button>
          </div>

          {/* Color Circles Preset Selector */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {styleSubTab === 'text'
                  ? 'Mẫu màu chữ'
                  : styleSubTab === 'border'
                  ? 'Mẫu màu viền chính'
                  : styleSubTab === 'secondaryBorder'
                  ? 'Mẫu màu viền kép ngoài'
                  : 'Mẫu màu khối nền'}
              </span>
              
              {/* Optional switch toggle for enabling border/secondary border/background */}
              {styleSubTab === 'border' && (
                <label className="flex items-center space-x-1.5 cursor-pointer text-[11px] font-semibold text-slate-300">
                  <input
                    type="checkbox"
                    checked={styleConfig.textOutline !== false}
                    onChange={(e) => onChangeStyle({ ...styleConfig, textOutline: e.target.checked })}
                    className="accent-[#2196F3] w-3 h-3 rounded"
                  />
                  <span>Bật viền chính</span>
                </label>
              )}
              {styleSubTab === 'secondaryBorder' && (
                <label className="flex items-center space-x-1.5 cursor-pointer text-[11px] font-semibold text-slate-300">
                  <input
                    type="checkbox"
                    checked={
                      styleConfig.hasSecondaryOutline === true ||
                      ((styleConfig.secondaryOutlineWidth ?? 0) > 0 && styleConfig.hasSecondaryOutline !== false)
                    }
                    onChange={(e) =>
                      onChangeStyle({
                        ...styleConfig,
                        hasSecondaryOutline: e.target.checked,
                        secondaryOutlineColor: styleConfig.secondaryOutlineColor || '#000000',
                        secondaryOutlineWidth: styleConfig.secondaryOutlineWidth || 4,
                      })
                    }
                    className="accent-[#2196F3] w-3 h-3 rounded"
                  />
                  <span>Bật viền kép (Double Outline)</span>
                </label>
              )}
              {styleSubTab === 'bg' && (
                <label className="flex items-center space-x-1.5 cursor-pointer text-[11px] font-semibold text-slate-300">
                  <input
                    type="checkbox"
                    checked={styleConfig.hasBackground === true}
                    onChange={(e) => onChangeStyle({ ...styleConfig, hasBackground: e.target.checked })}
                    className="accent-[#2196F3] w-3 h-3 rounded"
                  />
                  <span>Bật khối nền</span>
                </label>
              )}
            </div>

            {/* Horizontal scrollable circles & custom color picker */}
            <div className="flex items-center space-x-2 bg-[#18191c] p-2.5 rounded-xl border border-slate-800/50">
              {/* Preset circles wrapper */}
              <div className="flex-1 flex items-center space-x-2.5 overflow-x-auto pr-1 py-1 scrollbar-none">
                {PRESET_COLORS.map((color) => {
                  let isSelected = false;
                  if (styleSubTab === 'text') {
                    isSelected = (styleConfig.fontColor || '#ffffff').toLowerCase() === color.hex.toLowerCase();
                  } else if (styleSubTab === 'border') {
                    isSelected =
                      (styleConfig.outlineColor || '#000000').toLowerCase() === color.hex.toLowerCase() &&
                      styleConfig.textOutline !== false;
                  } else if (styleSubTab === 'secondaryBorder') {
                    isSelected =
                      (styleConfig.secondaryOutlineColor || '#000000').toLowerCase() === color.hex.toLowerCase() &&
                      (styleConfig.hasSecondaryOutline === true ||
                        ((styleConfig.secondaryOutlineWidth ?? 0) > 0 && styleConfig.hasSecondaryOutline !== false));
                  } else {
                    isSelected =
                      (styleConfig.backgroundColor || '#000000').toLowerCase() === color.hex.toLowerCase() &&
                      styleConfig.hasBackground === true;
                  }

                  return (
                    <button
                      key={color.hex}
                      onClick={() => {
                        if (styleSubTab === 'text') {
                          onChangeStyle({ ...styleConfig, fontColor: color.hex });
                        } else if (styleSubTab === 'border') {
                          onChangeStyle({ ...styleConfig, outlineColor: color.hex, textOutline: true });
                        } else if (styleSubTab === 'secondaryBorder') {
                          onChangeStyle({
                            ...styleConfig,
                            secondaryOutlineColor: color.hex,
                            secondaryOutlineWidth: styleConfig.secondaryOutlineWidth || 4,
                            hasSecondaryOutline: true,
                          });
                        } else {
                          onChangeStyle({ ...styleConfig, backgroundColor: color.hex, hasBackground: true });
                        }
                      }}
                      className="w-7 h-7 rounded-full border border-slate-700 relative flex-shrink-0 transition transform hover:scale-110 flex items-center justify-center cursor-pointer"
                      style={{ backgroundColor: color.hex }}
                      title={color.name}
                    >
                      {isSelected && (
                        <Check
                          className={`w-4 h-4 stroke-[3px] ${
                            color.hex === '#ffffff' || color.hex === '#fef08a' || color.hex === '#facc15'
                              ? 'text-black'
                              : 'text-white'
                          }`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Direct Custom Color Picker input */}
              <div className="flex-shrink-0 pl-1 border-l border-slate-800 flex items-center justify-center">
                <input
                  type="color"
                  value={
                    styleSubTab === 'text'
                      ? styleConfig.fontColor || '#ffffff'
                      : styleSubTab === 'border'
                      ? styleConfig.outlineColor || '#000000'
                      : styleSubTab === 'secondaryBorder'
                      ? styleConfig.secondaryOutlineColor || '#000000'
                      : styleConfig.backgroundColor && styleConfig.backgroundColor.startsWith('#')
                      ? styleConfig.backgroundColor
                      : '#000000'
                  }
                  onChange={(e) => {
                    const customColor = e.target.value;
                    if (styleSubTab === 'text') {
                      onChangeStyle({ ...styleConfig, fontColor: customColor });
                    } else if (styleSubTab === 'border') {
                      onChangeStyle({ ...styleConfig, outlineColor: customColor, textOutline: true });
                    } else if (styleSubTab === 'secondaryBorder') {
                      onChangeStyle({
                        ...styleConfig,
                        secondaryOutlineColor: customColor,
                        secondaryOutlineWidth: styleConfig.secondaryOutlineWidth || 4,
                        hasSecondaryOutline: true,
                      });
                    } else {
                      onChangeStyle({ ...styleConfig, backgroundColor: customColor, hasBackground: true });
                    }
                  }}
                  className="w-7 h-7 rounded-full border-0 bg-transparent cursor-pointer"
                  title="Chọn màu tùy biến khác"
                />
              </div>
            </div>
          </div>

          {/* Sub-tab specific extras: opacity slider & border radius */}
          {styleSubTab === 'bg' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#18191c] p-3 rounded-xl border border-slate-800/40">
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold">
                  <span>ĐỘ TRONG SUỐT KHỐI NỀN</span>
                  <span className="text-[#2196F3] font-mono">{styleConfig.bgOpacity ?? 65}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={styleConfig.bgOpacity ?? 65}
                  onChange={(e) => onChangeStyle({ ...styleConfig, bgOpacity: parseInt(e.target.value, 10), hasBackground: true })}
                  className="w-full accent-[#2196F3] cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold">
                  <span>ĐỘ BO GÓC KHỐI NỀN</span>
                  <span className="text-[#2196F3] font-mono">{styleConfig.borderRadius ?? 8}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="24"
                  value={styleConfig.borderRadius ?? 8}
                  onChange={(e) => onChangeStyle({ ...styleConfig, borderRadius: parseInt(e.target.value, 10), hasBackground: true })}
                  className="w-full accent-[#2196F3] cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* Sub-tab specific extras for primary border: outline width slider */}
          {styleSubTab === 'border' && (
            <div className="bg-[#18191c] p-3 rounded-xl border border-slate-800/40">
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold">
                  <span>ĐỘ TO CỦA VIỀN CHÍNH</span>
                  <span className="text-[#2196F3] font-mono">{styleConfig.outlineWidth ?? 3}px</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="12"
                  step="0.5"
                  value={styleConfig.outlineWidth ?? 3}
                  onChange={(e) => onChangeStyle({ ...styleConfig, outlineWidth: parseFloat(e.target.value), textOutline: true })}
                  className="w-full accent-[#2196F3] cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* Sub-tab specific extras for secondary outline (Viền kép) */}
          {styleSubTab === 'secondaryBorder' && (
            <div className="flex flex-col gap-3 bg-[#18191c] p-3 rounded-xl border border-slate-800/40">
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold">
                  <span>ĐỘ DÀY VIỀN KÉP NGOÀI</span>
                  <span className="text-[#2196F3] font-mono">{styleConfig.secondaryOutlineWidth ?? 4}px</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="16"
                  step="0.5"
                  value={styleConfig.secondaryOutlineWidth ?? 4}
                  onChange={(e) =>
                    onChangeStyle({
                      ...styleConfig,
                      secondaryOutlineWidth: parseFloat(e.target.value),
                      hasSecondaryOutline: true,
                    })
                  }
                  className="w-full accent-[#2196F3] cursor-pointer"
                />
              </div>

              {/* Quick 2-tone outline presets */}
              <div className="space-y-1.5 pt-2 border-t border-slate-800/60">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">
                  Gợi ý phối viền kép CapCut (1-Click)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {[
                    { label: 'Trắng - Đen - Vàng', font: '#ffffff', out1: '#000000', out2: '#facc15' },
                    { label: 'Vàng - Đen - Trắng', font: '#facc15', out1: '#000000', out2: '#ffffff' },
                    { label: 'Trắng - Đen - Đỏ', font: '#ffffff', out1: '#000000', out2: '#ef4444' },
                    { label: 'Xanh - Trắng - Xanh đậm', font: '#38bdf8', out1: '#ffffff', out2: '#0369a1' },
                    { label: 'Vàng - Đỏ - Đen', font: '#facc15', out1: '#ef4444', out2: '#000000' },
                    { label: 'Đỏ - Vàng - Đen', font: '#ef4444', out1: '#facc15', out2: '#000000' },
                  ].map((preset, pIdx) => (
                    <button
                      key={pIdx}
                      type="button"
                      onClick={() =>
                        onChangeStyle({
                          ...styleConfig,
                          fontColor: preset.font,
                          outlineColor: preset.out1,
                          outlineWidth: styleConfig.outlineWidth || 3,
                          textOutline: true,
                          secondaryOutlineColor: preset.out2,
                          secondaryOutlineWidth: styleConfig.secondaryOutlineWidth || 4,
                          hasSecondaryOutline: true,
                        })
                      }
                      className="px-2 py-1.5 rounded-lg border border-slate-800 hover:border-slate-700 bg-[#121316] text-[10px] text-slate-300 hover:text-white flex items-center justify-between transition cursor-pointer"
                    >
                      <span className="truncate pr-1">{preset.label}</span>
                      <div className="flex items-center -space-x-1 shrink-0">
                        <span className="w-2.5 h-2.5 rounded-full border border-slate-900" style={{ backgroundColor: preset.font }} />
                        <span className="w-2.5 h-2.5 rounded-full border border-slate-900" style={{ backgroundColor: preset.out1 }} />
                        <span className="w-2.5 h-2.5 rounded-full border border-slate-900" style={{ backgroundColor: preset.out2 }} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* FontSize range slider (Kích thước chữ) displayed below as requested */}
          <div className="flex flex-col gap-1 px-1">
            <div className="flex justify-between items-center text-xs font-semibold text-slate-300">
              <span>Kích thước chữ</span>
              <span className="text-[#2196F3] font-mono font-bold">
                {((styleConfig.fontSize || 16) / 16).toFixed(1)}x
              </span>
            </div>
            <div className="flex items-center space-x-3 mt-1">
              <input
                type="range"
                min="10"
                max="60"
                value={styleConfig.fontSize || 16}
                onChange={(e) => onChangeStyle({ ...styleConfig, fontSize: parseInt(e.target.value, 10) })}
                className="flex-1 accent-[#2196F3] cursor-pointer h-1.5 rounded-lg bg-slate-800"
              />
              <span className="text-[10px] text-slate-500 font-mono w-6 text-right select-none">
                {styleConfig.fontSize || 16}px
              </span>
            </div>
          </div>

        </div>
      )}

    </div>
  );
};
