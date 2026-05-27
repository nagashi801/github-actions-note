# GitHub Actions Note Workflow

This repository generates and posts note.com articles from GitHub Actions.

## Pipeline

1. Optionally analyze a reference note.com article with the saved Playwright login state
2. Research with Gemini API and Google Search grounding
3. Write a structured Japanese long-form draft with Gemini API
4. Fact-check and revise with Gemini API and Google Search grounding
5. Generate one image for every level-2 article heading with Imagen
6. Generate additional demo-result images when the article says an image was actually created
7. Post to note.com with Playwright, or save as draft

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
| `cta / 読者に促す行動` | `cta` | yes | 記事の最後で読者に促す行動です。 | `まずは15秒のショート動画テーマを1つ決めて、3シーン構成の台本をChatGPTに作ってもらってください` |
| `tags / カンマ区切りタグ` | `tags` | no | note に付けたいタグです。カンマ区切りで入力します。 | `AI動画,ショート動画,ChatGPT,画像生成AI,AI副業` |
| `reference_url / 参考note URL` | `reference_url` | no | 参考にしたい note 記事のURLです。ログイン状態で読める記事も、`NOTE_STORAGE_STATE_JSON` が有効なら解析できます。 | `https://note.com/genel/n/n5d80af93d97e` |
| `reference_mode / 参考記事の使い方` | `reference_mode` | yes | 参考記事をどの強さで使うかです。 | 下の「Reference Mode」を参照 |
| `original_angle / 参考記事との差別化` | `original_angle` | no | 参考記事と何を変えるかです。盗作にならないように、題材・読者・切り口の差分を書きます。 | `参考記事の実演形式は使うが、題材は浮気復讐系ではなくAI副業初心者向けのショート動画にする` |
| `demo_topic / 記事内で実演する内容` | `demo_topic` | no | 記事内で実際に作って見せるものです。「作ってみた」系ではかなり重要です。 | `ChatGPTで15秒ショート動画の台本を作り、各シーンの画像素材を生成する` |
| `tools_used / 実演で使うツール` | `tools_used` | no | 記事内で使うツールです。カンマ区切りで入力します。 | `ChatGPT,Imagen,CapCut,note` |
| `asset_urls / 参照・埋め込み用URL` | `asset_urls` | no | すでに用意済みの画像・動画・投稿URLがある場合に入れます。なければ空でOKです。 | `https://...` |
| `is_public / 公開投稿する` | `is_public` | yes | `true` なら公開投稿、`false` なら下書き保存です。まずは `false` 推奨です。 | `false` |
| `dry_run / note投稿をスキップ` | `dry_run` | yes | `true` なら記事生成だけしてnote投稿をスキップします。動作確認用です。 | `false` |

### Reference Mode

`reference_mode` は参考記事の使い方を決めます。

| Value | Meaning | Use when |
| --- | --- | --- |
| `none` | 参考記事を使いません。通常の記事生成です。 | 完全に新規テーマで書きたいとき |
| `structure_only` | 見出し構成、話の順番、締め方などの骨組みだけ参考にします。 | 参考記事に寄せすぎたくないとき |
| `explanation_pattern` | 説明の粒度、実演の流れ、プロンプトや画像の見せ方、失敗例から改善する流れまで強めに参考にします。 | 「作ってみた。作り方」系の記事を書きたいとき |

### Generated Demo Images

通常の見出し画像とは別に、記事内で「実際に作ってみました」「こういう画像ができました」と説明する場面では、追加のデモ画像を自動生成できます。

ライター工程が本文中に `[[demo_image:asset_id]]` というマーカーを置き、画像生成工程がそのマーカーに対応する画像を生成します。

投稿工程では、そのマーカー位置に実際の生成画像を挿入します。

動画そのものは自動生成しません。動画化や編集は手動工程として記事内で説明する想定です。

### Example: Short Video Article

ショート動画制作の記事を書く場合の入力例です。

```text
theme:
AIだけで「副業初心者あるある」ショート動画を作ってみた。台本・画像素材の作り方

target:
ショート動画を作りたいけれど、台本作りや素材作りで止まっているAI副業初心者。TikTok、YouTube Shorts、Instagram Reelsに投稿してみたい人

message:
ショート動画制作は、最初から完璧な映像を作ろうとすると止まってしまう。まずはChatGPTで台本を作り、画像生成AIで場面素材を作り、動画化は手動で試す流れにすると、初心者でも1本目を形にできる

cta:
まずは15秒のショート動画テーマを1つ決めて、ChatGPTに「3シーン構成の台本」と「各シーンの画像生成プロンプト」を作ってもらってください

tags:
AI動画,ショート動画,ChatGPT,画像生成AI,AI副業,動画制作,YouTubeShorts

reference_url:
https://note.com/genel/n/n5d80af93d97e

reference_mode:
explanation_pattern

original_angle:
参考記事のように、実際に作る流れ、プロンプト、生成結果、失敗例、改善案を見せる。ただし題材は浮気復讐系ではなく、副業初心者が共感しやすい「副業初心者あるある」ショート動画にする。画像は自動生成し、動画化は手動で行う前提にする

demo_topic:
AIだけで「副業初心者あるある」ショート動画の素材を作る。ChatGPTで15秒の台本を作り、各シーンの画像生成プロンプトを作り、実際に生成した画像を記事内に貼る

tools_used:
ChatGPT,Imagen,CapCut,note

asset_urls:

is_public:
false

dry_run:
false
```

## Notes

- The workflow uses `gemini-2.5-flash` by default via `GEMINI_MODEL`.
- The workflow uses `imagen-4.0-fast-generate-001` by default via `IMAGEN_MODEL`.
- Reference analysis extracts reusable article-craft patterns such as explanation order, media placement, prompt/code-block placement, and failure/improvement flow. It should not copy source article wording, assets, or proprietary prompts.
- Every generated level-2 and level-3 heading section is expected to have exactly one generated image. The post step fails if the browser does not detect the expected number of inserted images.
- Hands-on demo articles can include generated result images inside the body. The writer step marks placement with `[[demo_image:asset_id]]`, the image step generates the matching asset, and the post step inserts that actual image at the marker position.
- Keep Google Cloud billing disabled if you want to stay on the Gemini API free tier. When free quota is exhausted, the workflow should fail with a quota/rate-limit error rather than silently charging you.
- If note.com changes its editor UI, the Playwright selectors in `.github/workflows/note.yaml` may need adjustment.

## References

- Gemini API: https://ai.google.dev/gemini-api/docs
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini API rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Playwright: https://playwright.dev/
