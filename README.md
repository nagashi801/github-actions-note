# GitHub Actions Note Workflow

This repository generates and posts note.com articles from GitHub Actions.

## Pipeline

1. Optionally analyze a reference note.com article with the saved Playwright login state
2. Research with Gemini API and Google Search grounding
3. Write a structured Japanese long-form draft with Gemini API
4. Fact-check and revise with Gemini API and Google Search grounding
5. Generate decorative section images with Imagen only for text-heavy sections that do not already contain prompt/code blocks or manual media placeholders
6. Post to note.com with Playwright, or save as draft

## Required Secrets

- `GEMINI_API_KEY`: Gemini API key from Google AI Studio
- `NOTE_STORAGE_STATE_JSON`: note.com Playwright storage state JSON

`ANTHROPIC_API_KEY` is no longer required.

## Workflow Inputs

GitHub Actions の `Run workflow` フォームに入力する項目です。

| Actions screen label | Input key | Required | Meaning | What to write |
| --- | --- | --- | --- | --- |
| `theme / 記事テーマ・仮タイトル` | `theme` | yes | 記事のテーマ、または仮タイトルです。記事全体の方向性を決めます。 | `AIだけで「副業初心者あるある」ショート動画を作ってみた。台本・画像素材の作り方` |
| `target / 想定読者` | `target` | yes | 誰に向けた記事かです。ここが曖昧だと記事もぼんやりします。 | `ショート動画を作りたいけれど、台本や素材作りで止まっているAI副業初心者` |
| `message / 記事で一番伝えたいこと` | `message` | yes | 記事で一番伝えたい結論です。読者に持ち帰ってほしい考えを書きます。 | `最初から完璧な動画を作ろうとせず、まずはChatGPTで台本を作り、画像生成AIで素材を作ると1本目を形にしやすい` |
| `tags / カンマ区切りタグ` | `tags` | no | note に付けたいタグです。カンマ区切りで入力します。 | `AI動画,ショート動画,ChatGPT,画像生成AI,AI副業` |
| `reference_url / 参考note URL` | `reference_url` | no | 参考にしたい note 記事のURLです。ログイン状態で読める記事も、`NOTE_STORAGE_STATE_JSON` が有効なら解析できます。 | `https://note.com/genel/n/n5d80af93d97e` |
| `reference_mode / 参考記事の使い方` | `reference_mode` | yes | 参考記事をどの強さで使うかです。 | 下の「Reference Mode」を参照 |
| `demo_topic / 記事内で実演する内容` | `demo_topic` | no | 記事内で実際に作って見せるものです。「作ってみた」系ではかなり重要です。 | `ChatGPTで15秒ショート動画の台本を作り、各シーンの画像素材を生成する` |
| `is_public / 公開投稿する` | `is_public` | yes | `true` なら公開投稿、`false` なら下書き保存です。まずは `false` 推奨です。 | `false` |
| `dry_run / note投稿をスキップ` | `dry_run` | yes | `true` なら記事生成だけしてnote投稿をスキップします。動作確認用です。 | `false` |

### Reference Mode

`reference_mode` は参考記事の使い方を決めます。

| Value | Meaning | Use when |
| --- | --- | --- |
| `none` | 参考記事を使いません。通常の記事生成です。 | 完全に新規テーマで書きたいとき |
| `structure_only` | 見出し構成、話の順番、締め方などの骨組みだけ参考にします。 | 参考記事に寄せすぎたくないとき |
| `explanation_pattern` | 説明の粒度、実演の流れ、プロンプトや画像の見せ方、失敗例から改善する流れまで強めに参考にします。 | 「作ってみた。作り方」系の記事を書きたいとき |

### Manual Media Placeholders

実演記事では、実際の作業スクショ、Geminiで生成したシーン画像、Klingで生成した動画、CapCutの編集画面などは手動で差し込みます。

本文には、次のようなプレースホルダーが自動で入ります。

```text
[ここにChatGPTへ入力したプロンプト画面のスクショを添付]
```

```text
[ここにGeminiで生成したシーン1の画像を貼り付ける]
```

```text
[ここにKlingで生成したシーン1の動画を差し込む]
```

プレースホルダーがある見出し、プロンプトや出力結果のコードブロックがある見出しには、装飾画像を追加生成しません。

### Example: Short Video Article

ショート動画制作の記事を書く場合の入力例です。

```text
theme:
AIだけで「副業初心者あるある」ショート動画を作ってみた。台本・画像素材の作り方

target:
ショート動画を作りたいけれど、台本作りや素材作りで止まっているAI副業初心者。TikTok、YouTube Shorts、Instagram Reelsに投稿してみたい人

message:
ショート動画制作は、最初から完璧な映像を作ろうとすると止まってしまう。まずはChatGPTで台本を作り、画像生成AIで場面素材を作り、動画化は手動で試す流れにすると、初心者でも1本目を形にできる

tags:
AI動画,ショート動画,ChatGPT,画像生成AI,AI副業,動画制作,YouTubeShorts

reference_url:
https://note.com/genel/n/n5d80af93d97e

reference_mode:
explanation_pattern

demo_topic:
AIだけで「副業初心者あるある」ショート動画の素材を作る。ChatGPTで15秒の台本を作り、各シーンの画像生成プロンプトを作り、実際に生成した画像を記事内に貼る

is_public:
false

dry_run:
false
```

## Notes

- The workflow uses `gemini-2.5-flash` by default via `GEMINI_MODEL`.
- The workflow uses `imagen-4.0-fast-generate-001` by default via `IMAGEN_MODEL`.
- Reference analysis extracts reusable article-craft patterns such as explanation order, media placement, prompt/code-block placement, and failure/improvement flow. It should not copy source article wording, assets, or proprietary prompts.
- Decorative section images are generated only for text-heavy sections without prompt/code blocks or manual media placeholders.
- Hands-on demo articles should use manual placeholders for real production assets such as screenshots, generated scene images, Kling videos, and CapCut timelines.
- Keep Google Cloud billing disabled if you want to stay on the Gemini API free tier. When free quota is exhausted, the workflow should fail with a quota/rate-limit error rather than silently charging you.
- If note.com changes its editor UI, the Playwright selectors in `.github/workflows/note.yaml` may need adjustment.

## References

- Gemini API: https://ai.google.dev/gemini-api/docs
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini API rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Playwright: https://playwright.dev/
