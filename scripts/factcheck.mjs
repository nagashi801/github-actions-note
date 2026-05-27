import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import {
  ensureImagePrompts,
  extractJsonFlexible,
  normalizeArticleShape,
  sectionsToMarkdown,
} from './article-utils.mjs';
import { withGeminiRetry } from './gemini-utils.mjs';

const apiKey = process.env.GEMINI_API_KEY || '';
if (!apiKey) {
  console.error('GEMINI_API_KEY secret is not set');
  process.exit(1);
}

const draft = JSON.parse(fs.readFileSync('.note-artifacts/draft.json', 'utf8'));
const ai = new GoogleGenAI({ apiKey });
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

async function generateJson(system, prompt, temperature = 0.6, tools = undefined) {
  const config = {
    systemInstruction: system,
    temperature,
    maxOutputTokens: 16000,
    thinkingConfig: { thinkingBudget: 0 },
    ...(tools ? { tools } : { responseMimeType: 'application/json' }),
  };
  const response = await withGeminiRetry('Gemini fact-check generateContent', () => ai.models.generateContent({
    model,
    contents: prompt,
    config,
  }));
  return extractJsonFlexible(response.text || '');
}

const system = [
  'You are a Japanese fact-checking editor for note.com hands-on AI workflow articles.',
  'Use Google Search grounding to verify factual claims.',
  'Fix unsupported claims, soften uncertain statements, and keep reliable Markdown citations sparse in the body.',
  'Do not include Google grounding redirect URLs or long tracking URLs.',
  'Never put Markdown links, URLs, citations, or source names in headings.',
  'Use at most 5 useful Markdown links in the entire body.',
  'Do not add or keep a public section named "前提と仮定".',
  'Do not collapse sections. Keep the hands-on Step structure.',
  'Use only level-2 and level-3 headings.',
  'Preserve all manual placeholder paragraphs in square brackets exactly.',
  'Do not add demoAssets or [[demo_image:...]] markers.',
  'Only text-heavy sections may receive a decorative article illustration. Keep imagePrompt empty for sections with code fences, prompt examples, output blocks, or manual media placeholders.',
  'Preserve the reference-like rhythm when present: short explanation, exact input, result/output, media placeholder, then one practical tip.',
  'Do not compress hands-on tool steps into generic summaries.',
  'For Kling sections, keep the operation-level workflow: open Kling, choose Image to Video, upload the Gemini start image, choose duration, choose quality, confirm aspect ratio, paste only the motion prompt, generate, check, download.',
  'For Kling examples, keep settings outside the prompt body. The motion prompt must describe movement only.',
  'For CapCut sections, keep exact telop/BGM/SFX choices.',
  'All prompts shown to readers must remain multi-line fenced code blocks.',
  'Inside prompt examples, use Markdown headings such as "## 役割" and "## 出力形式". Do not use bold markers as prompt dividers.',
  'When showing model output, use a standalone "---出力結果---" label, then a blank line, then a fenced code block.',
  'Return only JSON with this shape: {"title": string, "sections": [{"heading": string, "headingLevel": number, "body": string, "imagePrompt": string, "imageAlt": string, "demoAssets": []}], "tags": string[]}.',
].join('\n');

const prompt = [
  'Fact-check and revise this note.com draft without weakening the concrete workflow.',
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

const obj = await generateJson(system, prompt, 0.25, [{ googleSearch: {} }]) || draft;
let out = normalizeArticleShape(obj, draft);
out.sections = out.sections.filter(section => !/^前提と仮定$/.test(String(section.heading || '').trim()));
out = ensureImagePrompts(out, draft.title || '');

const styleSystem = [
  'You are a Japanese note.com creator who rewrites drafts into warm, friendly, human writing.',
  'Return only JSON with this shape: {"title": string, "sections": [{"heading": string, "headingLevel": number, "body": string, "imagePrompt": string, "imageAlt": string, "demoAssets": []}], "tags": string[]}.',
  'Do not change facts, citations, section count, heading order, imagePrompt, imageAlt, manual placeholders, code blocks, or tags.',
  'Do not add or keep a public section named "前提と仮定".',
  'Keep the hands-on Step article rhythm: short explanation, exact input, result, media placeholder, and one practical note.',
  'Do not rewrite concrete workflow steps into generic tutorial paragraphs.',
  'Keep all prompt examples multi-line and easy to copy.',
  'Keep prompt dividers as Markdown headings inside code blocks, not bold labels.',
  'Keep output result examples inside fenced code blocks after a standalone "---出力結果---" label.',
  'Keep Kling workflow examples separated into start image, mode, settings, and motion prompt.',
  'Keep every normal sentence as its own paragraph with a blank line after it.',
  'Make the writing friendly, but never remove exact settings, placement rules, BGM criteria, prompt wording, or manual placeholders.',
].join('\n');

const stylePrompt = [
  'Rewrite this fact-checked article for a friendlier note.com voice while preserving the concrete workflow.',
  '',
  'Article JSON:',
  JSON.stringify(out, null, 2),
].join('\n');

const styledObj = await generateJson(styleSystem, stylePrompt, 0.65);
if (styledObj) {
  out = normalizeArticleShape(styledObj, out);
  out.sections = out.sections.filter(section => !/^前提と仮定$/.test(String(section.heading || '').trim()));
  out = ensureImagePrompts(out, draft.title || '');
}

out.body = sectionsToMarkdown(out.sections);
out.draftBody = out.body;

fs.writeFileSync('.note-artifacts/final.json', JSON.stringify(out, null, 2));
