import React from 'react';
import { SubtitleStyleConfig } from '../types';

interface OutlinedSubtitleTextProps {
  text: string;
  styleConfig: Partial<SubtitleStyleConfig>;
  scaleFactor?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Optional karaoke timestamp word highlight array */
  timestamps?: Array<{ word: string; start: number; end: number }>;
  currentTime?: number;
  startTime?: number;
}

/**
 * Renders subtitle text with 100% vector-smooth round outline stroke.
 * Uses SVG text elements with stroke-linejoin="round" and stroke-linecap="round"
 * to guarantee that large/bold fonts never produce miter spikes ("gai / tua rua").
 */
export const OutlinedSubtitleText: React.FC<OutlinedSubtitleTextProps> = ({
  text,
  styleConfig,
  scaleFactor = 1,
  className = '',
  style = {},
  timestamps,
  currentTime = 0,
  startTime = 0,
}) => {
  const fontColor = styleConfig.fontColor || '#ffffff';
  const outlineColor = styleConfig.outlineColor || '#000000';
  const rawOutlineWidth = Math.max(0, styleConfig.outlineWidth ?? 3);
  const textOutline = styleConfig.textOutline !== false && rawOutlineWidth > 0;
  
  // Calculate primary scaled outline width (SVG stroke is centered on path, so double for total outer width)
  const strokeWidth = textOutline ? rawOutlineWidth * scaleFactor * 2 : 0;

  // Secondary outline (viền kép / outer sticker border)
  const hasSecondaryOutline = styleConfig.hasSecondaryOutline === true ||
    (typeof styleConfig.secondaryOutlineWidth === 'number' && styleConfig.secondaryOutlineWidth > 0 && styleConfig.hasSecondaryOutline !== false);
  const secondaryOutlineColor = styleConfig.secondaryOutlineColor || '#000000';
  const rawSecondaryOutlineWidth = Math.max(0, styleConfig.secondaryOutlineWidth ?? 4);
  const secondaryStrokeWidth = (hasSecondaryOutline && rawSecondaryOutlineWidth > 0)
    ? (rawOutlineWidth + rawSecondaryOutlineWidth) * scaleFactor * 2
    : 0;
  
  const fontSize = (styleConfig.fontSize || 16) * scaleFactor;
  const fontWeight = styleConfig.fontWeight || 'bold';
  const fontStyle = styleConfig.fontStyle || 'normal';
  const fontFamily = styleConfig.fontFamily || 'system-ui, sans-serif';

  // Background box styling if enabled
  const hasBackground = styleConfig.hasBackground === true;
  const backgroundColor = styleConfig.backgroundColor || '#000000';
  const bgOpacity = styleConfig.bgOpacity ?? 65;
  
  const getRgba = (hexColor: string, opacityPercent: number) => {
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

  const bgStyle = hasBackground ? getRgba(backgroundColor, bgOpacity) : 'transparent';
  const padding = hasBackground ? `${(styleConfig.padding || 6) * scaleFactor}px` : '0px';
  const borderRadius = `${(styleConfig.borderRadius ?? 8) * scaleFactor}px`;

  // Process multiline text
  const lines = text.split('\n');

  // Handle karaoke timestamps mode if present
  const hasKaraoke = timestamps && timestamps.length > 0;

  if (hasKaraoke) {
    const relTime = currentTime - startTime;
    return (
      <span
        className={`inline-block ${className}`}
        style={{
          fontFamily,
          fontSize: `${fontSize}px`,
          fontWeight,
          fontStyle,
          backgroundColor: bgStyle,
          padding,
          borderRadius,
          lineHeight: '1.35',
          textAlign: 'center',
          writingMode: styleConfig.orientation === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
          textOrientation: styleConfig.orientation === 'vertical' ? 'upright' : undefined,
          ...style,
        }}
      >
        {timestamps.map((ts, idx) => {
          const isActive = relTime >= ts.start && relTime <= ts.end;
          const wordColor = isActive ? '#facc15' : fontColor;
          return (
            <span
              key={idx}
              className={`inline-block relative transition-transform duration-75 ${
                isActive ? 'transform scale-105' : ''
              }`}
              style={{
                marginRight: '0.25em',
                filter: styleConfig.textShadowColor
                  ? `drop-shadow(0px ${(2 * scaleFactor).toFixed(1)}px ${(4 * scaleFactor).toFixed(1)}px ${styleConfig.textShadowColor})`
                  : `drop-shadow(0px ${(2 * scaleFactor).toFixed(1)}px ${(4 * scaleFactor).toFixed(1)}px rgba(0,0,0,0.85))`,
              }}
            >
              <svg
                className="overflow-visible inline-block align-baseline"
                style={{
                  height: `${fontSize * 1.3}px`,
                  verticalAlign: '-0.15em',
                }}
              >
                {/* Secondary (Outer) stroke text for viền kép */}
                {secondaryStrokeWidth > 0 && (
                  <text
                    x="50%"
                    y="75%"
                    textAnchor="middle"
                    fill={secondaryOutlineColor}
                    stroke={secondaryOutlineColor}
                    strokeWidth={secondaryStrokeWidth}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    fontFamily={fontFamily}
                    fontSize={fontSize}
                    fontWeight={fontWeight}
                    fontStyle={fontStyle}
                  >
                    {ts.word}
                  </text>
                )}
                {/* Primary (Middle) stroke text */}
                {strokeWidth > 0 && (
                  <text
                    x="50%"
                    y="75%"
                    textAnchor="middle"
                    fill={outlineColor}
                    stroke={outlineColor}
                    strokeWidth={strokeWidth}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    fontFamily={fontFamily}
                    fontSize={fontSize}
                    fontWeight={fontWeight}
                    fontStyle={fontStyle}
                  >
                    {ts.word}
                  </text>
                )}
                <text
                  x="50%"
                  y="75%"
                  textAnchor="middle"
                  fill={wordColor}
                  fontFamily={fontFamily}
                  fontSize={fontSize}
                  fontWeight={fontWeight}
                  fontStyle={fontStyle}
                >
                  {ts.word}
                </text>
              </svg>
            </span>
          );
        })}
      </span>
    );
  }

  return (
    <span
      className={`inline-block ${className}`}
      style={{
        fontFamily,
        fontSize: `${fontSize}px`,
        fontWeight,
        fontStyle,
        backgroundColor: bgStyle,
        padding,
        borderRadius,
        lineHeight: '1.35',
        textAlign: 'center',
        writingMode: styleConfig.orientation === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
        textOrientation: styleConfig.orientation === 'vertical' ? 'upright' : undefined,
        filter: styleConfig.textShadowColor
          ? `drop-shadow(0px ${(2 * scaleFactor).toFixed(1)}px ${(4 * scaleFactor).toFixed(1)}px ${styleConfig.textShadowColor})`
          : `drop-shadow(0px ${(2 * scaleFactor).toFixed(1)}px ${(4 * scaleFactor).toFixed(1)}px rgba(0,0,0,0.85))`,
        ...style,
      }}
    >
      <span className="flex flex-col items-center justify-center">
        {lines.map((line, lineIdx) => (
          <span key={lineIdx} className="relative inline-block my-[0.05em]">
            <svg
              className="overflow-visible block"
              style={{
                height: `${fontSize * 1.3}px`,
                minWidth: '1em',
              }}
            >
              {/* Secondary (Outer) round stroke text for viền kép */}
              {secondaryStrokeWidth > 0 && (
                <text
                  x="50%"
                  y="75%"
                  textAnchor="middle"
                  fill={secondaryOutlineColor}
                  stroke={secondaryOutlineColor}
                  strokeWidth={secondaryStrokeWidth}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fontFamily={fontFamily}
                  fontSize={fontSize}
                  fontWeight={fontWeight}
                  fontStyle={fontStyle}
                  style={{
                    textTransform: (styleConfig.textTransform as any) || 'none',
                  }}
                >
                  {line}
                </text>
              )}
              {/* Primary (Middle) round stroke text */}
              {strokeWidth > 0 && (
                <text
                  x="50%"
                  y="75%"
                  textAnchor="middle"
                  fill={outlineColor}
                  stroke={outlineColor}
                  strokeWidth={strokeWidth}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fontFamily={fontFamily}
                  fontSize={fontSize}
                  fontWeight={fontWeight}
                  fontStyle={fontStyle}
                  style={{
                    textTransform: (styleConfig.textTransform as any) || 'none',
                  }}
                >
                  {line}
                </text>
              )}
              {/* Inner main text fill */}
              <text
                x="50%"
                y="75%"
                textAnchor="middle"
                fill={fontColor}
                fontFamily={fontFamily}
                fontSize={fontSize}
                fontWeight={fontWeight}
                fontStyle={fontStyle}
                style={{
                  textTransform: (styleConfig.textTransform as any) || 'none',
                }}
              >
                {line}
              </text>
            </svg>
          </span>
        ))}
      </span>
    </span>
  );
};
