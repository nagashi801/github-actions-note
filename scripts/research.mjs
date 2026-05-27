import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import { withGeminiRetry } from './gemini-utils.mjs';

const apiKey = process.env.GEMINI_API_KEY || '';
if (!apiKey) {
  console.error('GEMINI_API_KEY secret is not set');
  process.exit(1);
}

const theme = process.env.THEME || '';
const target = process.env.TARGET || '';
const today = new Date().toISOString().slice(0, 10);
const artifactsDir = '.note-artifacts';
fs.mkdirSync(artifactsDir, { recursive: true });

const ai = new GoogleGenAI({ apiKey });
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function addCitations(response) {
  let text = response.text || '';
  const supports = response.candidates?.[0]?.groundingMetadata?.groundingSupports || [];
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sorted = [...supports].sort((a, b) => (b.segment?.endIndex ?? 0) - (a.segment?.endIndex ?? 0));
  for (const support of sorted) {
    const end = support.segment?.endIndex;
    if (end === undefined || !support.groundingChunkIndices?.length) continue;
    const links = support.groundingChunkIndices.map(i => {
      const web = chunks[i]?.web;
      return web?.uri ? `[${web.title || i + 1}](${web.uri})` : null;
    }).filter(Boolean);
    if (links.length) text = text.slice(0, end) + links.join(', ') + text.slice(end);
  }
  return text;
}

const system = [
  'You are an expert researcher for long-form Japanese note.com articles.',
  'Write in Japanese.',
  'Prioritize primary sources and official sources.',
  'Use Markdown links inline for citations.',
  'Return only the final research report. Do not ask questions.',
].join('\n');

const prompt = [
  'Create a final research report for the following article plan.',
  'If assumptions are needed, state them briefly in a section named "前提と仮定" and continue.',
  '',
  `Theme: ${theme}`,
  `Target reader: ${target}`,
  `Current date: ${today}`,
].join('\n');

const response = await withGeminiRetry('Gemini research generateContent', () => ai.models.generateContent({
  model,
  contents: prompt,
  config: {
    systemInstruction: system,
    temperature: 0.2,
    maxOutputTokens: 12000,
    thinkingConfig: { thinkingBudget: 0 },
    tools: [{ googleSearch: {} }],
  },
}));

const report = addCitations(response);
fs.writeFileSync(`${artifactsDir}/research.md`, report || '');
fs.writeFileSync(`${artifactsDir}/research_trace.json`, JSON.stringify(response, null, 2));
