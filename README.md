# GitHub Actions Note Workflow

This repository generates and posts note.com articles from GitHub Actions.

## Pipeline

1. Research with Gemini API and Google Search grounding
2. Write a structured Japanese long-form draft with Gemini API
3. Fact-check and revise with Gemini API and Google Search grounding
4. Generate one image for every level-2 article heading with Imagen
5. Post to note.com with Playwright, or save as draft

## Required Secrets

- `GEMINI_API_KEY`: Gemini API key from Google AI Studio
- `NOTE_STORAGE_STATE_JSON`: note.com Playwright storage state JSON

`ANTHROPIC_API_KEY` is no longer required.

## Workflow Inputs

- `theme`: Article theme
- `target`: Target reader
- `message`: Core message to communicate
- `cta`: Call to action
- `tags`: Optional comma-separated tags
- `is_public`: `true` to publish, `false` to save as draft
- `dry_run`: `true` to generate artifacts without posting

## Notes

- The workflow uses `gemini-2.5-flash` by default via `GEMINI_MODEL`.
- The workflow uses `imagen-4.0-generate-001` by default via `IMAGEN_MODEL`.
- Every generated level-2 heading section is expected to have exactly one generated image. Nested subsections such as level-3 headings do not get their own images. The post step fails if the browser does not detect the expected number of inserted images.
- Keep Google Cloud billing disabled if you want to stay on the Gemini API free tier. When free quota is exhausted, the workflow should fail with a quota/rate-limit error rather than silently charging you.
- If note.com changes its editor UI, the Playwright selectors in `.github/workflows/note.yaml` may need adjustment.

## References

- Gemini API: https://ai.google.dev/gemini-api/docs
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini API rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Playwright: https://playwright.dev/
