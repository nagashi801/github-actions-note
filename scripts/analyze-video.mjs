import {
  GoogleGenAI,
  createPartFromBase64,
  createPartFromUri,
  createUserContent,
} from '@google/genai';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { extractJsonFlexible } from './article-utils.mjs';
import { withGeminiRetry } from './gemini-utils.mjs';

const artifactsDir = '.note-artifacts';
fs.mkdirSync(artifactsDir, { recursive: true });

const videoUrl = (process.env.VIDEO_URL || '').trim();
const apiKey = process.env.GEMINI_API_KEY || '';
const model = process.env.VIDEO_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const maxBytes = Number(process.env.VIDEO_MAX_BYTES || 300 * 1024 * 1024);
const inlineMaxBytes = Number(process.env.VIDEO_INLINE_MAX_BYTES || 20 * 1024 * 1024);
const segmentSeconds = Number(process.env.VIDEO_SEGMENT_SECONDS || 5);
const maxSegments = Number(process.env.VIDEO_MAX_SEGMENTS || 12);
const downloadPath = path.join(artifactsDir, 'source-video');
const segmentsDir = path.join(artifactsDir, 'video-segments');

function writeDisabled(reason) {
  const out = {
    enabled: false,
    reason,
    sourceUrl: videoUrl,
    downloaded: false,
    confirmedVideo: false,
    analysis: null,
  };
  fs.writeFileSync(path.join(artifactsDir, 'video-analysis.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(artifactsDir, 'video-analysis.md'), `Video analysis skipped: ${reason}\n`);
}

function failBeforeApi(message) {
  const out = {
    enabled: true,
    sourceUrl: videoUrl,
    downloaded: false,
    confirmedVideo: false,
    error: message,
  };
  fs.writeFileSync(path.join(artifactsDir, 'video-analysis.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(artifactsDir, 'video-analysis.md'), `Video analysis failed before API use: ${message}\n`);
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function normalizeSharedUrl(rawUrl) {
  const url = new URL(rawUrl);

  if (url.hostname === 'drive.google.com') {
    const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
    const id = fileMatch?.[1] || url.searchParams.get('id');
    if (id) {
      return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
    }
  }

  if (url.hostname.endsWith('dropbox.com')) {
    url.searchParams.set('dl', '1');
    return url.toString();
  }

  return rawUrl;
}

function extensionForMime(mime) {
  const map = new Map([
    ['video/mp4', '.mp4'],
    ['video/mpeg', '.mpeg'],
    ['video/quicktime', '.mov'],
    ['video/avi', '.avi'],
    ['video/x-msvideo', '.avi'],
    ['video/x-flv', '.flv'],
    ['video/mpg', '.mpg'],
    ['video/webm', '.webm'],
    ['video/wmv', '.wmv'],
    ['video/x-ms-wmv', '.wmv'],
    ['video/3gpp', '.3gp'],
  ]);
  return map.get(String(mime || '').split(';')[0].trim().toLowerCase()) || '.bin';
}

function sniffVideo(buffer) {
  if (buffer.length >= 12 && buffer.slice(4, 8).toString('ascii') === 'ftyp') {
    const majorBrand = buffer.slice(8, 12).toString('ascii').trim();
    if (majorBrand === 'qt') return 'video/quicktime';
    return 'video/mp4';
  }
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'video/webm';
  if (buffer.length >= 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 11).toString('ascii') === 'AVI') return 'video/avi';
  if (buffer.length >= 3 && buffer.slice(0, 3).equals(Buffer.from([0x00, 0x00, 0x01]))) return 'video/mpeg';
  if (buffer.length >= 4 && buffer.slice(0, 3).toString('ascii') === 'FLV') return 'video/x-flv';
  if (buffer.length >= 4 && buffer.slice(0, 4).equals(Buffer.from([0x30, 0x26, 0xb2, 0x75]))) return 'video/wmv';
  return '';
}

function isHtml(buffer, contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('text/html')) return true;
  const head = buffer.slice(0, 512).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

function runTool(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    failBeforeApi(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    failBeforeApi(`${label} failed with exit code ${result.status}: ${result.stderr || result.stdout}`);
  }
  return result;
}

function assertTool(command) {
  const result = spawnSync(command, ['-version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    failBeforeApi(`${command} is required for video segmentation but was not found`);
  }
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const secs = String(safe % 60).padStart(2, '0');
  return `${minutes}:${secs}`;
}

function splitVideoForAnalysis(downloaded) {
  if (!segmentSeconds || segmentSeconds <= 0) {
    return [{
      path: downloaded.path,
      mimeType: downloaded.mimeType,
      bytes: downloaded.bytes,
      index: 0,
      timeRange: '0:00-end',
    }];
  }

  assertTool('ffmpeg');
  fs.rmSync(segmentsDir, { recursive: true, force: true });
  fs.mkdirSync(segmentsDir, { recursive: true });

  const pattern = path.join(segmentsDir, 'segment-%03d.mp4');
  runTool('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', downloaded.path,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-map_metadata', '-1',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'baseline',
    '-level', '3.0',
    '-r', '15',
    '-vf', 'scale=360:-2',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-f', 'segment',
    '-segment_time', String(segmentSeconds),
    '-reset_timestamps', '1',
    pattern,
  ], 'ffmpeg video segmentation');

  const segmentFiles = fs.readdirSync(segmentsDir)
    .filter(name => /^segment-\d+\.mp4$/.test(name))
    .sort()
    .slice(0, maxSegments);

  if (!segmentFiles.length) {
    failBeforeApi('ffmpeg did not produce any video segments');
  }

  return segmentFiles.map((name, index) => {
    const fullPath = path.join(segmentsDir, name);
    const stat = fs.statSync(fullPath);
    const start = index * segmentSeconds;
    const end = start + segmentSeconds;
    return {
      path: fullPath,
      mimeType: 'video/mp4',
      bytes: stat.size,
      index,
      timeRange: `${formatTime(start)}-${formatTime(end)}`,
    };
  });
}

async function createVideoPartForInput(ai, input) {
  if (input.bytes <= inlineMaxBytes) {
    return {
      inputMethod: 'inline_data',
      geminiFile: null,
      part: createPartFromBase64(
        fs.readFileSync(input.path, 'base64'),
        input.mimeType,
      ),
    };
  }

  const uploaded = await withGeminiRetry(`Gemini video file upload segment ${input.index + 1}`, () => ai.files.upload({
    file: input.path,
    config: { mimeType: input.mimeType },
  }));

  let file = uploaded;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (!file?.state || file.state === 'ACTIVE') break;
    if (file.state === 'FAILED') {
      throw new Error(`Gemini File API failed to process segment ${input.index + 1}`);
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
    file = await ai.files.get({ name: file.name });
  }

  if (file?.state && file.state !== 'ACTIVE') {
    throw new Error(`Gemini File API did not finish processing segment ${input.index + 1}. state=${file.state}`);
  }

  return {
    inputMethod: 'file_api',
    geminiFile: {
      name: file.name,
      uri: file.uri,
      mimeType: file.mimeType || input.mimeType,
      state: file.state || 'ACTIVE',
    },
    part: createPartFromUri(file.uri, file.mimeType || input.mimeType),
  };
}

async function downloadAndConfirm(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  let response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'github-actions-note/1.0',
        accept: 'video/*,application/octet-stream,*/*;q=0.8',
      },
    });
  } catch (error) {
    clearTimeout(timer);
    failBeforeApi(`video_url could not be fetched: ${error.message}`);
  }
  clearTimeout(timer);

  if (!response.ok) {
    failBeforeApi(`video_url returned HTTP ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    failBeforeApi('video_url response body is empty');
  }

  const contentType = response.headers.get('content-type') || '';
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) {
    failBeforeApi(`video file is too large: ${declaredLength} bytes exceeds VIDEO_MAX_BYTES=${maxBytes}`);
  }

  let total = 0;
  const headChunks = [];
  const capture = new Transform({
    transform(chunk, encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new Error(`video file is too large: exceeds VIDEO_MAX_BYTES=${maxBytes}`));
        return;
      }
      if (Buffer.concat(headChunks).length < 4096) {
        headChunks.push(Buffer.from(chunk));
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(response.body), capture, fs.createWriteStream(downloadPath));
  } catch (error) {
    failBeforeApi(`video_url download failed: ${error.message}`);
  }

  if (total === 0) {
    failBeforeApi('video_url downloaded 0 bytes');
  }

  const head = Buffer.concat(headChunks).slice(0, 4096);
  if (isHtml(head, contentType)) {
    failBeforeApi('video_url returned an HTML page, not a direct video file. Use a public direct-download URL.');
  }

  const sniffedMime = sniffVideo(head);
  const headerMime = String(contentType).split(';')[0].trim().toLowerCase();
  const confirmedMime = sniffedMime || (headerMime.startsWith('video/') ? headerMime : '');
  if (!confirmedMime) {
    failBeforeApi(`downloaded file could not be confirmed as a supported video. content-type="${contentType}"`);
  }

  const finalPath = `${downloadPath}${extensionForMime(confirmedMime)}`;
  fs.renameSync(downloadPath, finalPath);
  return { path: finalPath, mimeType: confirmedMime, bytes: total, contentType };
}

if (!videoUrl) {
  writeDisabled('video_url is empty');
  process.exit(0);
}

let normalizedUrl;
try {
  normalizedUrl = normalizeSharedUrl(videoUrl);
  new URL(normalizedUrl);
} catch {
  failBeforeApi('video_url is not a valid URL');
}

const downloaded = await downloadAndConfirm(normalizedUrl);
console.log(`VIDEO_CONFIRMED=${downloaded.mimeType} ${downloaded.bytes} bytes`);

if (!apiKey) {
  failBeforeApi('GEMINI_API_KEY secret is not set');
}

const ai = new GoogleGenAI({ apiKey });
console.log(`VIDEO_MODEL=${model}`);
const videoInputs = splitVideoForAnalysis(downloaded);
console.log(`VIDEO_SEGMENTS=${videoInputs.length} segment_seconds=${segmentSeconds} max_segments=${maxSegments}`);

const analysisPrompt = [
  'Analyze this video as source material for a Japanese note.com article.',
  'Return compact JSON text only.',
  'Do not use markdown fences or explanatory prose.',
  'Keep the analysis concise. Do not explain production steps.',
  'Only extract what is directly visible or audible.',
  'Do not invent a different story, character, tone, scene order, narration, or telop style.',
  'If audio or on-screen text is unclear, write "unclear".',
  'Limit sceneFlow to at most 8 scenes.',
  '',
  'Return this shape:',
  JSON.stringify({
    summary: '',
    genre: '',
    tone: '',
    sceneFlow: [
      {
        scene: 1,
        timeRange: '0:00-0:03',
        visible: '',
        audio: '',
        onScreenText: '',
        motion: '',
      },
    ],
    notableEditing: [],
    uncertainty: [],
  }, null, 2),
].join('\n');

const segmentResults = [];
for (const input of videoInputs) {
  const videoInput = await createVideoPartForInput(ai, input);
  console.log(`VIDEO_SEGMENT_INPUT=${input.index + 1}/${videoInputs.length} ${videoInput.inputMethod} ${input.bytes}/${inlineMaxBytes} bytes ${input.timeRange}`);
  const response = await withGeminiRetry(`Gemini video analysis segment ${input.index + 1}`, () => ai.models.generateContent({
    model,
    contents: createUserContent([
      videoInput.part,
      [
        analysisPrompt,
        '',
        `This clip is segment ${input.index + 1} of ${videoInputs.length}.`,
        `Approximate original time range: ${input.timeRange}.`,
        'Analyze only this clip.',
      ].join('\n'),
    ]),
    config: {
      temperature: 0.2,
      maxOutputTokens: 1200,
    },
  }));

  const responseText = response.text || '';
  const parsed = extractJsonFlexible(responseText) || {
    rawText: responseText,
    emptyResponse: !responseText.trim(),
    candidateCount: response.candidates?.length || 0,
    finishReasons: response.candidates?.map(candidate => candidate.finishReason).filter(Boolean) || [],
  };
  segmentResults.push({
    index: input.index,
    timeRange: input.timeRange,
    bytes: input.bytes,
    inputMethod: videoInput.inputMethod,
    geminiFile: videoInput.geminiFile,
    analysis: parsed,
  });
}

let sceneCounter = 1;
const analysis = {
  summary: segmentResults
    .map(result => result.analysis?.summary || result.analysis?.videoSummary || '')
    .filter(Boolean)
    .join(' / '),
  genre: segmentResults.find(result => result.analysis?.genre || result.analysis?.likelyGenre)?.analysis?.genre
    || segmentResults.find(result => result.analysis?.genre || result.analysis?.likelyGenre)?.analysis?.likelyGenre
    || '',
  tone: segmentResults.find(result => result.analysis?.tone)?.analysis?.tone || '',
  sceneFlow: segmentResults.flatMap((result) => {
    const flow = Array.isArray(result.analysis?.sceneFlow) ? result.analysis.sceneFlow : [];
    if (!flow.length) {
      return [{
        scene: sceneCounter++,
        timeRange: result.timeRange,
        visible: result.analysis?.visible || result.analysis?.rawText || '',
        audio: result.analysis?.audio || '',
        onScreenText: result.analysis?.onScreenText || '',
        motion: result.analysis?.motion || '',
      }];
    }
    return flow.map((scene) => ({
      scene: sceneCounter++,
      timeRange: scene.timeRange || result.timeRange,
      visible: scene.visible || scene.visibleAction || '',
      audio: scene.audio || scene.narrationOrDialogue || '',
      onScreenText: scene.onScreenText || scene.telop || '',
      motion: scene.motion || scene.cameraAndMotion || '',
    }));
  }),
  notableEditing: segmentResults.flatMap(result => Array.isArray(result.analysis?.notableEditing) ? result.analysis.notableEditing : []),
  uncertainty: segmentResults.flatMap(result => Array.isArray(result.analysis?.uncertainty) ? result.analysis.uncertainty : []),
  segments: segmentResults,
};
const out = {
  enabled: true,
  sourceUrl: videoUrl,
  normalizedUrl,
  inputMethod: 'segmented',
  inlineMaxBytes,
  segmentSeconds,
  maxSegments,
  downloaded: true,
  confirmedVideo: true,
  mimeType: downloaded.mimeType,
  bytes: downloaded.bytes,
  geminiFile: null,
  analysis,
};

fs.writeFileSync(path.join(artifactsDir, 'video-analysis.json'), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(artifactsDir, 'video-analysis.md'), [
  `# Video analysis`,
  '',
  `- Source URL: ${videoUrl}`,
  `- MIME type: ${downloaded.mimeType}`,
  `- Bytes: ${downloaded.bytes}`,
  '',
  '```json',
  JSON.stringify(analysis, null, 2),
  '```',
  '',
].join('\n'));
