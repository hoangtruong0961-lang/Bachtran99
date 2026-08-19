import React, { useRef, useState, useEffect } from 'react';
import {
  Play,
  Pause,
  ZoomIn,
  ZoomOut,
  Scissors,
  Type,
  Volume2,
  Subtitles,
  Film,
  Upload,
  Mic,
  Headphones,
  Music2,
  ChevronDown,
  Undo,
  Redo,
  Captions,
  Lock,
  Unlock,
  Maximize2,
} from 'lucide-react';
import { SubtitleItem } from '../types';

interface CapCutTimelineProps {
  duration: number;
  currentTime: number;
  subtitles: SubtitleItem[];
  selectedSubtitleId: string | null;
  isVideoSelected?: boolean;
  onSelectVideoBlock?: (selected: boolean) => void;
  onSeek: (time: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onAddSubtitle?: (time?: number) => void;
  onSplitSubtitle?: (time: number) => void;
  onSelectSubtitle?: (sub: SubtitleItem | null) => void;
  onUpdateSubtitle?: (updated: SubtitleItem) => void;
  hasVideo?: boolean;
  videoTitle?: string;
  onOpenImportModal?: () => void;
  onImportVideo?: (url: string, title?: string) => void;
  onPlayTTS?: (text: string) => void;
  // Track Popover Actions
  onExtractSRT?: () => void;
  onImportSRT?: (file: File) => void;
  onExtractAudio?: () => void;
  onImportAudio?: (file: File) => void;
  bgMusicTitle?: string;
  onImportBgMusic?: (file: File) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

const formatMMSS = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const mm = m < 10 ? `0${m}` : `${m}`;
  const ss = s < 10 ? `0${s}` : `${s}`;
  return `${mm}:${ss}`;
};

const formatTimeLabel = (seconds: number, step: number): string => {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const mm = m < 10 ? `0${m}` : `${m}`;
  const ss = s < 10 ? `0${s}` : `${s}`;

  if (step < 1) {
    const tenths = Math.floor((seconds % 1) * 10);
    return `${mm}:${ss}.${tenths}`;
  }
  return `${mm}:${ss}`;
};

export const CapCutTimeline: React.FC<CapCutTimelineProps> = ({
  duration,
  currentTime,
  subtitles,
  selectedSubtitleId,
  isVideoSelected = false,
  onSelectVideoBlock,
  onSeek,
  isPlaying,
  onTogglePlay,
  onAddSubtitle,
  onSplitSubtitle,
  onSelectSubtitle,
  onUpdateSubtitle,
  hasVideo = true,
  videoTitle = 'imported_video.mp4',
  onOpenImportModal,
  onImportVideo,
  onPlayTTS,
  onExtractSRT,
  onImportSRT,
  onExtractAudio,
  onImportAudio,
  bgMusicTitle,
  onImportBgMusic,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // Hidden File Inputs
  const srtInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const bgMusicInputRef = useRef<HTMLInputElement | null>(null);

  // Track header popover dropdown state
  const [activeHeaderPopover, setActiveHeaderPopover] = useState<'subtitle' | 'audio' | 'music' | null>(null);

  // Zoom scale multiplier (1x = fit, 1.5x, up to 30x)
  const [zoom, setZoom] = useState<number>(20);
  const [containerWidth, setContainerWidth] = useState<number>(800);

  // Zoom lock state: Lock zoom by default so swiping/scrolling on touch/trackpads NEVER auto-zooms
  const [isZoomLocked, setIsZoomLocked] = useState<boolean>(true);

  // Programmatic scroll flag to avoid scroll feedback loops
  const isProgrammaticScrollRef = useRef<boolean>(false);
  const lastProgrammaticScrollTimeRef = useRef<number>(0);
  const isUserScrollingRef = useRef<boolean>(false);
  const userScrollTimeoutRef = useRef<any>(null);

  // Mouse drag-to-scroll scrubbing state
  const [isMouseDown, setIsMouseDown] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startScrollLeftRef = useRef<number>(0);

  // Measure timeline container width dynamically for pixel-perfect playhead alignment
  useEffect(() => {
    if (!containerRef.current) return;
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth || 800);
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Calculate playhead offset: playhead aligns with exactly 50% center of the timeline bar
  const playheadOffset = containerWidth / 2;

  // Dragging state for Left/Right handles or whole block move on selected subtitle clip
  const [draggingState, setDraggingState] = useState<{
    subId: string;
    type: 'left' | 'right' | 'move';
    initialClickTime?: number;
    initialStartTime?: number;
    initialEndTime?: number;
  } | null>(null);

  const subtitlesRef = useRef<SubtitleItem[]>(subtitles);
  useEffect(() => {
    subtitlesRef.current = subtitles;
  }, [subtitles]);

  const hasDraggedRef = useRef<boolean>(false);
  const dragStartXRef = useRef<number>(0);

  // Touch gesture state for pinch-to-zoom
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef<number>(1);
  const isPinchingRef = useRef<boolean>(false);

  const safeDuration = duration && duration > 0 ? duration : 60;

  // Sync scrollLeft with currentTime so the white playhead remains fixed in the center
  useEffect(() => {
    if (!containerRef.current) return;
    // Skip programmatic scroll if the user is actively scrolling/scrubbing and the video is paused
    if (isUserScrollingRef.current && !isPlaying) return;

    const trackWidth = containerWidth * zoom;
    const targetScroll = Math.max(0, (currentTime / safeDuration) * trackWidth);

    if (Math.abs(containerRef.current.scrollLeft - targetScroll) > 0.5) {
      isProgrammaticScrollRef.current = true;
      lastProgrammaticScrollTimeRef.current = Date.now();
      containerRef.current.scrollLeft = targetScroll;
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    }
  }, [currentTime, safeDuration, zoom, containerWidth, isPlaying]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
      }
    };
  }, []);

