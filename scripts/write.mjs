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
  'You are a warm, human Japanese note.com long-form article writer.',
  'Return only JSON with this shape: {"title": string, "sections": [{"heading": string, "headingLevel": number, "body": string, "imagePrompt": string, "imageAlt": string}], "tags": string[]}.',
  'Create a section for every visible heading in the article, including introduction, numbered sections, subsections, and conclusion. Do not merge headings.',
  'Every section must have exactly one vivid imagePrompt that directly matches that section. This is mandatory.',
  'The full article should be around 6000 to 9000 Japanese characters when possible.',
  'Write in Japanese with human warmth: use concrete metaphors, small emotional reactions, occasional exclamation marks, and natural emoji/kaomoji when they fit.',
  'Avoid stiff textbook tone. Prefer a friendly note.com voice, like a creator speaking to readers.',
  'Make each sentence its own paragraph inside section bodies. Put a blank line after every sentence.',
  'Use natural headings and short paragraphs. Preserve useful Markdown links from the research report.',
  'End with an upbeat closing that makes readers feel good, such as inviting them to meet again next time.',
  'Image prompts must be in English, 16:9, polished digital illustration, no text, no letters, no logos, no UI screenshots.',
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
