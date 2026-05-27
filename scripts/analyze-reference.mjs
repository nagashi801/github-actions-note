import { GoogleGenAI } from '@google/genai';
import { chromium } from 'playwright';
import fs from 'fs';

const artifactsDir = '.note-artifacts';
fs.mkdirSync(artifactsDir, { recursive: true });

const referenceUrl = String(process.env.REFERENCE_URL || '').trim();
const referenceMode = String(process.env.REFERENCE_MODE || 'none').trim();
const originalAngle = String(process.env.ORIGINAL_ANGLE || '').trim();
const demoTopic = String(process.env.DEMO_TOPIC || '').trim();
const toolsUsed = String(process.env.TOOLS_USED || '').trim();
const assetUrls = String(process.env.ASSET_URLS || '').trim();

function writeEmpty(reason) {
  const out = {
    enabled: false,
    reason,
    referenceMode,
    referenceUrl,
    originalAngle,
    demoTopic,
    toolsUsed,
    assetUrls,
  };
  fs.writeFileSync(`${artifactsDir}/reference-analysis.json`, JSON.stringify(out, null, 2));
  fs.writeFileSync(`${artifactsDir}/reference-analysis.md`, `Reference analysis skipped: ${reason}\n`);
}

if (!referenceUrl || referenceMode === 'none') {
  writeEmpty('reference_url is empty or reference_mode is none');
  process.exit(0);
}

const apiKey = process.env.GEMINI_API_KEY || '';
if (!apiKey) {
  console.error('GEMINI_API_KEY secret is not set');
  process.exit(1);
}

const statePath = process.env.STATE_PATH || '';
if (!statePath || !fs.existsSync(statePath)) {
  console.error('STATE_PATH storage state is required when using reference_url');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true, args: ['--lang=ja-JP'] });
const context = await browser.newContext({ storageState: statePath, locale: 'ja-JP' });
const page = await context.newPage();
await page.goto(referenceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(4000);

const extracted = await page.evaluate(() => {
  const text = document.body?.innerText || '';
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4')).map(el => ({
    tag: el.tagName,
    text: (el.innerText || el.textContent || '').trim(),
  })).filter(h => h.text);
  const images = Array.from(document.querySelectorAll('img')).map((img, index) => ({
    index,
    alt: img.alt || '',
    width: img.naturalWidth || 0,
    height: img.naturalHeight || 0,
  }));
  const codeLikeBlocks = Array.from(document.querySelectorAll('pre, code')).map(el => (
    el.innerText || el.textContent || ''
  ).trim()).filter(Boolean).slice(0, 20);
  return {
    title: document.title,
    url: location.href,
    text,
    headings,
    imageCount: images.length,
    images,
    codeLikeBlockCount: codeLikeBlocks.length,
    codeLikeBlocks,
  };
});

await browser.close();

const ai = new GoogleGenAI({ apiKey });
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const articleText = extracted.text.slice(0, 30000);

const system = [
  'You analyze Japanese note.com articles for reusable article-craft patterns.',
  'Return only JSON.',
  'Do not copy or preserve the source article wording.',
  'Extract the explanation pattern, demonstration rhythm, media placement, prompt/code-block usage, failure/improvement flow, and CTA style.',
  'The downstream article may strongly reuse the explanation pattern and granularity, but must use a different topic, examples, wording, prompts, images, and claims.',
].join('\n');

const prompt = [
  'Analyze this reference article and create a reusable blueprint for generating a new original note.com article.',
  '',
  `Reference mode: ${referenceMode}`,
  `Original angle / differentiation: ${originalAngle}`,
  `New demo topic: ${demoTopic}`,
  `Tools for new article: ${toolsUsed}`,
  `User supplied asset URLs for new article: ${assetUrls}`,
  '',
  'Return JSON with this shape:',
  JSON.stringify({
    enabled: true,
    referenceMode,
    sourceTitle: 'string',
    sourceUrl: 'string',
    accessSummary: {
      textLength: 0,
      headingCount: 0,
      imageCount: 0,
      codeLikeBlockCount: 0,
    },
    reusableExplanationPattern: [
      {
        step: 'string',
        purpose: 'string',
        recommendedLength: 'string',
        mediaOrCodeToShow: 'string',
        readerEffect: 'string',
      },
    ],
    sectionBlueprint: [
      {
        headingRole: 'string',
        headingLevel: 2,
        whatToExplain: 'string',
        showThisKindOfAsset: 'string',
        includeCodeBlock: false,
        includeFailureOrLearning: false,
      },
    ],
    toneRules: ['string'],
    mediaPlan: ['string'],
    promptBlockPlan: ['string'],
    doNotCopy: ['string'],
  }, null, 2),
  '',
  'Reference headings:',
  JSON.stringify(extracted.headings, null, 2),
  '',
  'Reference article visible text for pattern analysis only:',
  articleText,
].join('\n');

const response = await ai.models.generateContent({
  model,
  contents: prompt,
  config: {
    systemInstruction: system,
    temperature: 0.2,
    maxOutputTokens: 12000,
    thinkingConfig: { thinkingBudget: 0 },
    responseMimeType: 'application/json',
  },
});

let analysis;
try {
  analysis = JSON.parse(response.text || '{}');
} catch {
  analysis = {
    enabled: true,
    referenceMode,
    sourceTitle: extracted.title,
    sourceUrl: extracted.url,
    parseWarning: 'Gemini did not return valid JSON',
  };
}

analysis.enabled = true;
analysis.referenceMode = referenceMode;
analysis.sourceTitle ||= extracted.title;
analysis.sourceUrl ||= extracted.url;
analysis.originalAngle = originalAngle;
analysis.demoTopic = demoTopic;
analysis.toolsUsed = toolsUsed;
analysis.assetUrls = assetUrls.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean);
analysis.accessSummary = {
  textLength: extracted.text.length,
  headingCount: extracted.headings.length,
  imageCount: extracted.imageCount,
  codeLikeBlockCount: extracted.codeLikeBlockCount,
  ...(analysis.accessSummary || {}),
};

fs.writeFileSync(`${artifactsDir}/reference-analysis.json`, JSON.stringify(analysis, null, 2));
fs.writeFileSync(`${artifactsDir}/reference-analysis.md`, [
  `# Reference Analysis`,
  '',
  `- Source: ${analysis.sourceTitle}`,
  `- URL: ${analysis.sourceUrl}`,
  `- Mode: ${analysis.referenceMode}`,
  `- Text length: ${analysis.accessSummary.textLength}`,
  `- Images: ${analysis.accessSummary.imageCount}`,
  '',
  '## Blueprint',
  '',
  JSON.stringify(analysis.sectionBlueprint || analysis.reusableExplanationPattern || [], null, 2),
].join('\n'));
