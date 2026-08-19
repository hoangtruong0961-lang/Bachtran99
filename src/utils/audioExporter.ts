import { SubtitleItem } from '../types';

/**
 * Encodes an AudioBuffer into a WAV format Blob (16-bit PCM)
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  
  const length = buffer.length;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  
  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);
  
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  /* RIFF identifier */
  writeString(0, 'RIFF');
  /* RIFF chunk size */
  view.setUint32(4, 36 + dataSize, true);
  /* RIFF type */
  writeString(8, 'WAVE');
  /* format chunk identifier */
  writeString(12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw PCM) */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numChannels, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * blockAlign, true);
  /* block align */
  view.setUint16(32, blockAlign, true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(36, 'data');
  /* data chunk length */
  view.setUint32(40, dataSize, true);
  
  // Write interleaved PCM audio samples
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }
  
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][i];
      // Clamp float sample to [-1, 1]
      sample = Math.max(-1, Math.min(1, sample));
      // Scale to 16-bit signed integer [-32768, 32767]
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }
  
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Generates and renders a single synchronized AudioBuffer of the TTS voiceover.
 */
export async function generateVoiceoverAudioBuffer(
  subtitles: SubtitleItem[],
  totalVideoDuration: number = 0,
  speedMultiplier: number = 1.0,
  ttsPitch: number = 0
): Promise<{ buffer: AudioBuffer; count: number; totalDuration: number }> {
  const subsWithAudio = subtitles.filter((s) => s.audioUrl && s.audioUrl.trim().length > 0);
  
  if (subsWithAudio.length === 0) {
    throw new Error('Chưa có phụ đề nào được tạo audio thuyết minh. Vui lòng bấm "Tạo Tất Cả Audio" trước khi xuất.');
  }

  const sampleRate = 24000; // Standard TTS audio sample rate
  const channels = 1;       // Mono channel output

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const tempCtx = new AudioCtx();

  // Decode each subtitle audio URL into AudioBuffer
  const decodedBuffers: { startTime: number; buffer: AudioBuffer; speed: number; finalDuration: number }[] = [];

  for (const sub of subsWithAudio) {
    try {
      const base64Data = sub.audioUrl!.replace(/^data:audio\/\w+;base64,/, '');
      const binaryStr = atob(base64Data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const decoded = await tempCtx.decodeAudioData(bytes.buffer);
      const normalDuration = decoded.duration;
      
      // Calculate original target duration
      const targetDuration = sub.endTime - sub.startTime;
      
      // Smart Audio Fit Logic
      let appliedSpeed = sub.speed || speedMultiplier || 1.0;
      if (!sub.speed) {
        if (normalDuration > targetDuration) {
          const requiredSpeed = normalDuration / targetDuration;
          appliedSpeed = Math.min(1.35, requiredSpeed);
        }
      }
      
      const finalDuration = normalDuration / appliedSpeed;

      decodedBuffers.push({
        startTime: sub.startTime,
        buffer: decoded,
        speed: appliedSpeed,
        finalDuration,
      });
    } catch (err) {
      console.warn(`[Audio Exporter] Unable to decode TTS audio for sub ${sub.id}:`, err);
    }
  }

  if (decodedBuffers.length === 0) {
    throw new Error('Không thể giải mã dữ liệu audio thuyết minh.');
  }

  // Calculate maximum timeline duration needed based on the fitted end times
  let maxEndTime = totalVideoDuration || 0;
  for (const item of decodedBuffers) {
    const estimatedEnd = item.startTime + item.finalDuration;
    if (estimatedEnd > maxEndTime) {
      maxEndTime = estimatedEnd;
    }
  }

  // Ensure minimum duration of 1 second
  maxEndTime = Math.max(1, maxEndTime + 1);

  // Create OfflineAudioContext to render full concatenated audio track
  const offlineCtx = new OfflineAudioContext(
    channels,
    Math.ceil(sampleRate * maxEndTime),
    sampleRate
  );

  // Schedule each audio buffer at its specified startTime with its calculated playbackRate and pitch shift
  for (const item of decodedBuffers) {
    const source = offlineCtx.createBufferSource();
    source.buffer = item.buffer;
    
    // Set custom playback rate according to Smart Audio Fit calculation
    if (item.speed !== 1.0) {
      source.playbackRate.value = Math.max(0.2, Math.min(3.0, item.speed));
    }

    // Apply manual ttsPitch detuning + optional pitch compensation for playback speedup (1 semitone = 100 cents)
    // If speed > 1.0, we slightly compensate pitch downwards (-cents) to neutralize the "chipmunk" shift if desired,
    // or apply exact user-configured ttsPitch detune.
    let totalDetuneCents = ttsPitch * 100;
    if (item.speed > 1.0) {
      // Natural pitch compensation: counter playbackRate pitch shift (cents = 1200 * log2(1/speed))
      const pitchCompensationCents = -1200 * Math.log2(item.speed);
      totalDetuneCents += pitchCompensationCents;
    }

    const clampedDetune = Math.max(-1200, Math.min(1200, totalDetuneCents));
    if (clampedDetune !== 0) {
      source.detune.value = clampedDetune;
    }
    
    source.connect(offlineCtx.destination);
    source.start(item.startTime);
  }

  // Render composite audio
  const renderedBuffer = await offlineCtx.startRendering();

  return {
    buffer: renderedBuffer,
    count: decodedBuffers.length,
    totalDuration: maxEndTime,
  };
}

/**
 * Merges all available TTS audio clips from subtitles into a single synchronized WAV file.
 */
export async function generateVoiceoverWav(
  subtitles: SubtitleItem[],
  totalVideoDuration: number = 0,
  speedMultiplier: number = 1.0,
  ttsPitch: number = 0
): Promise<{ blob: Blob; count: number; totalDuration: number }> {
  const { buffer, count, totalDuration } = await generateVoiceoverAudioBuffer(
    subtitles,
    totalVideoDuration,
    speedMultiplier,
    ttsPitch
  );

  // Convert to WAV Blob
  const wavBlob = audioBufferToWavBlob(buffer);

  return {
    blob: wavBlob,
    count,
    totalDuration,
  };
}
