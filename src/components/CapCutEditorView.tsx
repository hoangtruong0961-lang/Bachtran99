import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  Download,
  Cpu,
  List,
  Save,
  Check,
  X,
  Plus,
  Upload,
  Film,
  Settings,
  ChevronUp,
  ChevronDown,
  Trash2,
  Loader2,
  DownloadCloud,
  Link as LinkIcon,
  ShieldCheck,
  FileVideo,
  CheckCircle,
  RefreshCw,
  HardDrive,
} from 'lucide-react';
import {
  Project,
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
  VideoClip,
  GlobalMovieContext,
  GlossaryEntity,
} from '../types';
import { SAMPLE_VIDEOS } from '../data/sampleVideos';
import { parseSRT, normalizeSubtitles, resolveOverlapsWithPriority } from '../utils/srtParser';
import { storeMediaFileDB, getMediaFileUrlDB, cacheRemoteVideoToDB, hasMediaFileDB } from '../utils/idbStorage';
import { runClientSideLocalOcrBatch, StreamingOcrPool, hasSubtitleTextCandidate, applyBackgroundFilter } from '../utils/localPaddleOcrEngine';
import { extractFramesWithWebCodecs, extractFramesParallelVideo, isWebCodecsSupported } from '../utils/webcodecsFrameExtractor';
import { VideoPlayer } from './VideoPlayer';
import { CapCutTimeline } from './CapCutTimeline';
import { CapCutBottomBar } from './CapCutBottomBar';
import { SubtitleList } from './SubtitleList';
import { ExportModal } from './ExportModal';
import { HelpModal } from './HelpModal';
import { ConfigView } from './ConfigView';

interface CapCutEditorViewProps {
  project: Project;
  onBackToHome: () => void;
  onSaveProject: (updated: Project) => void;
  selectedModel: GeminiModelOption;
  onSelectModel: (model: GeminiModelOption) => void;
  appSettings: AppSettings;
  onSaveSettings: (newSettings: AppSettings) => void;
  onOpenSettings?: () => void;
}

