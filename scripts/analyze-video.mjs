import { GoogleGenAI, createPartFromUri, createUserContent } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { extractJsonFlexible } from './article-utils.mjs';
import { withGeminiRetry } from './gemini-utils.mjs';

const artifactsDir = '.note-artifacts';
fs.mkdirSync(artifactsDir, { recursive: true });

const videoUrl = (process.env.VIDEO_URL || '').trim();
const apiKey = process.env.GEMINI_API_KEY || '';
const model = process.env.VIDEO_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-pro';
const maxBytes = Number(process.env.VIDEO_MAX_BYTES || 300 * 1024 * 1024);
const downloadPath = path.join(artifactsDir, 'source-video');

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
  if (buffer.length >= 12 && buffer.slice(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
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
const uploaded = await withGeminiRetry('Gemini video file upload', () => ai.files.upload({
  file: downloaded.path,
  config: { mimeType: downloaded.mimeType },
}));

let file = uploaded;
for (let attempt = 0; attempt < 30; attempt++) {
  if (!file?.state || file.state === 'ACTIVE') break;
  if (file.state === 'FAILED') {
    throw new Error('Gemini File API failed to process the uploaded video');
  }
  await new Promise(resolve => setTimeout(resolve, 5000));
  file = await ai.files.get({ name: file.name });
}

if (file?.state && file.state !== 'ACTIVE') {
  throw new Error(`Gemini File API did not finish processing the video. state=${file.state}`);
}

const analysisPrompt = [
  'Analyze this video as source material for a Japanese note.com article about how the video was made with AI tools.',
  'Return JSON only.',
  'Do not invent a different story, character, tone, scene order, narration, or telop style.',
  'Extract what is visible and audible. If audio or text is unclear, say so.',
  'The article will reverse-engineer production steps, so focus on scene flow, production assets needed, and manual placeholders.',
  '',
  'Return this shape:',
  JSON.stringify({
    videoSummary: '',
    likelyGenre: '',
    tone: '',
    characterContinuity: '',
    sceneFlow: [
      {
        scene: 1,
        timeRange: '0:00-0:03',
        visibleAction: '',
        narrationOrDialogue: '',
        telop: '',
        cameraAndMotion: '',
        productionPurpose: '',
      },
    ],
    reverseProductionPlan: {
      chatGptShouldCreate: [],
      geminiShouldCreate: [],
      klingShouldAnimate: [],
      capCutShouldEdit: [],
    },
    requiredManualPlaceholders: [],
    articleWarnings: [],
  }, null, 2),
].join('\n');

const response = await withGeminiRetry('Gemini video analysis generateContent', () => ai.models.generateContent({
  model,
  contents: createUserContent([
    createPartFromUri(file.uri, file.mimeType || downloaded.mimeType),
    analysisPrompt,
  ]),
  config: {
    temperature: 0.2,
    maxOutputTokens: 12000,
    responseMimeType: 'application/json',
  },
}));

const analysis = extractJsonFlexible(response.text || '') || { rawText: response.text || '' };
const out = {
  enabled: true,
  sourceUrl: videoUrl,
  normalizedUrl,
  downloaded: true,
  confirmedVideo: true,
  mimeType: downloaded.mimeType,
  bytes: downloaded.bytes,
  geminiFile: {
    name: file.name,
    uri: file.uri,
    mimeType: file.mimeType || downloaded.mimeType,
    state: file.state || 'ACTIVE',
  },
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
