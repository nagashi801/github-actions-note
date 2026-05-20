# GitHub Actions Note Workflow

This repository generates and posts note.com articles from GitHub Actions.

## Pipeline

1. Research with Gemini API and Google Search grounding
2. Write a Japanese long-form draft with Gemini API
3. Fact-check and revise with Gemini API and Google Search grounding
4. Post to note.com with Playwright, or save as draft

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
- Keep Google Cloud billing disabled if you want to stay on the Gemini API free tier. When free quota is exhausted, the workflow should fail with a quota/rate-limit error rather than silently charging you.
- If note.com changes its editor UI, the Playwright selectors in `.github/workflows/note.yaml` may need adjustment.

## References

- Gemini API: https://ai.google.dev/gemini-api/docs
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini API rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Playwright: https://playwright.dev/