export const CapCutEditorView: React.FC<CapCutEditorViewProps> = ({
  project,
  onBackToHome,
  onSaveProject,
  selectedModel,
  onSelectModel,
  appSettings,
  onSaveSettings,
  onOpenSettings,
}) => {
  const [projectTitle, setProjectTitle] = useState<string>(project.title);
  const [videoUrl, setVideoUrl] = useState<string>(project.videoUrl);
  const [videoDuration, setVideoDuration] = useState<number>(project.duration || 0);

  const [clips, setClips] = useState<VideoClip[]>(() => {
    if (project.clips && project.clips.length > 0) {
      return project.clips;
    }
    return [
      {
        id: project.id,
        title: project.title,
        url: project.videoUrl,
        duration: project.duration || 0,
      }
    ];
  });
  const [activeClipIndex, setActiveClipIndex] = useState<number>(0);

  const clipStartTimes = React.useMemo(() => {
    const starts: number[] = [];
    let accum = 0;
    for (const c of clips) {
      starts.push(accum);
      accum += c.duration;
    }
    return starts;
  }, [clips]);

  const totalDuration = React.useMemo(() => {
    return clips.reduce((sum, c) => sum + c.duration, 0);
  }, [clips]);

  useEffect(() => {
    if (totalDuration > 0) {
      setVideoDuration(totalDuration);
    }
  }, [totalDuration]);

  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null);

  const handleLoadedMetadata = (d: number) => {
    if (videoRef.current && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
      setVideoDimensions({ width: videoRef.current.videoWidth, height: videoRef.current.videoHeight });
    }
    if (clips && clips.length > 1) {
      setVideoDuration(totalDuration);
    } else {
      setVideoDuration(d);
      setClips(prev => {
        if (prev.length <= 1) {
          return [{ ...prev[0], duration: d }];
        }
        return prev;
      });
    }
  };

  // Detect and track exact intrinsic resolution of the current video
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const checkDim = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
      }
    };
    checkDim();
    video.addEventListener('loadedmetadata', checkDim);
    video.addEventListener('canplay', checkDim);
    return () => {
      video.removeEventListener('loadedmetadata', checkDim);
      video.removeEventListener('canplay', checkDim);
    };
  }, [videoUrl]);

  const getResolutionBadge = () => {
    if (!videoDimensions || !videoDimensions.width || !videoDimensions.height) {
      return videoUrl ? 'HD' : '--';
    }
    const { width, height } = videoDimensions;
    const minDim = Math.min(width, height);
    const maxDim = Math.max(width, height);

    if (minDim >= 2160 || maxDim >= 3840) return '4K';
    if (minDim >= 1440 || maxDim >= 2560) return '2K';
    if (minDim >= 1080 || maxDim >= 1920) return '1080P';
    if (minDim >= 720 || maxDim >= 1280) return '720P';
    if (minDim >= 480 || maxDim >= 854) return '480P';
    if (minDim >= 360) return '360P';
    return `${minDim}P`;
  };

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [showConfigDrawer, setShowConfigDrawer] = useState<boolean>(false);

  // Active Bottom Bar Tab (null by default so timeline & video stay big)
  const [activeTab, setActiveTab] = useState<CapCutTab | null>(null);

  // ROI Box
  const [roi, setRoi] = useState<RegionROI>(project.roi || { x: 10, y: 76, width: 80, height: 20 });

  // Subtitles
  const [subtitles, setSubtitles] = useState<SubtitleItem[]>(project.subtitles || []);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string | null>(null);

  const selectedSubtitle = subtitles.find((s) => s.id === selectedSubtitleId) || null;

  // Overlays (Blur, Logo, Text)
  const [blurOverlays, setBlurOverlays] = useState<BlurOverlay[]>(project.blurOverlays || []);
  const [showBlurVirtualBorder, setShowBlurVirtualBorder] = useState<boolean>(true);
  const [logoOverlays, setLogoOverlays] = useState<LogoOverlay[]>(project.logoOverlays || []);
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>(project.textOverlays || []);

  // History state for Undo/Redo of subtitles
  const [history, setHistory] = useState<SubtitleItem[][]>(() => [project.subtitles || []]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const isHistoryChangeRef = useRef(false);
  const isFirstRenderRef = useRef(true);

  // Sync with project loaded
  useEffect(() => {
    setBlurOverlays(project.blurOverlays || []);
    setLogoOverlays(project.logoOverlays || []);
    setTextOverlays(project.textOverlays || []);
    setVideoVolume(project.videoVolume ?? 1.0);
    setVideoSpeed(project.videoSpeed ?? 1.0);
    setCustomContext(project.customContext || '');
    setHistory([project.subtitles || []]);
    setHistoryIndex(0);
  }, [project.id]);

  // Track subtitles changes to update history
  useEffect(() => {
    if (isHistoryChangeRef.current) {
      isHistoryChangeRef.current = false;
      return;
    }
    const currentHead = history[historyIndex];
    if (currentHead && JSON.stringify(currentHead) === JSON.stringify(subtitles)) {
      return;
    }
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(subtitles);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [subtitles]);

  const handleUndo = () => {
    if (historyIndex > 0) {
      isHistoryChangeRef.current = true;
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      setSubtitles(history[prevIndex]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      isHistoryChangeRef.current = true;
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setSubtitles(history[nextIndex]);
    }
  };

  // Target Language
  const [targetLang, setTargetLang] = useState<string>(project.targetLang || 'Tiếng Việt');

  // Style Config
  const [styleConfig, setStyleConfig] = useState<SubtitleStyleConfig>(() => {
    const base = project.styleConfig || {
      fontSize: 22,
      fontColor: '#121212',
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      bgOpacity: 65,
      padding: 6,
      position: 'bottom',
      bottomOffsetPercentage: 12,
      maskOriginalSubtitles: false,
      maskColor: 'rgba(0,0,0,0.35)',
      textOutline: true,
      outlineColor: '#ffffff',
      outlineWidth: 3,
      hasSecondaryOutline: false,
      secondaryOutlineColor: '#000000',
      secondaryOutlineWidth: 4,
      fontFamily: 'system-ui, sans-serif',
      orientation: 'horizontal',
      maxCharsHorizontal: 65,
      maxCharsVertical: 36,
      hasBackground: false,
    };

    return {
      ...base,
      maskOriginalSubtitles: base.maskOriginalSubtitles === true,
      hasBackground: base.hasBackground === true,
      hasSecondaryOutline: base.hasSecondaryOutline === true || (typeof base.secondaryOutlineWidth === 'number' && base.secondaryOutlineWidth > 0 && base.hasSecondaryOutline !== false),
    };
  });

  // Scan progress
  const [scanProgress, setScanProgress] = useState<OCRScanProgress>({
    status: 'idle',
    currentFrame: 0,
    totalFrames: 0,
    currentTime: 0,
    totalTime: 0,
    message: '',
    percentage: 0,
  });

  const [isExtractingSingle, setIsExtractingSingle] = useState<boolean>(false);
  const [isDetectingRoi, setIsDetectingRoi] = useState<boolean>(false);
  const [isTranslatingBatch, setIsTranslatingBatch] = useState<boolean>(false);
  const [translationProgressMsg, setTranslationProgressMsg] = useState<string>('');

  // Video Block Selection State for context-sensitive bottom bar
  const [isVideoSelected, setIsVideoSelected] = useState<boolean>(false);
  const [bgMusicTitle, setBgMusicTitle] = useState<string | null>(null);
  const [videoVolume, setVideoVolume] = useState<number>(project.videoVolume ?? 1.0);
  const [videoSpeed, setVideoSpeed] = useState<number>(project.videoSpeed ?? 1.0);
  const [customContext, setCustomContext] = useState<string>(project.customContext || '');
  const [globalContext, setGlobalContext] = useState<GlobalMovieContext | null>(project.globalContext || null);

  // Audio / TTS state & refs
  const [isGeneratingAllAudio, setIsGeneratingAllAudio] = useState<boolean>(false);
  const [isGeneratingSingleAudio, setIsGeneratingSingleAudio] = useState<string | null>(null);
  const [audioGenProgress, setAudioGenProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [audioPlayWithVideo, setAudioPlayWithVideo] = useState<boolean>(true);
  const activeAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const lastPlayedSubIdRef = useRef<string | null>(null);
  const ttsPipelineIdRef = useRef<number>(0);
  const sharedAudioCtxRef = useRef<AudioContext | null>(null);
  const audioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const prevTimeRef = useRef<number>(0);

  // Helper to retrieve or initialize single persistent AudioContext
  const getSharedAudioContext = () => {
    if (!sharedAudioCtxRef.current || sharedAudioCtxRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      sharedAudioCtxRef.current = new AudioCtx();
    }
    if (sharedAudioCtxRef.current.state === 'suspended') {
      sharedAudioCtxRef.current.resume().catch(() => {});
    }
    return sharedAudioCtxRef.current;
  };

  // Modals & Video Import
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importTab, setImportTab] = useState<'file' | 'url' | 'gendownload'>('file');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isConcatenating, setIsConcatenating] = useState<boolean>(false);
  const [concatError, setConcatError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<{
    title: string;
    videoUrl: string;
    directUrl?: string;
    platform: string;
    thumbnail?: string;
    author?: string;
  } | null>(null);
  const [customUrl, setCustomUrl] = useState<string>('');
  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Stop active audio play sources (Web Audio & SpeechSynthesis)
  const stopAllAudioPlayback = () => {
    if (activeAudioSourceRef.current) {
      try {
        activeAudioSourceRef.current.stop();
        activeAudioSourceRef.current.disconnect();
      } catch {}
      activeAudioSourceRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    lastPlayedSubIdRef.current = null;
  };

  // Sync state when project prop changes
  useEffect(() => {
    stopAllAudioPlayback();
    setProjectTitle(project.title);
    setVideoUrl(project.videoUrl);
    setVideoDuration(project.duration || 0);
    setSubtitles(project.subtitles || []);
    setSelectedSubtitleId(null);
    setRoi(project.roi || { x: 10, y: 76, width: 80, height: 20 });
    setTargetLang(project.targetLang || 'Tiếng Việt');
    if (project.styleConfig) {
      setStyleConfig(project.styleConfig);
    }
  }, [project.id]);

  // Smooth requestAnimationFrame animation loop to update currentTime at 60fps during playback
  useEffect(() => {
    if (!isPlaying) return;

    let animationFrameId: number;

    const updatePlayhead = () => {
      if (videoRef.current && !videoRef.current.paused) {
        setCurrentTime(videoRef.current.currentTime);
        animationFrameId = requestAnimationFrame(updatePlayhead);
      }
    };

    animationFrameId = requestAnimationFrame(updatePlayhead);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying]);

  const [isLocallyStored, setIsLocallyStored] = useState<boolean>(false);
  const [isCachingVideo, setIsCachingVideo] = useState<boolean>(false);

  // Restore stored video from IndexedDB or cache remote video to prevent expiration (anti-die)
  useEffect(() => {
    let isMounted = true;
    async function checkAndRestoreVideo() {
      // 1. Check if video already exists in IndexedDB
      const restoredUrl = await getMediaFileUrlDB(project.id);
      if (restoredUrl && isMounted) {
        setVideoUrl(restoredUrl);
        setIsLocallyStored(true);
        return;
      }

      // 2. If not in IndexedDB and videoUrl is a remote URL (e.g. TikTok CDN / GenDownload), auto-cache in background
      if (videoUrl && !videoUrl.startsWith('blob:') && !videoUrl.startsWith('data:')) {
        setIsCachingVideo(true);
        cacheRemoteVideoToDB(project.id, videoUrl)
          .then((cachedUrl) => {
            if (cachedUrl && isMounted) {
              console.log('[Editor] Auto-cached remote video to IndexedDB:', cachedUrl);
              setVideoUrl(cachedUrl);
              setIsLocallyStored(true);
            }
          })
          .finally(() => {
            if (isMounted) setIsCachingVideo(false);
          });
      }
    }
    checkAndRestoreVideo();
    return () => {
      isMounted = false;
    };
  }, [project.id]);

  // Synchronize native video element playback speed and volume
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = videoVolume;
    }
  }, [videoVolume, videoUrl]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = videoSpeed;
    }
  }, [videoSpeed, videoUrl, isPlaying]);

  const handleImportVideo = async (
    newUrl: string,
    newTitle?: string,
    newRoi?: RegionROI,
    videoFile?: File,
    preserveExistingSubtitles: boolean = false
  ) => {
    stopAllAudioPlayback();
    let finalUrl = newUrl;
    if (videoFile) {
      const storedUrl = await storeMediaFileDB(project.id, videoFile);
      if (storedUrl) {
        finalUrl = storedUrl;
        setIsLocallyStored(true);
      }
    } else if (finalUrl && !finalUrl.startsWith('blob:') && !finalUrl.startsWith('data:')) {
      setIsCachingVideo(true);
      cacheRemoteVideoToDB(project.id, finalUrl)
        .then((cachedUrl) => {
          if (cachedUrl) {
            setVideoUrl(cachedUrl);
            setIsLocallyStored(true);
          }
        })
        .finally(() => {
          setIsCachingVideo(false);
        });
    }

    setVideoUrl(finalUrl);
    if (newTitle) setProjectTitle(newTitle);
    if (newRoi) setRoi(newRoi);
    setVideoDuration(0);
    setCurrentTime(0);

    // Only clear subtitles if user is explicitly loading a completely new video, not when relinking an expired video
    if (!preserveExistingSubtitles) {
      setSubtitles([]);
      setSelectedSubtitleId(null);
    }
    setShowImportModal(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const videoFiles = (Array.from(files) as File[]).filter(f => f.type.startsWith('video/'));
      if (videoFiles.length > 0) {
        setSelectedFiles((prev) => [...prev, ...videoFiles]);
        setConcatError(null);
      } else {
        setConcatError('Chỉ hỗ trợ kéo thả tệp tin video (MP4, WebM, MOV...)');
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFiles((prev) => [...prev, ...Array.from(files)]);
      setConcatError(null);
    }
  };

  const handleMoveFile = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === selectedFiles.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const updated = [...selectedFiles];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setSelectedFiles(updated);
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleConcatAndImportVideo = async () => {
    if (selectedFiles.length === 0) return;
    if (selectedFiles.length === 1) {
      const file = selectedFiles[0];
      const title = file.name.replace(/\.[^/.]+$/, '');
      const url = URL.createObjectURL(file);
      handleImportVideo(url, title, undefined, file);
      setShowImportModal(false);
      setSelectedFiles([]);
      return;
    }

    setIsConcatenating(true);
    setConcatError(null);

    try {
      const formData = new FormData();
      selectedFiles.forEach((file) => {
        formData.append('videos', file);
      });

      console.log('[CapCutEditorView] Uploading and concatenating', selectedFiles.length, 'videos...');

      const res = await fetch('/api/concat-videos', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const resText = await res.text().catch(() => '');
        let errMsg = 'Lỗi từ máy chủ khi ghép video.';
        try {
          const errJson = JSON.parse(resText);
          errMsg = errJson.message || errJson.error || errMsg;
        } catch (_) {
          if (resText) {
            // strip html tags if any
            errMsg = resText.replace(/<[^>]*>/g, ' ').substring(0, 300).trim() || errMsg;
          }
        }
        throw new Error(errMsg);
      }

      const blob = await res.blob();
      const mergedFile = new File([blob], `merged_${Date.now()}.mp4`, { type: 'video/mp4' });
      const url = URL.createObjectURL(mergedFile);

      const defaultTitle = selectedFiles
        .slice(0, 3)
        .map((f) => f.name.replace(/\.[^/.]+$/, ''))
        .join(' + ') + (selectedFiles.length > 3 ? '...' : '');

      handleImportVideo(url, defaultTitle, undefined, mergedFile);
      setShowImportModal(false);
      setSelectedFiles([]);
    } catch (err: any) {
      console.error('Error merging videos:', err);
      setConcatError(err.message || 'Có lỗi xảy ra trong quá trình tải và ghép video.');
    } finally {
      setIsConcatenating(false);
    }
  };

  const handleExtractVideoWithGenDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrl.trim()) return;

    setIsExtracting(true);
    setExtractError(null);
    setExtractedData(null);

    try {
      const res = await fetch('/api/download-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: customUrl.trim(),
          apiKey: appSettings.genDownloadApiKey,
          apiUrl: appSettings.videoDownloaderApiUrl,
        }),
      });

      const rawText = await res.text().catch(() => '');
      let json: any = null;
      try {
        json = JSON.parse(rawText);
      } catch {
        throw new Error(`Phản hồi máy chủ tải video không hợp lệ: ${rawText.slice(0, 100)}`);
      }
      if (!res.ok || !json || !json.success || !json.data) {
        throw new Error(json?.error || json?.message || 'Không thể bóc tách link video từ đường dẫn đã cung cấp.');
      }

      setExtractedData({
        title: json.data.title || 'Video Tải Từ Link',
        videoUrl: json.data.videoUrl,
        directUrl: json.data.directUrl || json.data.videoUrl,
        platform: json.platform || 'Multi-platform',
        thumbnail: json.data.thumbnail,
        author: json.data.author,
      });
    } catch (err: any) {
      console.error('Error extracting video:', err);
      setExtractError(err.message || 'Lỗi khi kết nối API tải video GenDownload.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleConfirmImportExtracted = () => {
    if (extractedData) {
      handleImportVideo(extractedData.directUrl || extractedData.videoUrl, extractedData.title);
      setShowImportModal(false);
      setExtractedData(null);
      setCustomUrl('');
    }
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customUrl.trim()) {
      handleImportVideo(customUrl.trim(), 'Video URL từ Internet');
      setCustomUrl('');
      setShowImportModal(false);
    }
  };

  const cancelScanRef = useRef<boolean>(false);

  // Active Subtitle item for current video time or selected subtitle
  const activeSubtitle = React.useMemo(() => {
    const matches = subtitles.filter(
      (s) => currentTime >= s.startTime && currentTime <= s.endTime
    );
    if (matches.length > 0) {
      return matches.sort((a, b) => b.startTime - a.startTime)[0];
    }
    // When paused or stopped, if a subtitle is selected or active, allow editing its box
    if (!isPlaying && selectedSubtitleId) {
      return subtitles.find((s) => s.id === selectedSubtitleId) || null;
    }
    return null;
  }, [subtitles, currentTime, isPlaying, selectedSubtitleId]);

  // Auto-save project changes
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }

    const hasChanges =
      projectTitle !== project.title ||
      videoUrl !== project.videoUrl ||
      videoDuration !== (project.duration || 0) ||
      JSON.stringify(subtitles) !== JSON.stringify(project.subtitles || []) ||
      JSON.stringify(roi) !== JSON.stringify(project.roi || { x: 10, y: 76, width: 80, height: 20 }) ||
      targetLang !== (project.targetLang || 'Tiếng Việt') ||
      JSON.stringify(styleConfig) !== JSON.stringify(project.styleConfig) ||
      JSON.stringify(blurOverlays) !== JSON.stringify(project.blurOverlays || []) ||
      JSON.stringify(logoOverlays) !== JSON.stringify(project.logoOverlays || []) ||
      JSON.stringify(textOverlays) !== JSON.stringify(project.textOverlays || []) ||
      videoVolume !== (project.videoVolume ?? 1.0) ||
      videoSpeed !== (project.videoSpeed ?? 1.0) ||
      customContext !== (project.customContext || '') ||
      JSON.stringify(globalContext) !== JSON.stringify(project.globalContext || null) ||
      JSON.stringify(clips) !== JSON.stringify(project.clips || []);

    if (hasChanges) {
      onSaveProject({
        ...project,
        title: projectTitle,
        videoUrl,
        duration: videoDuration,
        subtitles,
        roi,
        targetLang,
        styleConfig,
        blurOverlays,
        logoOverlays,
        textOverlays,
        videoVolume,
        videoSpeed,
        customContext,
        globalContext,
        clips,
        updatedAt: Date.now(),
      });
    }
  }, [
    projectTitle,
    videoUrl,
    videoDuration,
    subtitles,
    roi,
    targetLang,
    styleConfig,
    blurOverlays,
    logoOverlays,
    textOverlays,
    videoVolume,
    videoSpeed,
    customContext,
    globalContext,
    clips,
    project,
    onSaveProject,
  ]);

  const handleManualSave = () => {
    onSaveProject({
      ...project,
      title: projectTitle,
      videoUrl,
      duration: videoDuration,
      subtitles,
      roi,
      targetLang,
      styleConfig,
      blurOverlays,
      logoOverlays,
      textOverlays,
      videoVolume,
      videoSpeed,
      customContext,
      globalContext,
      clips,
      updatedAt: Date.now(),
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  // Helper to map relative 2D box [ymin, xmin, ymax, xmax] from 0-1000 scale to absolute frame percentage
  const calculateAbsoluteBox = (box2d: number[], currentRoi: RegionROI): RegionROI => {
    if (!Array.isArray(box2d) || box2d.length !== 4) return currentRoi;
    const [ymin, xmin, ymax, xmax] = box2d;
    const relY = ymin / 10;
    const relX = xmin / 10;
    const relH = Math.max(3, (ymax - ymin) / 10);
    const relW = Math.max(6, (xmax - xmin) / 10);

    return {
      x: Number(Math.max(0, Math.min(95, currentRoi.x + (relX * currentRoi.width) / 100)).toFixed(2)),
      y: Number(Math.max(0, Math.min(95, currentRoi.y + (relY * currentRoi.height) / 100)).toFixed(2)),
      width: Number(Math.min(100 - currentRoi.x, (relW * currentRoi.width) / 100).toFixed(2)),
      height: Number(Math.min(100 - currentRoi.y, (relH * currentRoi.height) / 100).toFixed(2)),
    };
  };

  // Handler: Auto-detect exact original subtitle position in video frame
  const handleAutoDetectRoi = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

    setIsDetectingRoi(true);
    try {
      const canvas = document.createElement('canvas');
      const vWidth = video.videoWidth;
      const vHeight = video.videoHeight;

      const cropX = (roi.x / 100) * vWidth;
      const cropY = (roi.y / 100) * vHeight;
      const cropW = (roi.width / 100) * vWidth;
      const cropH = (roi.height / 100) * vHeight;

      canvas.width = Math.max(10, Math.round(cropW));
      canvas.height = Math.max(10, Math.round(cropH));

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
      const croppedBase64 = canvas.toDataURL('image/jpeg', 0.92);

      const res = await fetch('/api/ocr-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: croppedBase64,
          timestamp: currentTime,
          targetLang,
          model: selectedModel,
          apiMode: appSettings?.apiMode,
          apiKey: appSettings?.apiKey,
          proxyUrl: appSettings?.proxyUrl,
          proxyKey: appSettings?.proxyKey,
          proxyTargetModel: appSettings?.proxyTargetModel,
          customModelName: appSettings?.customModelName,
          proxyNoApiKey: appSettings?.proxyNoApiKey,
        }),
      });

      const rawText = await res.text().catch(() => '');
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        data = {};
      }
      if (data.success && data.result?.box_2d) {
        const autoBox = calculateAbsoluteBox(data.result.box_2d, roi);
        setRoi(autoBox);

        if (selectedSubtitleId) {
          setSubtitles((prev) =>
            prev.map((s) => (s.id === selectedSubtitleId ? { ...s, boundingBox: autoBox } : s))
          );
        }
      } else {
        alert('Đã khớp vị trí vùng chọn phụ đề.');
      }
    } catch (err) {
      console.error('Auto detect ROI error:', err);
    } finally {
      setIsDetectingRoi(false);
    }
  };

  // Handler: Single frame OCR
  const handleExtractSingleFrame = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

    setIsExtractingSingle(true);
    try {
      const canvas = document.createElement('canvas');
      const vWidth = video.videoWidth;
      const vHeight = video.videoHeight;

      const cropX = (roi.x / 100) * vWidth;
      const cropY = (roi.y / 100) * vHeight;
      const cropW = (roi.width / 100) * vWidth;
      const cropH = (roi.height / 100) * vHeight;

      const targetW = Math.max(800, Math.round(cropW * 1.5));
      const targetH = Math.max(160, Math.round(cropH * 1.5));

      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
      const croppedBase64 = canvas.toDataURL('image/jpeg', 0.92);

      const res = await fetch('/api/ocr-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: croppedBase64,
          timestamp: currentTime,
          targetLang,
          model: selectedModel,
          apiMode: appSettings?.apiMode,
          apiKey: appSettings?.apiKey,
          proxyUrl: appSettings?.proxyUrl,
          proxyKey: appSettings?.proxyKey,
          proxyTargetModel: appSettings?.proxyTargetModel,
          customModelName: appSettings?.customModelName,
          proxyNoApiKey: appSettings?.proxyNoApiKey,
        }),
      });

      const rawText = await res.text().catch(() => '');
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        data = {};
      }
      if (data.success && data.result?.hasText) {
        let subBox: RegionROI | undefined = undefined;
        if (data.result.box_2d) {
          subBox = calculateAbsoluteBox(data.result.box_2d, roi);
        }

        const newSub: SubtitleItem = {
          id: `single-${Date.now()}`,
          startTime: Math.max(0, currentTime - 0.2),
          endTime: currentTime + 2.5,
          originalText: data.result.originalText || '',
          translatedText: '', // Quét OCR ra phụ đề gốc chưa cần dịch ngay
          sourceLang: data.result.sourceLang,
          boundingBox: subBox || roi,
        };

        setSubtitles((prev) => {
          return normalizeSubtitles([...prev, newSub]);
        });
      } else {
        alert('Không tìm thấy phụ đề trong vùng chọn tại khung hình này.');
      }
    } catch (err: any) {
      console.error('OCR extract error:', err);
    } finally {
      setIsExtractingSingle(false);
    }
  };

  // Helper: Extract cropped frame at timestamp with contrast boost for high OCR accuracy
  const extractCroppedFrameAtTime = async (
    targetTime: number,
    roiBox: RegionROI,
    customVideo?: HTMLVideoElement | null
  ): Promise<{ canvas: HTMLCanvasElement; pixelData?: Uint8ClampedArray; width?: number; height?: number } | null> => {
    return new Promise((resolve) => {
      const video = customVideo || videoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) {
        resolve(null);
        return;
      }

      const capture = () => {
        try {
          const canvas = document.createElement('canvas');
          const vWidth = video.videoWidth;
          const vHeight = video.videoHeight;

          const cropX = (roiBox.x / 100) * vWidth;
          const cropY = (roiBox.y / 100) * vHeight;
          const cropW = (roiBox.width / 100) * vWidth;
          const cropH = (roiBox.height / 100) * vHeight;

          // Maintain clean, proportional resolution for OCR tensor input without distorting text aspect ratio
          let scale = 1.0;
          if (cropW > 0 && cropH > 0) {
            if (cropH < 64) {
              scale = 64 / cropH;
            } else if (cropW > 1280) {
              scale = 1280 / cropW;
            }
          }

          const targetW = Math.max(32, Math.round(cropW * scale));
          const targetH = Math.max(32, Math.round(cropH * scale));

          canvas.width = targetW;
          canvas.height = targetH;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.filter = 'none';
          ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);

          // Apply real background filter to eliminate video background interference & enhance text stroke contrast
          if (appSettings?.bgFilterMode && appSettings.bgFilterMode !== 'none' && (appSettings.bgFilterStrength ?? 0) > 0) {
            applyBackgroundFilter(ctx, targetW, targetH, appSettings.bgFilterMode, appSettings.bgFilterStrength ?? 30);
          }

          const imgData = ctx.getImageData(0, 0, targetW, targetH);

          resolve({
            canvas,
            pixelData: imgData.data,
            width: targetW,
            height: targetH,
          });
        } catch (err) {
          console.error('Error capturing frame:', err);
          resolve(null);
        }
      };

      let relativeTime = targetTime;
      let targetClipIndex = activeClipIndex;

      if (clips && clips.length > 1) {
        for (let i = 0; i < clips.length; i++) {
          const start = clipStartTimes[i];
          const end = start + clips[i].duration;
          if (targetTime >= start && targetTime <= end) {
            targetClipIndex = i;
            relativeTime = targetTime - start;
            break;
          }
        }
      }

      const switchSourceAndSeek = async () => {
        if (clips && clips.length > 1 && clips[targetClipIndex]) {
          const expectedSrc = clips[targetClipIndex].url;
          if (!video.src.includes(expectedSrc) && !video.currentSrc.includes(expectedSrc)) {
            return new Promise<void>((resolveSrc) => {
              const onLoaded = () => {
                video.removeEventListener('loadedmetadata', onLoaded);
                resolveSrc();
              };
              video.addEventListener('loadedmetadata', onLoaded);
              video.src = expectedSrc;
              video.load();
            });
          }
        }
      };

      switchSourceAndSeek().then(() => {
        if (Math.abs(video.currentTime - relativeTime) < 0.02) {
          capture();
          return;
        }

        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let seekedFired = false;

        const onSeeked = () => {
          if (seekedFired) return;
          seekedFired = true;
          if (timeoutId) clearTimeout(timeoutId);
          video.removeEventListener('seeked', onSeeked);
          capture();
        };

        timeoutId = setTimeout(() => {
          if (seekedFired) return;
          seekedFired = true;
          video.removeEventListener('seeked', onSeeked);
          capture();
        }, 800);

        video.addEventListener('seeked', onSeeked, { once: true });
        if ('fastSeek' in video && typeof (video as any).fastSeek === 'function') {
          (video as any).fastSeek(relativeTime);
        } else {
          video.currentTime = relativeTime;
        }
      });
    });
  };

  // Full scan handler
  const handleStartFullScan = async (
    startT: number,
    endT: number,
    stepInterval: number,
    customContext: string
  ) => {
    cancelScanRef.current = false;
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    const initialMainVideoTime = video.currentTime;

    const timePoints: number[] = [];
    for (let t = startT; t <= endT; t += stepInterval) {
      timePoints.push(t);
    }

    const totalFrames = timePoints.length;
    setScanProgress({
      status: 'scanning',
      currentFrame: 0,
      totalFrames,
      currentTime: startT,
      totalTime: endT - startT,
      message: '⚡ Đang khởi tạo 8 luồng GPU bóc tách video song song siêu tốc...',
      percentage: 0,
    });

    const frameBatches: { image: string; pixelData?: Uint8ClampedArray; width?: number; height?: number; timestamp: number }[][] = [];
    let currentBatch: { image: string; pixelData?: Uint8ClampedArray; width?: number; height?: number; timestamp: number }[] = [];
    let capturedFramesCount = 0;
    let filteredNoTextCount = 0;
    const detectedTransitions: number[] = [];

    // Dynamic optimal batch size: 6-10 frames per batch for complete temporal video context
    const targetBatchSize = Math.max(5, Math.min(10, Math.round(2.8 / Math.max(0.15, stepInterval))));

    const videoSourceUrl = video.currentSrc || video.src || videoUrl;

    const effectiveBgFilterMode = (appSettings?.bgFilterMode && appSettings.bgFilterMode !== 'none') ? appSettings.bgFilterMode : 'adaptive';
    const effectiveBgFilterStrength = (appSettings?.bgFilterStrength && appSettings.bgFilterStrength > 0) ? appSettings.bgFilterStrength : 65;
    console.log('[OCR-Preprocess] mode=', effectiveBgFilterMode, 'strength=', effectiveBgFilterStrength);

    const isLocalPaddle = appSettings?.ocrEngine === 'paddleocr';

    // Initialize Streaming OCR Worker Pool for local PaddleOCR to process frames concurrently during video extraction
    let streamingOcrPool: StreamingOcrPool | null = null;
    const recentFrameTimes: number[] = [];
    if (isLocalPaddle) {
      streamingOcrPool = new StreamingOcrPool({
        stepInterval,
        transitionTimestamps: detectedTransitions,
        minConfidence: appSettings?.confidenceThreshold ?? 0.70,
        sourceLang: 'zh',
        targetLang,
        onProgress: (msg) => {
          const activeWorkers = streamingOcrPool ? streamingOcrPool.getBusyWorkersCount() : 0;
          const totalWorkers = streamingOcrPool ? streamingOcrPool.getPoolSize() : 0;
          const cpuUsage = totalWorkers > 0 ? Math.round((activeWorkers / totalWorkers) * 100) : 0;

          const nowMs = performance.now();
          const cutoff = nowMs - 2000;
          while (recentFrameTimes.length > 0 && recentFrameTimes[0] < cutoff) {
            recentFrameTimes.shift();
          }
          const windowDurationSec = recentFrameTimes.length > 1
            ? (recentFrameTimes[recentFrameTimes.length - 1] - recentFrameTimes[0]) / 1000
            : 2;
          const currentFps = windowDurationSec > 0.05 ? (recentFrameTimes.length / windowDurationSec) : 0;

          setScanProgress((prev) => ({
            ...prev,
            message: msg,
            fps: Math.round(currentFps * 10) / 10,
            cpuUsage,
            activeWorkers,
            totalWorkers,
          }));
        },
      });
      await streamingOcrPool.init();
    }

    // True WebCodecs VideoDecoder Extractor with Frame-Diffing transition detection
    await extractFramesWithWebCodecs({
      videoUrl: videoSourceUrl,
      crossOrigin: video.crossOrigin,
      startT,
      endT,
      stepInterval,
      roi,
      bgFilterMode: effectiveBgFilterMode,
      bgFilterStrength: effectiveBgFilterStrength,
      adaptiveSampling: appSettings?.adaptiveSampling ?? true,
      shouldCancel: () => cancelScanRef.current,
      isLocalPaddle,
      onProgress: (current, total, msg) => {
        const activeWorkers = streamingOcrPool ? streamingOcrPool.getBusyWorkersCount() : 0;
        const totalWorkers = streamingOcrPool ? streamingOcrPool.getPoolSize() : 0;
        const cpuUsage = totalWorkers > 0 ? Math.round((activeWorkers / totalWorkers) * 100) : 0;

        const nowMs = performance.now();
        const cutoff = nowMs - 2000;
        while (recentFrameTimes.length > 0 && recentFrameTimes[0] < cutoff) {
          recentFrameTimes.shift();
        }
        const windowDurationSec = recentFrameTimes.length > 1
          ? (recentFrameTimes[recentFrameTimes.length - 1] - recentFrameTimes[0]) / 1000
          : 2;
        const currentFps = windowDurationSec > 0.05 ? (recentFrameTimes.length / windowDurationSec) : 0;

        setScanProgress((prev) => ({
          ...prev,
          currentFrame: current,
          totalFrames: Math.max(prev.totalFrames, total, current),
          message: streamingOcrPool && streamingOcrPool.latestProgressMessage
            ? streamingOcrPool.latestProgressMessage
            : msg,
          fps: Math.round(currentFps * 10) / 10,
          cpuUsage,
          activeWorkers,
          totalWorkers,
        }));
      },
      onFrameCaptured: (item) => {
        capturedFramesCount++;
        if (item.isTransitionFrame) {
          detectedTransitions.push(item.timestamp);
        }

        const hasText = item.hasText ?? hasSubtitleTextCandidate(item.pixelData, item.width, item.height);

        if (!hasText) {
          filteredNoTextCount++;
        } else {
          // Optimization: Skip heavy synchronous toDataURL('image/jpeg') Base64 encoding on main UI thread for Local PaddleOCR
          const base64 = isLocalPaddle ? undefined : item.canvas.toDataURL('image/jpeg', 0.88);
          const frameItem = {
            image: base64,
            pixelData: item.pixelData,
            width: item.width,
            height: item.height,
            timestamp: item.timestamp,
          };

          currentBatch.push(frameItem);
          if (currentBatch.length >= targetBatchSize) {
            frameBatches.push([...currentBatch]);
            currentBatch = [];
          }

          if (streamingOcrPool) {
            // Push directly to concurrent ONNX WASM worker pipeline!
            streamingOcrPool.pushFrame(frameItem);
          }
        }

        const scanDuration = Math.max(0.1, endT - startT);
        const timeProgress = Math.min(1.0, Math.max(0.0, (item.timestamp - startT) / scanDuration));
        const scanPercentage = Math.min(60, Math.max(1, Math.round(timeProgress * 60)));

        const nowMs = performance.now();
        recentFrameTimes.push(nowMs);
        const cutoff = nowMs - 2000;
        while (recentFrameTimes.length > 0 && recentFrameTimes[0] < cutoff) {
          recentFrameTimes.shift();
        }
        const windowDurationSec = recentFrameTimes.length > 1
          ? (recentFrameTimes[recentFrameTimes.length - 1] - recentFrameTimes[0]) / 1000
          : 2;
        const currentFps = windowDurationSec > 0.05 ? (recentFrameTimes.length / windowDurationSec) : 0;

        const activeWorkers = streamingOcrPool ? streamingOcrPool.getBusyWorkersCount() : 0;
        const totalWorkers = streamingOcrPool ? streamingOcrPool.getPoolSize() : 0;
        const cpuUsage = totalWorkers > 0 ? Math.round((activeWorkers / totalWorkers) * 100) : 0;

        setScanProgress((prev) => ({
          ...prev,
          currentFrame: capturedFramesCount,
          totalFrames: Math.max(prev.totalFrames, capturedFramesCount),
          currentTime: item.timestamp,
          percentage: scanPercentage,
          fps: Math.round(currentFps * 10) / 10,
          cpuUsage,
          activeWorkers,
          totalWorkers,
          message: streamingOcrPool && streamingOcrPool.latestProgressMessage
            ? streamingOcrPool.latestProgressMessage
            : `⚡ [Song song WebCodecs + 8 Luồng PaddleOCR] (${Math.round(timeProgress * 100)}% | ${item.timestamp.toFixed(1)}s/${endT.toFixed(1)}s)...`,
        }));
      },
    });

    if (currentBatch.length > 0) {
      frameBatches.push([...currentBatch]);
      currentBatch = [];
    }

    // Restore main video player position so user view is not disrupted
    if (video) {
      try {
        video.currentTime = initialMainVideoTime;
      } catch (e) {
        // ignore
      }
    }

    if (cancelScanRef.current) {
      setScanProgress((prev) => ({ ...prev, status: 'idle', message: 'Đã hủy' }));
      return;
    }

    if (capturedFramesCount === 0) {
      setScanProgress({
        status: 'completed',
        currentFrame: totalFrames,
        totalFrames,
        currentTime: endT,
        totalTime: endT - startT,
        message: 'Không thể bóc tách ảnh từ video (do bảo mật CORS của link video ngoài). Vui lòng nạp file video trực tiếp từ máy.',
        percentage: 100,
      });
      return;
    }

    const engineName = isLocalPaddle
      ? 'PP-OCRv6 WebAssembly (ONNX Web)'
      : 'Gemini Cloud AI';

    setScanProgress((prev) => ({
      ...prev,
      status: 'translating',
      percentage: Math.max(prev.percentage, 70),
      message: streamingOcrPool ? prev.message : `Đang hoàn thiện bóc tách chữ bằng ${engineName}...`,
    }));

    const newSubtitles: SubtitleItem[] = [];
    let lastApiError = '';

    if (streamingOcrPool) {
      try {
        const localResults = await streamingOcrPool.finish(detectedTransitions);
        try {
          const rawItems = streamingOcrPool.getRawDetectedItems();
          localStorage.setItem('raw_ocr_results', JSON.stringify(rawItems));
        } catch (e) {
          console.warn('Failed to save raw_ocr_results to localStorage:', e);
        }
        localResults.forEach((res, idx) => {
          if (res.originalText && res.originalText.trim()) {
            newSubtitles.push({
              id: `local-scan-${idx}-${Date.now()}`,
              startTime: res.startTime,
              endTime: res.endTime,
              originalText: res.originalText.trim(),
              translatedText: '',
              sourceLang: res.sourceLang || 'zh',
              boundingBox: roi,
              confidence: res.confidence,
            });
          }
        });
      } catch (err: any) {
        console.warn('Streaming OCR finish error:', err);
      }
    }

    // Fallback: If streaming pool returned 0 items or wasn't initialized, run client-side batch OCR engine!
    if (isLocalPaddle && newSubtitles.length === 0) {
      const allFrames = frameBatches.flat();
      try {
        const localResults = await runClientSideLocalOcrBatch(
          allFrames,
          (msg) => {
            setScanProgress((prev) => ({ ...prev, message: msg }));
          },
          stepInterval,
          detectedTransitions,
          appSettings?.confidenceThreshold ?? 0.70,
          'zh',
          targetLang
        );

        localResults.forEach((res, idx) => {
          if (res.originalText && res.originalText.trim()) {
            newSubtitles.push({
              id: `local-scan-${idx}-${Date.now()}`,
              startTime: res.startTime,
              endTime: res.endTime,
              originalText: res.originalText.trim(),
              translatedText: '',
              sourceLang: res.sourceLang || 'PP-OCRv6 Wasm Local',
              boundingBox: roi,
              confidence: res.confidence,
            });
          }
        });
      } catch (err: any) {
        console.error('Local OCR error:', err);
        lastApiError = 'Lỗi xử lý Local Wasm ONNX Engine.';
      }
    } else if (!isLocalPaddle && newSubtitles.length === 0) {
      for (let b = 0; b < frameBatches.length; b++) {
        if (cancelScanRef.current) break;

        try {
          const res = await fetch('/api/ocr-batch-frames', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              frames: frameBatches[b],
              targetLang,
              model: selectedModel,
              ocrEngine: 'gemini_vision',
              customContext,
              apiMode: appSettings?.apiMode,
              apiKey: appSettings?.apiKey,
              proxyUrl: appSettings?.proxyUrl,
              proxyKey: appSettings?.proxyKey,
              proxyTargetModel: appSettings?.proxyTargetModel,
              customModelName: appSettings?.customModelName,
              proxyNoApiKey: appSettings?.proxyNoApiKey,
            }),
          });

          const rawText = await res.text().catch(() => '');
          let data: any = {};
          try {
            data = JSON.parse(rawText);
          } catch {
            data = {};
          }

          if (!res.ok) {
            throw new Error(data.error || `HTTP ${res.status}: ${res.statusText || rawText.slice(0, 100)}`);
          }

          if (data.success && Array.isArray(data.subtitles)) {
            const batchFrames = frameBatches[b];
            const maxBatchTimestamp = batchFrames && batchFrames.length > 0
              ? batchFrames[batchFrames.length - 1].timestamp + Math.max(0.3, stepInterval)
              : endT;

            data.subtitles.forEach((s: any, idx: number) => {
              if (s.originalText && s.originalText.trim()) {
                let subBox: RegionROI | undefined = undefined;
                if (s.box_2d) {
                  subBox = calculateAbsoluteBox(s.box_2d, roi);
                }

                const rawStart = typeof s.startTime === 'number' && !isNaN(s.startTime) ? s.startTime : 0;
                let rawEnd = typeof s.endTime === 'number' && !isNaN(s.endTime) ? s.endTime : rawStart + 1.2;

                // Cap duration so a single subtitle cannot drift into future batches
                if (rawEnd > maxBatchTimestamp) {
                  rawEnd = maxBatchTimestamp;
                }
                if (rawEnd <= rawStart) {
                  rawEnd = Number((rawStart + 0.5).toFixed(2));
                }

                newSubtitles.push({
                  id: `scan-${b}-${idx}-${Date.now()}`,
                  startTime: Number(rawStart.toFixed(2)),
                  endTime: Number(rawEnd.toFixed(2)),
                  originalText: s.originalText.trim(),
                  translatedText: '', // OCR ra phụ đề gốc
                  sourceLang: s.sourceLang,
                  boundingBox: subBox || roi,
                });
              }
            });
          } else if (data.error) {
            lastApiError = data.error;
          }
        } catch (err: any) {
          console.error('Batch scan error:', err);
          lastApiError = err?.message || 'Lỗi kết nối máy chủ API OCR.';
        }

        setScanProgress((prev) => ({
          ...prev,
          percentage: 70 + Math.round(((b + 1) / frameBatches.length) * 28),
        }));

        // Gentle pause to respect API rate limits
        if (b < frameBatches.length - 1) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    }

    let finalSubtitles = newSubtitles;

    let aiRefineError: string | null = null;
    let aiRefineSucceeded = false;

    // Workflow bước cuối: Gọi AI Sàng lọc phụ đề gốc (tự động chạy để sửa lỗi chính tả & lọc trùng, trừ khi người dùng chủ động TẮT trong Cài đặt)
    if (newSubtitles.length > 0 && appSettings?.autoAiRefine !== false && !cancelScanRef.current) {
      setScanProgress((prev) => ({
        ...prev,
        status: 'translating',
        percentage: 92,
        message: `🤖 Bước cuối: AI (${selectedModel}) đang sửa lỗi chính tả & lọc trùng ${newSubtitles.length} phụ đề...`,
      }));

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s safety timeout for Render deployment & large subtitle lists

        const dedupRes = await fetch('/api/deduplicate-subtitles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            subtitles: newSubtitles,
            targetLang,
            model: selectedModel,
            apiMode: appSettings?.apiMode,
            apiKey: appSettings?.apiKey,
            proxyUrl: appSettings?.proxyUrl,
            proxyKey: appSettings?.proxyKey,
            proxyTargetModel: appSettings?.proxyTargetModel,
            customModelName: appSettings?.customModelName,
            proxyNoApiKey: appSettings?.proxyNoApiKey,
          }),
        });

        clearTimeout(timeoutId);

        let dedupData: any = {};
        try {
          dedupData = await dedupRes.json();
        } catch (jsonParseErr) {
          const rawText = await dedupRes.text().catch(() => '');
          dedupData = { error: `Invalid JSON response: ${rawText.slice(0, 300)}` };
        }

        if (dedupRes.ok && dedupData.success && Array.isArray(dedupData.subtitles) && dedupData.subtitles.length > 0) {
          finalSubtitles = dedupData.subtitles.map((s: any, idx: number) => ({
            id: `ai-clean-${idx}-${Date.now()}`,
            startTime: typeof s.startTime === 'number' ? s.startTime : 0,
            endTime: typeof s.endTime === 'number' ? s.endTime : (s.startTime || 0) + 1.2,
            originalText: String(s.originalText || '').trim(),
            translatedText: '', // Phụ đề gốc đã được AI sửa lỗi chính tả & làm sạch, giữ nguyên chưa dịch
            sourceLang: s.sourceLang,
            boundingBox: roi,
          }));
          aiRefineSucceeded = true;
          console.log(`[AI Refine] Succeeded! Refined into ${finalSubtitles.length} clean subtitles.`);
        } else {
          aiRefineError = dedupData.message || dedupData.error || `HTTP ${dedupRes.status} ${dedupRes.statusText}`;
          console.error('[AI Refine Error - F12 DevTools]', {
            status: dedupRes.status,
            statusText: dedupRes.statusText,
            apiMode: appSettings?.apiMode,
            proxyUrl: appSettings?.proxyUrl,
            proxyTargetModel: appSettings?.proxyTargetModel,
            model: selectedModel,
            errorMessage: aiRefineError,
            rawResponse: dedupData,
          });
        }
      } catch (dedupErr: any) {
        if (dedupErr.name === 'AbortError') {
          aiRefineError = 'Quá thời gian chờ phản hồi AI (90s)';
          console.error('[AI Refine Timeout - F12 DevTools] Request timed out after 90s:', dedupErr);
        } else {
          aiRefineError = dedupErr?.message || 'Không thể kết nối đến máy chủ AI';
          console.error('[AI Refine Network/Execution Exception - F12 DevTools]', dedupErr);
        }
      }
    }

    if (finalSubtitles.length > 0) {
      setSubtitles((prev) => {
        // Replace existing subtitles in the scanned interval [startT, endT]
        const remainingOld = prev.filter(
          (s) => s.endTime <= startT || s.startTime >= endT
        );
        return normalizeSubtitles([...remainingOld, ...finalSubtitles]);
      });
    }

    let completionMessage = '';
    if (finalSubtitles.length > 0) {
      if (appSettings?.autoAiRefine !== false) {
        if (aiRefineSucceeded) {
          completionMessage = `✨ Hoàn thành! AI đã bóc tách & tinh lọc thành công ${finalSubtitles.length} phụ đề chuẩn.`;
        } else if (aiRefineError) {
          completionMessage = `Đã bóc tách được ${finalSubtitles.length} phụ đề bằng PaddleOCR. ⚠️ Bước AI Lọc trùng bị bỏ qua do: ${aiRefineError} (Vui lòng kiểm tra API Key trong Cài đặt hoặc biến GEMINI_API_KEY trên Render).`;
        } else {
          completionMessage = `Đã hoàn thành! Đã bóc tách thành công ${finalSubtitles.length} phụ đề.`;
        }
      } else {
        completionMessage = `Đã hoàn thành! Đã bóc tách ${finalSubtitles.length} phụ đề bằng PaddleOCR Cục bộ (0 tốn Quota).`;
      }
    } else if (lastApiError) {
      completionMessage = lastApiError;
    } else {
      completionMessage = `AI không tìm thấy chữ trong vùng quét OCR (${capturedFramesCount} khung hình). Bạn hãy điều chỉnh/mở rộng khung quét OCR màu xanh đè trọn vùng chữ phụ đề trên video và quét lại.`;
    }

    setScanProgress({
      status: 'completed',
      currentFrame: totalFrames,
      totalFrames,
      currentTime: endT,
      totalTime: endT - startT,
      message: completionMessage,
      percentage: 100,
    });

    setTimeout(() => {
      setScanProgress((prev) => ({ ...prev, status: 'idle' }));
    }, 3000);
  };

  const handleCancelScan = () => {
    cancelScanRef.current = true;
    setScanProgress((prev) => ({ ...prev, status: 'idle', message: 'Đã hủy' }));
  };

  const handleReScanSubtitle = async (sub: SubtitleItem) => {
    if (!sub) return;
    const interval = appSettings?.ocrInterval || 0.3;
    handleSeek(sub.startTime);
    await handleStartFullScan(sub.startTime, sub.endTime, interval, '');
  };

  const handleAiDeduplicateSubtitles = async () => {
    if (subtitles.length === 0) return;
    setIsTranslatingBatch(true);
    try {
      const res = await fetch('/api/deduplicate-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subtitles,
          targetLang,
          model: selectedModel,
          apiMode: appSettings?.apiMode,
          apiKey: appSettings?.apiKey,
          proxyUrl: appSettings?.proxyUrl,
          proxyKey: appSettings?.proxyKey,
          proxyTargetModel: appSettings?.proxyTargetModel,
          customModelName: appSettings?.customModelName,
          proxyNoApiKey: appSettings?.proxyNoApiKey,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || `HTTP Error ${res.status}`);
      }

      if (data.success && Array.isArray(data.subtitles) && data.subtitles.length > 0) {
        const cleanedSubs: SubtitleItem[] = data.subtitles.map((s: any, idx: number) => ({
          id: `ai-clean-${idx}-${Date.now()}`,
          startTime: typeof s.startTime === 'number' ? s.startTime : 0,
          endTime: typeof s.endTime === 'number' ? s.endTime : (s.startTime || 0) + 1.2,
          originalText: String(s.originalText || '').trim(),
          translatedText: String(s.translatedText || '').trim(),
          sourceLang: s.sourceLang,
          boundingBox: s.boundingBox || roi,
        }));

        setSubtitles(normalizeSubtitles(cleanedSubs));
        alert(`✨ AI đã hoàn thành sàng lọc phụ đề:\n- Sửa lỗi chính tả OCR\n- Loại bỏ rác & thủy ấn\n- Gộp câu lặp trùng, còn lại ${cleanedSubs.length} phụ đề.`);
      } else {
        alert(data.error || 'AI không trả về dữ liệu phụ đề hợp lệ.');
      }
    } catch (err: any) {
      console.error('AI deduplicate error:', err);
      alert('Không thể thực hiện AI lọc trùng: ' + (err?.message || 'Lỗi hệ thống'));
    } finally {
      setIsTranslatingBatch(false);
    }
  };

  const handleReTranslateAll = async (
    overrideModel?: GeminiModelOption,
    optimizeForTts: boolean = true,
    customCtx?: string
  ) => {
    if (subtitles.length === 0) return;
    const effectiveContext = customCtx !== undefined ? customCtx : customContext;
    if (customCtx !== undefined && customCtx !== customContext) {
      setCustomContext(customCtx);
    }

    setIsTranslatingBatch(true);
    
    try {
      // =========================================================================
      // BƯỚC 1: TRÍCH XUẤT NGỮ CẢNH TOÀN CỤC TRƯỚC KHI DỊCH
      // Prompt vai trò: "context synchronization expert"
      // AI đọc lướt toàn bộ phụ đề để rút ra: tên nhân vật, địa danh, và thể loại phim
      // =========================================================================
      setTranslationProgressMsg('🧠 Bước 1/2: AI đang đọc lướt kịch bản để phân tích thể loại phim, tên nhân vật & đại từ xưng hô...');
      console.log(`[handleReTranslateAll] Stage 1: Extracting global context from ${subtitles.length} subtitles...`);

      let activeGlobalContext: GlobalMovieContext = globalContext || {
        movieGenre: 'Tự động',
        eraAndSetting: 'Tự nhiên',
        characterPronounGuide: 'Xưng hô tự nhiên theo ngữ cảnh từng câu.',
        summary: '',
        knownEntityGlossary: [],
      };

      try {
        const ctxRes = await fetch('/api/extract-global-context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subtitles,
            targetLang,
            model: overrideModel || selectedModel,
            customContext: effectiveContext,
            apiMode: appSettings?.apiMode,
            apiKey: appSettings?.apiKey,
            proxyUrl: appSettings?.proxyUrl,
            proxyKey: appSettings?.proxyKey,
            proxyTargetModel: appSettings?.proxyTargetModel,
            customModelName: appSettings?.customModelName,
            proxyNoApiKey: appSettings?.proxyNoApiKey,
          }),
        });

        const rawCtxText = await ctxRes.text().catch(() => '');
        let ctxData: any = {};
        try {
          ctxData = JSON.parse(rawCtxText);
        } catch {
          console.warn('[handleReTranslateAll] Global context parse warning:', rawCtxText.slice(0, 100));
        }

        if (ctxRes.ok && ctxData.success && ctxData.globalContext) {
          activeGlobalContext = ctxData.globalContext;
          setGlobalContext(activeGlobalContext);
          console.log('[handleReTranslateAll] Stage 1 Global Context Extracted:', activeGlobalContext);
        }
      } catch (ctxErr) {
        console.warn('[handleReTranslateAll] Global context extraction fallback:', ctxErr);
      }

      // =========================================================================
      // BƯỚC 2: DỊCH THEO BATCH — MANG THEO NGỮ CẢNH TOÀN CỤC & TỪ BATCH TRƯỚC
      // Mang theo: KNOWN ENTITY GLOSSARY, PREVIOUS CONTEXT, GLOBAL MOVIE GENRE
      // =========================================================================
      const chunkSize = 20;
      const totalSubtitles = subtitles.length;
      const chunks: SubtitleItem[][] = [];
      
      for (let i = 0; i < totalSubtitles; i += chunkSize) {
        chunks.push(subtitles.slice(i, i + chunkSize));
      }
      
      const totalChunks = chunks.length;
      console.log(`[handleReTranslateAll] Stage 2: Translating ${totalSubtitles} subtitles in ${totalChunks} chained batches (Genre: "${activeGlobalContext.movieGenre}")...`);

      let runningGlossary: GlossaryEntity[] = [...(activeGlobalContext.knownEntityGlossary || [])];
      let previousContextBuffer: { id: string; originalText: string; translatedText: string }[] = [];

      for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        const currentChunk = chunks[chunkIdx];
        const genreBadge = activeGlobalContext.movieGenre && activeGlobalContext.movieGenre !== 'Tự động'
          ? `[${activeGlobalContext.movieGenre}] `
          : '';
        const pct = Math.round((chunkIdx / totalChunks) * 100);
        setTranslationProgressMsg(`🎯 Bước 2/2: Đang dịch nhóm ${chunkIdx + 1}/${totalChunks} ${genreBadge}(${pct}%)...`);

        let success = false;
        let attempt = 0;
        const maxRetries = 2;
        let lastError: any = null;

        while (attempt <= maxRetries && !success) {
          try {
            const res = await fetch('/api/translate-batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                subtitles: currentChunk,
                targetLang,
                model: overrideModel || selectedModel,
                optimizeForTts,
                customContext: effectiveContext,
                globalContext: activeGlobalContext,
                knownEntityGlossary: runningGlossary,
                previousContext: previousContextBuffer,
                apiMode: appSettings?.apiMode,
                apiKey: appSettings?.apiKey,
                proxyUrl: appSettings?.proxyUrl,
                proxyKey: appSettings?.proxyKey,
                proxyTargetModel: appSettings?.proxyTargetModel,
                customModelName: appSettings?.customModelName,
                proxyNoApiKey: appSettings?.proxyNoApiKey,
              }),
            });

            const rawText = await res.text().catch(() => '');
            let data: any = {};
            try {
              data = JSON.parse(rawText);
            } catch {
              throw new Error(`HTTP ${res.status}: Phản hồi dịch không hợp lệ (${rawText.slice(0, 100)})`);
            }

            if (!res.ok || !data.success) {
              throw new Error(data.message || data.error || `HTTP ${res.status}`);
            }

            if (Array.isArray(data.translations)) {
              const chunkTranslationsMap = new Map<string, string>();
              data.translations.forEach((t: any) => chunkTranslationsMap.set(t.id, t.translatedText));

              // Cập nhật phụ đề trên giao diện ngay lập tức
              setSubtitles((prev) =>
                prev.map((s) => {
                  if (chunkTranslationsMap.has(s.id)) {
                    return { ...s, translatedText: chunkTranslationsMap.get(s.id)! };
                  }
                  return s;
                })
              );

              // Cập nhật từ điển thực thể nếu batch mới tìm thấy thực thể mới
              if (Array.isArray(data.newEntities) && data.newEntities.length > 0) {
                const existingKeys = new Set(runningGlossary.map((g) => g.original.toLowerCase().trim()));
                data.newEntities.forEach((ne: any) => {
                  if (ne.original && ne.translated && !existingKeys.has(ne.original.toLowerCase().trim())) {
                    runningGlossary.push({
                      original: ne.original,
                      translated: ne.translated,
                      type: ne.type || 'term',
                      description: ne.description || '',
                    });
                    existingKeys.add(ne.original.toLowerCase().trim());
                  }
                });
              }

              // Lưu 3 câu cuối của batch này làm PREVIOUS CONTEXT cho batch sau
              previousContextBuffer = currentChunk.slice(-3).map((sub) => ({
                id: sub.id,
                originalText: sub.originalText,
                translatedText: chunkTranslationsMap.get(sub.id) || '',
              }));

              success = true;
            } else {
              throw new Error('Định dạng dữ liệu dịch trả về không hợp lệ.');
            }
          } catch (err: any) {
            attempt++;
            lastError = err;
            console.warn(`[handleReTranslateAll] Batch ${chunkIdx + 1} attempt ${attempt} failed:`, err);
            if (attempt <= maxRetries) {
              await new Promise((r) => setTimeout(r, 1500));
            }
          }
        }

        if (!success) {
          throw new Error(lastError?.message || `Lỗi ở nhóm dịch thứ ${chunkIdx + 1}`);
        }
      }

      // Cập nhật lại từ điển thực thể hoàn chỉnh vào project context
      setGlobalContext((prev) => ({
        ...(prev || activeGlobalContext),
        knownEntityGlossary: runningGlossary,
      }));

      setTranslationProgressMsg('');
      const entityCount = runningGlossary.length;
      alert(`✨ Đã dịch hoàn tất toàn bộ phụ đề thành công!\n- Thể loại phim: ${activeGlobalContext.movieGenre || 'Tự động'}\n- Từ điển thực thể đồng bộ: ${entityCount} mục`);
    } catch (e: any) {
      console.error(e);
      alert('Quá trình dịch bị gián đoạn:\n' + (e?.message || 'Lỗi hệ thống'));
    } finally {
      setIsTranslatingBatch(false);
      setTranslationProgressMsg('');
    }
  };

  // Play base64 audio with Web Audio API using persistent AudioContext and buffer cache for ultra-fast, zero-lag playback
  const playBase64AudioWithControls = async (
    base64: string,
    speed: number = appSettings.ttsSpeed || 1.0,
    pitch: number = appSettings.ttsPitch || 0,
    subId?: string
  ) => {
    try {
      if (activeAudioSourceRef.current) {
        try {
          activeAudioSourceRef.current.stop();
          activeAudioSourceRef.current.disconnect();
        } catch {}
        activeAudioSourceRef.current = null;
      }

      const audioCtx = getSharedAudioContext();
      const cacheKey = subId ? `${subId}_${base64.slice(0, 32)}` : base64.slice(0, 64);

      let audioBuffer = audioBufferCacheRef.current.get(cacheKey);

      if (!audioBuffer) {
        const binaryStr = atob(base64);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
        // Retain up to 300 decoded audio clips in memory to eliminate decoding overhead during playback
        if (audioBufferCacheRef.current.size > 300) {
          audioBufferCacheRef.current.clear();
        }
        audioBufferCacheRef.current.set(cacheKey, audioBuffer);
      }

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = Math.max(0.2, Math.min(3.0, speed));
      source.detune.value = Math.max(-1200, Math.min(1200, pitch * 100)); // cents pitch shift
      source.connect(audioCtx.destination);
      source.start(0);
      activeAudioSourceRef.current = source;
      return source;
    } catch (e) {
      console.warn('Web Audio Playback Fallback', e);
      try {
        const audio = new Audio(`data:audio/wav;base64,${base64}`);
        audio.playbackRate = Math.max(0.5, Math.min(2.0, speed));
        audio.play().catch(() => {});
      } catch {}
    }
  };

  // Helper to assign TTS audio to a subtitle and ripple-shift subsequent subtitles to prevent audio truncation
  const updateSubtitleAudioAndRippleTimeline = (
    prevSubtitles: SubtitleItem[],
    targetId: string,
    audioBase64: string,
    rawDuration: number,
    timestamps?: any
  ): SubtitleItem[] => {
    const list = prevSubtitles.map((s) => ({ ...s }));
    const idx = list.findIndex((s, i) => String(s.id || i) === String(targetId));
    if (idx === -1) return prevSubtitles;

    const target = list[idx];
    const origDuration = target.endTime - target.startTime;

    let roundedDuration = rawDuration;
    let speedMultiplier = 1.0;

    // Apply gentle speedup if needed to fit original timing
    if (roundedDuration > origDuration && origDuration > 0.5) {
      const requiredSpeed = roundedDuration / origDuration;
      speedMultiplier = Math.min(1.25, requiredSpeed);
      roundedDuration = roundedDuration / speedMultiplier;
    }

    const finalEndTime = target.startTime + Math.max(origDuration, roundedDuration);
    target.audioUrl = `data:audio/wav;base64,${audioBase64}`;
    target.duration = Math.round(roundedDuration * 1000) / 1000;
    target.endTime = Math.round(finalEndTime * 1000) / 1000;
    target.speed = speedMultiplier;
    if (timestamps) target.timestamps = timestamps;

    // Ripple shift subsequent subtitles if new endTime extends into next start time
    for (let k = idx + 1; k < list.length; k++) {
      const prevItem = list[k - 1];
      const currItem = list[k];
      const minStart = prevItem.endTime + 0.05;

      if (currItem.startTime < minStart) {
        const shift = minStart - currItem.startTime;
        currItem.startTime = Math.round((currItem.startTime + shift) * 1000) / 1000;
        currItem.endTime = Math.round((currItem.endTime + shift) * 1000) / 1000;
      } else {
        break;
      }
    }

    return list;
  };

  // Split text into short sentence chunks for instant pipelined TTS streaming
  const splitTextIntoSentenceChunks = (text: string): string[] => {
    if (!text || !text.trim()) return [];
    const trimmed = text.trim();
    // Subtitles <= 180 characters should be processed in 1 single chunk without splitting
    if (trimmed.length <= 180) {
      return [trimmed];
    }
    const rawParts = trimmed.split(/(?<=[.?!;\n])\s+/);
    const chunks: string[] = [];
    let current = '';

    for (const part of rawParts) {
      const p = part.trim();
      if (!p) continue;

      if ((current ? current + ' ' + p : p).length <= 180) {
        current = current ? current + ' ' + p : p;
      } else {
        if (current) chunks.push(current);
        if (p.length <= 180) {
          current = p;
        } else {
          const commaParts = p.split(/(?<=[,])\s+/);
          let cCurrent = '';
          for (const cp of commaParts) {
            const cTrim = cp.trim();
            if (!cTrim) continue;
            if ((cCurrent ? cCurrent + ' ' + cTrim : cTrim).length <= 180) {
              cCurrent = cCurrent ? cCurrent + ' ' + cTrim : cTrim;
            } else {
              if (cCurrent) chunks.push(cCurrent);
              cCurrent = cTrim;
            }
          }
          if (cCurrent) chunks.push(cCurrent);
          current = '';
        }
      }
    }
    if (current) chunks.push(current);

    return chunks.length > 0 ? chunks : [trimmed];
  };

  const fetchChunkAudioBase64 = async (
    textChunk: string,
    speed: number,
    provider: TTSProviderOption
  ): Promise<string | null> => {
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textChunk,
          provider,
          nghiVoice: appSettings.nghiVoice || 'lacphi',
          edgeVoice: appSettings.edgeVoice || 'vi-VN-HoaiMyNeural',
          tiktokSessionId: appSettings.tiktokSessionId,
          tiktokVoice: appSettings.tiktokVoice || 'vi_001',
          voice: appSettings.geminiVoice || 'Kore',
          ttsSpeed: speed,
          apiMode: appSettings?.apiMode,
          apiKey: appSettings?.apiKey,
          proxyUrl: appSettings?.proxyUrl,
          proxyKey: appSettings?.proxyKey,
          proxyTargetModel: appSettings?.proxyTargetModel,
          customModelName: appSettings?.customModelName,
          proxyNoApiKey: appSettings?.proxyNoApiKey,
          tiktokProxyUrl: appSettings?.tiktokProxyUrl,
        }),
      });

      const rawText = await res.text().catch(() => '');
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        console.warn('[Chunk TTS Server Response Error]', res.status, rawText.slice(0, 150));
        return null;
      }

      if (!res.ok || !data.success) {
        console.warn('[Chunk TTS Server Response Error]', res.status, data.error || data.message || rawText.slice(0, 150));
        return null;
      }

      if (data.audioBase64) {
        return data.audioBase64;
      }
    } catch (e) {
      console.warn('Error fetching chunk TTS:', e);
    }
    return null;
  };

  const handlePlayTTS = async (
    text: string,
    speed: number = appSettings.ttsSpeed || 1.0,
    pitch: number = appSettings.ttsPitch || 0,
    providerOverride?: TTSProviderOption
  ) => {
    if (!text || !text.trim()) return;

    // Cancel previous playback pipeline
    if (activeAudioSourceRef.current) {
      try {
        activeAudioSourceRef.current.stop();
      } catch {}
    }

    const currentPipelineId = Date.now();
    ttsPipelineIdRef.current = currentPipelineId;

    const provider = providerOverride || appSettings.ttsProvider || 'nghi_tts';
    const chunks = splitTextIntoSentenceChunks(text);

    if (chunks.length === 0) return;

    let hasError = false;

    // Single short sentence: simple immediate fetch & play
    if (chunks.length === 1) {
      const b64 = await fetchChunkAudioBase64(chunks[0], speed, provider);
      if (ttsPipelineIdRef.current !== currentPipelineId) return;
      if (b64) {
        await playBase64AudioWithControls(b64, speed, pitch);
      } else if (provider === 'browser') {
        const utterance = new SpeechSynthesisUtterance(chunks[0]);
        utterance.rate = Math.max(0.5, Math.min(2.0, speed));
        utterance.pitch = Math.max(0.5, Math.min(1.5, 1 + pitch / 10));
        utterance.lang = 'vi-VN';
        window.speechSynthesis.speak(utterance);
      } else if (provider === 'nghi_tts') {
        console.warn('[Nghi-TTS] Audio not ready or voice model needs to be downloaded.');
      } else {
        console.warn(`[TTS Error] Cannot generate audio with ${provider}`);
        alert(`Lỗi: Không thể tạo giọng đọc với nhà cung cấp ${provider}. Vui lòng thử lại hoặc chọn giọng đọc khác.`);
      }
      return;
    }

    // Paragraph Chunking Pipeline: Render Chunk 1 -> Play Chunk 1 while pre-rendering Chunk 2 in background
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch {}
    }

    const chunkAudioPromises = new Map<number, Promise<AudioBuffer | null>>();

    const getOrFetchChunkBuffer = (index: number): Promise<AudioBuffer | null> => {
      if (index >= chunks.length) return Promise.resolve(null);
      if (chunkAudioPromises.has(index)) {
        return chunkAudioPromises.get(index)!;
      }

      const promise = (async () => {
        const b64 = await fetchChunkAudioBase64(chunks[index], speed, provider);
        if (!b64 || ttsPipelineIdRef.current !== currentPipelineId) return null;
        try {
          const binaryStr = atob(b64);
          const len = binaryStr.length;
          const bytes = new Uint8Array(len);
          for (let k = 0; k < len; k++) {
            bytes[k] = binaryStr.charCodeAt(k);
          }
          return await audioCtx.decodeAudioData(bytes.buffer);
        } catch (e) {
          console.warn(`Failed to decode chunk ${index}:`, e);
          return null;
        }
      })();

      chunkAudioPromises.set(index, promise);
      return promise;
    };

    // Immediately start pre-fetching Chunk 0 & Chunk 1 in parallel
    getOrFetchChunkBuffer(0);
    getOrFetchChunkBuffer(1);

    for (let i = 0; i < chunks.length; i++) {
      if (ttsPipelineIdRef.current !== currentPipelineId) break;

      // Pipeline trigger for next chunks
      if (i + 1 < chunks.length) getOrFetchChunkBuffer(i + 1);
      if (i + 2 < chunks.length) getOrFetchChunkBuffer(i + 2);

      const buffer = await getOrFetchChunkBuffer(i);
      if (ttsPipelineIdRef.current !== currentPipelineId) break;

      if (buffer) {
        await new Promise<void>((resolve) => {
          if (ttsPipelineIdRef.current !== currentPipelineId) {
            resolve();
            return;
          }
          const source = audioCtx.createBufferSource();
          source.buffer = buffer;
          source.playbackRate.value = Math.max(0.2, Math.min(3.0, speed));
          source.detune.value = Math.max(-1200, Math.min(1200, pitch * 100));
          source.connect(audioCtx.destination);

          source.onended = () => resolve();
          source.start(0);
          activeAudioSourceRef.current = source;
        });
      } else if (provider === 'browser') {
        // SpeechSynthesis for browser provider only
        await new Promise<void>((resolve) => {
          if (ttsPipelineIdRef.current !== currentPipelineId) {
            resolve();
            return;
          }
          const utterance = new SpeechSynthesisUtterance(chunks[i]);
          utterance.rate = Math.max(0.5, Math.min(2.0, speed));
          utterance.pitch = Math.max(0.5, Math.min(1.5, 1 + pitch / 10));
          utterance.lang = 'vi-VN';
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          window.speechSynthesis.speak(utterance);
        });
      } else {
        hasError = true;
        console.warn(`[TTS Error] Segment ${i} failed for provider: ${provider}`);
      }
    }

    if (hasError && ttsPipelineIdRef.current === currentPipelineId) {
      alert(`Một số phân đoạn không thể tạo được giọng đọc bằng ${provider}. Vui lòng thử lại hoặc chọn giọng khác.`);
    }
  };

  // Gộp Phụ Đề Ngắn (Merge short consecutive subtitles)
  const handleMergeShortSubtitles = () => {
    if (subtitles.length < 2) return;
    const sorted = [...subtitles].sort((a, b) => a.startTime - b.startTime);
    const merged: SubtitleItem[] = [];
    let i = 0;

    while (i < sorted.length) {
      let curr = { ...sorted[i] };
      let j = i + 1;

      while (j < sorted.length) {
        const next = sorted[j];
        const gap = next.startTime - curr.endTime;
        const words = (curr.translatedText || curr.originalText).trim().split(/\s+/).filter(Boolean).length;
        const duration = curr.endTime - curr.startTime;

        // Merge if gap <= 1.2s and (current sub is short <= 4 words or <= 1.8s) and combined length <= 7s
        if (gap <= 1.2 && (words <= 4 || duration <= 1.8) && (next.endTime - curr.startTime) <= 7.0) {
          curr.endTime = next.endTime;
          curr.originalText = `${curr.originalText} ${next.originalText}`.trim();
          curr.translatedText = `${curr.translatedText || curr.originalText} ${next.translatedText || next.originalText}`.trim();
          curr.audioUrl = undefined;
          j++;
        } else {
          break;
        }
      }
      merged.push(curr);
      i = j;
    }

    setSubtitles(merged);
  };

  // Tạo Audio Thuyết Minh Toàn Bộ (Generate TTS for all subtitles using safe client-side chunked batching)
  const handleGenerateAllAudio = async () => {
    if (subtitles.length === 0) return;
    setIsGeneratingAllAudio(true);
    setAudioGenProgress({ current: 0, total: subtitles.length });

    const itemsToGen = subtitles.map((s, idx) => ({
      id: String(s.id || idx),
      text: (s.translatedText || s.originalText || '').trim(),
      targetDuration: Math.max(0.5, (s.endTime - s.startTime) || 2.0),
    })).filter((item) => item.text.length > 0);

    if (itemsToGen.length === 0) {
      setIsGeneratingAllAudio(false);
      return;
    }

    let completedCount = 0;
    const CHUNK_SIZE = 10; // Process 10 items per batch to prevent HTTP timeouts & rate limits
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    let tempCtx: AudioContext | null = null;

    try {
      if (AudioCtx) {
        tempCtx = new AudioCtx();
      }

      for (let i = 0; i < itemsToGen.length; i += CHUNK_SIZE) {
        const chunkItems = itemsToGen.slice(i, i + CHUNK_SIZE);

        try {
          const res = await fetch('/api/tts/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: chunkItems,
              provider: appSettings.ttsProvider || 'nghi_tts',
              nghiVoice: appSettings.nghiVoice || 'lacphi',
              edgeVoice: appSettings.edgeVoice || 'vi-VN-HoaiMyNeural',
              tiktokSessionId: appSettings.tiktokSessionId,
              tiktokVoice: appSettings.tiktokVoice || 'vi_001',
              voice: appSettings.geminiVoice || 'Kore',
              ttsSpeed: appSettings.ttsSpeed || 1.0,
              apiMode: appSettings?.apiMode,
              apiKey: appSettings?.apiKey,
              proxyUrl: appSettings?.proxyUrl,
              proxyKey: appSettings?.proxyKey,
              proxyTargetModel: appSettings?.proxyTargetModel,
              customModelName: appSettings?.customModelName,
              proxyNoApiKey: appSettings?.proxyNoApiKey,
              tiktokProxyUrl: appSettings?.tiktokProxyUrl,
            }),
          });

          if (!res.ok) {
            console.warn(`[Batch TTS Chunk Error] Chunk ${i / CHUNK_SIZE + 1} status: ${res.status}`);
            completedCount += chunkItems.length;
            setAudioGenProgress({ current: Math.min(completedCount, itemsToGen.length), total: itemsToGen.length });
            continue;
          }

          const reader = res.body?.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const r = JSON.parse(line);
                  if (r && r.audioBase64) {
                    const base64Data = r.audioBase64.replace(/^data:audio\/\w+;base64,/, '');
                    const binaryStr = atob(base64Data);
                    const bytes = new Uint8Array(binaryStr.length);
                    for (let k = 0; k < binaryStr.length; k++) {
                      bytes[k] = binaryStr.charCodeAt(k);
                    }

                    let roundedDuration = r.duration || 1.5;
                    let speedMultiplier = 1.0;
                    let finalEndTime = 0;

                    if (tempCtx) {
                      try {
                        // Pass a cloned buffer slice to decodeAudioData to avoid neutering ArrayBuffer
                        const decodedBuffer = await tempCtx.decodeAudioData(bytes.buffer.slice(0));
                        roundedDuration = Math.round(decodedBuffer.duration * 1000) / 1000;
                      } catch (decErr) {
                        console.warn('[Smart Audio Fit] Failed to decode audio for', r.id, decErr);
                      }
                    }

                    setSubtitles((prev) =>
                      updateSubtitleAudioAndRippleTimeline(
                        prev,
                        r.id,
                        r.audioBase64,
                        roundedDuration,
                        r.timestamps
                      )
                    );
                  }

                  completedCount++;
                  setAudioGenProgress({ current: Math.min(completedCount, itemsToGen.length), total: itemsToGen.length });

                } catch (lineErr) {
                  console.error('Error parsing streaming line:', lineErr);
                }
              }
            }
          }
        } catch (chunkErr) {
          console.warn('[Batch TTS Chunk Exception]', chunkErr);
          completedCount += chunkItems.length;
          setAudioGenProgress({ current: Math.min(completedCount, itemsToGen.length), total: itemsToGen.length });
        }

        // Small pause between chunks to give network/servers a breathing room
        await new Promise((res) => setTimeout(res, 200));
      }

      // Final pass to normalize timestamps and layout
      setSubtitles((prev) => normalizeSubtitles(prev));

    } catch (err) {
      console.warn('Error progressive batch generating TTS:', err);
    } finally {
      if (tempCtx) {
        try { tempCtx.close(); } catch {}
      }
      setIsGeneratingAllAudio(false);
    }
  };

  // Clear all cached audio
  const handleClearAllAudio = () => {
    audioBufferCacheRef.current.clear();
    setSubtitles((prev) => prev.map((s) => ({ ...s, audioUrl: undefined })));
  };

  // Generate TTS audio for a single selected subtitle item
  const handleGenerateSingleAudio = async (subId: string) => {
    const sub = subtitles.find((s) => s.id === subId);
    if (!sub) return;
    const text = (sub.translatedText || sub.originalText || '').trim();
    if (!text) return;

    setIsGeneratingSingleAudio(subId);

    const targetDuration = Math.max(0.5, (sub.endTime - sub.startTime) || 2.0);

    try {
      const res = await fetch('/api/tts/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ id: sub.id, text, targetDuration }],
          provider: appSettings.ttsProvider || 'nghi_tts',
          nghiVoice: appSettings.nghiVoice || 'lacphi',
          edgeVoice: appSettings.edgeVoice || 'vi-VN-HoaiMyNeural',
          tiktokSessionId: appSettings.tiktokSessionId,
          tiktokVoice: appSettings.tiktokVoice || 'vi_001',
          voice: appSettings.geminiVoice || 'Kore',
          ttsSpeed: appSettings.ttsSpeed || 1.0,
          apiMode: appSettings?.apiMode,
          apiKey: appSettings?.apiKey,
          proxyUrl: appSettings?.proxyUrl,
          proxyKey: appSettings?.proxyKey,
          proxyTargetModel: appSettings?.proxyTargetModel,
          customModelName: appSettings?.customModelName,
          proxyNoApiKey: appSettings?.proxyNoApiKey,
          tiktokProxyUrl: appSettings?.tiktokProxyUrl,
        }),
      });

      if (!res.ok) {
        console.warn('[Single TTS Server Error]', res.status);
        setIsGeneratingSingleAudio(null);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      if (!reader) {
        setIsGeneratingSingleAudio(null);
        return;
      }

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const tempCtx = new AudioCtx();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const r = JSON.parse(line);
            if (r && r.audioBase64) {
              const base64Data = r.audioBase64.replace(/^data:audio\/\w+;base64,/, '');
              const binaryStr = atob(base64Data);
              const bytes = new Uint8Array(binaryStr.length);
              for (let k = 0; k < binaryStr.length; k++) {
                bytes[k] = binaryStr.charCodeAt(k);
              }

              let roundedDuration = r.duration || 1.5;
              let speedMultiplier = 1.0;

              try {
                const decodedBuffer = await tempCtx.decodeAudioData(bytes.buffer);
                roundedDuration = Math.round(decodedBuffer.duration * 1000) / 1000;
              } catch (_) {}

              setSubtitles((prev) =>
                updateSubtitleAudioAndRippleTimeline(
                  prev,
                  subId,
                  r.audioBase64,
                  roundedDuration,
                  r.timestamps
                )
              );
            }
          } catch (e) {
            console.warn('[Single TTS Parse Error]', e);
          }
        }
      }
    } catch (err) {
      console.error('Error generating single audio:', err);
    } finally {
      setIsGeneratingSingleAudio(null);
    }
  };

  const handlePlaySingleAudio = (sub: SubtitleItem) => {
    if (sub.audioUrl) {
      const base64 = sub.audioUrl.replace(/^data:audio\/\w+;base64,/, '');
      playBase64AudioWithControls(base64, sub.speed || appSettings.ttsSpeed || 1.0, appSettings.ttsPitch || 0, sub.id);
    }
  };

  const handleDeleteSingleAudio = (subId: string) => {
    setSubtitles((prev) =>
      prev.map((s) => (s.id === subId ? { ...s, audioUrl: undefined } : s))
    );
  };

  // Synchronize TTS audio playback with video play timeline (Robust range-based matching)
  useEffect(() => {
    if (!isPlaying || !audioPlayWithVideo) {
      if (activeAudioSourceRef.current) {
        try {
          activeAudioSourceRef.current.stop();
          activeAudioSourceRef.current.disconnect();
        } catch {}
        activeAudioSourceRef.current = null;
      }
      lastPlayedSubIdRef.current = null;
      prevTimeRef.current = currentTime;
      return;
    }

    const timeDelta = currentTime - prevTimeRef.current;
    // Detect seek or rewind (time jumped backwards or jumped forward by > 1.5s)
    const isSeeking = timeDelta < -0.1 || timeDelta > 1.5;
    prevTimeRef.current = currentTime;

    if (isSeeking) {
      lastPlayedSubIdRef.current = null;
      if (activeAudioSourceRef.current) {
        try {
          activeAudioSourceRef.current.stop();
          activeAudioSourceRef.current.disconnect();
        } catch {}
        activeAudioSourceRef.current = null;
      }
    }

    // Match active subtitle covering currentTime [startTime, endTime]
    // Fixes skipped audio on heavy/long videos where frame drops cause time updates to jump past startTime + 0.4s
    const currentActive = subtitles.find(
      (s) => currentTime >= s.startTime && currentTime <= s.endTime
    );

    if (currentActive) {
      if (currentActive.audioUrl && lastPlayedSubIdRef.current !== currentActive.id) {
        lastPlayedSubIdRef.current = currentActive.id;
        const base64 = currentActive.audioUrl.replace(/^data:audio\/\w+;base64,/, '');
        const playbackSpeed = currentActive.speed || appSettings.ttsSpeed || 1.0;
        playBase64AudioWithControls(base64, playbackSpeed, appSettings.ttsPitch || 0, currentActive.id);
      }
    } else {
      // In gap between subtitles, reset lastPlayedSubIdRef so next subtitle triggers cleanly
      lastPlayedSubIdRef.current = null;
    }
  }, [currentTime, isPlaying, audioPlayWithVideo, subtitles, appSettings.ttsSpeed, appSettings.ttsPitch]);

  const handleSeek = (time: number) => {
    stopAllAudioPlayback();
    if (videoRef.current) {
      if (clips && clips.length > 1) {
        let targetIndex = 0;
        let relativeTime = time;
        for (let i = 0; i < clips.length; i++) {
          const start = clipStartTimes[i];
          const end = start + clips[i].duration;
          if (time >= start && time <= end) {
            targetIndex = i;
            relativeTime = time - start;
            break;
          }
        }

        if (activeClipIndex !== targetIndex) {
          setActiveClipIndex(targetIndex);
          videoRef.current.src = clips[targetIndex].url;
        }

        videoRef.current.currentTime = relativeTime;
        setCurrentTime(time);
      } else {
        videoRef.current.currentTime = time;
        setCurrentTime(time);
      }
    }
  };

  const handleTogglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.volume = videoVolume;
      videoRef.current.playbackRate = videoSpeed;
      videoRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => {
          console.error('Video play error:', err);
          setIsPlaying(false);
        });
    }
  };

  // Split subtitle at current time
  const handleSplitSubtitle = (splitTime: number) => {
    const target = subtitles.find((s) => splitTime > s.startTime + 0.3 && splitTime < s.endTime - 0.3);
    if (!target) return;

    const firstSub: SubtitleItem = {
      ...target,
      endTime: splitTime,
    };

    const secondSub: SubtitleItem = {
      ...target,
      id: `split-${Date.now()}`,
      startTime: splitTime,
    };

    setSubtitles((prev) =>
      normalizeSubtitles(
        prev.map((s) => (s.id === target.id ? firstSub : s)).concat(secondSub)
      )
    );
  };

  const handleUpdateActiveSubtitleBox = React.useCallback(
    (newBox: { x: number; y: number; width: number; height: number }) => {
      setRoi(newBox);
      setSubtitles((prev) =>
        prev.map((sub) => ({ ...sub, boundingBox: newBox }))
      );
    },
    []
  );

  return (
    <div className="min-h-screen bg-[#0b0b0d] text-slate-100 flex justify-center font-sans antialiased overflow-hidden">
      {/* Smartphone / PC Responsive Container Viewport */}
      <div className="w-full max-w-md md:max-w-2xl lg:max-w-3xl bg-[#121215] h-screen flex flex-col relative shadow-2xl border-x border-slate-900/80 overflow-hidden">
        
        {/* 1. CapCut Navigation Header - Slim & Compact */}
        <header className="bg-[#141418] border-b border-slate-800/80 px-3 py-1.5 flex items-center justify-between z-40 h-[38px] shadow-sm">
          {/* Left: Close Button */}
          <button
            onClick={onBackToHome}
            className="p-1 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition cursor-pointer"
            title="Đóng / Trở về Trang Chủ"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Right: Real Video Resolution Badge (Right Next to Export) & Export Button */}
          <div className="flex items-center space-x-2">
            {videoUrl && (
              <div 
                className="bg-slate-800/90 border border-slate-700/80 text-slate-200 text-[10px] px-2 py-0.5 rounded-md font-mono font-bold flex items-center space-x-1 shadow-sm select-none"
                title={videoDimensions ? `Độ phân giải thực tế: ${videoDimensions.width} × ${videoDimensions.height}` : 'Đang tải độ phân giải...'}
              >
                <span>{getResolutionBadge()}</span>
                {videoDimensions && (
                  <span className="text-[9px] text-slate-400 font-normal hidden sm:inline">
                    ({videoDimensions.width}x{videoDimensions.height})
                  </span>
                )}
              </div>
            )}

            <button
              onClick={() => setIsExportOpen(true)}
              className="bg-slate-100 hover:bg-white text-slate-950 font-black text-xs px-3 py-1 rounded-lg transition shadow-sm flex items-center space-x-1 cursor-pointer active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Xuất</span>
            </button>
          </div>
        </header>



        {/* 2. Editor Main Canvas Body */}
        <div className="flex-1 flex flex-col overflow-hidden relative bg-[#0b0b0d]">
          {/* Responsive Video Canvas Container */}
          <div className="flex-1 min-h-0 p-2 flex items-center justify-center overflow-hidden bg-black">
            <div className="w-full h-full max-h-full flex items-center justify-center min-h-0">
              <VideoPlayer
                videoUrl={videoUrl}
                roi={roi}
                onChangeRoi={setRoi}
                showRoiBox={activeTab === 'extract'}
                activeSubtitle={activeSubtitle}
                isSubtitleSelected={Boolean(selectedSubtitleId && activeSubtitle && selectedSubtitleId === activeSubtitle.id)}
                onSelectSubtitle={(sub) => {
                  if (sub) {
                    setSelectedSubtitleId(sub.id);
                    setIsVideoSelected(false);
                  }
                }}
                onUpdateActiveSubtitleBox={handleUpdateActiveSubtitleBox}
                styleConfig={styleConfig}
                onChangeStyleConfig={setStyleConfig}
                onExtractSingleFrame={handleExtractSingleFrame}
                isExtractingSingle={isExtractingSingle}
                onAutoDetectRoi={handleAutoDetectRoi}
                isDetectingRoi={isDetectingRoi}
                onTimeUpdate={setCurrentTime}
                onLoadedMetadata={handleLoadedMetadata}
                videoRef={videoRef}
                isPlaying={isPlaying}
                onTogglePlay={handleTogglePlay}
                onImportVideo={(url, title) => handleImportVideo(url, title)}
                onOpenImportModal={() => setShowImportModal(true)}
                scanProgress={scanProgress}
                blurOverlays={blurOverlays}
                onChangeBlurOverlays={setBlurOverlays}
                showBlurVirtualBorder={showBlurVirtualBorder}
                logoOverlays={logoOverlays}
                onChangeLogoOverlays={setLogoOverlays}
                textOverlays={textOverlays}
                onChangeTextOverlays={setTextOverlays}
                clips={clips}
                activeClipIndex={activeClipIndex}
                onChangeActiveClipIndex={setActiveClipIndex}
              />
            </div>
          </div>

          {/* CapCut Multi-track Timeline Track */}
          <CapCutTimeline
            duration={videoDuration}
            currentTime={currentTime}
            subtitles={subtitles}
            selectedSubtitleId={selectedSubtitleId}
            isVideoSelected={isVideoSelected}
            onSelectVideoBlock={(selected) => {
              setIsVideoSelected(selected);
              if (selected) setSelectedSubtitleId(null);
            }}
            onSeek={handleSeek}
            isPlaying={isPlaying}
            onTogglePlay={handleTogglePlay}
            onSplitSubtitle={handleSplitSubtitle}
            onSelectSubtitle={(sub) => {
              setSelectedSubtitleId(sub ? sub.id : null);
              if (sub) setIsVideoSelected(false);
            }}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={historyIndex > 0}
            canRedo={historyIndex < history.length - 1}
            onUpdateSubtitle={(updated) =>
              setSubtitles((prev) =>
                prev.map((s) => (s.id === updated.id ? updated : s))
              )
            }
            hasVideo={Boolean(videoUrl)}
            videoTitle={projectTitle || 'imported_video.mp4'}
            onOpenImportModal={() => setShowImportModal(true)}
            onImportVideo={(url, title) => handleImportVideo(url, title)}
            onPlayTTS={(text) => handlePlayTTS(text)}
            onExtractSRT={() => {
              handleStartFullScan(0, Math.ceil(videoDuration) || 300, 1.0, '');
            }}
            onImportSRT={(file) => {
              const reader = new FileReader();
              reader.onload = (e) => {
                const content = e.target?.result as string;
                if (content) {
                  const parsed = parseSRT(content);
                  if (parsed.length > 0) {
                    setSubtitles(parsed);
                  }
                }
              };
              reader.readAsText(file);
            }}
            onExtractAudio={() => {
              handleGenerateAllAudio();
            }}
            onImportAudio={(file) => {
              alert(`Đã nhập file audio: ${file.name}`);
            }}
            bgMusicTitle={bgMusicTitle}
            onImportBgMusic={(file) => {
              setBgMusicTitle(file.name);
            }}
            onAddSubtitle={(t) =>
              setSubtitles((prev) => {
                const targetTime = t || currentTime;
                const newSub = {
                  id: `manual-${Date.now()}`,
                  startTime: targetTime,
                  endTime: targetTime + 2.5,
                  originalText: 'Nhập văn bản...',
                  translatedText: 'Nhập bản dịch...',
                };
                const newList = [...prev, newSub].sort((a, b) => a.startTime - b.startTime);
                return resolveOverlapsWithPriority(newList, newSub.id);
              })
            }
          />
        </div>

        {/* 3. CapCut Bottom Function Bar */}
        <CapCutBottomBar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          isVideoSelected={isVideoSelected}
          onSelectVideoBlock={(selected) => setIsVideoSelected(selected)}
          onOpenImportModal={() => setShowImportModal(true)}
          selectedSubtitle={selectedSubtitle}
          onSelectSubtitle={(sub) => {
            setSelectedSubtitleId(sub ? sub.id : null);
            if (sub) setIsVideoSelected(false);
          }}
          videoVolume={videoVolume}
          onChangeVideoVolume={setVideoVolume}
          videoSpeed={videoSpeed}
          onChangeVideoSpeed={setVideoSpeed}
          onUpdateSubtitle={(updated) =>
            setSubtitles((prev) => {
              const updatedList = prev.map((s) => (s.id === updated.id ? updated : s));
              return resolveOverlapsWithPriority(updatedList, updated.id);
            })
          }
          onDeleteSubtitle={(id) => {
            setSubtitles((prev) => prev.filter((s) => s.id !== id));
            if (selectedSubtitleId === id) setSelectedSubtitleId(null);
          }}
          onExtractSingleFrame={handleExtractSingleFrame}
          isExtractingSingle={isExtractingSingle}
          onStartFullScan={handleStartFullScan}
          scanProgress={scanProgress}
          onCancelScan={handleCancelScan}
          videoDuration={videoDuration}
          targetLang={targetLang}
          onSelectTargetLang={setTargetLang}
          selectedModel={selectedModel}
          onSelectModel={onSelectModel}
          onReTranslateAll={handleReTranslateAll}
          customContext={customContext}
          globalContext={globalContext}
          isTranslatingBatch={isTranslatingBatch}
          translationProgressMsg={translationProgressMsg}
          activeSubtitle={activeSubtitle}
          appSettings={appSettings}
          onSaveSettings={onSaveSettings}
          onPlayTTS={handlePlayTTS}
          onMergeShortSubtitles={handleMergeShortSubtitles}
          onGenerateAllAudio={handleGenerateAllAudio}
          isGeneratingAllAudio={isGeneratingAllAudio}
          onGenerateSingleAudio={handleGenerateSingleAudio}
          isGeneratingSingleAudio={isGeneratingSingleAudio}
          onPlaySingleAudio={handlePlaySingleAudio}
          onDeleteSingleAudio={handleDeleteSingleAudio}
          audioGenProgress={audioGenProgress}
          audioPlayWithVideo={audioPlayWithVideo}
          onToggleAudioPlayWithVideo={setAudioPlayWithVideo}
          onClearAllAudio={handleClearAllAudio}
          subtitles={subtitles}
          onAddSubtitle={() =>
            setSubtitles((prev) => {
              const newSub = {
                id: `manual-${Date.now()}`,
                startTime: currentTime,
                endTime: currentTime + 2.5,
                originalText: 'Nhập văn bản gốc...',
                translatedText: 'Nhập bản dịch...',
              };
              const newList = [...prev, newSub].sort((a, b) => a.startTime - b.startTime);
              return resolveOverlapsWithPriority(newList, newSub.id);
            })
          }
          styleConfig={styleConfig}
          onChangeStyle={setStyleConfig}
          onChangeRoi={setRoi}
          onOpenConfigDrawer={() => setShowConfigDrawer(true)}
          onReScanSubtitle={handleReScanSubtitle}
          onUpdateSubtitles={setSubtitles}
          blurOverlays={blurOverlays}
          onChangeBlurOverlays={setBlurOverlays}
          showBlurVirtualBorder={showBlurVirtualBorder}
          onToggleBlurVirtualBorder={setShowBlurVirtualBorder}
          logoOverlays={logoOverlays}
          onChangeLogoOverlays={setLogoOverlays}
          textOverlays={textOverlays}
          onChangeTextOverlays={setTextOverlays}
        />

        {/* Modals */}
        {showImportModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
            <div className="bg-[#18181c] border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-lg p-5 flex flex-col gap-4 shadow-2xl my-auto max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2">
                  <div className="p-1.5 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-xl">
                    <Film className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white">Import / Đổi Video Cho Dự Án</h3>
                    <p className="text-[10px] text-slate-400">Thay đổi video nền và giữ nguyên phụ đề hiện tại</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowImportModal(false);
                    setSelectedFiles([]);
                    setConcatError(null);
                    setExtractError(null);
                    setExtractedData(null);
                  }}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Advanced Import Tab Select Bar */}
              <div className="grid grid-cols-3 bg-[#111114] border border-slate-800/80 p-1.5 rounded-xl text-xs gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setImportTab('file');
                    setConcatError(null);
                  }}
                  className={`py-1.5 rounded-lg transition flex items-center justify-center space-x-1 ${
                    importTab === 'file'
                      ? 'bg-slate-200 text-slate-950 font-extrabold shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Tệp cục bộ</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setImportTab('gendownload');
                    setExtractError(null);
                  }}
                  className={`py-1.5 rounded-lg transition flex items-center justify-center space-x-1 ${
                    importTab === 'gendownload'
                      ? 'bg-sky-500 text-slate-950 font-extrabold shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <DownloadCloud className="w-3.5 h-3.5" />
                  <span>Tải Video</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setImportTab('url');
                    setConcatError(null);
                  }}
                  className={`py-1.5 rounded-lg transition flex items-center justify-center space-x-1 ${
                    importTab === 'url'
                      ? 'bg-slate-800 text-slate-200 border border-slate-700 font-extrabold shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                  <span>Link MP4</span>
                </button>
              </div>

              {/* TAB 1: LOCAL FILE SELECTOR WITH MULTI-VIDEO CONCAT */}
              {importTab === 'file' && (
                <div className="flex flex-col gap-4">
                  {/* Drag-and-drop container */}
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all duration-300 ${
                      isDragging
                        ? 'border-sky-400 bg-sky-950/20 scale-[1.01]'
                        : 'border-slate-800 hover:border-slate-600 bg-[#121215]/50'
                    }`}
                  >
                    <div className="relative z-10 flex flex-col items-center space-y-3">
                      <div className="w-12 h-12 rounded-full bg-slate-800/80 border border-slate-700/60 flex items-center justify-center shadow-inner">
                        <Upload className="w-6 h-6 text-sky-400 animate-pulse" />
                      </div>

                      <div className="space-y-1">
                        <h3 className="text-xs font-extrabold text-white uppercase tracking-wider">
                          Tải lên & Ghép nối Video
                        </h3>
                        <p className="text-[10px] text-slate-400 max-w-sm mx-auto leading-normal">
                          Kéo thả video vào đây hoặc chọn nhiều video để tự động ghép nối thành một video duy nhất cho dự án.
                        </p>
                      </div>

                      <label className="cursor-pointer btn-metallic text-[10px] font-black uppercase tracking-wider px-5 py-2 rounded-xl inline-flex items-center space-x-1.5 shadow-md">
                        <FileVideo className="w-3.5 h-3.5 text-slate-900" />
                        <span>Chọn Video từ thiết bị</span>
                        <input
                          type="file"
                          accept="video/mp4,video/webm,video/quicktime"
                          onChange={handleFileSelect}
                          multiple
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Selected Video List for Reordering */}
                  {selectedFiles.length > 0 && (
                    <div className="bg-[#121215] border border-slate-800 rounded-xl p-3 flex flex-col gap-2 max-h-52 overflow-y-auto">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-1">
                        <div className="flex items-center space-x-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                          <span className="text-[10px] font-black text-slate-300 uppercase tracking-wider">
                            Danh sách Video ghép ({selectedFiles.length})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedFiles([])}
                          className="text-[9px] text-rose-400 hover:text-rose-300 hover:underline font-extrabold uppercase tracking-wide transition-colors"
                        >
                          Xóa tất cả
                        </button>
                      </div>

                      <div className="space-y-1.5">
                        {selectedFiles.map((file, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between bg-[#16161a] border border-slate-800 p-2 rounded-xl text-xs hover:border-slate-700 transition"
                          >
                            <div className="flex items-center space-x-2 min-w-0 flex-1">
                              <span className="text-[9px] bg-slate-800 text-slate-300 font-extrabold w-5 h-5 rounded flex items-center justify-center flex-shrink-0">
                                {idx + 1}
                              </span>
                              <FileVideo className="w-4 h-4 text-sky-400 flex-shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-slate-200 font-semibold text-[11px] leading-tight">
                                  {file.name}
                                </p>
                                <p className="text-[9px] text-slate-500">
                                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center space-x-1 ml-2 flex-shrink-0">
                              <button
                                type="button"
                                disabled={idx === 0 || isConcatenating}
                                onClick={() => handleMoveFile(idx, 'up')}
                                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-20 rounded"
                                title="Lên"
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === selectedFiles.length - 1 || isConcatenating}
                                onClick={() => handleMoveFile(idx, 'down')}
                                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-20 rounded"
                                title="Xuống"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={isConcatenating}
                                onClick={() => handleRemoveFile(idx)}
                                className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded"
                                title="Xóa"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-2 mt-1">
                        <label className="flex-1 cursor-pointer bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 text-slate-300 font-bold text-[10px] py-2 rounded-xl transition text-center flex items-center justify-center space-x-1">
                          <Plus className="w-3.5 h-3.5 text-sky-400" />
                          <span>Thêm video khác...</span>
                          <input
                            type="file"
                            accept="video/mp4,video/webm,video/quicktime"
                            onChange={handleFileSelect}
                            multiple
                            className="hidden"
                          />
                        </label>
                      </div>

                      <button
                        type="button"
                        disabled={isConcatenating}
                        onClick={handleConcatAndImportVideo}
                        className="w-full mt-1 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-95 text-slate-950 font-black text-xs py-2.5 rounded-xl transition flex items-center justify-center space-x-1.5 shadow-md cursor-pointer"
                      >
                        <Check className="w-4 h-4 stroke-[3px]" />
                        <span className="uppercase font-black">XÁC NHẬN GHÉP VÀ ĐỔI VIDEO</span>
                      </button>
                    </div>
                  )}

                  {/* Concatenating Loader */}
                  {isConcatenating && (
                    <div className="bg-[#121215] border border-sky-500/30 rounded-xl p-4 flex flex-col items-center justify-center gap-2.5 text-center shadow-md">
                      <Loader2 className="w-8 h-8 text-sky-400 animate-spin animate-duration-1000" />
                      <div className="space-y-0.5">
                        <p className="text-xs font-black text-white uppercase">Đang gộp và mã hóa video...</p>
                        <p className="text-[9px] text-slate-400 max-w-xs leading-relaxed">
                          Quá trình ghép nối có thể mất vài giây phụ thuộc vào dung lượng video của bạn. Hãy giữ màn hình hoạt động!
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Error Notification */}
                  {concatError && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-xl text-[11px]">
                      {concatError}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: GENDOWNLOAD MULTI-PLATFORM VIDEO DOWNLOADER */}
              {importTab === 'gendownload' && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-1 flex-wrap text-[9px]">
                    <span className="bg-slate-800 text-sky-300 font-mono font-bold px-2 py-0.5 rounded-full border border-sky-500/20 flex items-center space-x-1">
                      <ShieldCheck className="w-3 h-3 text-sky-400" />
                      <span>GenDownload API</span>
                    </span>
                    <span className="bg-slate-900 text-slate-400 px-1.5 py-0.5 rounded-full border border-slate-800">TikTok</span>
                    <span className="bg-slate-900 text-slate-400 px-1.5 py-0.5 rounded-full border border-slate-800">Douyin</span>
                    <span className="bg-slate-900 text-slate-400 px-1.5 py-0.5 rounded-full border border-slate-800">YouTube</span>
                    <span className="bg-slate-900 text-slate-400 px-1.5 py-0.5 rounded-full border border-slate-800">Facebook</span>
                  </div>

                  <form onSubmit={handleExtractVideoWithGenDownload} className="flex flex-col gap-2">
                    <label className="text-[10px] text-slate-300 font-semibold">
                      Dán đường dẫn video từ mạng xã hội:
                    </label>
                    <div className="flex space-x-2">
                      <input
                        type="url"
                        required
                        placeholder="https://v.douyin.com/... hoặc link TikTok / YouTube"
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                        className="flex-1 bg-[#121215] border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-sky-500"
                      />
                      <button
                        type="submit"
                        disabled={isExtracting || !customUrl.trim()}
                        className="bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-black text-[11px] px-3 py-2 rounded-xl transition flex items-center space-x-1"
                      >
                        {isExtracting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Đang bóc...</span>
                          </>
                        ) : (
                          <>
                            <DownloadCloud className="w-3.5 h-3.5" />
                            <span>Lấy Video</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>

                  {/* Error Notification */}
                  {extractError && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-xl text-[11px]">
                      {extractError}
                    </div>
                  )}

                  {/* Extracted Video Result Card */}
                  {extractedData && (
                    <div className="bg-[#121215] border border-sky-500/30 rounded-xl p-3 flex flex-col gap-2 animate-fade-in">
                      <div className="flex items-start space-x-3">
                        {extractedData.thumbnail ? (
                          <img
                            src={extractedData.thumbnail}
                            alt="Preview"
                            className="w-14 h-14 object-cover rounded-lg border border-slate-800 flex-shrink-0"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Film className="w-5 h-5 text-sky-400" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center space-x-1.5 mb-0.5">
                            <span className="text-[8px] bg-sky-500/10 text-sky-400 font-bold px-1.5 py-0.5 rounded border border-sky-500/20 uppercase">
                              {extractedData.platform}
                            </span>
                            <span className="text-[9px] text-slate-400 truncate">{extractedData.author}</span>
                          </div>
                          <h4 className="text-[11px] font-bold text-white line-clamp-2 leading-tight">
                            {extractedData.title}
                          </h4>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleConfirmImportExtracted}
                        className="w-full mt-1 bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-xs py-2.5 rounded-xl transition flex items-center justify-center space-x-1 shadow-md shadow-sky-500/10"
                      >
                        <Check className="w-4 h-4" />
                        <span>XÁC NHẬN ĐỔI SANG VIDEO NÀY</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: DIRECT MP4 URL */}
              {importTab === 'url' && (
                <form onSubmit={handleUrlSubmit} className="flex flex-col gap-2">
                  <label className="text-[10px] text-slate-300 font-semibold">Dán link trực tiếp file video MP4 / WebM:</label>
                  <div className="flex space-x-2">
                    <input
                      type="url"
                      placeholder="https://example.com/video.mp4"
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                      className="flex-1 bg-[#121215] border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-sky-500"
                    />
                    <button
                      type="submit"
                      className="bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold px-4 py-2 rounded-xl transition"
                    >
                      Mở
                    </button>
                  </div>
                </form>
              )}

              {/* Sample Videos Section */}
              <div className="border-t border-slate-800/80 pt-3">
                <h4 className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wide">Dùng Video mẫu có sẵn:</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {SAMPLE_VIDEOS.map((sample) => (
                    <button
                      key={sample.id}
                      onClick={() => {
                        handleImportVideo(sample.url, sample.title, sample.defaultRoi);
                        setShowImportModal(false);
                      }}
                      className="p-2 bg-[#121215] border border-slate-850 hover:border-sky-500 rounded-lg text-left transition flex items-center justify-between"
                    >
                      <span className="text-[11px] font-semibold text-slate-200 truncate pr-2">{sample.title}</span>
                      <span className="text-[8px] bg-sky-500/10 border border-sky-500/20 text-sky-400 px-1.5 py-0.5 rounded font-mono">
                        {sample.language}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}

        <ExportModal
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
          subtitles={subtitles}
          onImportSubtitles={setSubtitles}
          videoUrl={videoUrl}
          videoDuration={videoDuration}
          styleConfig={styleConfig}
          projectTitle={projectTitle}
          onGenerateAllAudio={handleGenerateAllAudio}
          isGeneratingAllAudio={isGeneratingAllAudio}
          ttsSpeed={appSettings?.ttsSpeed || 1.0}
          ttsPitch={appSettings?.ttsPitch || 0}
          videoVolume={videoVolume}
          blurOverlays={blurOverlays}
          logoOverlays={logoOverlays}
          textOverlays={textOverlays}
        />

        {/* Inline Config Drawer styled matching Home screen cards */}
        {showConfigDrawer && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-[#121215] border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md p-4 max-h-[85vh] overflow-y-auto shadow-2xl flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center space-x-2">
                  <div className="p-1.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <Settings className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Cấu Hình Hệ Thống</h3>
                    <p className="text-[10px] text-slate-400">Thay đổi API Key, Engine OCR, Proxy</p>
                  </div>
                </div>

                <button
                  onClick={() => setShowConfigDrawer(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <ConfigView
                settings={appSettings}
                onSaveSettings={onSaveSettings}
              />
            </div>
          </div>
        )}

        <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
      </div>
    </div>
  );
};
