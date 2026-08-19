import { SubtitleItem } from '../types';
import { refineBoundaryTimestamps } from './ocrPostprocessing';

export function formatTimeSRT(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const pad = (num: number, size = 2) => num.toString().padStart(size, '0');
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(ms, 3)}`;
}

export function formatTimeVTT(seconds: number): string {
  return formatTimeSRT(seconds).replace(',', '.');
}

export function formatTimeShort(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const pad = (num: number) => num.toString().padStart(2, '0');
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${pad(mins)}:${pad(secs)}.${ms}`;
}

export function exportToSRT(
  subtitles: SubtitleItem[],
  mode: 'translated' | 'original' | 'bilingual' = 'translated'
): string {
  return subtitles
    .map((sub, index) => {
      let text = sub.translatedText || sub.originalText || '';
      if (mode === 'original') {
        text = sub.originalText || sub.translatedText || '';
      } else if (mode === 'bilingual') {
        const orig = (sub.originalText || '').trim();
        const trans = (sub.translatedText || '').trim();
        text = orig && trans && orig !== trans ? `${orig}\n${trans}` : (trans || orig);
      }
      return `${index + 1}\n${formatTimeSRT(sub.startTime)} --> ${formatTimeSRT(sub.endTime)}\n${text}\n`;
    })
    .join('\n');
}

export function exportToVTT(
  subtitles: SubtitleItem[],
  mode: 'translated' | 'original' | 'bilingual' = 'translated'
): string {
  let content = 'WEBVTT\n\n';
  content += subtitles
    .map((sub, index) => {
      let text = sub.translatedText || sub.originalText || '';
      if (mode === 'original') {
        text = sub.originalText || sub.translatedText || '';
      } else if (mode === 'bilingual') {
        const orig = (sub.originalText || '').trim();
        const trans = (sub.translatedText || '').trim();
        text = orig && trans && orig !== trans ? `${orig}\n${trans}` : (trans || orig);
      }
      return `${index + 1}\n${formatTimeVTT(sub.startTime)} --> ${formatTimeVTT(sub.endTime)}\n${text}\n`;
    })
    .join('\n');
  return content;
}

export function exportToTXT(
  subtitles: SubtitleItem[],
  mode: 'translated' | 'original' | 'bilingual' = 'translated'
): string {
  return subtitles
    .map((sub) => {
      const time = `[${formatTimeShort(sub.startTime)} - ${formatTimeShort(sub.endTime)}]`;
      let text = sub.translatedText || sub.originalText || '';
      if (mode === 'original') {
        text = sub.originalText || sub.translatedText || '';
      } else if (mode === 'bilingual') {
        const orig = (sub.originalText || '').trim();
        const trans = (sub.translatedText || '').trim();
        text = orig && trans && orig !== trans ? `${orig}\n${trans}` : (trans || orig);
      }
      return `${time}\n${text}\n`;
    })
    .join('\n');
}

