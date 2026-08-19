import { SubtitleItem, SubtitleStyleConfig } from '../types';
import { wrapSubtitleText } from '../utils/srtParser';

let offscreenCanvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let fontsLoaded = false;

// Preload custom fonts into the worker's FontFaceSet to prevent falling back to standard thin fonts
async function loadCustomFonts() {
  if (fontsLoaded) return;
  if (typeof FontFace !== 'undefined' && (self as any).fonts) {
    try {
      const fonts = [
        { family: 'Plus Jakarta Sans', url: 'https://fonts.gstatic.com/s/plusjakartasans/v8/L0x9DFM0_VJNtXg7FIdC7K3uyX4nyqHNNiV9694t1A3G8g.woff2' },
        { family: 'Roboto', url: 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxKKTU1Kg.woff2' },
        { family: 'Playfair Display', url: 'https://fonts.gstatic.com/s/playfairdisplay/v30/nuFvD7K327Spv37f968DGpY1rad7gMW30ey87iU.woff2' },
        { family: 'Montserrat', url: 'https://fonts.gstatic.com/s/montserrat/v25/JTUSjIg1_i6t8kCHKm459W1hyyTh89ZNpQ.woff2' }
      ];
      for (const f of fonts) {
        try {
          const fontFace = new FontFace(f.family, `url(${f.url})`, { weight: 'bold' });
          // Add timeout to font loading so network stall won't freeze worker
          await Promise.race([
            fontFace.load(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Font load timeout')), 3000))
          ]);
          (self as any).fonts.add(fontFace);
        } catch (e) {
          // Ignore individual load failures
        }
      }
      fontsLoaded = true;
    } catch (err) {
      console.warn('[Worker] Failed to load custom web fonts:', err);
    }
  }
}

const loadedCustomFontNames = new Set<string>();

async function loadUploadedFonts(customUploadedFonts?: { family: string; dataUrl: string }[]) {
  if (!customUploadedFonts || customUploadedFonts.length === 0) return;
  if (typeof FontFace !== 'undefined' && (self as any).fonts) {
    for (const font of customUploadedFonts) {
      if (loadedCustomFontNames.has(font.family)) continue;
      try {
        const fontFace = new FontFace(font.family, `url(${font.dataUrl})`);
        const loaded = await fontFace.load();
        (self as any).fonts.add(loaded);
        loadedCustomFontNames.add(font.family);
      } catch (e) {
        console.warn('[Worker] Failed to load custom uploaded font:', font.family, e);
      }
    }
  }
}

function getBgColorWithOpacity(hexColor: string, opacity: number = 65): string {
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
}

function wrapCanvasText(
  context: OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine ? currentLine + ' ' + word : word;
    const metrics = context.measureText(testLine);
    if (metrics.width > maxWidth && i > 0) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

function drawSubtitleOverlay(
  context: OffscreenCanvasRenderingContext2D,
  imageBitmap: ImageBitmap | VideoFrame,
  vWidth: number,
  vHeight: number,
  curTime: number,
  subtitles: SubtitleItem[],
  styleConfig: SubtitleStyleConfig,
  blurOverlays: any[] = [],
  logoOverlays: any[] = [],
  textOverlays: any[] = [],
  logoBitmaps: Record<string, ImageBitmap> = {}
) {
  // 1. Draw base video frame
  context.drawImage(imageBitmap, 0, 0, vWidth, vHeight);

  // 1b. Render Blur Overlays
  blurOverlays.forEach((blur) => {
    try {
      context.save();
      context.beginPath();
      const x = (blur.x / 100) * vWidth;
      const y = (blur.y / 100) * vHeight;
      const w = (blur.width / 100) * vWidth;
      const h = (blur.height / 100) * vHeight;
      const r = (blur.borderRadius || 0) * (vHeight / 720);
      if (typeof context.roundRect === 'function') {
        context.roundRect(x, y, w, h, r);
      } else {
        context.rect(x, y, w, h);
      }
      context.clip();
      context.filter = `blur(${blur.blur * (vHeight / 720)}px)`;
      context.drawImage(imageBitmap, 0, 0, vWidth, vHeight);
      context.restore();
    } catch (err) {
      console.warn('[Worker] Blur overlay draw warning:', err);
    }
  });

  // 1c. Render Logo Overlays
  logoOverlays.forEach((logo) => {
    const x = (logo.x / 100) * vWidth;
    const y = (logo.y / 100) * vHeight;
    const w = (logo.width / 100) * vWidth;
    const h = (logo.height / 100) * vHeight;
    const img = logoBitmaps[logo.id] || logoBitmaps[logo.url];
    if (img) {
      context.save();
      context.globalAlpha = (logo.opacity || 100) / 100;
      context.drawImage(img, x, y, w, h);
      context.restore();
    }
  });

  // 1d. Render Text Overlays
  textOverlays.forEach((textItem) => {
    const x = (textItem.x / 100) * vWidth;
    const y = (textItem.y / 100) * vHeight;
    const w = (textItem.width / 100) * vWidth;
    const h = (textItem.height / 100) * vHeight;
    context.save();
    context.globalAlpha = (textItem.opacity || 100) / 100;
    if (textItem.backgroundColor) {
      context.fillStyle = textItem.backgroundColor;
      context.fillRect(x, y, w, h);
    }
    // Scale font size dynamically with height
    const scaleFactor = vHeight / 720;
    const fontSize = Math.max(8, Math.round(textItem.fontSize * scaleFactor));
    const fontFamily = styleConfig.fontFamily || 'system-ui, sans-serif';
    context.font = `bold ${fontSize}px ${fontFamily}`;
    context.fillStyle = textItem.color || '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    const textLines = wrapCanvasText(context, textItem.text, w - 8);
    const textLineHeight = fontSize * 1.2;
    const startY = y + h / 2 - ((textLines.length - 1) * textLineHeight) / 2;
    textLines.forEach((line, idx) => {
      context.fillText(line, x + w / 2, startY + idx * textLineHeight);
    });
    context.restore();
  });

  // 2. Mask original subtitles if requested
  if (styleConfig.maskOriginalSubtitles) {
    context.fillStyle = styleConfig.maskColor || 'rgba(0, 0, 0, 0.75)';
    const maskY =
      vHeight * (1 - (styleConfig.bottomOffsetPercentage || 12) / 100) -
      vHeight * 0.08;
    const maskH = vHeight * 0.14;
    context.fillRect(0, Math.max(0, maskY), vWidth, maskH);
  }

  // 3. Find active subtitle item
  const activeSub = subtitles.find(
    (s) => curTime >= s.startTime && curTime <= s.endTime
  );

  if (!activeSub) return;

  let rawText = activeSub.translatedText || activeSub.originalText || '';

  // Apply text transformation (casing)
  if (styleConfig.textTransform === 'uppercase') {
    rawText = rawText.toUpperCase();
  } else if (styleConfig.textTransform === 'lowercase') {
    rawText = rawText.toLowerCase();
  } else if (styleConfig.textTransform === 'capitalize') {
    rawText = rawText.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Align style configurations & fallback defaults with VideoPlayer.tsx perfectly
  const defaultFontSize = styleConfig.fontSize || 22;
  const defaultPadding = styleConfig.padding || 6;
  const defaultBorderRadius = styleConfig.borderRadius ?? 8;
  const bgOpacity = styleConfig.bgOpacity ?? 65;

  // Calculate font size relative to standard 720p height
  const scaleFactor = vHeight / 720;
  const baseFontSize = defaultFontSize * scaleFactor;
  // Proportional minimum font size (10px on 360p corresponds to 20px on 720p)
  const minFontSize = Math.max(12, Math.round(20 * scaleFactor));
  const fontSize = Math.max(minFontSize, Math.round(baseFontSize));

  const fontFamily = styleConfig.fontFamily || 'system-ui, sans-serif';
  const fontWeight = styleConfig.fontWeight || 'bold';
  const fontStyle = styleConfig.fontStyle || 'normal';

  context.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const lineHeight = fontSize * 1.35;
  const padding = defaultPadding * scaleFactor;

  // Use boundingBox if available, otherwise fallback
  const displayBox = activeSub.boundingBox;
  
  let lines: string[];
  let boxX: number;
  let boxY: number;
  let boxWidth: number;
  let boxHeight: number;

  if (displayBox) {
    const parentX = (displayBox.x / 100) * vWidth;
    const parentY = (displayBox.y / 100) * vHeight;
    const parentWidth = (displayBox.width / 100) * vWidth;
    const parentHeight = (displayBox.height / 100) * vHeight;

    // Word wrap based on bounding box width
    const wrapWidth = Math.max(50, parentWidth - padding * 2.5);
    lines = wrapCanvasText(context, rawText, wrapWidth);

    // Calculate actual content dimensions
    let maxLineWidth = 0;
    lines.forEach((line) => {
      const w = context.measureText(line).width;
      if (w > maxLineWidth) maxLineWidth = w;
    });

    const totalTextHeight = lines.length * lineHeight;
    boxWidth = Math.min(parentWidth, maxLineWidth + padding * 2.5);
    boxHeight = Math.min(parentHeight, totalTextHeight + padding * 1.5);

    // Center content box inside parent bounding box
    boxX = parentX + (parentWidth - boxWidth) / 2;
    boxY = parentY + (parentHeight - boxHeight) / 2;
  } else {
    // Fallback wrapping based on max character width
    const wrappedText = wrapSubtitleText(
      rawText,
      styleConfig.orientation || 'horizontal',
      styleConfig.maxCharsHorizontal || 65,
      styleConfig.maxCharsVertical || 36
    );
    lines = wrappedText ? wrappedText.split('\n') : [];
    if (lines.length === 0) return;

    let maxLineWidth = 0;
    lines.forEach((line) => {
      const w = context.measureText(line).width;
      if (w > maxLineWidth) maxLineWidth = w;
    });

    const totalTextHeight = lines.length * lineHeight;
    boxWidth = maxLineWidth + padding * 2.5;
    boxHeight = totalTextHeight + padding * 1.5;

    let posY = vHeight * 0.82;
    if (styleConfig.position === 'top') {
      posY = vHeight * 0.15;
    } else if (styleConfig.position === 'middle') {
      posY = vHeight * 0.5;
    }
    if (styleConfig.bottomOffsetPercentage) {
      posY = vHeight * (1 - styleConfig.bottomOffsetPercentage / 100);
    }

    boxX = (vWidth - boxWidth) / 2;
    boxY = posY - boxHeight / 2;
  }

  // Draw Subtitle Background Box with proper alpha/opacity parsing
  if (styleConfig.hasBackground !== false && styleConfig.backgroundColor) {
    context.fillStyle = getBgColorWithOpacity(styleConfig.backgroundColor, bgOpacity);
    const radius = defaultBorderRadius * scaleFactor;

    context.beginPath();
    if (typeof (context as any).roundRect === 'function') {
      (context as any).roundRect(boxX, boxY, boxWidth, boxHeight, radius);
    } else {
      context.rect(boxX, boxY, boxWidth, boxHeight);
    }
    context.fill();
  }

  // Draw Text Lines centered inside box
  const startY = boxY + boxHeight / 2 - ((lines.length - 1) * lineHeight) / 2;
  const drawX = boxX + boxWidth / 2;

  lines.forEach((line, idx) => {
    const lineY = startY + idx * lineHeight;

    // 1. Text Shadow / Glow
    if (styleConfig.textShadowColor) {
      context.save();
      context.shadowColor = styleConfig.textShadowColor;
      context.shadowBlur = (styleConfig.textShadowBlur ?? 8) * scaleFactor;
      context.shadowOffsetX = (styleConfig.textShadowOffsetX ?? 0) * scaleFactor;
      context.shadowOffsetY = (styleConfig.textShadowOffsetY ?? 2) * scaleFactor;
      context.fillStyle = styleConfig.fontColor || '#ffffff';
      context.fillText(line, drawX, lineY);
      context.restore();
    } else if (styleConfig.textOutline !== false) {
      context.save();
      context.shadowColor = 'rgba(0,0,0,0.85)';
      context.shadowBlur = 6 * scaleFactor;
      context.shadowOffsetY = 3 * scaleFactor;
      context.fillStyle = styleConfig.fontColor || '#ffffff';
      context.fillText(line, drawX, lineY);
      context.restore();
    }

    // 2. Secondary Text Outline (Viền kép / Outer sticker border)
    const hasSecOutline = styleConfig.hasSecondaryOutline === true ||
      (typeof styleConfig.secondaryOutlineWidth === 'number' && styleConfig.secondaryOutlineWidth > 0 && styleConfig.hasSecondaryOutline !== false);
    const secOutlineWidth = hasSecOutline ? Math.max(0, styleConfig.secondaryOutlineWidth ?? 4) : 0;
    const primOutlineWidth = (styleConfig.textOutline !== false) ? Math.max(0, styleConfig.outlineWidth ?? 3) : 0;

    if (secOutlineWidth > 0) {
      const totalSecStroke = Math.max(0.5, (primOutlineWidth + secOutlineWidth) * 2 * scaleFactor);
      context.strokeStyle = styleConfig.secondaryOutlineColor || '#000000';
      context.lineWidth = totalSecStroke;
      context.lineJoin = 'round';
      context.miterLimit = 2;
      context.strokeText(line, drawX, lineY);
    }

    // 3. Primary Text Outline (Stroke)
    if (styleConfig.textOutline !== false && primOutlineWidth > 0) {
      context.strokeStyle = styleConfig.outlineColor || '#000000';
      context.lineWidth = Math.max(0.5, primOutlineWidth * 2 * scaleFactor);
      context.lineJoin = 'round';
      context.miterLimit = 2;
      context.strokeText(line, drawX, lineY);
    }

    // 4. Main Text Fill
    context.fillStyle = styleConfig.fontColor || '#ffffff';
    context.fillText(line, drawX, lineY);
  });
}

const logoBitmapsCache = new Map<string, ImageBitmap>();

async function getLogoBitmap(logo: { id: string; url: string }): Promise<ImageBitmap | null> {
  if (logoBitmapsCache.has(logo.id)) {
    return logoBitmapsCache.get(logo.id)!;
  }
  try {
    const res = await fetch(logo.url);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    logoBitmapsCache.set(logo.id, bitmap);
    return bitmap;
  } catch (err) {
    console.error('Failed to load logo bitmap in worker:', err);
    return null;
  }
}

let renderQueuePromise: Promise<void> = Promise.resolve();

async function processRenderTask(data: any) {
  const {
    imageBitmap,
    videoFrame,
    timestampUs,
    isKeyFrame,
    currentTime,
    vWidth,
    vHeight,
    subtitles,
    styleConfig,
    frameIdx,
    blurOverlays = [],
    logoOverlays = [],
    textOverlays = [],
  } = data;

  const frameSource = videoFrame || imageBitmap;

  try {
    // Async preload fonts
    await loadCustomFonts();
    if (styleConfig && styleConfig.customUploadedFonts) {
      await loadUploadedFonts(styleConfig.customUploadedFonts);
    }

    // Pre-load all logo bitmaps for this frame
    const logoBitmaps: Record<string, ImageBitmap> = {};
    if (logoOverlays && logoOverlays.length > 0) {
      await Promise.all(
        logoOverlays.map(async (logo: any) => {
          const bmp = await getLogoBitmap(logo);
          if (bmp) {
            logoBitmaps[logo.id] = bmp;
          }
        })
      );
    }

    // Align dimensions to even numbers (H.264/WebCodecs requirement)
    const alignedWidth = Math.max(2, Math.floor(vWidth / 2) * 2);
    const alignedHeight = Math.max(2, Math.floor(vHeight / 2) * 2);

    if (!offscreenCanvas || offscreenCanvas.width !== alignedWidth || offscreenCanvas.height !== alignedHeight) {
      offscreenCanvas = new OffscreenCanvas(alignedWidth, alignedHeight);
      ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    }

    if (!ctx || !offscreenCanvas) {
      throw new Error('Render context creation failed in task worker');
    }

    // Clear canvas before drawing to make sure no leftover garbage from any previous crash/draw remains
    ctx.clearRect(0, 0, alignedWidth, alignedHeight);

    // Draw the overlay
    drawSubtitleOverlay(
      ctx,
      frameSource,
      alignedWidth,
      alignedHeight,
      currentTime,
      subtitles,
      styleConfig,
      blurOverlays,
      logoOverlays,
      textOverlays,
      logoBitmaps
    );
    
    if (frameSource && typeof frameSource.close === 'function') {
      frameSource.close(); // Immediate memory cleanup of original frame
    }

    // Extract the high-performance rendered bitmap
    const renderedBitmap = offscreenCanvas.transferToImageBitmap();

    // Send the rendered bitmap back using zero-copy transfer
    (self.postMessage as any)({
      type: 'RENDER_DONE',
      renderedBitmap,
      frameIdx,
      timestampUs,
      isKeyFrame,
      currentTime,
    }, [renderedBitmap]);

  } catch (err: any) {
    if (frameSource && typeof frameSource.close === 'function') {
      frameSource.close();
    }
    self.postMessage({
      type: 'RENDER_ERROR',
      frameIdx,
      error: err?.message || 'Parallel rendering failed',
    });
  }
}

self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;

  if (type === 'RENDER') {
    renderQueuePromise = renderQueuePromise
      .then(() => processRenderTask(e.data))
      .catch((err) => {
        console.error('[Task Worker] Uncaught render queue error:', err);
      });
  }
};
