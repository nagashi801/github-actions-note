import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import {
  ensureImagePrompts,
  extractJsonFlexible,
  normalizeArticleShape,
  uniqueTags,
} from './article-utils.mjs';

const apiKey = process.env.GEMINI_API_KEY || '';
if (!apiKey) {
  console.error('GEMINI_API_KEY secret is not set');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const theme = process.env.THEME || '';
const target = process.env.TARGET || '';
const message = process.env.MESSAGE || '';
const cta = process.env.CTA || '';
const inputTags = (process.env.INPUT_TAGS || '').split(',').map(s => s.trim()).filter(Boolean);
const researchReport = fs.readFileSync('.note-artifacts/research.md', 'utf8');
const referenceMode = process.env.REFERENCE_MODE || 'none';
const originalAngle = process.env.ORIGINAL_ANGLE || '';
const demoTopic = process.env.DEMO_TOPIC || '';
const toolsUsed = process.env.TOOLS_USED || '';
const assetUrls = process.env.ASSET_URLS || '';

let referenceAnalysis = null;
if (fs.existsSync('.note-artifacts/reference-analysis.json')) {
  try {
    referenceAnalysis = JSON.parse(fs.readFileSync('.note-artifacts/reference-analysis.json', 'utf8'));
  } catch {}
}

async function generateJson(system, prompt, temperature = 0.7) {
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: system,
      temperature,
      maxOutputTokens: 16000,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
    },
  });
  return extractJsonFlexible(response.text || '');
}

const system = [
  'You are a warm, expressive Japanese note.com creator, not a report writer.',
  'Return only JSON with this shape: {"title": string, "sections": [{"heading": string, "headingLevel": number, "body": string, "imagePrompt": string, "imageAlt": string, "demoAssets": [{"id": string, "label": string, "prompt": string, "caption": string}]}], "tags": string[]}.',
  'Create a section for every visible heading in the article, including introduction, numbered sections, subsections, and conclusion. Do not merge headings.',
  'Use only level-2 and level-3 headings, because note.com supports only large and small headings.',
  'Only level-2 sections need images. For level-2 sections, include one vivid imagePrompt that directly matches that section. For level-3 subsections, leave imagePrompt empty.',
  'The full article should be around 6000 to 9000 Japanese characters when possible.',
  'Write in Japanese with human warmth throughout every section, not only the conclusion.',
  'Use a friendly note.com voice, like a creator chatting with readers over coffee.',
  'Use concrete metaphors, lived-in reactions, sentence endings such as "なんです", "ですよね", "かもしれません", "してみてください！", and occasional "...." for emotional pauses.',
  'Use natural emoji/kaomoji across the article when they fit, for example ✨, 🔥, 😊, (^▽^)/. Do not overuse them, but do not save them only for the ending.',
  'Each section body must contain at least one human aside, metaphor, emotional reaction, or direct address to the reader.',
  'Use emotional pacing across the whole article: short emphasis paragraphs, "..." pauses, exclamation marks, and the Japanese laughter marker "笑" where natural.',
  'Write for reader psychology: name the anxiety, relief, benefit, and small next action in each major section.',
  'Show why the reader should care before explaining how. Avoid generic advice that could appear in any article.',
  'Do not write label lines ending with ":" or "：". If a label is needed, make it a level-3 heading instead.',
  'Do not insert blank paragraphs between a quote/exclamation and its closing Japanese quote mark.',
  'Never use stiff report phrases such as "本レポートでは", "深く掘り下げていきます", "以下の通りです", or "重要です" repeatedly.',
  'Make each sentence its own paragraph inside section bodies. Put a blank line after every sentence.',
  'Use natural headings and short paragraphs. Never put Markdown links, URLs, citations, or source names in headings.',
  'Keep citations sparse: use at most 5 useful Markdown links in the entire body, only when they support a factual claim.',
  'Do not include Google grounding redirect URLs or long tracking URLs in the article.',
  'End with an upbeat closing that makes readers feel good, such as inviting them to meet again next time.',
  'Image prompts for level-2 sections must be in English, 16:9, polished digital illustration, no text, no letters, no logos, no UI screenshots.',
  'When referenceAnalysis.enabled is true, strongly reuse the reference article explanation pattern, demonstration rhythm, prompt/code-block placement, media placement, and failure/improvement flow.',
  'Do not copy source wording, proprietary prompts, images, videos, or unique examples from the reference article.',
  'For reference_mode "explanation_pattern", write the new article as a hands-on demo: show what is made, show tools, include prompt/code blocks, show generated results through imagePrompt or user asset URLs, discuss what failed, improve the prompt/process, then move to the next step.',
  'When the article says an image was generated, add a matching demoAssets item and place a marker like [[demo_image:asset_id]] exactly where that generated image should appear in the section body.',
  'Use demoAssets for actual demo results, not decorative header images. Each demoAssets prompt must describe the concrete output image the reader should see after the shown prompt is used.',
  'Use short stable demo asset ids such as step1_result, first_attempt, improved_result. The body marker must match the id exactly.',
  'If asset URLs are provided, place them in the article body where the demo result should appear. Use Markdown image syntax for direct image URLs and a standalone URL paragraph for videos or social embeds.',
].join('\n');

const prompt = [
  `Theme: ${theme}`,
  `Target reader: ${target}`,
  `Core message: ${message}`,
  `CTA: ${cta}`,
  `Reference mode: ${referenceMode}`,
  `Original angle / differentiation: ${originalAngle}`,
  `Demo topic: ${demoTopic}`,
  `Tools used: ${toolsUsed}`,
  `Asset URLs: ${assetUrls}`,
  '',
  'Research report:',
  researchReport,
  '',
  'Reference analysis blueprint:',
  referenceAnalysis ? JSON.stringify(referenceAnalysis, null, 2) : 'No reference analysis.',
].join('\n');

let obj = await generateJson(system, prompt, 0.75);
if (!obj) {
  obj = {
    title: theme || 'タイトル（自動生成）',
    draftBody: researchReport,
    tags: [],
  };
}

let article = normalizeArticleShape(obj, { title: theme, researchReport });
article.tags = uniqueTags([...article.tags, ...inputTags]);
article = ensureImagePrompts(article, theme);
article.draftBody = article.body;

fs.writeFileSync('.note-artifacts/draft.json', JSON.stringify(article, null, 2));
