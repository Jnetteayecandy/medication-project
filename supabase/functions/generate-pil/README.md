# generate-pil (AI Generate PIL)

Supabase Edge Function that drafts a Thai Patient Information Leaflet with AI.
Works with **Google Gemini (free tier)** or **Anthropic Claude (paid)**.
API keys are stored only as Supabase secrets, never in the web app.

## Option A — Google Gemini (free)

1. Get a free API key at https://aistudio.google.com/apikey (sign in with a Google account → Create API key).
2. Set it and deploy:
   ```bash
   npx supabase secrets set GEMINI_API_KEY=your-gemini-key
   npx supabase functions deploy generate-pil --no-verify-jwt
   ```
   When `GEMINI_API_KEY` is set, Gemini is used automatically.

Free-tier notes: requests per minute/day are limited (the app shows a message when
the quota is used up). Web search ("Grounding with Google Search") may not be included
in every free tier — if it isn't, the draft is still generated without it and the app
says so in "Please verify". Google may use free-tier requests to improve its products;
the app only sends the medicine name, strength, form, company and your notes
(no patient data).

## Option B — Anthropic Claude (paid)

1. Create an API key at https://console.anthropic.com and add billing.
2. ```bash
   npx supabase secrets set ANTHROPIC_API_KEY=your-anthropic-key
   npx supabase secrets set AI_PROVIDER=claude      # only needed if GEMINI_API_KEY is also set
   npx supabase functions deploy generate-pil --no-verify-jwt
   ```

## Also required (once)

Run `supabase_activity_log_setup.sql` and `supabase_medication_save_setup.sql`
again in the Supabase SQL Editor (approval / AI columns and rules).

Deploying from the Dashboard instead of the CLI: Edge Functions → Deploy a new function
→ Via Editor → name `generate-pil`, paste `index.ts`; turn **off** "Verify JWT";
add the secrets under Edge Functions → Secrets.

## Optional secrets

| Secret | Default | Meaning |
|---|---|---|
| `AI_PROVIDER` | `gemini` if `GEMINI_API_KEY` is set, else `claude` | Which AI to use |
| `GEMINI_MODEL` | `gemini-flash-latest` | Gemini model (the alias always points to the current Flash model) |
| `PIL_AI_MODEL` | `claude-opus-5-5` | Claude model. Cheaper: `claude-sonnet-5-5` or `claude-haiku-5-5` |
| `PIL_AI_EFFORT` | `medium` | Claude only: `low` / `medium` / `high` |
| `AI_DAILY_LIMIT` | `30` | Generations per user per 24 hours |

## Notes

- Only ADMIN / PHARMACIST / STAFF profiles can use it; every call is logged as
  `ai_generate` in `activity_logs` (visible on the Admin page, with the model used).
- Output is a draft: the editor requires the signed-in user to tick
  "I have reviewed and approve this PIL" before saving, and the database rejects
  content saves without that approval.