export function parseSRT(srtContent: string): SubtitleItem[] {
  const items: SubtitleItem[] = [];
  const blocks = srtContent.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      let timeLineIdx = lines.findIndex((l) => l.includes('-->'));
      if (timeLineIdx !== -1) {
        const timeParts = lines[timeLineIdx].split('-->');
        if (timeParts.length === 2) {
          const startTime = parseTimeToSeconds(timeParts[0].trim());
          const endTime = parseTimeToSeconds(timeParts[1].trim());
          const text = lines.slice(timeLineIdx + 1).join('\n');

          items.push({
            id: `imported-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            startTime,
            endTime,
            originalText: text,
            translatedText: text,
          });
        }
      }
    }
  }

  return normalizeSubtitles(items);
}

export function getLevenshteinDistance(str1: string, str2: string): number {
  const track = Array(str2.length + 1).fill(null).map(() =>
    Array(str1.length + 1).fill(null));
  for (let i = 0; i <= str1.length; i += 1) {
    track[0][i] = i;
  }
  for (let j = 0; j <= str2.length; j += 1) {
    track[j][0] = j;
  }
  for (let j = 1; j <= str2.length; j += 1) {
    for (let i = 1; i <= str1.length; i += 1) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1,
        track[j - 1][i] + 1,
        track[j - 1][i - 1] + indicator
      );
    }
  }
  return track[str2.length][str1.length];
}

export function stripDiacritics(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export function getTextQualityScore(text: string): number {
  if (!text) return 0;
  let score = text.length;
  // Count diacritics / accent marks (Vietnamese / CJK / Latin accented characters)
  const diacriticsCount = (text.match(/[\u00C0-\u024F\u1EA0-\u1EF9]/g) || []).length;
  score += diacriticsCount * 3;
  // Penalty for strange noise symbols
  const noiseSymbols = (text.match(/[^\p{L}\p{N}\s,.-]/gu) || []).length;
  score -= noiseSymbols * 2;
  return score;
}

export function areTextsSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  // Use Unicode Property Escapes (\p{L}\p{N}) with global/unicode flags to preserve ALL letters across Vietnamese, Chinese, English, etc.
  const cleanA = a.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const cleanB = b.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

  if (cleanA === cleanB) return true;
  if (!cleanA || !cleanB) return false;

  // Compare diacritics-stripped base text (e.g., "xinchàocácbạn" vs "xinchaocacban")
  const baseA = stripDiacritics(cleanA);
  const baseB = stripDiacritics(cleanB);
  if (baseA === baseB) return true;

  const minLen = Math.min(cleanA.length, cleanB.length);
  const maxLen = Math.max(cleanA.length, cleanB.length);
  if (maxLen === 0) return true;

  const lengthRatio = minLen / maxLen;

  const dist = getLevenshteinDistance(cleanA, cleanB);
  const similarity = 1 - dist / maxLen;

  // Strict similarity threshold: 0.88 to avoid merging different sentences that share common words
  return similarity >= 0.88 && lengthRatio >= 0.82;
}

export function normalizeSubtitles(subs: SubtitleItem[]): SubtitleItem[] {
  if (!subs || subs.length === 0) return [];

  // 1. Remove empty items
  const valid = subs.filter(
    (s) =>
      (s.originalText && s.originalText.trim().length > 0) ||
      (s.translatedText && s.translatedText.trim().length > 0)
  );

  // 2. Sort strictly by startTime ascending
  valid.sort((a, b) => a.startTime - b.startTime);

  // 3. Deduplicate and merge overlapping or adjacent items ONLY if they have identical/similar text
  const merged: SubtitleItem[] = [];
  for (const item of valid) {
    if (merged.length === 0) {
      merged.push({ ...item });
      continue;
    }

    const prev = merged[merged.length - 1];
    const origA = (prev.originalText || '').trim();
    const origB = (item.originalText || '').trim();

    const isSimilar = areTextsSimilar(origA, origB);
    const timeGap = item.startTime - prev.endTime;
    const startGap = Math.abs(item.startTime - prev.startTime);
    const overlapDuration = Math.max(0, Math.min(prev.endTime, item.endTime) - Math.max(prev.startTime, item.startTime));

    // Overlap condition: ONLY merge if text is similar AND frames overlap or are close in time
    const isOverlappingOrClose = item.startTime <= prev.endTime + 0.5 || timeGap <= 0.5 || (startGap <= 1.0 && overlapDuration > 0.1);

    if (isSimilar && isOverlappingOrClose) {
      // Merge into previous item and pick the highest quality text representation
      prev.endTime = Math.max(prev.endTime, item.endTime);
      prev.startTime = Math.min(prev.startTime, item.startTime);

      const scoreA = getTextQualityScore(origA);
      const scoreB = getTextQualityScore(origB);

      if (scoreB > scoreA) {
        prev.originalText = origB;
      }
      if (!prev.translatedText && item.translatedText) {
        prev.translatedText = item.translatedText;
      }
    } else {
      merged.push({ ...item });
    }
  }

  // 4. Adjust end times & refine boundary timestamps using BoundaryRefiner
  return refineBoundaryTimestamps(merged);
}

function parseTimeToSeconds(timeStr: string): number {
  const cleaned = timeStr.replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    const hrs = parseFloat(parts[0]);
    const mins = parseFloat(parts[1]);
    const secs = parseFloat(parts[2]);
    return hrs * 3600 + mins * 60 + secs;
  } else if (parts.length === 2) {
    const mins = parseFloat(parts[0]);
    const secs = parseFloat(parts[1]);
    return mins * 60 + secs;
  }
  return 0;
}

export function wrapSubtitleText(
  text: string,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
  maxCharsH: number = 65,
  maxCharsV: number = 36
): string {
  if (!text) return '';
  const limit = Math.max(3, orientation === 'vertical' ? (maxCharsV || 36) : (maxCharsH || 65));

  const rawLines = text.split('\n');
  const finalLines: string[] = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const pushWithLimit = (str: string) => {
      let remaining = str;
      while (remaining.length > limit) {
        finalLines.push(remaining.slice(0, limit));
        remaining = remaining.slice(limit);
      }
      if (remaining.length > 0) {
        finalLines.push(remaining);
      }
    };

    if (trimmed.length <= limit) {
      finalLines.push(trimmed);
      continue;
    }

    const hasSpaces = trimmed.includes(' ');

    if (orientation === 'vertical' || !hasSpaces) {
      pushWithLimit(trimmed);
    } else {
      const words = trimmed.split(/\s+/);
      let currentLine = '';

      for (const word of words) {
        if (!word) continue;

        if (word.length > limit) {
          if (currentLine) {
            finalLines.push(currentLine);
            currentLine = '';
          }
          pushWithLimit(word);
          continue;
        }

        const candidate = currentLine ? `${currentLine} ${word}` : word;
        if (candidate.length <= limit) {
          currentLine = candidate;
        } else {
          if (currentLine) finalLines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) {
        finalLines.push(currentLine);
      }
    }
  }

  return finalLines.join('\n');
}

export function resolveOverlapsWithPriority(subs: SubtitleItem[], priorityId?: string | null): SubtitleItem[] {
  if (!subs || subs.length <= 1) return subs || [];
  
  // Sort by startTime
  const sorted = [...subs].sort((a, b) => a.startTime - b.startTime);
  
  if (priorityId) {
    const priorityIdx = sorted.findIndex(s => s.id === priorityId);
    if (priorityIdx !== -1) {
      // Adjust items before priority (going backwards)
      for (let i = priorityIdx - 1; i >= 0; i--) {
        const curr = sorted[i];
        const next = sorted[i + 1]; // This is closer to priority or is priority itself
        if (curr.endTime > next.startTime - 0.02) {
          curr.endTime = Number(Math.max(curr.startTime + 0.1, next.startTime - 0.02).toFixed(2));
          if (curr.startTime > curr.endTime - 0.1) {
            curr.startTime = Number(Math.max(0, curr.endTime - 0.1).toFixed(2));
          }
        }
      }
      // Adjust items after priority (going forwards)
      for (let i = priorityIdx + 1; i < sorted.length; i++) {
        const curr = sorted[i];
        const prev = sorted[i - 1]; // This is closer to priority or is priority itself
        if (curr.startTime < prev.endTime + 0.02) {
          curr.startTime = Number((prev.endTime + 0.02).toFixed(2));
          if (curr.endTime < curr.startTime + 0.1) {
            curr.endTime = Number((curr.startTime + 0.1).toFixed(2));
          }
        }
      }
      return sorted;
    }
  }
  
  // Standard non-overlap pass if no priorityId specified
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev.endTime >= curr.startTime) {
      prev.endTime = Number(Math.max(prev.startTime + 0.1, curr.startTime - 0.02).toFixed(2));
      if (curr.startTime < prev.endTime + 0.02) {
        curr.startTime = Number((prev.endTime + 0.02).toFixed(2));
      }
      if (curr.endTime < curr.startTime + 0.1) {
        curr.endTime = Number((curr.startTime + 0.1).toFixed(2));
      }
    }
  }
  return sorted;
}
