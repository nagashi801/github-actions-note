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
  'Return only JSON with this shape: {"title": string, "sections": [{"heading": string, "headingLevel": number, "body": string, "imagePrompt": string, "imageAlt": string}], "tags": string[]}.',
  'Create a section for every visible heading in the article, including introduction, numbered sections, subsections, and conclusion. Do not merge headings.',
  'Only level-2 sections need images. For level-2 sections, include one vivid imagePrompt that directly matches that section. For level-3 and level-4 subsections, leave imagePrompt empty.',
  'The full article should be around 6000 to 9000 Japanese characters when possible.',
  'Write in Japanese with human warmth throughout every section, not only the conclusion.',
  'Use a friendly note.com voice, like a creator chatting with readers over coffee.',
  'Use concrete metaphors, lived-in reactions, sentence endings such as "なんです", "ですよね", "かもしれません", "してみてください！", and occasional "...." for emotional pauses.',
  'Use natural emoji/kaomoji across the article when they fit, for example ✨, 🔥, 😊, (^▽^)/. Do not overuse them, but do not save them only for the ending.',
  'Each section body must contain at least one human aside, metaphor, emotional reaction, or direct address to the reader.',
  'Never use stiff report phrases such as "本レポートでは", "深く掘り下げていきます", "以下の通りです", or "重要です" repeatedly.',
  'Make each sentence its own paragraph inside section bodies. Put a blank line after every sentence.',
  'Use natural headings and short paragraphs. Preserve useful Markdown links from the research report.',
  'End with an upbeat closing that makes readers feel good, such as inviting them to meet again next time.',
  'Image prompts for level-2 sections must be in English, 16:9, polished digital illustration, no text, no letters, no logos, no UI screenshots.',
].join('\n');

const prompt = [
  `Theme: ${theme}`,
  `Target reader: ${target}`,
  `Core message: ${message}`,
  `CTA: ${cta}`,
  '',
  'Research report:',
  researchReport,
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
