import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import {
  ensureImagePrompts,
  extractJsonFlexible,
  normalizeArticleShape,
  sectionsToMarkdown,
} from './article-utils.mjs';

const apiKey = process.env.GEMINI_API_KEY || '';
if (!apiKey) {
  console.error('GEMINI_API_KEY secret is not set');
  process.exit(1);
}

const draft = JSON.parse(fs.readFileSync('.note-artifacts/draft.json', 'utf8'));
const ai = new GoogleGenAI({ apiKey });
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const system = [
  'You are a Japanese fact-checking editor for note.com articles.',
  'Use Google Search grounding to verify the draft.',
  'Fix unsupported claims, soften uncertain statements, and keep reliable Markdown citations in the body.',
  'Preserve the warm, human voice, metaphors, occasional emoji/kaomoji, and upbeat closing unless a claim is inaccurate.',
  'Do not collapse sections. Keep one section for every heading.',
  'Every section must keep exactly one imagePrompt, updated if the section changes.',
  'Keep each sentence as its own paragraph with a blank line after every sentence.',
  'Return only JSON with this shape: {"title": string, "sections": [{"heading": string, "headingLevel": number, "body": string, "imagePrompt": string, "imageAlt": string}], "tags": string[]}.',
].join('\n');

const prompt = [
  'Fact-check and revise this note.com draft.',
  '',
  `Title: ${draft.title || ''}`,
  `Tags: ${(draft.tags || []).join(', ')}`,
  '',
  'Sections JSON:',
  JSON.stringify(draft.sections || [], null, 2),
  '',
  'Plain Markdown body for reading context:',
  sectionsToMarkdown(draft.sections || []),
].join('\n');

const response = await ai.models.generateContent({
  model,
  contents: prompt,
  config: {
    systemInstruction: system,
    temperature: 0.3,
    maxOutputTokens: 16000,
    thinkingConfig: { thinkingBudget: 0 },
    tools: [{ googleSearch: {} }],
  },
});

const obj = extractJsonFlexible(response.text || '') || draft;
let out = normalizeArticleShape(obj, draft);
out = ensureImagePrompts(out, draft.title || '');
out.body = sectionsToMarkdown(out.sections);
out.draftBody = out.body;

fs.writeFileSync('.note-artifacts/final.json', JSON.stringify(out, null, 2));
