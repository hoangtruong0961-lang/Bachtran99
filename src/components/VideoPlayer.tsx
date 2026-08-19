import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  Crop,
  Play,
  Pause,
  Camera,
  AlertCircle,
  RefreshCw,
  Upload,
  Film,
  Cpu,
  Zap,
  Activity,
  Gauge,
} from 'lucide-react';
import { RegionROI, SubtitleItem, SubtitleStyleConfig, OCRScanProgress, BlurOverlay, LogoOverlay, TextOverlay, VideoClip } from '../types';
import { wrapSubtitleText } from '../utils/srtParser';
import { buildTextShadowStyle, getSubtitleCssStyle } from '../utils/textEffectUtils';
import { OutlinedSubtitleText } from './OutlinedSubtitleText';

interface VideoPlayerProps {
  videoUrl: string;
  roi: RegionROI;
  onChangeRoi: (newRoi: RegionROI) => void;
  activeSubtitle?: SubtitleItem | null;
  isSubtitleSelected?: boolean;
  onSelectSubtitle?: (sub: SubtitleItem | null) => void;
  onUpdateActiveSubtitleBox?: (newBox: { x: number; y: number; width: number; height: number }) => void;
  styleConfig: SubtitleStyleConfig;
  onChangeStyleConfig?: (newStyle: SubtitleStyleConfig) => void;
  onExtractSingleFrame: (currentTime: number, croppedBase64: string) => void;
  isExtractingSingle: boolean;
  onAutoDetectRoi?: () => void;
  isDetectingRoi?: boolean;
  onTimeUpdate?: (currentTime: number) => void;
  onLoadedMetadata?: (duration: number) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  onImportVideo?: (url: string, title?: string, file?: File, preserveExistingSubtitles?: boolean) => void;
  onOpenImportModal?: () => void;
  showRoiBox?: boolean;
  scanProgress?: OCRScanProgress;
  blurOverlays?: BlurOverlay[];
  onChangeBlurOverlays?: (overlays: BlurOverlay[]) => void;
  showBlurVirtualBorder?: boolean;
  logoOverlays?: LogoOverlay[];
  onChangeLogoOverlays?: (overlays: LogoOverlay[]) => void;
  textOverlays?: TextOverlay[];
  onChangeTextOverlays?: (overlays: TextOverlay[]) => void;
  clips?: VideoClip[];
  activeClipIndex?: number;
  onChangeActiveClipIndex?: (index: number) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoUrl,
  roi,
  onChangeRoi,
  activeSubtitle,
  isSubtitleSelected = false,
  onSelectSubtitle,
  onUpdateActiveSubtitleBox,
  styleConfig,
  onChangeStyleConfig,
  onExtractSingleFrame,
  isExtractingSingle,
  onAutoDetectRoi,
  isDetectingRoi,
  onTimeUpdate,
  onLoadedMetadata,
  videoRef,
  isPlaying = false,
  onTogglePlay,
  onImportVideo,
  onOpenImportModal,
  showRoiBox = false,
  scanProgress,
  blurOverlays = [],
  onChangeBlurOverlays,
  showBlurVirtualBorder = true,
  logoOverlays = [],
  onChangeLogoOverlays,
  textOverlays = [],
  onChangeTextOverlays,
  clips,
  activeClipIndex,
  onChangeActiveClipIndex,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);

  const [internalActiveClipIndex, setInternalActiveClipIndex] = useState<number>(0);
  const activeClipIndexActual = activeClipIndex !== undefined ? activeClipIndex : internalActiveClipIndex;
  const setActiveClipIndexActual = onChangeActiveClipIndex !== undefined ? onChangeActiveClipIndex : setInternalActiveClipIndex;

  const clipStartTimes = React.useMemo(() => {
    if (!clips || clips.length === 0) return [0];
    const starts: number[] = [];
    let accum = 0;
    for (const c of clips) {
      starts.push(accum);
      accum += c.duration;
    }
    return starts;
  }, [clips]);

  const totalDuration = React.useMemo(() => {
    if (!clips || clips.length === 0) return 0;
    return clips.reduce((sum, c) => sum + c.duration, 0);
  }, [clips]);

  // Dragging states for custom overlays (Blur, Logo, Text)
  const [dragOverlay, setDragOverlay] = useState<{
    type: 'blur' | 'logo' | 'text';
    id: string;
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se';
    startPos: { x: number; y: number };
    startRect: { x: number; y: number; width: number; height: number };
  } | null>(null);

  const handleStartDragOverlay = (
    e: React.MouseEvent | React.TouchEvent,
    type: 'blur' | 'logo' | 'text',
    id: string,
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se',
    rect: { x: number; y: number; width: number; height: number }
  ) => {
    e.stopPropagation();
    let clientX = 0;
    let clientY = 0;
    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      e.preventDefault();
      clientX = e.clientX;
      clientY = e.clientY;
    } else {
      return;
    }
    const { xPercent, yPercent } = getContainerRelativePosFromClient(clientX, clientY);
    setDragOverlay({
      type,
      id,
      mode,
      startPos: { x: xPercent, y: yPercent },
      startRect: { ...rect },
    });
  };

  useEffect(() => {
    if (!dragOverlay) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      let clientX = 0;
      let clientY = 0;

      if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ('clientX' in e) {
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
      } else {
        return;
      }

      const { xPercent, yPercent } = getContainerRelativePosFromClient(clientX, clientY);
      const deltaX = xPercent - dragOverlay.startPos.x;
      const deltaY = yPercent - dragOverlay.startPos.y;

      const nextRect = { ...dragOverlay.startRect };

      if (dragOverlay.mode === 'move') {
        nextRect.x = Math.max(0, Math.min(100 - dragOverlay.startRect.width, dragOverlay.startRect.x + deltaX));
        nextRect.y = Math.max(0, Math.min(100 - dragOverlay.startRect.height, dragOverlay.startRect.y + deltaY));
      } else if (dragOverlay.mode === 'se') {
        nextRect.width = Math.max(5, Math.min(100 - dragOverlay.startRect.x, dragOverlay.startRect.width + deltaX));
        nextRect.height = Math.max(5, Math.min(100 - dragOverlay.startRect.y, dragOverlay.startRect.height + deltaY));
      } else if (dragOverlay.mode === 'sw') {
        const newX = Math.max(0, Math.min(dragOverlay.startRect.x + dragOverlay.startRect.width - 5, dragOverlay.startRect.x + deltaX));
        nextRect.width = dragOverlay.startRect.width + (dragOverlay.startRect.x - newX);
        nextRect.x = newX;
        nextRect.height = Math.max(5, Math.min(100 - dragOverlay.startRect.y, dragOverlay.startRect.height + deltaY));
      } else if (dragOverlay.mode === 'ne') {
        const newY = Math.max(0, Math.min(dragOverlay.startRect.y + dragOverlay.startRect.height - 5, dragOverlay.startRect.y + deltaY));
        nextRect.height = dragOverlay.startRect.height + (dragOverlay.startRect.y - newY);
        nextRect.y = newY;
        nextRect.width = Math.max(5, Math.min(100 - dragOverlay.startRect.x, dragOverlay.startRect.width + deltaX));
      } else if (dragOverlay.mode === 'nw') {
        const newX = Math.max(0, Math.min(dragOverlay.startRect.x + dragOverlay.startRect.width - 5, dragOverlay.startRect.x + deltaX));
        const newY = Math.max(0, Math.min(dragOverlay.startRect.y + dragOverlay.startRect.height - 5, dragOverlay.startRect.y + deltaY));
        nextRect.width = dragOverlay.startRect.width + (dragOverlay.startRect.x - newX);
        nextRect.height = dragOverlay.startRect.height + (dragOverlay.startRect.y - newY);
        nextRect.x = newX;
        nextRect.y = newY;
      }

      // Update active list
      if (dragOverlay.type === 'blur' && onChangeBlurOverlays) {
        onChangeBlurOverlays(blurOverlays.map(b => b.id === dragOverlay.id ? { ...b, ...nextRect } : b));
      } else if (dragOverlay.type === 'logo' && onChangeLogoOverlays) {
        onChangeLogoOverlays(logoOverlays.map(l => l.id === dragOverlay.id ? { ...l, ...nextRect } : l));
      } else if (dragOverlay.type === 'text' && onChangeTextOverlays) {
        onChangeTextOverlays(textOverlays.map(t => t.id === dragOverlay.id ? { ...t, ...nextRect } : t));
      }
    };

    const handlePointerUp = () => {
      setDragOverlay(null);
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);
    window.addEventListener('touchcancel', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
      window.removeEventListener('touchcancel', handlePointerUp);
    };
  }, [dragOverlay, blurOverlays, logoOverlays, textOverlays]);

  // Active target box for mask and subtitle auto-alignment
  const activeBox = activeSubtitle?.boundingBox || roi;

  // Detect if videoUrl is an iframe embed URL (e.g. YouTube embed)
  const isEmbedUrl = Boolean(
    videoUrl &&
    (videoUrl.includes('youtube.com/embed/') ||
     videoUrl.includes('youtube-nocookie.com/embed/') ||
     videoUrl.includes('player.vimeo.com/video/'))
  );

  // Video fallback CORS and error management
  const [useCrossOrigin, setUseCrossOrigin] = useState<boolean>(
    Boolean(videoUrl && !videoUrl.startsWith('blob:') && !isEmbedUrl)
  );
  const [hasLoadError, setHasLoadError] = useState<boolean>(false);

  useEffect(() => {
    setHasLoadError(false);
    setUseCrossOrigin(Boolean(videoUrl && !videoUrl.startsWith('blob:') && !isEmbedUrl));
  }, [videoUrl, isEmbedUrl]);

  const handleVideoError = () => {
    if (useCrossOrigin) {
      console.warn('Video load error with crossOrigin="anonymous", retrying without crossOrigin...');
      setUseCrossOrigin(false);
      if (videoRef.current) {
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.load();
          }
        }, 50);
      }
    } else if (
      videoUrl &&
      (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) &&
      !videoUrl.includes('/api/proxy-video') &&
      onImportVideo
    ) {
      console.warn('Direct video URL failed to stream, auto-retrying via /api/proxy-video proxy stream...');
      const proxiedUrl = `/api/proxy-video?url=${encodeURIComponent(videoUrl)}`;
      onImportVideo(proxiedUrl, undefined, undefined, true);
    } else {
      console.error('Video element failed to load source:', videoUrl);
      setHasLoadError(true);
    }
  };

  // Helper to calculate RGBA background with opacity
  const getBgColorWithOpacity = (hexColor: string, opacity: number = 65) => {
    if (!hexColor) return `rgba(0, 0, 0, ${opacity / 100})`;
    if (hexColor.startsWith('rgba')) return hexColor;
    let hex = hexColor.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
    const num = parseInt(hex, 16);
    if (isNaN(num)) return `rgba(0, 0, 0, ${opacity / 100})`;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${(opacity / 100).toFixed(2)})`;
  };

  // Exact rendered bounding box of <video> inside containerRef (accounting for object-contain letterboxing/pillarboxing)
  const [videoDisplayRect, setVideoDisplayRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>({ left: 0, top: 0, width: 0, height: 0 });
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null);

  const updateVideoDisplayRect = useCallback(() => {
    if (!containerRef.current || !videoRef.current) return;
    const video = videoRef.current;
    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    const cWidth = containerRect.width;
    const cHeight = containerRect.height;
    const vWidth = video.videoWidth;
    const vHeight = video.videoHeight;

    if (vWidth > 0 && vHeight > 0) {
      const vAspect = vWidth / vHeight;
      setVideoAspectRatio((prev) => (prev !== vAspect ? vAspect : prev));
    }

    if (!cWidth || !cHeight || !vWidth || !vHeight) {
      if (cWidth && cHeight) {
        setVideoDisplayRect({ left: 0, top: 0, width: cWidth, height: cHeight });
      }
      return;
    }

    const containerAspect = cWidth / cHeight;
    const videoAspect = vWidth / vHeight;

    let renderWidth = cWidth;
    let renderHeight = cHeight;
    let renderLeft = 0;
    let renderTop = 0;

    if (Math.abs(videoAspect - containerAspect) > 0.005) {
      if (videoAspect > containerAspect) {
        // Video is wider than container -> letterbox top & bottom
        renderHeight = cWidth / videoAspect;
        renderTop = (cHeight - renderHeight) / 2;
      } else {
        // Video is taller/narrower than container -> pillarbox left & right
        renderWidth = cHeight * videoAspect;
        renderLeft = (cWidth - renderWidth) / 2;
      }
    }

    setVideoDisplayRect({
      left: renderLeft,
      top: renderTop,
      width: renderWidth,
      height: renderHeight,
    });
  }, [videoRef]);

  // Keep videoDisplayRect synchronized on resize, metadata load, video events, or orientation change
  useEffect(() => {
    updateVideoDisplayRect();
    const video = videoRef.current;

    const handleVideoSync = () => {
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        const vAspect = video.videoWidth / video.videoHeight;
        setVideoAspectRatio((prev) => (prev !== vAspect ? vAspect : prev));
      }
      updateVideoDisplayRect();
    };

    if (video) {
      video.addEventListener('loadedmetadata', handleVideoSync);
      video.addEventListener('loadeddata', handleVideoSync);
      video.addEventListener('canplay', handleVideoSync);
      video.addEventListener('playing', handleVideoSync);
      video.addEventListener('resize', handleVideoSync);
    }

    let animFrameId: number;
    const pollForDimensions = () => {
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        const vAspect = video.videoWidth / video.videoHeight;
        setVideoAspectRatio((prev) => (prev !== vAspect ? vAspect : prev));
        updateVideoDisplayRect();
      } else {
        animFrameId = requestAnimationFrame(pollForDimensions);
      }
    };
    pollForDimensions();

    const observer = new ResizeObserver(() => {
      updateVideoDisplayRect();
    });
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    window.addEventListener('resize', updateVideoDisplayRect);
    return () => {
      if (video) {
        video.removeEventListener('loadedmetadata', handleVideoSync);
        video.removeEventListener('loadeddata', handleVideoSync);
        video.removeEventListener('canplay', handleVideoSync);
        video.removeEventListener('playing', handleVideoSync);
        video.removeEventListener('resize', handleVideoSync);
      }
      if (animFrameId) cancelAnimationFrame(animFrameId);
      observer.disconnect();
      window.removeEventListener('resize', updateVideoDisplayRect);
    };
  }, [updateVideoDisplayRect, videoUrl]);

  // Dragging states for ROI box
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragMode, setDragMode] = useState<
    'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e' | null
  >(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [startRoi, setStartRoi] = useState<RegionROI>(roi);

  // Subtitle Overlay Interactive Drag, Scale & Pinch-to-zoom Handling (Mouse & Touch)
  const [isSubDragging, setIsSubDragging] = useState<boolean>(false);
  const [subDragMode, setSubDragMode] = useState<
    'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e' | 'pinch' | null
  >(null);
  const [subDragStart, setSubDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [subStartBox, setSubStartBox] = useState<{ x: number; y: number; width: number; height: number }>({
    x: 10,
    y: 76,
    width: 80,
    height: 20,
  });
  const initialPinchDistRef = useRef<number>(0);
  const pinchStartBoxRef = useRef<{ x: number; y: number; width: number; height: number }>({
    x: 10,
    y: 76,
    width: 80,
    height: 20,
  });

  const startDraggingSub = (
    clientX: number,
    clientY: number,
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e' | 'pinch'
  ) => {
    setIsSubDragging(true);
    setSubDragMode(mode);
    const { xPercent, yPercent } = getContainerRelativePosFromClient(clientX, clientY);
    setSubDragStart({ x: xPercent, y: yPercent });
    const currentBox = activeSubtitle?.boundingBox || roi;
    setSubStartBox(currentBox);
    pinchStartBoxRef.current = currentBox;
  };

  const handleStartDragSubtitle = (
    e: React.MouseEvent | React.TouchEvent,
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'
  ) => {
    e.stopPropagation();
    if ('touches' in e) {
      if (e.touches.length >= 2) {
        // Multi-touch pinch-to-zoom detected
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        initialPinchDistRef.current = dist > 0 ? dist : 1;
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;
        startDraggingSub(midX, midY, 'pinch');
      } else if (e.touches.length === 1) {
        startDraggingSub(e.touches[0].clientX, e.touches[0].clientY, mode);
      }
    } else if ('clientX' in e) {
      e.preventDefault();
      startDraggingSub(e.clientX, e.clientY, mode);
    }
  };

  useEffect(() => {
    if (!isSubDragging || !subDragMode) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      // Prevent browser pull-to-refresh or page dragging during subtitle interaction
      if ('cancelable' in e && e.cancelable) {
        e.preventDefault();
      }

      if ('touches' in e) {
        if (e.touches.length >= 2 && subDragMode === 'pinch') {
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
          const initialDist = initialPinchDistRef.current || 1;
          const scale = currentDist / initialDist;

          const baseBox = pinchStartBoxRef.current;
          const nextWidth = Math.max(10, Math.min(100, Math.round(baseBox.width * scale * 10) / 10));
          const nextHeight = Math.max(4, Math.min(100, Math.round(baseBox.height * scale * 10) / 10));
          const centerX = baseBox.x + baseBox.width / 2;
          const centerY = baseBox.y + baseBox.height / 2;
          const nextX = Math.max(0, Math.min(100 - nextWidth, Math.round((centerX - nextWidth / 2) * 10) / 10));
          const nextY = Math.max(0, Math.min(100 - nextHeight, Math.round((centerY - nextHeight / 2) * 10) / 10));

          if (onUpdateActiveSubtitleBox) {
            onUpdateActiveSubtitleBox({ x: nextX, y: nextY, width: nextWidth, height: nextHeight });
          }
          return;
        }
      }

      let clientX = 0;
      let clientY = 0;

      if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ('clientX' in e) {
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
      } else {
        return;
      }

      const { xPercent, yPercent } = getContainerRelativePosFromClient(clientX, clientY);
      const deltaX = xPercent - subDragStart.x;
      const deltaY = yPercent - subDragStart.y;

      const nextBox = { ...subStartBox };

      if (subDragMode === 'move') {
        nextBox.x = Math.max(0, Math.min(100 - subStartBox.width, subStartBox.x + deltaX));
        nextBox.y = Math.max(0, Math.min(100 - subStartBox.height, subStartBox.y + deltaY));
      } else if (subDragMode === 'se') {
        nextBox.width = Math.max(10, Math.min(100 - subStartBox.x, subStartBox.width + deltaX));
        nextBox.height = Math.max(4, Math.min(100 - subStartBox.y, subStartBox.height + deltaY));
      } else if (subDragMode === 'sw') {
        const newX = Math.max(0, Math.min(subStartBox.x + subStartBox.width - 10, subStartBox.x + deltaX));
        nextBox.width = subStartBox.width + (subStartBox.x - newX);
        nextBox.x = newX;
        nextBox.height = Math.max(4, Math.min(100 - subStartBox.y, subStartBox.height + deltaY));
      } else if (subDragMode === 'ne') {
        const newY = Math.max(0, Math.min(subStartBox.y + subStartBox.height - 4, subStartBox.y + deltaY));
        nextBox.height = subStartBox.height + (subStartBox.y - newY);
        nextBox.y = newY;
        nextBox.width = Math.max(10, Math.min(100 - subStartBox.x, subStartBox.width + deltaX));
      } else if (subDragMode === 'nw') {
        const newX = Math.max(0, Math.min(subStartBox.x + subStartBox.width - 10, subStartBox.x + deltaX));
        const newY = Math.max(0, Math.min(subStartBox.y + subStartBox.height - 4, subStartBox.y + deltaY));
        nextBox.width = subStartBox.width + (subStartBox.x - newX);
        nextBox.height = subStartBox.height + (subStartBox.y - newY);
        nextBox.x = newX;
        nextBox.y = newY;
      } else if (subDragMode === 'n') {
        const newY = Math.max(0, Math.min(subStartBox.y + subStartBox.height - 4, subStartBox.y + deltaY));
        nextBox.height = subStartBox.height + (subStartBox.y - newY);
        nextBox.y = newY;
      } else if (subDragMode === 's') {
        nextBox.height = Math.max(4, Math.min(100 - subStartBox.y, subStartBox.height + deltaY));
      } else if (subDragMode === 'w') {
        const newX = Math.max(0, Math.min(subStartBox.x + subStartBox.width - 10, subStartBox.x + deltaX));
        nextBox.width = subStartBox.width + (subStartBox.x - newX);
        nextBox.x = newX;
      } else if (subDragMode === 'e') {
        nextBox.width = Math.max(10, Math.min(100 - subStartBox.x, subStartBox.width + deltaX));
      }

      if (onUpdateActiveSubtitleBox) {
        onUpdateActiveSubtitleBox(nextBox);
      }
    };

    const handlePointerUp = () => {
      setIsSubDragging(false);
      setSubDragMode(null);
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);
    window.addEventListener('touchcancel', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
      window.removeEventListener('touchcancel', handlePointerUp);
    };
  }, [isSubDragging, subDragMode, subDragStart, subStartBox, onUpdateActiveSubtitleBox]);

  const handleTimeUpdateInternal = () => {
    if (!videoRef.current) return;
    const t = videoRef.current.currentTime;
    
    if (clips && clips.length > 1) {
      const absoluteTime = (clipStartTimes[activeClipIndexActual] || 0) + t;
      setCurrentTime(absoluteTime);
      if (onTimeUpdate) onTimeUpdate(absoluteTime);
    } else {
      setCurrentTime(t);
      if (onTimeUpdate) onTimeUpdate(t);
    }
  };

  const handleLoadedMetadataInternal = () => {
    if (!videoRef.current) return;
    setHasLoadError(false);
    updateVideoDisplayRect();
    const d = videoRef.current.duration;
    if (videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
      setVideoAspectRatio(videoRef.current.videoWidth / videoRef.current.videoHeight);
    }
    
    if (clips && clips.length > 1) {
      if (onLoadedMetadata) onLoadedMetadata(totalDuration);
    } else {
      if (onLoadedMetadata && !isNaN(d)) onLoadedMetadata(d);
    }
  };

  const handleVideoEndedInternal = () => {
    if (clips && clips.length > 1 && activeClipIndexActual < clips.length - 1) {
      const nextIndex = activeClipIndexActual + 1;
      setActiveClipIndexActual(nextIndex);
      
      const nextClip = clips[nextIndex];
      if (videoRef.current) {
        videoRef.current.src = nextClip.url;
        videoRef.current.currentTime = 0;
        if (isPlaying) {
          videoRef.current.play().catch(err => console.warn('[VideoPlayer] Play failed:', err));
        }
      }
    }
  };

  // Helper to crop video frame according to current ROI
  const captureCroppedFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;

    const canvas = document.createElement('canvas');
    const vWidth = video.videoWidth || 1280;
    const vHeight = video.videoHeight || 720;

    const cropX = (roi.x / 100) * vWidth;
    const cropY = (roi.y / 100) * vHeight;
    const cropW = (roi.width / 100) * vWidth;
    const cropH = (roi.height / 100) * vHeight;

    canvas.width = Math.max(10, Math.round(cropW));
    canvas.height = Math.max(10, Math.round(cropH));

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    try {
      ctx.drawImage(
        video,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        canvas.width,
        canvas.height
      );
      return canvas.toDataURL('image/jpeg', 0.92);
    } catch (e) {
      console.error('Error rendering cropped frame to canvas:', e);
      return null;
    }
  }, [roi, videoRef]);

  const handleExtractClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const cropped = captureCroppedFrame();
    if (cropped) {
      onExtractSingleFrame(currentTime, cropped);
    }
  };

  // ROI & Subtitle Interactive Drag & Scale Handling (Mouse & Touch)
  const getContainerRelativePosFromClient = (clientX: number, clientY: number) => {
    if (!containerRef.current) return { xPercent: 0, yPercent: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const video = videoRef.current;

    let vLeft = videoDisplayRect.left;
    let vTop = videoDisplayRect.top;
    let vWidth = videoDisplayRect.width;
    let vHeight = videoDisplayRect.height;

    // Live fallback calculation if state is unpopulated or out of sync
    if ((!vWidth || !vHeight) && video && video.videoWidth > 0 && video.videoHeight > 0 && rect.width > 0 && rect.height > 0) {
      const containerAspect = rect.width / rect.height;
      const videoAspect = video.videoWidth / video.videoHeight;
      if (videoAspect > containerAspect) {
        vWidth = rect.width;
        vHeight = rect.width / videoAspect;
        vLeft = 0;
        vTop = (rect.height - vHeight) / 2;
      } else {
        vWidth = rect.height * videoAspect;
        vHeight = rect.height;
        vLeft = (rect.width - vWidth) / 2;
        vTop = 0;
      }
    }

    const finalWidth = vWidth || rect.width || 1;
    const finalHeight = vHeight || rect.height || 1;

    const clickX = clientX - (rect.left + vLeft);
    const clickY = clientY - (rect.top + vTop);

    const xPercent = Math.max(0, Math.min(100, (clickX / finalWidth) * 100));
    const yPercent = Math.max(0, Math.min(100, (clickY / finalHeight) * 100));

    return { xPercent, yPercent };
  };

  const startDraggingROI = (
    clientX: number,
    clientY: number,
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'
  ) => {
    setIsDragging(true);
    setDragMode(mode);
    const { xPercent, yPercent } = getContainerRelativePosFromClient(clientX, clientY);
    setDragStart({ x: xPercent, y: yPercent });
    setStartRoi({ ...roi });
  };

  const handleStartDrag = (
    e: React.MouseEvent | React.TouchEvent,
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'
  ) => {
    e.stopPropagation();
    if ('touches' in e && e.touches.length > 0) {
      startDraggingROI(e.touches[0].clientX, e.touches[0].clientY, mode);
    } else if ('clientX' in e) {
      e.preventDefault();
      startDraggingROI(e.clientX, e.clientY, mode);
    }
  };

  // Global pointer listeners during active ROI drag
  useEffect(() => {
    if (!isDragging || !dragMode) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      let clientX = 0;
      let clientY = 0;

      if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ('clientX' in e) {
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
      } else {
        return;
      }

      const { xPercent, yPercent } = getContainerRelativePosFromClient(clientX, clientY);
      const deltaX = xPercent - dragStart.x;
      const deltaY = yPercent - dragStart.y;

      const nextRoi = { ...startRoi };

      if (dragMode === 'move') {
        nextRoi.x = Math.max(0, Math.min(100 - startRoi.width, startRoi.x + deltaX));
        nextRoi.y = Math.max(0, Math.min(100 - startRoi.height, startRoi.y + deltaY));
      } else if (dragMode === 'se') {
        nextRoi.width = Math.max(4, Math.min(100 - startRoi.x, startRoi.width + deltaX));
        nextRoi.height = Math.max(3, Math.min(100 - startRoi.y, startRoi.height + deltaY));
      } else if (dragMode === 'sw') {
        const newX = Math.max(0, Math.min(startRoi.x + startRoi.width - 4, startRoi.x + deltaX));
        nextRoi.width = startRoi.width + (startRoi.x - newX);
        nextRoi.x = newX;
        nextRoi.height = Math.max(3, Math.min(100 - startRoi.y, startRoi.height + deltaY));
      } else if (dragMode === 'ne') {
        const newY = Math.max(0, Math.min(startRoi.y + startRoi.height - 3, startRoi.y + deltaY));
        nextRoi.height = startRoi.height + (startRoi.y - newY);
        nextRoi.y = newY;
        nextRoi.width = Math.max(4, Math.min(100 - startRoi.x, startRoi.width + deltaX));
      } else if (dragMode === 'nw') {
        const newX = Math.max(0, Math.min(startRoi.x + startRoi.width - 4, startRoi.x + deltaX));
        const newY = Math.max(0, Math.min(startRoi.y + startRoi.height - 3, startRoi.y + deltaY));
        nextRoi.width = startRoi.width + (startRoi.x - newX);
        nextRoi.height = startRoi.height + (startRoi.y - newY);
        nextRoi.x = newX;
        nextRoi.y = newY;
      } else if (dragMode === 'n') {
        const newY = Math.max(0, Math.min(startRoi.y + startRoi.height - 3, startRoi.y + deltaY));
        nextRoi.height = startRoi.height + (startRoi.y - newY);
        nextRoi.y = newY;
      } else if (dragMode === 's') {
        nextRoi.height = Math.max(3, Math.min(100 - startRoi.y, startRoi.height + deltaY));
      } else if (dragMode === 'w') {
        const newX = Math.max(0, Math.min(startRoi.x + startRoi.width - 4, startRoi.x + deltaX));
        nextRoi.width = startRoi.width + (startRoi.x - newX);
        nextRoi.x = newX;
      } else if (dragMode === 'e') {
        nextRoi.width = Math.max(4, Math.min(100 - startRoi.x, startRoi.width + deltaX));
      }

      nextRoi.x = Math.round(nextRoi.x * 10) / 10;
      nextRoi.y = Math.round(nextRoi.y * 10) / 10;
      nextRoi.width = Math.round(nextRoi.width * 10) / 10;
      nextRoi.height = Math.round(nextRoi.height * 10) / 10;

      onChangeRoi(nextRoi);
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      setDragMode(null);
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);
    window.addEventListener('touchcancel', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
      window.removeEventListener('touchcancel', handlePointerUp);
    };
  }, [isDragging, dragMode, dragStart, startRoi, onChangeRoi]);

  return (
    <div 
      className="w-full h-full max-h-full flex items-center justify-center flex-1 relative isolate min-h-0 overflow-hidden p-0.5 sm:p-1"
    >
      {/* Dynamic Video Preview Frame - Automatically scales and adapts to the video aspect ratio */}
      <div
        ref={containerRef}
        onClick={() => {
          if (!isDragging) onTogglePlay?.();
        }}
        style={{
          aspectRatio: videoAspectRatio ? `${videoAspectRatio}` : undefined,
          maxWidth: '100%',
          maxHeight: '100%',
        }}
        className={`relative bg-black rounded-2xl border border-slate-800 shadow-2xl overflow-hidden select-none cursor-pointer group flex items-center justify-center transition-all duration-300 min-h-0 ${
          videoAspectRatio 
            ? (videoAspectRatio >= 1 ? 'w-full h-auto' : 'h-full w-auto')
            : 'w-full h-full'
        }`}
      >
        {!videoUrl ? (
          <div className="absolute inset-0 z-40 bg-[#0d0e12] flex flex-col items-center justify-center p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-400 shadow-xl shadow-sky-500/10">
              <Upload className="w-8 h-8" />
            </div>
            <div className="space-y-1 max-w-xs">
              <h3 className="text-base font-extrabold text-white">Import Video</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Vui lòng import file video (MP4/WebM) từ thiết bị hoặc chọn từ thư viện để bắt đầu chỉnh sửa.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <label className="cursor-pointer bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-xs px-4 py-2.5 rounded-xl transition shadow-lg shadow-sky-500/20 flex items-center space-x-1.5 active:scale-95">
                <Upload className="w-4 h-4" />
                <span>Import Video Từ Máy</span>
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && onImportVideo) {
                      const url = URL.createObjectURL(file);
                      onImportVideo(url, file.name.replace(/\.[^/.]+$/, ''), file);
                    }
                  }}
                  className="hidden"
                />
              </label>
              {onOpenImportModal && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenImportModal();
                  }}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs px-3.5 py-2.5 rounded-xl transition border border-slate-700 active:scale-95"
                >
                  Chọn Nguồn Khác
                </button>
              )}
            </div>
          </div>
        ) : isEmbedUrl ? (
          <div className="relative w-full h-full flex flex-col items-center justify-center bg-black overflow-hidden">
            <iframe
              src={videoUrl.includes('?') ? videoUrl : `${videoUrl}?autoplay=1`}
              title="Embedded Video Player"
              className="w-full h-full border-0 pointer-events-auto"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
            <div className="absolute top-2 left-2 z-30 bg-slate-900/90 backdrop-blur-md text-amber-300 border border-amber-500/30 text-[11px] px-2.5 py-1 rounded-lg shadow-md flex items-center space-x-1.5 pointer-events-none">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
              <span>Chế độ phát Embed Web (YouTube)</span>
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            src={clips && clips.length > 1 ? clips[activeClipIndexActual].url : videoUrl}
            onTimeUpdate={handleTimeUpdateInternal}
            onLoadedMetadata={handleLoadedMetadataInternal}
            onEnded={handleVideoEndedInternal}
            onError={handleVideoError}
            className="w-full h-full object-contain pointer-events-auto"
            crossOrigin={useCrossOrigin ? 'anonymous' : undefined}
            playsInline
          />
        )}

        {/* Video Load Error Overlay */}
        {hasLoadError && (
          <div className="absolute inset-0 z-40 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-amber-400 animate-pulse" />
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-white">Link video gốc đã hết hạn hoặc không tải được</h4>
              <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                Link video từ mạng (TikTok/Douyin) có token bảo mật hết hạn theo thời gian. Bạn có thể chọn file từ máy hoặc dán link mới để thay thế video nền mà <strong>không bị mất phụ đề</strong>!
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {onImportVideo && (
                <label className="cursor-pointer bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs px-3.5 py-2 rounded-xl transition flex items-center space-x-1.5 shadow-md active:scale-95">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Chọn File Từ Máy (Giữ Phụ Đề)</span>
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setHasLoadError(false);
                        const url = URL.createObjectURL(file);
                        onImportVideo(url, file.name.replace(/\.[^/.]+$/, ''), file, true);
                      }
                    }}
                    className="hidden"
                  />
                </label>
              )}
              {onOpenImportModal && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenImportModal();
                  }}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-xs flex items-center space-x-1.5 transition border border-slate-700 active:scale-95"
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>Dán Link Mới</span>
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setHasLoadError(false);
                  if (videoRef.current) {
                    videoRef.current.load();
                  }
                }}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-xs flex items-center space-x-1.5 transition border border-slate-700/60"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Thử Lại</span>
              </button>
            </div>
          </div>
        )}




        {/* Rendered Video Surface Overlay Container (1:1 aligned with <video> element inside letterboxing) */}
        {!hasLoadError && videoUrl && (
          <div
            className="absolute z-20 pointer-events-none overflow-hidden"
            style={{
              left: `${videoDisplayRect.left}px`,
              top: `${videoDisplayRect.top}px`,
              width: `${videoDisplayRect.width || '100%'}px`,
              height: `${videoDisplayRect.height || '100%'}px`,
            }}
          >
            {/* Blur Overlays */}
            {blurOverlays.map((blur, idx) => {
              const displayHeight = videoDisplayRect.height || 720;
              const blurScale = displayHeight / 720;
              const scaledBlur = (blur.blur || 0) * blurScale;
              const scaledBorderRadius = (blur.borderRadius || 0) * blurScale;
              const isVirtualActive = showBlurVirtualBorder ?? true;

              return (
                <div
                  key={blur.id}
                  onMouseDown={(e) => handleStartDragOverlay(e, 'blur', blur.id, 'move', blur)}
                  onTouchStart={(e) => handleStartDragOverlay(e, 'blur', blur.id, 'move', blur)}
                  onClick={(e) => e.stopPropagation()}
                  className={`absolute z-21 pointer-events-auto touch-none cursor-grab active:cursor-grabbing group/blur transition-all ${
                    isVirtualActive
                      ? 'border-2 border-dashed border-sky-400/90 bg-sky-400/10 shadow-[0_0_10px_rgba(56,189,248,0.35)]'
                      : 'border border-transparent hover:border-sky-400/80'
                  }`}
                  style={{
                    left: `${blur.x}%`,
                    top: `${blur.y}%`,
                    width: `${blur.width}%`,
                    height: `${blur.height}%`,
                    backdropFilter: `blur(${scaledBlur}px)`,
                    WebkitBackdropFilter: `blur(${scaledBlur}px)`,
                    borderRadius: `${scaledBorderRadius}px`,
                  }}
                  title="Vùng làm mờ (Kéo để di chuyển / Chạm góc để thu phóng)"
                >
                  {/* Virtual border badge tag for recognition */}
                  {isVirtualActive && (
                    <div className="absolute -top-5 left-0 bg-sky-500/95 text-white font-black text-[9px] px-1.5 py-0.5 rounded-t shadow pointer-events-none flex items-center space-x-1 whitespace-nowrap opacity-85 group-hover/blur:opacity-100">
                      <span>Viền ảo mờ #{idx + 1}</span>
                    </div>
                  )}

                  {/* 4 Corner Touch Handles for Resizing */}
                  <div
                    onMouseDown={(e) => handleStartDragOverlay(e, 'blur', blur.id, 'nw', blur)}
                    onTouchStart={(e) => handleStartDragOverlay(e, 'blur', blur.id, 'nw', blur)}
                    className={`absolute -top-2 -left-2 w-5 h-5 flex items-center justify-center cursor-nwse-resize z-30 pointer-events-auto touch-none ${
                      isVirtualActive ? 'opacity-90' : 'opacity-0 group-hover/blur:opacity-100'
                    } transition-opacity`}
                  >
                    <div className="w-2.5 h-2.5 bg-sky-400 border border-slate-950 rounded-full shadow" />
                  </div>
                  <div
                    onMouseDown={(e) => handleStartDragOverlay(e, 'blur', blur.id, 'ne', blur)}
                    onTouchStart={(e) => handleStartDragOverlay(e, 'blur', blur.id, 'ne', blur)}
                    className={`absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center cursor-nesw-resize z-30 pointer-events-auto touch-none ${
                      isVirtualActive ? 'opacity-90' : 'opacity-0 group-hover/blur:opacity-100'
                    } transition-opacity`}
                  >
                    <div className="w-2.5 h-2.5 bg-sky-400 border border-slate-950 rounded-full shadow" />
                  </div>
                  <div
                    onMouseDown={(e) => handleStartDragOverlay(e, 'blur', blur.id, 'sw', blur)}
                    onTouchStart={(e) => handleStartDragOverlay(e, 'blur', blur.id, 'sw', blur)}
                    className={`absolute -bottom-2 -left-2 w-5 h-5 flex items-center justify-center cursor-nesw-resize z-30 pointer-events-auto touch-none ${
                      isVirtualActive ? 'opacity-90' : 'opacity-0 group-hover/blur:opacity-100'
                    } transition-opacity`}
                  >
                    <div className="w-2.5 h-2.5 bg-sky-400 border border-slate-950 rounded-full shadow" />
                  </div>
                  <div
                    onMouseDown={(e) => handleStartDragOverlay(e, 'blur', blur.id, 'se', blur)}
                    onTouchStart={(e) => handleStartDragOverlay(e, 'blur', blur.id, 'se', blur)}
                    className={`absolute -bottom-2 -right-2 w-5 h-5 flex items-center justify-center cursor-nwse-resize z-30 pointer-events-auto touch-none ${
                      isVirtualActive ? 'opacity-90' : 'opacity-0 group-hover/blur:opacity-100'
                    } transition-opacity`}
                  >
                    <div className="w-2.5 h-2.5 bg-sky-400 border border-slate-950 rounded-full shadow" />
                  </div>
                </div>
              );
            })}

            {/* Logo Overlays */}
            {logoOverlays.map((logo) => (
              <div
                key={logo.id}
                onMouseDown={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'move', logo)}
                onTouchStart={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'move', logo)}
                onClick={(e) => e.stopPropagation()}
                className="absolute z-22 pointer-events-auto touch-none cursor-grab active:cursor-grabbing border border-transparent hover:border-sky-400/80 group/logo transition-colors"
                style={{
                  left: `${logo.x}%`,
                  top: `${logo.y}%`,
                  width: `${logo.width}%`,
                  height: `${logo.height}%`,
                }}
              >
                <img
                  src={logo.url}
                  className="w-full h-full object-contain pointer-events-none"
                  style={{ opacity: logo.opacity / 100 }}
                  alt="overlay logo"
                  referrerPolicy="no-referrer"
                />
                {/* 4 Corner Touch Handles for Resizing */}
                <div
                  onMouseDown={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'nw', logo)}
                  onTouchStart={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'nw', logo)}
                  className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-sky-400 border border-slate-950 rounded-full cursor-nwse-resize opacity-0 group-hover/logo:opacity-100 transition-opacity"
                />
                <div
                  onMouseDown={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'ne', logo)}
                  onTouchStart={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'ne', logo)}
                  className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-sky-400 border border-slate-950 rounded-full cursor-nesw-resize opacity-0 group-hover/logo:opacity-100 transition-opacity"
                />
                <div
                  onMouseDown={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'sw', logo)}
                  onTouchStart={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'sw', logo)}
                  className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-sky-400 border border-slate-950 rounded-full cursor-nesw-resize opacity-0 group-hover/logo:opacity-100 transition-opacity"
                />
                <div
                  onMouseDown={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'se', logo)}
                  onTouchStart={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'se', logo)}
                  className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-sky-400 border border-slate-950 rounded-full cursor-nwse-resize opacity-0 group-hover/logo:opacity-100 transition-opacity"
                />
              </div>
            ))}

            {/* Text Overlays */}
            {textOverlays.map((textItem) => {
              // Scale font size dynamically with player height
              const displayHeight = videoDisplayRect.height || 360;
              const scaleFactor = displayHeight / 720;
              const actualFontSize = Math.max(8, Math.round(textItem.fontSize * scaleFactor));
              return (
                <div
                  key={textItem.id}
                  onMouseDown={(e) => handleStartDragOverlay(e, 'text', textItem.id, 'move', textItem)}
                  onTouchStart={(e) => handleStartDragOverlay(e, 'text', textItem.id, 'move', textItem)}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute z-23 pointer-events-auto touch-none cursor-grab active:cursor-grabbing border border-transparent hover:border-sky-400/80 group/text flex items-center justify-center text-center p-1 font-bold select-none whitespace-pre-wrap break-all transition-colors"
                  style={{
                    left: `${textItem.x}%`,
                    top: `${textItem.y}%`,
                    width: `${textItem.width}%`,
                    height: `${textItem.height}%`,
                    fontSize: `${actualFontSize}px`,
                    color: textItem.color,
                    backgroundColor: textItem.backgroundColor,
                    opacity: textItem.opacity / 100,
                  }}
                >
                  {textItem.text}
                  {/* 4 Corner Touch Handles for Resizing */}
                  <div
                    onMouseDown={(e) => handleStartDragOverlay(e, 'text', textItem.id, 'nw', textItem)}
                    onTouchStart={(e) => handleStartDragOverlay(e, 'text', textItem.id, 'nw', textItem)}
                    className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-sky-400 border border-slate-950 rounded-full cursor-nwse-resize opacity-0 group-hover/text:opacity-100 transition-opacity"
                  />
                  <div
                    onMouseDown={(e) => handleStartDragOverlay(e, 'text', textItem.id, 'ne', textItem)}
                    onTouchStart={(e) => handleStartDragOverlay(e, 'text', textItem.id, 'ne', textItem)}
                    className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-sky-400 border border-slate-950 rounded-full cursor-nesw-resize opacity-0 group-hover/text:opacity-100 transition-opacity"
                  />
                  <div
                    onMouseDown={(e) => handleStartDragOverlay(e, 'text', textItem.id, 'sw', textItem)}
                    onTouchStart={(e) => handleStartDragOverlay(e, 'text', textItem.id, 'sw', textItem)}
                    className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-sky-400 border border-slate-950 rounded-full cursor-nesw-resize opacity-0 group-hover/text:opacity-100 transition-opacity"
                  />
                  <div
                    onMouseDown={(e) => handleStartDragOverlay(e, 'text', textItem.id, 'se', textItem)}
                    onTouchStart={(e) => handleStartDragOverlay(e, 'text', textItem.id, 'se', textItem)}
                    className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-sky-400 border border-slate-950 rounded-full cursor-nwse-resize opacity-0 group-hover/text:opacity-100 transition-opacity"
                  />
                </div>
              );
            })}

            {/* ROI Box Overlay (White Dashed Border without corner knobs, 8-directional smooth drag/resize zones) - ONLY shown in Extract mode */}
            {showRoiBox && (
              <div className="absolute inset-0 z-20 pointer-events-none">
                <div
                  onMouseDown={(e) => handleStartDrag(e, 'move')}
                  onTouchStart={(e) => handleStartDrag(e, 'move')}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute border-2 border-dashed border-white shadow-[0_0_10px_rgba(0,0,0,0.85)] outline outline-1 outline-black/40 bg-transparent cursor-move transition-all pointer-events-auto rounded-none touch-none group/roi box-border"
                  style={{
                    left: `${roi.x}%`,
                    top: `${roi.y}%`,
                    width: `${roi.width}%`,
                    height: `${roi.height}%`,
                    boxSizing: 'border-box',
                  }}
                >
                  {/* Clean White Label Badge */}
                  <div className="absolute -top-6 left-0 bg-white text-slate-950 font-black text-[10px] px-2 py-0.5 rounded shadow-lg pointer-events-none flex items-center space-x-1 whitespace-nowrap opacity-90 group-hover/roi:opacity-100 transition-opacity">
                    <Crop className="w-3 h-3 text-slate-950" />
                    <span>Vùng Quét OCR {activeSubtitle?.boundingBox ? '(Đã khớp)' : ''}</span>
                  </div>

                  {/* 4 Invisible Corner Resize Hit Areas (No bulky knobs, clean cursor-based resize) */}
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 'nw')}
                    onTouchStart={(e) => handleStartDrag(e, 'nw')}
                    className="absolute -top-3 -left-3 w-7 h-7 cursor-nwse-resize pointer-events-auto touch-none z-30"
                    title="Thu phóng góc trên-trái"
                  />
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 'ne')}
                    onTouchStart={(e) => handleStartDrag(e, 'ne')}
                    className="absolute -top-3 -right-3 w-7 h-7 cursor-nesw-resize pointer-events-auto touch-none z-30"
                    title="Thu phóng góc trên-phải"
                  />
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 'sw')}
                    onTouchStart={(e) => handleStartDrag(e, 'sw')}
                    className="absolute -bottom-3 -left-3 w-7 h-7 cursor-nesw-resize pointer-events-auto touch-none z-30"
                    title="Thu phóng góc dưới-trái"
                  />
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 'se')}
                    onTouchStart={(e) => handleStartDrag(e, 'se')}
                    className="absolute -bottom-3 -right-3 w-7 h-7 cursor-nwse-resize pointer-events-auto touch-none z-30"
                    title="Thu phóng góc dưới-phải"
                  />

                  {/* 4 Invisible Edge Resize Hit Areas (Top, Bottom, Left, Right) */}
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 'n')}
                    onTouchStart={(e) => handleStartDrag(e, 'n')}
                    className="absolute -top-2 inset-x-4 h-4 cursor-ns-resize pointer-events-auto touch-none z-20"
                    title="Kéo chỉnh cạnh trên"
                  />
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 's')}
                    onTouchStart={(e) => handleStartDrag(e, 's')}
                    className="absolute -bottom-2 inset-x-4 h-4 cursor-ns-resize pointer-events-auto touch-none z-20"
                    title="Kéo chỉnh cạnh dưới"
                  />
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 'w')}
                    onTouchStart={(e) => handleStartDrag(e, 'w')}
                    className="absolute -left-2 inset-y-4 w-4 cursor-ew-resize pointer-events-auto touch-none z-20"
                    title="Kéo chỉnh cạnh trái"
                  />
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 'e')}
                    onTouchStart={(e) => handleStartDrag(e, 'e')}
                    className="absolute -right-2 inset-y-4 w-4 cursor-ew-resize pointer-events-auto touch-none z-20"
                    title="Kéo chỉnh cạnh phải"
                  />
                </div>
              </div>
            )}

            {/* Active Subtitle Overlay - Touch Draggable & Scalable (Applies to all subtitles) */}
            {activeSubtitle && (() => {
              const isVertical = styleConfig.orientation === 'vertical';
              const activeText = activeSubtitle.translatedText || activeSubtitle.originalText;
              const formattedText = wrapSubtitleText(
                activeText,
                styleConfig.orientation || 'horizontal',
                styleConfig.maxCharsHorizontal || 65,
                styleConfig.maxCharsVertical || 36
              );

              const outlineCol = styleConfig.outlineColor || '#ffffff';
              
              // Dynamic scaling factor relative to standard 720p resolution
              const displayHeight = videoDisplayRect.height || 360;
              const scaleFactor = displayHeight / 720;
              const previewFontSize = Math.max(10, Math.round((styleConfig.fontSize || 22) * scaleFactor));
              const previewPadding = styleConfig.hasBackground !== false
                ? `${Math.max(2, Math.round((styleConfig.padding || 6) * scaleFactor))}px`
                : '0px';
              const previewBorderRadius = `${Math.max(2, Math.round((styleConfig.borderRadius ?? 8) * scaleFactor))}px`;

              const dynamicCssStyle = getSubtitleCssStyle(styleConfig, scaleFactor);

              const displayBox = activeSubtitle.boundingBox || roi;

              const textCasingCss = styleConfig.textTransform === 'uppercase' 
                ? 'uppercase' 
                : styleConfig.textTransform === 'lowercase' 
                ? 'lowercase' 
                : styleConfig.textTransform === 'capitalize' 
                ? 'capitalize' 
                : 'none';

              return (
                <div
                  onClick={(e) => {
                    if (!isSubtitleSelected && onSelectSubtitle && activeSubtitle) {
                      e.stopPropagation();
                      onSelectSubtitle(activeSubtitle);
                    }
                  }}
                  onMouseDown={(e) => {
                    if (isSubtitleSelected) handleStartDragSubtitle(e, 'move');
                  }}
                  onTouchStart={(e) => {
                    if (isSubtitleSelected) handleStartDragSubtitle(e, 'move');
                  }}
                  className={`absolute z-30 select-none flex flex-col items-center justify-center text-center p-0.5 rounded border box-border ${
                    isSubtitleSelected
                      ? `pointer-events-auto touch-none group/sub border-dashed border-white/90 shadow-[0_0_8px_rgba(0,0,0,0.8)] outline outline-1 outline-black/40 ${
                          isSubDragging
                            ? 'cursor-grabbing border-white bg-white/10 ring-1 ring-cyan-400/50'
                            : 'cursor-grab hover:border-white hover:bg-white/5 active:cursor-grabbing'
                        }`
                      : 'pointer-events-auto cursor-pointer border-transparent hover:border-white/30'
                  }`}
                  title={
                    isSubtitleSelected
                      ? 'Kéo di chuyển hoặc chạm các góc/cạnh nét đứt màu trắng để thu phóng phụ đề (Áp dụng toàn bộ)'
                      : 'Nhấn để chọn và tùy chỉnh phụ đề'
                  }
                  style={{
                    left: `${displayBox.x}%`,
                    top: `${displayBox.y}%`,
                    width: `${displayBox.width}%`,
                    minHeight: `${displayBox.height}%`,
                    boxSizing: 'border-box',
                  }}
                >
                  {/* 4 Corner Touch Resizing Handles with Compact Sleek White Discs (Only when selected) */}
                  {isSubtitleSelected && (
                    <React.Fragment>
                      {/* Top-Left */}
                      <div
                        onMouseDown={(e) => handleStartDragSubtitle(e, 'nw')}
                        onTouchStart={(e) => handleStartDragSubtitle(e, 'nw')}
                        className="absolute -top-2.5 -left-2.5 w-6 h-6 flex items-center justify-center cursor-nwse-resize pointer-events-auto touch-none z-40 group/nw"
                        title="Thu phóng góc trên-trái"
                      >
                        <div className="w-2.5 h-2.5 bg-white border border-slate-950 rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.8)] transition-transform group-hover/nw:scale-125 active:scale-140 active:bg-cyan-300 ring-1 ring-white/50" />
                      </div>

                      {/* Top-Right */}
                      <div
                        onMouseDown={(e) => handleStartDragSubtitle(e, 'ne')}
                        onTouchStart={(e) => handleStartDragSubtitle(e, 'ne')}
                        className="absolute -top-2.5 -right-2.5 w-6 h-6 flex items-center justify-center cursor-nesw-resize pointer-events-auto touch-none z-40 group/ne"
                        title="Thu phóng góc trên-phải"
                      >
                        <div className="w-2.5 h-2.5 bg-white border border-slate-950 rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.8)] transition-transform group-hover/ne:scale-125 active:scale-140 active:bg-cyan-300 ring-1 ring-white/50" />
                      </div>

                      {/* Bottom-Left */}
                      <div
                        onMouseDown={(e) => handleStartDragSubtitle(e, 'sw')}
                        onTouchStart={(e) => handleStartDragSubtitle(e, 'sw')}
                        className="absolute -bottom-2.5 -left-2.5 w-6 h-6 flex items-center justify-center cursor-nesw-resize pointer-events-auto touch-none z-40 group/sw"
                        title="Thu phóng góc dưới-trái"
                      >
                        <div className="w-2.5 h-2.5 bg-white border border-slate-950 rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.8)] transition-transform group-hover/sw:scale-125 active:scale-140 active:bg-cyan-300 ring-1 ring-white/50" />
                      </div>

                      {/* Bottom-Right */}
                      <div
                        onMouseDown={(e) => handleStartDragSubtitle(e, 'se')}
                        onTouchStart={(e) => handleStartDragSubtitle(e, 'se')}
                        className="absolute -bottom-2.5 -right-2.5 w-6 h-6 flex items-center justify-center cursor-nwse-resize pointer-events-auto touch-none z-40 group/se"
                        title="Thu phóng góc dưới-phải"
                      >
                        <div className="w-2.5 h-2.5 bg-white border border-slate-950 rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.8)] transition-transform group-hover/se:scale-125 active:scale-140 active:bg-cyan-300 ring-1 ring-white/50" />
                      </div>

                      {/* 4 Edge Touch Handles (Top, Bottom, Left, Right) */}
                      {/* Top Edge */}
                      <div
                        onMouseDown={(e) => handleStartDragSubtitle(e, 'n')}
                        onTouchStart={(e) => handleStartDragSubtitle(e, 'n')}
                        className="absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-4 flex items-center justify-center cursor-ns-resize pointer-events-auto touch-none z-40 group/n"
                        title="Kéo chỉnh chiều cao trên"
                      >
                        <div className="w-3.5 h-1 bg-white border border-slate-950 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.8)] transition-transform group-hover/n:scale-125 active:bg-cyan-300" />
                      </div>

                      {/* Bottom Edge */}
                      <div
                        onMouseDown={(e) => handleStartDragSubtitle(e, 's')}
                        onTouchStart={(e) => handleStartDragSubtitle(e, 's')}
                        className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-4 flex items-center justify-center cursor-ns-resize pointer-events-auto touch-none z-40 group/s"
                        title="Kéo chỉnh chiều cao dưới"
                      >
                        <div className="w-3.5 h-1 bg-white border border-slate-950 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.8)] transition-transform group-hover/s:scale-125 active:bg-cyan-300" />
                      </div>

                      {/* Left Edge */}
                      <div
                        onMouseDown={(e) => handleStartDragSubtitle(e, 'w')}
                        onTouchStart={(e) => handleStartDragSubtitle(e, 'w')}
                        className="absolute top-1/2 -translate-y-1/2 -left-2 w-4 h-8 flex items-center justify-center cursor-ew-resize pointer-events-auto touch-none z-40 group/w"
                        title="Kéo chỉnh chiều rộng trái"
                      >
                        <div className="w-1 h-3.5 bg-white border border-slate-950 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.8)] transition-transform group-hover/w:scale-125 active:bg-cyan-300" />
                      </div>

                      {/* Right Edge */}
                      <div
                        onMouseDown={(e) => handleStartDragSubtitle(e, 'e')}
                        onTouchStart={(e) => handleStartDragSubtitle(e, 'e')}
                        className="absolute top-1/2 -translate-y-1/2 -right-2 w-4 h-8 flex items-center justify-center cursor-ew-resize pointer-events-auto touch-none z-40 group/e"
                        title="Kéo chỉnh chiều rộng phải"
                      >
                        <div className="w-1 h-3.5 bg-white border border-slate-950 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.8)] transition-transform group-hover/e:scale-125 active:bg-cyan-300" />
                      </div>
                    </React.Fragment>
                  )}

                  <div className={`text-center w-full flex ${isVertical ? 'flex-row items-center justify-center' : 'flex-col items-center'} gap-1.5 drop-shadow-lg px-1 py-0.5`}>
                    {formattedText ? (
                      <OutlinedSubtitleText
                        text={formattedText}
                        styleConfig={styleConfig}
                        scaleFactor={scaleFactor}
                        timestamps={activeSubtitle.timestamps}
                        currentTime={currentTime}
                        startTime={activeSubtitle.startTime}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* CapCut-style AI Laser Scanning Overlay HUD during OCR analysis */}
        {scanProgress && (scanProgress.status === 'scanning' || scanProgress.status === 'translating') && (
          <div className="absolute inset-0 z-50 bg-slate-950/70 backdrop-blur-md flex flex-col items-center justify-center p-6 text-white select-none pointer-events-auto">
            {/* Animated Laser Grid & Scanner Beam */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
              <div className="w-full h-full bg-[linear-gradient(to_right,#0284c7_1px,transparent_1px),linear-gradient(to_bottom,#0284c7_1px,transparent_1px)] bg-[size:24px_24px]" />
              <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_15px_#22d3ee] animate-pulse" style={{ top: `${(scanProgress.percentage || 10) % 100}%` }} />
            </div>

            {/* Glowing Spinner Center */}
            <div className="relative mb-5 flex items-center justify-center">
              <div className="w-16 h-16 rounded-full border-4 border-cyan-500/20 border-t-cyan-400 animate-spin" />
              <div className="absolute w-10 h-10 rounded-full border-2 border-emerald-500/30 border-b-emerald-400 animate-spin" style={{ animationDirection: 'reverse' }} />
              <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin absolute" />
            </div>

            {/* Message & Stats */}
            <div className="text-center w-full max-w-md space-y-4 relative z-10">
              <div>
                <h3 className="text-sm font-black tracking-wide text-cyan-300 uppercase flex items-center justify-center gap-1.5">
                  <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
                  <span>Hệ thống phân tích PaddleOCR Wasm</span>
                </h3>
                <p className="text-xs text-slate-300 font-medium line-clamp-2 px-2 mt-1 min-h-[2rem]">
                  {scanProgress.message}
                </p>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1">
                <div className="w-full bg-slate-800/80 h-2.5 rounded-full overflow-hidden border border-slate-700/50 shadow-inner">
                  <div
                    className="bg-gradient-to-r from-cyan-500 via-emerald-400 to-cyan-300 h-full transition-all duration-300"
                    style={{ width: `${scanProgress.percentage}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 px-0.5">
                  <span className="text-cyan-400 font-bold">{scanProgress.percentage}% HOÀN THÀNH</span>
                  <span>Khung: {scanProgress.currentFrame}/{Math.max(scanProgress.currentFrame, scanProgress.totalFrames)}</span>
                </div>
              </div>

              {/* Real-time Diagnostics Monitor Panel */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                {/* 1. FPS / Speed Card */}
                <div className="bg-slate-900/95 border border-slate-800 rounded-xl p-3 text-left space-y-1.5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-1 opacity-[0.03]">
                    <Gauge className="w-12 h-12 text-white" />
                  </div>
                  <div className="flex items-center space-x-1.5 text-[9px] uppercase tracking-wider text-slate-400 font-bold">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>Tốc độ quét</span>
                  </div>
                  <div className="flex items-baseline space-x-1">
                    <span className="text-lg font-extrabold font-mono text-white">
                      {typeof scanProgress.fps === 'number' ? scanProgress.fps.toFixed(1) : '0.0'}
                    </span>
                    <span className="text-[9px] text-slate-400 font-semibold">FPS</span>
                  </div>
                  {/* Performance drop warnings */}
                  {typeof scanProgress.fps === 'number' && (
                    <div className="flex items-center space-x-1 text-[8px] font-bold">
                      {scanProgress.fps < 10 ? (
                        <span className="text-rose-400 bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-800/30">
                          ⚠️ Trễ hệ thống (Yếu)
                        </span>
                      ) : scanProgress.fps < 20 ? (
                        <span className="text-amber-400 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/30">
                          ⚡ Ổn định (Trung bình)
                        </span>
                      ) : (
                        <span className="text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-800/30">
                          🚀 Tối ưu (Cực nhanh)
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* 2. Worker Thread CPU Usage Card */}
                <div className="bg-slate-900/95 border border-slate-800 rounded-xl p-3 text-left space-y-1.5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-1 opacity-[0.03]">
                    <Cpu className="w-12 h-12 text-white" />
                  </div>
                  <div className="flex items-center space-x-1.5 text-[9px] uppercase tracking-wider text-slate-400 font-bold">
                    <Cpu className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                    <span>Hiệu dụng CPU</span>
                  </div>
                  <div className="flex items-baseline space-x-1">
                    <span className="text-lg font-extrabold font-mono text-white">
                      {typeof scanProgress.cpuUsage === 'number' ? scanProgress.cpuUsage : '0'}%
                    </span>
                    <span className="text-[9px] text-slate-400 font-semibold">TẢI TRỌNG</span>
                  </div>
                  <div className="space-y-1">
                    {/* Tiny visual progress bar representing worker CPU threads */}
                    <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-cyan-400 transition-all duration-300"
                        style={{ width: `${scanProgress.cpuUsage || 0}%` }}
                      />
                    </div>
                    {typeof scanProgress.activeWorkers === 'number' && typeof scanProgress.totalWorkers === 'number' && (
                      <div className="text-[8px] text-slate-400 font-semibold font-mono flex justify-between">
                        <span>Luồng bận:</span>
                        <span className="text-cyan-300">{scanProgress.activeWorkers}/{scanProgress.totalWorkers}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
