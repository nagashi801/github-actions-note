# GitHub Actions Note Workflow

This repository generates and posts note.com articles from GitHub Actions.

## Pipeline

1. Optionally analyze a reference note.com article with the saved Playwright login state
2. Research with Gemini API and Google Search grounding
3. Write a structured Japanese long-form draft with Gemini API
4. Fact-check and revise with Gemini API and Google Search grounding
5. Generate decorative section images with Imagen only for text-heavy sections
6. Post to note.com with Playwright, or save as draft

## Required Secrets

- `GEMINI_API_KEY`: Gemini API key from Google AI Studio
- `NOTE_STORAGE_STATE_JSON`: note.com Playwright storage state JSON

`ANTHROPIC_API_KEY` is no longer required.

## Workflow Inputs

GitHub Actions の `Run workflow` フォームに入力する項目です。

| Actions screen label | Input key | Required | Meaning | What to write |
| --- | --- | --- | --- | --- |
| `theme / 記事テーマ・仮タイトル` | `theme` | yes | 記事のテーマ、または仮タイトルです。記事全体の方向性を決めます。 | `AIだけで「底なし沼からの脱出方法」風ショート動画を作ってみた` |
| `target / 想定読者` | `target` | yes | 誰に向けた記事かです。ここが曖昧だと記事もぼんやりします。 | `ライフハック系・防災系・サバイバル系のショート動画をAIで作ってみたい初心者` |
| `message / 記事で一番伝えたいこと` | `message` | yes | 記事で一番伝えたい結論です。読者に持ち帰ってほしい考えを書きます。 | `ChatGPTで台本を作り、Geminiでシーン画像を作り、Klingで動きを付け、CapCutで編集すれば、初心者でもライフライン系ショート動画の試作品を作れる` |
| `tags / カンマ区切りタグ` | `tags` | no | note に付けたいタグです。カンマ区切りで入力します。 | `AI動画,ショート動画,ChatGPT,Gemini,Kling,CapCut,ライフハック,防災` |
| `reference_url / 参考note URL` | `reference_url` | no | 参考にしたい note 記事のURLです。ログイン状態で読める記事も、`NOTE_STORAGE_STATE_JSON` が有効なら解析できます。 | `https://note.com/storkai/n/n2662f266d683` |
| `reference_mode / 参考記事の使い方` | `reference_mode` | yes | 参考記事をどの強さで使うかです。 | 下の「Reference Mode」を参照 |
| `demo_topic / 記事内で実演する内容` | `demo_topic` | no | 記事内で実際に作って見せるものです。「作ってみた」系では重要です。 | `AIだけで「底なし沼からの脱出方法」風の15秒ショート動画を作る` |
| `is_public / 公開投稿する` | `is_public` | yes | `true` なら公開投稿、`false` なら下書き保存です。まずは `false` 推奨です。 | `false` |
| `dry_run / note投稿をスキップ` | `dry_run` | yes | `true` なら記事生成だけしてnote投稿をスキップします。動作確認用です。 | `false` |

## Reference Mode

`reference_mode` は参考記事の使い方を決めます。

| Value | Meaning | Use when |
| --- | --- | --- |
| `none` | 参考記事を使いません。 | URLなしで普通に生成したいとき |
| `structure_only` | 見出し構成、話の順番、締め方などの骨組みだけ参考にします。 | 参考記事に寄せすぎたくないとき |
| `explanation_pattern` | Step構成、段落の短さ、プロンプトの見せ方、出力結果の見せ方、画像・スクショの挟み方、「操作 → 結果 → 補足」の流れを強めに参考にします。 | 「作ってみた。作り方」系の記事を書きたいとき |

`explanation_pattern` は、参考記事の文章そのものや固有の作例をコピーするための設定ではありません。

参考記事からは「記事の進め方」と「見せ方」を取り出し、テーマ、プロンプト、作例、画像、動画、主張は新しい記事用に作り直します。

AI動画制作記事では、参考記事の流れに加えて、プログラム側の固定テンプレートで以下の手順を必ず入れます。

1. ChatGPTで企画・台本を作る
2. Geminiでシーン画像を1枚ずつ作る
3. KlingのImage to Videoで動きを付ける
4. CapCutで編集する
5. 投稿後に見直して改善する

Klingの説明では、画像を始端画像として選び、秒数・画質・比率を確認してから、動きの指示だけを入力する流れを書きます。

## Manual Media Placeholders

実演記事では、実際の作業スクショ、Geminiで生成したシーン画像、Klingで生成した動画、CapCutの編集画面などは手動で差し込みます。

本文には、次のようなプレースホルダーが自動で入ります。

```text
[ここにChatGPTへ入力したプロンプト画面のスクショを添付]
```

```text
[ここにChatGPTから返ってきた台本案のスクショを添付]
```

```text
[ここにGeminiで生成したシーン1の画像を貼り付ける]
```

```text
[ここにKlingのImage to Video設定画面のスクショを添付]
```

```text
[ここにKlingで生成したシーン1の動画を差し込む]
```

```text
[ここにCapCutのタイムライン画面のスクショを添付]
```

プレースホルダーがある見出し、プロンプトや出力結果のコードブロックがある見出しには、装飾画像を追加生成しません。

これは、AIが作った雰囲気画像と、実際の作業スクショ・生成画像・動画を混ぜすぎて読みづらくなるのを避けるためです。

本文生成時も、公開記事に `前提と仮定` という調査メモ用の見出しを出さないようにしています。

## Example: Short Video Article

```text
theme:
AIだけで「底なし沼からの脱出方法」風ショート動画を作ってみた

target:
ライフハック系・防災系・サバイバル系のショート動画をAIで作ってみたい初心者

message:
ChatGPTで台本を作り、Geminiでシーン画像を作り、Klingで動きを付け、CapCutで編集すれば、初心者でもライフライン系ショート動画の試作品を作れる

tags:
AI動画,ショート動画,ChatGPT,Gemini,Kling,CapCut,ライフハック,防災,サバイバル

reference_url:
https://note.com/storkai/n/n2662f266d683

reference_mode:
explanation_pattern

demo_topic:
AIだけで「底なし沼からの脱出方法」風の15秒ショート動画を作る

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
