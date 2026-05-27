import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import {
  ensureImagePrompts,
  extractJsonFlexible,
  normalizeArticleShape,
  sectionsToMarkdown,
  uniqueTags,
} from './article-utils.mjs';
import { withGeminiRetry } from './gemini-utils.mjs';

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
const inputTags = (process.env.INPUT_TAGS || '').split(',').map(s => s.trim()).filter(Boolean);
const researchReport = fs.readFileSync('.note-artifacts/research.md', 'utf8');
const referenceMode = process.env.REFERENCE_MODE || 'none';
const demoTopic = process.env.DEMO_TOPIC || '';
const originalAngle = 'Use the reference article as a structure and demonstration-rhythm template, but change the topic, examples, prompts, wording, claims, and assets.';
const toolsUsed = 'ChatGPT, Gemini, Kling, CapCut, note';
const cta = 'Encourage the reader to try one short-video topic, replace the placeholders with their own screenshots/images/videos, and publish after manual review.';

let referenceAnalysis = null;
if (fs.existsSync('.note-artifacts/reference-analysis.json')) {
  try {
    referenceAnalysis = JSON.parse(fs.readFileSync('.note-artifacts/reference-analysis.json', 'utf8'));
  } catch {}
}

let videoAnalysis = null;
if (fs.existsSync('.note-artifacts/video-analysis.json')) {
  try {
    videoAnalysis = JSON.parse(fs.readFileSync('.note-artifacts/video-analysis.json', 'utf8'));
  } catch {}
}

async function generateJson(system, prompt, temperature = 0.7) {
  const response = await withGeminiRetry('Gemini write generateContent', () => ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: system,
      temperature,
      maxOutputTokens: 16000,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
    },
  }));
  return extractJsonFlexible(response.text || '');
}

const aiVideoWorkflowTemplate = [
  '# AI video article workflow template',
  '',
  'Use this fixed workflow for hands-on AI short-video articles. The LLM may adapt wording and examples to the theme, but must not remove the concrete operations.',
  '',
  '## Introduction',
  '- Start with the reader problem and the actual demo topic.',
  '- Do not include a public "前提と仮定" section.',
  '- Explain that real screenshots/images/videos will be inserted manually by the editor.',
  '',
  '## Step 1: Create the idea and script with ChatGPT',
  '- Explain the goal of this step in short paragraphs.',
  '- Include a placeholder before or after the prompt screen:',
  '[ここにChatGPTへ入力したプロンプト画面のスクショを添付]',
  '- Show a multi-line ChatGPT prompt in a fenced code block.',
  '- Prompt blocks must use Markdown headings such as ## 役割, ## 動画の目的, ## ターゲット, ## 尺, ## 出力形式.',
  '- Do not use bold markers as dividers inside prompt blocks.',
  '- Show a separate output-result label and fenced output block.',
  '---出力結果---',
  '- Include a placeholder for the returned script:',
  '[ここにChatGPTから返ってきた台本案のスクショを添付]',
  '- Explain what to check in the result: hook, scene count, narration length, telop clarity, and safety disclaimer.',
  '',
  '## Step 2: Create scene images with Gemini',
  '- Explain that each scene image is generated one by one.',
  '- Show one Gemini image prompt as a multi-line code block.',
  '- The prompt should include subject, location, emotion, camera, lighting, style, aspect ratio, and negative instructions.',
  '- Include manual placeholders:',
  '[ここにGeminiへ入力した画像生成プロンプト画面のスクショを添付]',
  '[ここにGeminiで生成したシーン1の画像を貼り付ける]',
  '- Explain how to judge the generated image: readable silhouette, no text corruption, no extra limbs, clear mood, useful start frame.',
  '',
  '## Step 3: Add motion with Kling Image to Video',
  '- This step must be operation-level, not a summary.',
  '- Spell out the workflow in this order:',
  '  1. Open Kling.',
  '  2. Choose Image to Video.',
  '  3. Upload the Gemini-generated scene image as the start image.',
  '  4. Choose duration.',
  '  5. Choose quality.',
  '  6. Confirm aspect ratio.',
  '  7. Paste only the motion instruction prompt.',
  '  8. Generate.',
  '  9. Check the result.',
  '  10. Download or save.',
  '- Settings must be outside the prompt body.',
  '- The motion prompt must describe only movement: subject motion, camera motion, atmosphere, speed, and details.',
  '- Do not write fake combined syntax such as "Upload Image: ... Prompt: ...".',
  '- Include manual placeholders:',
  '[ここにKlingのImage to Video設定画面のスクショを添付]',
  '[ここにKlingで生成したシーン1の動画を差し込む]',
  '',
  '## Step 4: Edit with CapCut',
  '- Explain the timeline assembly operation.',
  '- Include a placeholder:',
  '[ここにCapCutのタイムライン画面のスクショを添付]',
  '- Give concrete telop settings: bottom safe area, max two lines, bold font, white text, black outline or shadow, semi-transparent dark backing when the background is busy.',
  '- Give concrete BGM criteria: instrumental preferred, avoid vocals that compete with narration, tense intro, relief at the end, low volume under narration.',
  '- Give concrete SFX timing: impact at hook, soft whoosh on cuts, small confirmation sound at solution.',
  '',
  '## Step 5: Post, review, and improve',
  '- Explain how to watch the result as a viewer.',
  '- Include a placeholder:',
  '[ここに完成したショート動画のプレビュー画面を添付]',
  '- Explain the review criteria: first second, save-worthiness, clarity, safety, and whether viewers can reproduce the method.',
  '',
  '## Summary',
  '- Encourage the reader to replace placeholders with their own production assets.',
  '- End warmly and practically.',
].join('\n');

