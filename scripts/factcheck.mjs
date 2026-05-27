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
  'You are a Japanese fact-checking editor for note.com articles.',
  'Use Google Search grounding to verify the draft.',
  'Fix unsupported claims, soften uncertain statements, and keep reliable Markdown citations sparse in the body.',
  'Never put Markdown links, URLs, citations, or source names in headings.',
  'Use at most 5 useful Markdown links in the entire body, only when they support a factual claim.',
  'Do not include Google grounding redirect URLs or long tracking URLs in the article.',
  'Preserve the warm, human voice, metaphors, occasional emoji/kaomoji, and upbeat closing unless a claim is inaccurate.',
  'Do not collapse sections. Keep one section for every heading.',
  'Use only level-2 and level-3 headings, because note.com supports only large and small headings.',
  'Only text-heavy sections should receive a decorative article illustration. Keep or update imagePrompt only when the section does not contain prompt/code examples, model output blocks, manual media placeholders, screenshots, Gemini scene images, Kling videos, or CapCut screenshots.',
  'Leave imagePrompt empty for sections that contain code fences, prompt examples, "---出力結果---", or manual placeholder paragraphs such as "[ここにGeminiで作ったシーン1の画像を貼り付ける]".',
  'Keep each sentence as its own paragraph with a blank line after every sentence.',
  'Do not add demoAssets or [[demo_image:...]] markers. The automation creates decorative illustrations only for text-heavy sections.',
  'Actual production screenshots, Gemini scene images, Kling videos, and CapCut screenshots should remain manual placeholder paragraphs such as "[ここにKlingで生成した動画を差し込む]" or "[ここに画像生成AIの作業スクショを添付]".',
  'Preserve manual placeholder paragraphs in square brackets exactly. They are instructions for the human editor.',
  'If a how-to explanation is vague, make it concrete with beginner-ready settings, criteria, and copyable wording. Explain video prompt wording, camera motion, telop placement, BGM choice, sound effects, and volume balance when relevant.',
  'Image prompts must be in English only, 16:9, polished editorial illustration or cinematic photo style. They should create an atmospheric mood image for text-heavy sections, not explain the section with text.',
  'Do not include the Japanese article title or Japanese section heading inside imagePrompt.',
  'For imagePrompt, focus on atmosphere, emotion, creator workflow, desks, tools, storyboards, abstract AI assistance, simple charts, waveforms, play buttons, and visual rhythm.',
  'For imagePrompt, avoid Japanese text completely. Do not include paragraphs, article headings, captions, chat messages, or detailed readable UI text.',
  'For imagePrompt, short English labels such as AI, PDCA, STEP, simple numbers, simple icons, charts, waveforms, and abstract UI panels are acceptable.',
  'For imagePrompt, device screens may appear, but detailed text should be blurred, tiny, or unreadable. Do not create screenshots or realistic app interfaces.',
  'Every prompt shown to readers must be readable across multiple lines as an indented or fenced code block. Never leave a long prompt on a single "プロンプト1:" line.',
  'Inside prompt examples, use Markdown headings such as "## 動画の目的" and "## 出力形式". Do not use bold markers such as "**動画の目的**" as section dividers inside prompts.',
  'When showing model output, separate the prompt block and output block into different paragraphs. Use a standalone label like "---出力結果---" followed by a blank line, then put the entire output result inside a fenced code block.',
  'For Kling examples, match the real workflow: first upload the start image, then choose Image to Video, duration, quality/aspect options, then enter only the motion prompt. Do not write a fake combined prompt like "Upload Image: ... Prompt: ...".',
  'Return only JSON with this shape: {"title": string, "sections": [{"heading": string, "headingLevel": number, "body": string, "imagePrompt": string, "imageAlt": string, "demoAssets": [{"id": string, "label": string, "prompt": string, "caption": string}]}], "tags": string[]}.',
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

const obj = await generateJson(system, prompt, 0.3, [{ googleSearch: {} }]) || draft;
let out = normalizeArticleShape(obj, draft);
out = ensureImagePrompts(out, draft.title || '');

const styleSystem = [
  'You are a Japanese note.com creator who rewrites drafts into warm, friendly, human writing.',
  'Return only JSON with this shape: {"title": string, "sections": [{"heading": string, "headingLevel": number, "body": string, "imagePrompt": string, "imageAlt": string, "demoAssets": [{"id": string, "label": string, "prompt": string, "caption": string}]}], "tags": string[]}.',
  'Do not change facts, citations, section count, heading order, imagePrompt, imageAlt, manual placeholders, or tags.',
  'Rewrite every section body so the whole article feels friendly and human, not like a report.',
  'Use direct address to the reader, small emotional reactions, concrete metaphors, and conversational endings throughout.',
  'Use occasional "！", "....", emoji, and kaomoji naturally across multiple sections. Examples: ✨, 🔥, 😊, (^▽^)/.',
  'Do not place all personality in the conclusion. Every section should have at least one warm or human-feeling sentence.',
  'Use emotional pacing across the whole article: short emphasis paragraphs, "..." pauses, exclamation marks, and the Japanese laughter marker "笑" where natural.',
  'Strengthen reader empathy: name the hidden worry, the practical benefit, and the feeling after trying the advice.',
  'Make the article feel specific and psychologically sharp, not generic. Add concrete creator/freelance/publishing situations when useful.',
  'Do not weaken concrete instructions into generic advice. Keep exact settings, placement rules, BGM criteria, prompt wording, and manual placeholders.',
  'Keep all prompt examples multi-line and easy to copy.',
  'Keep prompt dividers as Markdown headings inside code blocks, not bold labels.',
  'Keep output result examples inside fenced code blocks after a standalone "---出力結果---" label.',
  'Keep Kling workflow examples separated into start image, mode, settings, and motion prompt.',
  'Do not write label lines ending with ":" or "：". Convert such labels into level-3 headings or fold them into the sentence with a comma.',
  'Do not insert blank paragraphs between a quote/exclamation and its closing Japanese quote mark.',
  'Avoid stiff phrases: "本レポートでは", "深く掘り下げていきます", "以下の通りです", "重要です" repeated, "可能です" repeated, and textbook-style enumeration without commentary.',
  'Keep each sentence as its own paragraph with a blank line after every sentence.',
  'Keep useful Markdown links when they are present, but remove links from headings and avoid long tracking URLs.',
].join('\n');

const stylePrompt = [
  'Rewrite this fact-checked article for a friendlier note.com voice.',
  'The reader should feel like a real person is talking to them, not like they are reading a school report.',
  '',
  'Article JSON:',
  JSON.stringify(out, null, 2),
].join('\n');

const styledObj = await generateJson(styleSystem, stylePrompt, 0.85);
if (styledObj) {
  out = normalizeArticleShape(styledObj, out);
  out = ensureImagePrompts(out, draft.title || '');
}

out.body = sectionsToMarkdown(out.sections);
out.draftBody = out.body;

fs.writeFileSync('.note-artifacts/final.json', JSON.stringify(out, null, 2));