  // Handle user timeline scrolling / scrubbing to seek currentTime
  const handleScroll = () => {
    if (!containerRef.current) return;

    // Reject delayed browser scroll events from programmatic scrolling
    const timeSinceProgrammatic = Date.now() - lastProgrammaticScrollTimeRef.current;
    if (isProgrammaticScrollRef.current || timeSinceProgrammatic < 80) {
      return;
    }

    // IF VIDEO IS PLAYING AND USER STARTS SCROLLING/DRAGGING, IMMEDIATELY PAUSE VIDEO!
    if (isPlaying) {
      onTogglePlay();
      return;
    }

    // Set scrubbing state so programmatic scroll sync yields
    isUserScrollingRef.current = true;
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current);
    }
    userScrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 150);

    // HARD LOCK: Never allow scrollLeft < 0 (before 00:00)
    if (containerRef.current.scrollLeft < 0) {
      containerRef.current.scrollLeft = 0;
      onSeek(0);
      return;
    }

    const trackWidth = containerWidth * zoom;
    if (trackWidth <= 0) return;

    const currentScroll = Math.max(0, containerRef.current.scrollLeft);
    const calculatedTime = (currentScroll / trackWidth) * safeDuration;
    const clampedTime = Math.max(0, Math.min(safeDuration, calculatedTime));

    onSeek(Number(clampedTime.toFixed(2)));
  };

  // Mouse drag to scroll / scrub timeline on desktop
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (isPlaying) {
      onTogglePlay();
    }
    setIsMouseDown(true);
    startXRef.current = e.clientX;
    if (containerRef.current) {
      startScrollLeftRef.current = Math.max(0, containerRef.current.scrollLeft);
    }
  };

  useEffect(() => {
    if (!isMouseDown) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const dx = e.clientX - startXRef.current;
      // HARD LOCK: Clamp newScrollLeft to minimum 0 so user cannot scrub before 00:00
      const newScrollLeft = Math.max(0, startScrollLeftRef.current - dx);
      containerRef.current.scrollLeft = newScrollLeft;
    };

    const handleMouseUp = () => {
      setIsMouseDown(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isMouseDown]);

  // Handle drag handles for adjusting subtitle start/end times directly on timeline
  const handleStartDragHandle = (
    e: React.MouseEvent | React.TouchEvent,
    sub: SubtitleItem,
    type: 'left' | 'right' | 'move'
  ) => {
    e.stopPropagation();
    if ('cancelable' in e && e.cancelable) {
      e.preventDefault();
    }
    if (isPlaying) {
      onTogglePlay();
    }
    if (!trackRef.current) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const rect = trackRef.current.getBoundingClientRect();
    const trackWidth = containerWidth * zoom;

    const clickX = Math.max(0, Math.min(trackWidth, clientX - rect.left - playheadOffset));
    const clickTime = (clickX / trackWidth) * safeDuration;

    hasDraggedRef.current = false;
    dragStartXRef.current = clientX;

    setDraggingState({
      subId: sub.id,
      type,
      initialClickTime: clickTime,
      initialStartTime: sub.startTime,
      initialEndTime: sub.endTime,
    });
    if (onSelectSubtitle) onSelectSubtitle(sub);
  };

  useEffect(() => {
    if (!draggingState) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if ('cancelable' in e && e.cancelable) {
        e.preventDefault();
      }
      if (!trackRef.current || !onUpdateSubtitle) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      if (Math.abs(clientX - dragStartXRef.current) > 3) {
        hasDraggedRef.current = true;
      }

      const rect = trackRef.current.getBoundingClientRect();
      const trackWidth = containerWidth * zoom;

      const clickX = Math.max(0, Math.min(trackWidth, clientX - rect.left - playheadOffset));
      const targetTime = (clickX / trackWidth) * safeDuration;

      const currentSub = subtitlesRef.current.find((s) => s.id === draggingState.subId);
      if (!currentSub) return;

      // FLEXIBLE DRAGGING: Subtitles can be moved and resized freely across the safe duration boundary, utilizing dynamic lanes
      if (draggingState.type === 'left') {
        const newStart = Math.max(0, Math.min(targetTime, currentSub.endTime - 0.1));
        onUpdateSubtitle({ ...currentSub, startTime: Number(newStart.toFixed(2)) });
      } else if (draggingState.type === 'right') {
        const newEnd = Math.min(safeDuration, Math.max(targetTime, currentSub.startTime + 0.1));
        onUpdateSubtitle({ ...currentSub, endTime: Number(newEnd.toFixed(2)) });
      } else if (
        draggingState.type === 'move' &&
        draggingState.initialClickTime !== undefined &&
        draggingState.initialStartTime !== undefined &&
        draggingState.initialEndTime !== undefined
      ) {
        const delta = targetTime - draggingState.initialClickTime;
        const dur = draggingState.initialEndTime - draggingState.initialStartTime;

        let newStart = Math.max(0, draggingState.initialStartTime! + delta);
        let newEnd = newStart + dur;

        if (newEnd > safeDuration) {
          newEnd = safeDuration;
          newStart = Math.max(0, safeDuration - dur);
        }

        onUpdateSubtitle({
          ...currentSub,
          startTime: Number(newStart.toFixed(2)),
          endTime: Number(newEnd.toFixed(2)),
        });
      }
    };

    const handlePointerUp = () => {
      setDraggingState(null);
      setTimeout(() => {
        hasDraggedRef.current = false;
      }, 150);
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
  }, [draggingState, safeDuration, onUpdateSubtitle, containerWidth, zoom, playheadOffset]);

  // Handle click on timeline to seek
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (draggingState || !trackRef.current) return;
    if (isPlaying) {
      onTogglePlay();
    }
    const rect = trackRef.current.getBoundingClientRect();
    const trackWidth = containerWidth * zoom;

    const clickX = e.clientX - rect.left - playheadOffset;
    const clampedX = Math.max(0, Math.min(trackWidth, clickX));
    const targetTime = (clampedX / trackWidth) * safeDuration;
    onSeek(Math.max(0, Number(targetTime.toFixed(2))));
  };

  // Wheel zoom handling: require Ctrl / Cmd AND unlocked zoom, otherwise strictly scroll
  const handleWheel = (e: React.WheelEvent) => {
    // Prevent zoom when dragging to scroll or dragging block/handle
    if (isMouseDown || draggingState) {
      return;
    }

    // If Zoom is locked or Ctrl/Cmd is NOT pressed, perform standard horizontal scrolling
    if (isZoomLocked || (!e.ctrlKey && !e.metaKey)) {
      if (containerRef.current) {
        const scrollDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (Math.abs(scrollDelta) > 0) {
          containerRef.current.scrollLeft += scrollDelta;
          e.preventDefault();
        }
      }
      return;
    }

    // Only zoom if Zoom is explicitly UNLOCKED, Ctrl/Cmd is held, and deltaY is a distinct vertical pinch
    if (!isZoomLocked && (e.ctrlKey || e.metaKey) && Math.abs(e.deltaY) > 10 && Math.abs(e.deltaX) < 5) {
      e.preventDefault();
      const zoomFactor = -e.deltaY * 0.003;
      setZoom((prev) => {
        const factor = Math.exp(zoomFactor);
        const nextZoom = prev * factor;
        return Math.max(3, Math.min(75, nextZoom));
      });
    }
  };

  // Touch Pinch-to-Zoom Gesture Handlers
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isPlaying) {
      onTogglePlay();
    }
    if (draggingState || isZoomLocked) return;

    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      // Require initial finger separation > 80px to distinguish pinch zoom from 2-finger swipe
      if (dist > 80) {
        touchStartDistRef.current = dist;
        touchStartZoomRef.current = zoom;
        isPinchingRef.current = true;
      } else {
        touchStartDistRef.current = null;
        isPinchingRef.current = false;
      }
    } else {
      touchStartDistRef.current = null;
      isPinchingRef.current = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (draggingState || isZoomLocked) return;

    if (e.touches.length === 2 && touchStartDistRef.current !== null && isPinchingRef.current) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      
      const distDelta = Math.abs(currentDist - touchStartDistRef.current);
      // Require significant pinch distance change (> 35px) to prevent accidental zoom during 2-finger pan
      if (touchStartDistRef.current > 0 && distDelta > 35) {
        const scale = currentDist / touchStartDistRef.current;
        const newZoom = Math.max(3, Math.min(75, touchStartZoomRef.current * scale));
        setZoom(newZoom);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length < 2) {
      touchStartDistRef.current = null;
      isPinchingRef.current = false;
    }
  };

  // Generate timeline ruler time marks cleanly and dynamically according to zoom (Memoized to avoid thrashing during playback)
  const rulerTicks = React.useMemo(() => {
    const trackWidth = containerWidth * zoom;
    const pxPerSec = trackWidth / Math.max(0.1, safeDuration);

    // Minimum label width in pixels (60px) to prevent text collision
    const minLabelPx = 60;
    const minSecInterval = minLabelPx / pxPerSec;

    // Step increments in seconds based on zoom level
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const tickInterval = steps.find((s) => s >= minSecInterval) || 2;

    const ticks = [];
    const totalSecs = Math.ceil(safeDuration);

    for (let sec = 0; sec < totalSecs; sec += tickInterval) {
      const startPercent = (sec / safeDuration) * 100;

      ticks.push({
        sec,
        startPercent,
        label: formatTimeLabel(sec, tickInterval),
        tickInterval,
      });
    }
    return ticks;
  }, [containerWidth, zoom, safeDuration]);

  // Filter rulerTicks to only render the ones visible in the current scroll viewport (+ margin) to maximize zoom and playhead performance
  const visibleRulerTicks = React.useMemo(() => {
    // Determine visible time window bounds in seconds
    const visibleDuration = safeDuration / zoom;
    const margin = visibleDuration * 0.5;
    const startT = Math.max(0, currentTime - visibleDuration / 2 - margin);
    const endT = Math.min(safeDuration, currentTime + visibleDuration / 2 + margin);

    return rulerTicks.filter((tick) => tick.sec >= startT && tick.sec <= endT);
  }, [rulerTicks, currentTime, safeDuration, zoom]);

  // Filter subtitles to only render those in or close to the visible timeline viewport (+ a generous margin) to prevent DOM bloat and lagging on long videos
  const visibleSubtitles = React.useMemo(() => {
    const visibleDuration = safeDuration / zoom;
    const margin = Math.max(visibleDuration, 30); // 30 seconds or visibleDuration
    const startT = Math.max(0, currentTime - visibleDuration / 2 - margin);
    const endT = Math.min(safeDuration, currentTime + visibleDuration / 2 + margin);

    return subtitles.filter((sub) => {
      if (sub.id === selectedSubtitleId) return true;
      if (currentTime >= sub.startTime && currentTime <= sub.endTime) return true;
      return sub.startTime <= endT && sub.endTime >= startT;
    });
  }, [subtitles, currentTime, safeDuration, zoom, selectedSubtitleId]);

  // Dynamic multi-lane layout calculation for subtitles and audios to support overlapping segments seamlessly
  const subtitleLanes = React.useMemo(() => {
    const lanes: { id: string; laneIndex: number }[] = [];
    const laneEndTimes: number[] = [];
    
    // Sort subs by startTime to assign lanes deterministically
    const sortedSubs = [...subtitles].sort((a, b) => a.startTime - b.startTime);
    
    for (const sub of sortedSubs) {
      let assignedLane = -1;
      for (let j = 0; j < laneEndTimes.length; j++) {
        // Allow a tiny gap of 0.05s to prevent overlap bugs
        if (sub.startTime >= laneEndTimes[j] - 0.05) {
          assignedLane = j;
          laneEndTimes[j] = sub.endTime;
          break;
        }
      }
      if (assignedLane === -1) {
        assignedLane = laneEndTimes.length;
        laneEndTimes.push(sub.endTime);
      }
      lanes.push({ id: sub.id, laneIndex: assignedLane });
    }
    
    const laneMap = new Map<string, number>();
    lanes.forEach((item) => laneMap.set(item.id, item.laneIndex));
    return laneMap;
  }, [subtitles]);

  const numSubtitleLanes = React.useMemo(() => {
    if (subtitles.length === 0) return 1;
    let maxLane = 0;
    subtitleLanes.forEach((val) => {
      if (val > maxLane) {
        maxLane = val;
      }
    });
    return maxLane + 1;
  }, [subtitleLanes, subtitles]);

  return (
    <div className="bg-[#15181d] border-t border-slate-700/60 flex flex-col select-none text-slate-200 relative shadow-2xl">
      {/* Hidden File Inputs for SRT, Audio, and Background Music */}
      <input
        ref={srtInputRef}
        type="file"
        accept=".srt"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && onImportSRT) {
            onImportSRT(file);
          }
          if (e.target) e.target.value = '';
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && onImportAudio) {
            onImportAudio(file);
          }
          if (e.target) e.target.value = '';
        }}
      />
      <input
        ref={bgMusicInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && onImportBgMusic) {
            onImportBgMusic(file);
          }
          if (e.target) e.target.value = '';
        }}
      />

      {/* Top Toolbar - Pure, Minimal, Frameless Icon Controls */}
      <div className="px-3 py-1 flex items-center justify-between text-xs relative min-h-[26px] h-[26px] bg-[#12151a]">
        {/* Left: Fullscreen / Expand Icon */}
        <div className="flex items-center space-x-2 z-10">
          <button
            type="button"
            className="p-0.5 text-slate-300 hover:text-white transition cursor-pointer active:scale-90"
            title="Toàn màn hình / Mở rộng"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Center: Simple Standard Play / Pause Triangle & Pause Icon Button */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center">
          <button
            onClick={onTogglePlay}
            className="p-1 text-slate-200 hover:text-white hover:scale-110 active:scale-90 transition cursor-pointer flex items-center justify-center"
            title={isPlaying ? 'Tạm dừng video' : 'Phát video'}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current text-slate-100" />
            ) : (
              <Play className="w-4 h-4 fill-current text-slate-100 ml-0.5" />
            )}
          </button>
        </div>

        {/* Right: Undo, Redo, Zoom Out / Zoom In Icons */}
        <div className="flex items-center space-x-2.5 z-10">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className={`p-0.5 text-slate-300 hover:text-white transition disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer active:scale-90`}
            title="Hoàn tác (Undo)"
          >
            <Undo className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            className={`p-0.5 text-slate-300 hover:text-white transition disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer active:scale-90`}
            title="Làm lại (Redo)"
          >
            <Redo className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-3 bg-slate-800 self-center" />

          <button
            type="button"
            onClick={() => {
              setZoom((prev) => Math.max(3, Math.min(75, prev / 1.3)));
            }}
            className="p-0.5 text-slate-400 hover:text-white transition cursor-pointer active:scale-90"
            title="Thu nhỏ dòng thời gian (Zoom Out)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              setZoom((prev) => Math.max(3, Math.min(75, prev * 1.3)));
            }}
            className="p-0.5 text-slate-400 hover:text-white transition cursor-pointer active:scale-90"
            title="Phóng to dòng thời gian (Zoom In)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* CapCut Timeline Track Container */}
      <div className="relative bg-[#13161a] overflow-hidden rounded-lg border border-slate-800 mx-1 my-0.5 shadow-lg flex flex-col">
        {/* Scrollable Tracks Canvas Viewport */}
        <div
          className="relative w-full overflow-hidden"
          onClick={() => setActiveHeaderPopover(null)}
        >
          {/* PLAYHEAD VERTICAL NEEDLE */}
          <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[2px] bg-slate-100 z-40 pointer-events-none shadow-[0_0_8px_rgba(241,245,249,0.9)]" />

          <div
            ref={containerRef}
            onScroll={handleScroll}
            onMouseDown={handleMouseDown}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className="w-full overflow-x-auto relative custom-scrollbar bg-[#0f1216] min-h-[148px] max-h-[155px] touch-pan-x overscroll-x-none cursor-grab active:cursor-grabbing select-none"
            style={{ overscrollBehaviorX: 'contain' }}
          >
            <div
              ref={trackRef}
              onClick={handleTimelineClick}
              className="relative box-border"
              style={{
                width: `${containerWidth * zoom + containerWidth}px`,
                paddingLeft: `${playheadOffset}px`,
                paddingRight: `${containerWidth - playheadOffset}px`,
              }}
            >
              {/* Inner Track Content Wrapper */}
              <div className="relative w-full space-y-0.5 py-0.5">

                {/* CONTINUOUS VERTICAL GRID LINES */}
                <div className="absolute inset-y-0 left-0 right-0 pointer-events-none z-0">
                  {visibleRulerTicks.map((tick, idx) => {
                    const leftPx = (tick.sec / safeDuration) * (containerWidth * zoom);
                    return (
                      <div
                        key={`grid-${idx}`}
                        className="absolute top-0 bottom-0 w-px bg-slate-700/30"
                        style={{ left: `${leftPx}px` }}
                      />
                    );
                  })}
                </div>

                {/* ROW 1: TIME RULER - Clean Header */}
                <div className="h-5 bg-[#181c22] border-b border-slate-800 relative overflow-hidden select-none z-10">
                  {/* Left Head Track Rail Timecode Display (Stationary at the head of the ruler like track icons) */}
                  <div
                    className="absolute top-0 bottom-0 flex items-center z-25 pl-2 select-none pointer-events-none"
                    style={{
                      left: `-${playheadOffset}px`,
                      width: `${playheadOffset}px`,
                    }}
                  >
                    <div className="font-mono text-[9px] tracking-tight flex items-center space-x-1">
                      <span className="text-white font-bold">{formatMMSS(currentTime)}</span>
                      <span className="text-slate-500 font-normal">/</span>
                      <span className="text-slate-400 font-medium">{formatMMSS(safeDuration)}</span>
                    </div>
                  </div>

                  {visibleRulerTicks.map((tick, idx) => {
                    const leftPx = (tick.sec / safeDuration) * (containerWidth * zoom);
                    return (
                      <React.Fragment key={idx}>
                        {/* Vertical Tick Line */}
                        <div
                          className="absolute top-0 h-1.5 w-px bg-slate-500/80 pointer-events-none"
                          style={{ left: `${leftPx}px` }}
                        />
                        {/* Tick Label */}
                        <div
                          className={`absolute top-1.5 bottom-0 flex items-center pointer-events-none ${
                            tick.sec === 0 || leftPx === 0
                              ? 'justify-start pl-0.5'
                              : 'justify-start -translate-x-1/2'
                          }`}
                          style={{ left: `${leftPx}px` }}
                        >
                          <span className="text-[9px] font-mono text-slate-300 font-medium whitespace-nowrap bg-[#181c22]/90 px-0.5 rounded leading-none">
                             {tick.label}
                          </span>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* ROW 2: VIDEO TRACK */}
                <div className="h-7 bg-[#14171c]/50 border-b border-slate-800/80 relative flex items-center px-0 z-10">
                  {/* Video Track Rail Bar */}
                  <div
                    className="absolute top-0.5 bottom-0.5 bg-[#1a1e25] border border-slate-800 rounded-md z-0 pointer-events-none shadow-inner"
                    style={{
                      left: `-${playheadOffset}px`,
                      width: `calc(100% + ${playheadOffset}px)`,
                    }}
                  />

                  {/* Left Head Track Rail Start & Icon Pill */}
                  <div
                    className="absolute top-0 bottom-0 flex items-center z-25 pointer-events-auto"
                    style={{
                      left: `-${playheadOffset}px`,
                      width: `${playheadOffset}px`,
                    }}
                  >
                    <div className="relative ml-2 bg-gradient-to-r from-slate-800 to-slate-900 border border-slate-600/80 rounded-md px-1.5 py-0.5 flex items-center space-x-1 text-slate-100 font-bold text-[9px] shadow-sm">
                      <Film className="w-3 h-3 text-slate-300 flex-shrink-0" />
                      <span className="text-slate-200">Video</span>
                    </div>
                  </div>

                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onSelectVideoBlock) onSelectVideoBlock(!isVideoSelected);
                    }}
                    className={`absolute left-0 w-full h-5 bg-gradient-to-r from-slate-600 via-slate-500 to-slate-600 text-slate-950 font-bold overflow-hidden flex items-center justify-between px-2 shadow-sm rounded-md cursor-pointer transition-all z-10 ${
                      isVideoSelected
                        ? 'ring-1.5 ring-white border border-slate-100 shadow-md z-20'
                        : 'hover:brightness-110 border border-slate-400'
                    }`}
                    style={{
                      top: '4px',
                    }}
                  >
                    {/* Segment cut lines */}
                    <div
                      className="absolute inset-0 pointer-events-none overflow-hidden opacity-20"
                      style={{
                        background: `repeating-linear-gradient(90deg, transparent, transparent calc((100% / ${safeDuration}) - 1px), #334155 calc((100% / ${safeDuration}) - 1px), #334155 calc(100% / ${safeDuration}))`
                      }}
                    />

                    {/* Metallic Silver Video Badge */}
                    <div className="relative z-10 bg-slate-900/90 border border-slate-600/80 px-1.5 py-0.5 rounded text-[9px] font-bold text-slate-100 flex items-center space-x-1 max-w-[85%] truncate pointer-events-none shadow-sm ml-1">
                      <Film className="w-2.5 h-2.5 text-slate-300 flex-shrink-0" />
                      <span className="truncate text-slate-200">{videoTitle || 'imported_video.mp4'}</span>
                    </div>

                    {isVideoSelected && (
                      <span className="relative z-10 text-[8px] bg-slate-950 text-white font-black px-1 py-0.5 rounded uppercase tracking-wider">
                        Đang chọn
                      </span>
                    )}
                  </div>
                </div>

                {/* ROW 3: SUBTITLE TRACK */}
                <div 
                  className="h-7 bg-[#14171c]/50 border-b border-slate-800/80 relative flex items-center z-10"
                >
                  {/* Subtitle Track Rail Bar */}
                  <div
                    className="absolute top-0.5 bottom-0.5 bg-[#1a1e25] border border-slate-800 rounded-md z-0 pointer-events-none shadow-inner"
                    style={{
                      left: `-${playheadOffset}px`,
                      width: `calc(100% + ${playheadOffset}px)`,
                    }}
                  />

                  {/* Left Head Track Rail Start & Interactive Icon Pill */}
                  <div
                    className="absolute top-0 bottom-0 flex items-center z-25 pointer-events-auto"
                    style={{
                      left: `-${playheadOffset}px`,
                      width: `${playheadOffset}px`,
                    }}
                  >
                    <div className="relative ml-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveHeaderPopover(activeHeaderPopover === 'subtitle' ? null : 'subtitle');
                        }}
                        className="bg-gradient-to-r from-slate-800 to-slate-900 hover:from-slate-700 hover:to-slate-800 border border-slate-600/80 rounded-md px-1.5 py-0.5 flex items-center space-x-1 text-slate-100 font-bold text-[9px] shadow-sm cursor-pointer transition active:scale-95"
                      >
                        <Subtitles className="w-3 h-3 text-slate-300 flex-shrink-0" />
                        <span className="text-slate-200">Phụ đề</span>
                        <ChevronDown className="w-2 h-2 text-slate-400 flex-shrink-0" />
                      </button>

                      {activeHeaderPopover === 'subtitle' && (
                        <div className="absolute left-0 top-full mt-1 z-50 bg-[#22272e] border border-slate-600 rounded-lg shadow-2xl p-1 min-w-[130px] space-y-0.5 text-[11px] animate-in fade-in duration-100">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveHeaderPopover(null);
                              if (onExtractSRT) onExtractSRT();
                            }}
                            className="w-full text-left px-2 py-1 rounded hover:bg-slate-700 hover:text-white text-slate-200 font-semibold flex items-center space-x-1.5 transition"
                          >
                            <Type className="w-3 h-3 text-slate-300" />
                            <span>Trích xuất SRT</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveHeaderPopover(null);
                              srtInputRef.current?.click();
                            }}
                            className="w-full text-left px-2 py-1 rounded hover:bg-slate-700 hover:text-white text-slate-200 font-semibold flex items-center space-x-1.5 transition"
                          >
                            <Upload className="w-3 h-3 text-slate-300" />
                            <span>Nhập SRT</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {visibleSubtitles.map((sub) => {
                    const startPx = (sub.startTime / safeDuration) * (containerWidth * zoom);
                    const endPx = (sub.endTime / safeDuration) * (containerWidth * zoom);
                    const widthPx = Math.max(8, endPx - startPx);

                    const isSelected = selectedSubtitleId === sub.id;

                    return (
                      <div
                        key={sub.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (hasDraggedRef.current) return;
                          onSeek(sub.startTime);
                          if (onSelectSubtitle) onSelectSubtitle(sub);
                        }}
                        onMouseDown={(e) => handleStartDragHandle(e, sub, 'move')}
                        onTouchStart={(e) => handleStartDragHandle(e, sub, 'move')}
                        className={`absolute rounded-md text-[10px] font-bold px-1.5 flex items-center justify-between transition-all cursor-grab active:cursor-grabbing border border-white select-none touch-none ${
                          isSelected
                            ? 'bg-[#d2780e] text-white z-30 font-black shadow-lg scale-[1.01]'
                            : 'bg-[#b06103] text-white z-10 shadow-xs'
                        }`}
                        style={{
                          left: `${startPx}px`,
                          width: `${widthPx - 2}px`,
                          top: '4px',
                          height: '20px',
                        }}
                        title={`[${formatTimeLabel(sub.startTime, 0.1)} - ${formatTimeLabel(sub.endTime, 0.1)}]: ${
                          sub.translatedText || sub.originalText
                        }`}
                      >
                        {/* Left White Drag Handle */}
                        {isSelected && (
                          <div
                            onMouseDown={(e) => handleStartDragHandle(e, sub, 'left')}
                            onTouchStart={(e) => handleStartDragHandle(e, sub, 'left')}
                            className="absolute -left-2.5 top-0 bottom-0 w-2.5 bg-white rounded-l-md border-r border-zinc-300 shadow-md flex items-center justify-center cursor-ew-resize z-40 touch-none active:bg-sky-100 transition-transform"
                            title="Kéo mốc bắt đầu phụ đề"
                            style={{ height: '18px' }}
                          >
                            <div className="w-0.5 h-2 bg-zinc-900 rounded-full" />
                          </div>
                        )}

                        {/* Subtitle Text & Time Content */}
                        <div className="flex flex-col min-w-0 flex-1 justify-center">
                          <span className="truncate select-none pointer-events-none text-[9.5px] font-bold text-white leading-none">
                            {sub.translatedText || sub.originalText}
                          </span>
                        </div>

                        {/* Right White Drag Handle */}
                        {isSelected && (
                          <div
                            onMouseDown={(e) => handleStartDragHandle(e, sub, 'right')}
                            onTouchStart={(e) => handleStartDragHandle(e, sub, 'right')}
                            className="absolute -right-2.5 top-0 bottom-0 w-2.5 bg-white rounded-r-md border-l border-zinc-300 shadow-md flex items-center justify-center cursor-ew-resize z-40 touch-none active:bg-sky-100 transition-transform"
                            title="Kéo mốc kết thúc phụ đề"
                            style={{ height: '18px' }}
                          >
                            <div className="w-0.5 h-2 bg-zinc-900 rounded-full" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* ROW 4: AUDIO TRACK LANE */}
                <div 
                  className="h-7 bg-[#14171c]/50 border-b border-slate-800/80 relative flex items-center z-10"
                >
                  {/* Audio Track Rail Bar */}
                  <div
                    className="absolute top-0.5 bottom-0.5 bg-[#1a1e25] border border-slate-800 rounded-md z-0 pointer-events-none shadow-inner"
                    style={{
                      left: `-${playheadOffset}px`,
                      width: `calc(100% + ${playheadOffset}px)`,
                    }}
                  />

                  {/* Left Head Track Rail Start & Interactive Icon Pill */}
                  <div
                    className="absolute top-0 bottom-0 flex items-center z-25 pointer-events-auto"
                    style={{
                      left: `-${playheadOffset}px`,
                      width: `${playheadOffset}px`,
                    }}
                  >
                    <div className="relative ml-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveHeaderPopover(activeHeaderPopover === 'audio' ? null : 'audio');
                        }}
                        className="bg-gradient-to-r from-slate-800 to-slate-900 hover:from-slate-700 hover:to-slate-800 border border-slate-600/80 rounded-md px-1.5 py-0.5 flex items-center space-x-1 text-slate-100 font-bold text-[9px] shadow-sm cursor-pointer transition active:scale-95"
                      >
                        <Headphones className="w-3 h-3 text-slate-300 flex-shrink-0" />
                        <span className="text-slate-200">Audio</span>
                        <ChevronDown className="w-2 h-2 text-slate-400 flex-shrink-0" />
                      </button>

                      {activeHeaderPopover === 'audio' && (
                        <div className="absolute left-0 top-full mt-1 z-50 bg-[#22272e] border border-slate-600 rounded-lg shadow-2xl p-1 min-w-[130px] space-y-0.5 text-[11px] animate-in fade-in duration-100">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveHeaderPopover(null);
                              if (onExtractAudio) onExtractAudio();
                            }}
                            className="w-full text-left px-2 py-1 rounded hover:bg-slate-700 hover:text-white text-slate-200 font-semibold flex items-center space-x-1.5 transition"
                          >
                            <Volume2 className="w-3 h-3 text-slate-300" />
                            <span>Trích xuất audio</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveHeaderPopover(null);
                              audioInputRef.current?.click();
                            }}
                            className="w-full text-left px-2 py-1 rounded hover:bg-slate-700 hover:text-white text-slate-200 font-semibold flex items-center space-x-1.5 transition"
                          >
                            <Upload className="w-3 h-3 text-slate-300" />
                            <span>Nhập audio</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {visibleSubtitles.map((sub) => {
                    const startPx = (sub.startTime / safeDuration) * (containerWidth * zoom);
                    const endPx = (sub.endTime / safeDuration) * (containerWidth * zoom);
                    const widthPx = Math.max(8, endPx - startPx);

                    const hasAudio = Boolean(sub.audioUrl);

                    return (
                      <div
                        key={`dub-${sub.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSeek(sub.startTime);
                          if (onSelectSubtitle) onSelectSubtitle(sub);
                          if (onPlayTTS) onPlayTTS(sub.translatedText || sub.originalText);
                        }}
                        className={`absolute rounded-md text-[10px] font-bold px-1.5 flex flex-col justify-center overflow-hidden transition-all cursor-pointer active:scale-95 ${
                          hasAudio
                            ? 'bg-gradient-to-r from-sky-400 via-sky-500 to-blue-500 text-slate-950 border border-sky-300/80 z-20 shadow-xs'
                            : 'bg-sky-950/40 hover:bg-sky-900/60 text-sky-200 border border-dashed border-sky-500/40'
                        }`}
                        style={{
                          left: `${startPx}px`,
                          width: `${widthPx - 2}px`,
                          top: '4px',
                          height: '20px',
                        }}
                        title={
                          hasAudio
                            ? `[Audio] ${sub.translatedText || sub.originalText}`
                            : `[Audio Dubbing] Click để phát TTS`
                        }
                      >
                        {/* Audio Waveform SVG */}
                        <svg className="absolute inset-y-0 left-0 right-0 w-full h-full opacity-15 pointer-events-none text-slate-950" preserveAspectRatio="none" viewBox="0 0 100 32" fill="currentColor">
                          <rect x="2" y="12" width="1.5" height="8" rx="0.75" />
                          <rect x="6" y="8" width="1.5" height="16" rx="0.75" />
                          <rect x="10" y="14" width="1.5" height="4" rx="0.75" />
                          <rect x="14" y="6" width="1.5" height="20" rx="0.75" />
                          <rect x="18" y="10" width="1.5" height="12" rx="0.75" />
                          <rect x="22" y="4" width="1.5" height="24" rx="0.75" />
                          <rect x="26" y="12" width="1.5" height="8" rx="0.75" />
                          <rect x="30" y="14" width="1.5" height="4" rx="0.75" />
                          <rect x="34" y="8" width="1.5" height="16" rx="0.75" />
                          <rect x="38" y="6" width="1.5" height="20" rx="0.75" />
                          <rect x="42" y="12" width="1.5" height="8" rx="0.75" />
                          <rect x="46" y="10" width="1.5" height="12" rx="0.75" />
                          <rect x="50" y="4" width="1.5" height="24" rx="0.75" />
                          <rect x="54" y="14" width="1.5" height="4" rx="0.75" />
                          <rect x="58" y="8" width="1.5" height="16" rx="0.75" />
                          <rect x="62" y="6" width="1.5" height="20" rx="0.75" />
                          <rect x="66" y="12" width="1.5" height="8" rx="0.75" />
                          <rect x="70" y="10" width="1.5" height="12" rx="0.75" />
                          <rect x="74" y="4" width="1.5" height="24" rx="0.75" />
                          <rect x="78" y="14" width="1.5" height="4" rx="0.75" />
                          <rect x="82" y="8" width="1.5" height="16" rx="0.75" />
                          <rect x="86" y="6" width="1.5" height="20" rx="0.75" />
                          <rect x="90" y="12" width="1.5" height="8" rx="0.75" />
                          <rect x="94" y="10" width="1.5" height="12" rx="0.75" />
                        </svg>

                        <div className="relative z-10 flex items-center space-x-1 min-w-0 flex-1 justify-center">
                          <Volume2 className={`w-2.5 h-2.5 flex-shrink-0 ${hasAudio ? 'text-slate-950' : 'text-sky-400'}`} />
                          <span className={`truncate text-[9px] font-bold ${hasAudio ? 'text-slate-950' : 'text-sky-300'}`}>
                            {hasAudio ? (sub.translatedText || sub.originalText) : 'Chưa có audio'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ROW 5: NHẠC NỀN TRACK LANE */}
                <div className="h-7 bg-[#14171c]/50 border-b border-slate-800/80 relative flex items-center px-0 z-10">
                  {/* Nhạc nền Track Rail Bar */}
                  <div
                    className="absolute top-0.5 bottom-0.5 bg-[#1a1e25] border border-slate-800 rounded-md z-0 pointer-events-none shadow-inner"
                    style={{
                      left: `-${playheadOffset}px`,
                      width: `calc(100% + ${playheadOffset}px)`,
                    }}
                  />

                  {/* Left Head Track Rail Start & Interactive Icon Pill */}
                  <div
                    className="absolute top-0 bottom-0 flex items-center z-25 pointer-events-auto"
                    style={{
                      left: `-${playheadOffset}px`,
                      width: `${playheadOffset}px`,
                    }}
                  >
                    <div className="relative ml-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveHeaderPopover(activeHeaderPopover === 'music' ? null : 'music');
                        }}
                        className="bg-gradient-to-r from-slate-800 to-slate-900 hover:from-slate-700 hover:to-slate-800 border border-slate-600/80 rounded-md px-1.5 py-0.5 flex items-center space-x-1 text-slate-100 font-bold text-[9px] shadow-sm cursor-pointer transition active:scale-95"
                      >
                        <Music2 className="w-3 h-3 text-slate-300 fill-slate-300/10 flex-shrink-0" />
                        <span className="text-slate-200">Nhạc nền</span>
                        <ChevronDown className="w-2 h-2 text-slate-400 flex-shrink-0" />
                      </button>

                      {activeHeaderPopover === 'music' && (
                        <div className="absolute left-0 top-full mt-1 z-50 bg-[#22272e] border border-slate-600 rounded-lg shadow-2xl p-1 min-w-[130px] space-y-0.5 text-[11px] animate-in fade-in duration-100">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveHeaderPopover(null);
                              bgMusicInputRef.current?.click();
                            }}
                            className="w-full text-left px-2 py-1 rounded hover:bg-slate-700 hover:text-white text-slate-200 font-semibold flex items-center space-x-1.5 transition"
                          >
                            <Upload className="w-3 h-3 text-slate-300" />
                            <span>Nhập nhạc nền</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    className="absolute left-0 right-0 h-5 bg-gradient-to-r from-slate-800 via-slate-850 to-slate-900 border border-slate-700/80 rounded-md flex items-center justify-between px-2 overflow-hidden z-10"
                    style={{
                      top: '4px',
                    }}
                  >
                    <div className="flex items-center space-x-1.5 relative z-10 truncate">
                      <Music2 className="w-3 h-3 text-slate-300 fill-slate-300/10 flex-shrink-0" />
                      <span className="text-[9px] font-semibold text-slate-200 truncate">
                        {bgMusicTitle || 'Chưa chọn nhạc nền'}
                      </span>
                    </div>

                    {/* Waveform SVG */}
                    <svg className="h-full w-48 opacity-30 pointer-events-none text-slate-300" preserveAspectRatio="none" viewBox="0 0 100 32" fill="currentColor">
                      <rect x="2" y="12" width="1" height="8" rx="0.5" />
                      <rect x="5" y="8" width="1" height="16" rx="0.5" />
                      <rect x="8" y="14" width="1" height="4" rx="0.5" />
                      <rect x="11" y="6" width="1" height="20" rx="0.5" />
                      <rect x="14" y="10" width="1" height="12" rx="0.5" />
                      <rect x="17" y="4" width="1" height="24" rx="0.5" />
                      <rect x="20" y="12" width="1" height="8" rx="0.5" />
                      <rect x="23" y="14" width="1" height="4" rx="0.5" />
                      <rect x="26" y="8" width="1" height="16" rx="0.5" />
                      <rect x="29" y="6" width="1" height="20" rx="0.5" />
                      <rect x="32" y="12" width="1" height="8" rx="0.5" />
                      <rect x="35" y="10" width="1" height="12" rx="0.5" />
                      <rect x="38" y="4" width="1" height="24" rx="0.5" />
                      <rect x="41" y="14" width="1" height="4" rx="0.5" />
                      <rect x="44" y="8" width="1" height="16" rx="0.5" />
                      <rect x="47" y="6" width="1" height="20" rx="0.5" />
                      <rect x="50" y="12" width="1" height="8" rx="0.5" />
                      <rect x="53" y="10" width="1" height="12" rx="0.5" />
                      <rect x="56" y="4" width="1" height="24" rx="0.5" />
                      <rect x="59" y="14" width="1" height="4" rx="0.5" />
                      <rect x="62" y="8" width="1" height="16" rx="0.5" />
                      <rect x="65" y="6" width="1" height="20" rx="0.5" />
                      <rect x="68" y="12" width="1" height="8" rx="0.5" />
                      <rect x="71" y="10" width="1" height="12" rx="0.5" />
                      <rect x="74" y="4" width="1" height="24" rx="0.5" />
                      <rect x="77" y="14" width="1" height="4" rx="0.5" />
                      <rect x="80" y="8" width="1" height="16" rx="0.5" />
                      <rect x="83" y="6" width="1" height="20" rx="0.5" />
                      <rect x="86" y="12" width="1" height="8" rx="0.5" />
                      <rect x="89" y="10" width="1" height="12" rx="0.5" />
                      <rect x="92" y="4" width="1" height="24" rx="0.5" />
                      <rect x="95" y="14" width="1" height="4" rx="0.5" />
                    </svg>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