const system = [
  'You are a warm, practical Japanese note.com creator who writes hands-on AI-video production articles.',
  'Return only JSON with this shape: {"title": string, "sections": [{"heading": string, "headingLevel": number, "body": string, "imagePrompt": string, "imageAlt": string, "demoAssets": []}], "tags": string[]}.',
  'Use only headingLevel 2 and 3.',
  'Do not create demoAssets. Always return demoAssets as an empty array.',
  'Never publish a section named "前提と仮定". Treat assumptions as internal research notes only.',
  'Do not copy wording, proprietary prompts, images, videos, or unique examples from the reference article.',
  'When reference_mode is explanation_pattern, strongly imitate the reference article craft: Step structure, short paragraph rhythm, prompt display, output display, screenshot/image placement, and the "operation -> result -> practical note" flow.',
  'The fixed AI-video workflow template is mandatory for AI video articles. Use it as the concrete procedure layer.',
  'If videoAnalysis.enabled is true, the video analysis is the source of truth for the demo. Reverse-engineer the article from that video instead of inventing a different video concept.',
  'When videoAnalysis.enabled is true, preserve the actual scene order, character continuity, tone, narration/telop intent, and visible production result described in videoAnalysis.',
  'When videoAnalysis.enabled is true, use the fixed workflow to explain how to create that exact kind of video: script prompts, scene image prompts, Kling motion prompts, editing choices, and manual placeholders should all match the analyzed video.',
  'If videoAnalysis says a detail is unclear, write a manual-check placeholder instead of pretending it is known.',
  'The reference article controls article rhythm and presentation style; the fixed template controls the actual ChatGPT/Gemini/Kling/CapCut operations; the LLM adapts examples and explanations to the theme.',
  'Write every normal sentence as its own paragraph with a blank line after it.',
  'Use short, conversational Japanese paragraphs. Avoid report-like explanations.',
  'Do not drift into abstract advice. Every major step must include a concrete prompt, setting, manual media placeholder, result example, or review criterion.',
  'All prompts shown to readers must be multi-line fenced code blocks.',
  'Inside prompt examples, use Markdown headings such as "## 役割" and "## 出力形式". Do not use **bold** as prompt dividers.',
  'When showing model output, write a standalone "---出力結果---" label, then a blank line, then a fenced code block.',
  'Use manual media placeholders exactly as square-bracket paragraphs beginning with "[ここに".',
  'Use placeholders across all workflow steps, not only Kling.',
  'For Kling, describe the real Image to Video flow: open Kling, choose Image to Video, upload the Gemini start image, choose duration, choose quality, confirm aspect ratio, enter only motion instructions, generate, check, download.',
  'For Kling examples, settings must be outside the prompt body. The prompt body must contain movement only.',
  'For CapCut, include exact telop/BGM/SFX choices instead of saying "雰囲気に合う".',
  'Only text-heavy sections may receive a decorative article image. Leave imagePrompt empty for sections with code fences, prompt examples, output blocks, or manual media placeholders.',
  'Image prompts must be English only and must request atmospheric, decorative editorial visuals. Do not ask for readable Japanese text, article headings, chat screenshots, or detailed UI text in images.',
  'Short English labels such as AI, PDCA, STEP, icons, charts, waveforms, and play buttons are acceptable in decorative images.',
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
  '',
  'Mandatory AI-video workflow template:',
  aiVideoWorkflowTemplate,
  '',
  'Research report. Use only for factual support. Do not turn assumptions into article sections:',
  researchReport,
  '',
  'Reference analysis blueprint. Use for article rhythm and presentation pattern, especially when reference_mode is explanation_pattern:',
  referenceAnalysis ? JSON.stringify(referenceAnalysis, null, 2) : 'No reference analysis.',
  '',
  'Video analysis blueprint. If enabled, this overrides demo_topic for the actual video story and scene flow:',
  videoAnalysis ? JSON.stringify(videoAnalysis, null, 2) : 'No video analysis.',
].join('\n');

let obj = await generateJson(system, prompt, 0.65);
if (!obj) {
  obj = {
    title: theme || 'AI動画制作記事',
    draftBody: researchReport,
    tags: [],
  };
}

let article = normalizeArticleShape(obj, { title: theme, researchReport });
article.sections = article.sections.filter(section => !/^前提と仮定$/.test(String(section.heading || '').trim()));
article.tags = uniqueTags([...article.tags, ...inputTags]);
article = ensureImagePrompts(article, theme);
article.body = sectionsToMarkdown(article.sections);
article.draftBody = article.body;

fs.writeFileSync('.note-artifacts/draft.json', JSON.stringify(article, null, 2));
