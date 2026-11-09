# generate-pil (AI Generate PIL)

Supabase Edge Function that drafts a Thai Patient Information Leaflet with Claude.
The Anthropic API key is stored only as a Supabase secret, never in the web app.

## Setup (once)

1. Create an API key at https://console.anthropic.com (Settings → API keys) and add billing.
2. Run `supabase_activity_log_setup.sql` and `supabase_medication_save_setup.sql`
   again in the Supabase SQL Editor (adds the approval / AI columns and rules).
3. Deploy the function — either way works:

   **Supabase CLI**
   ```bash
   npx supabase login
   npx supabase link --project-ref bcehtpixbibbpmejsfyn
   npx supabase secrets set ANTHROPIC_API_KEY=your-key-here
   npx supabase functions deploy generate-pil --no-verify-jwt
   ```

   **Supabase Dashboard**
   - Edge Functions → Deploy a new function → Via Editor → name it `generate-pil`,
     paste `index.ts`, deploy.
   - Open the function's settings and turn **off** "Verify JWT"
     (the app's own sign-in has no Supabase JWT; the function checks the user's
     profile and role itself).
   - Edge Functions → Secrets → add `ANTHROPIC_API_KEY`.

## Optional secrets

| Secret | Default | Meaning |
|---|---|---|
| `PIL_AI_MODEL` | `claude-opus-5-5` | Claude model |
| `PIL_AI_EFFORT` | `medium` | `low` / `medium` / `high` - higher is more thorough but slower and costs more |
| `AI_DAILY_LIMIT` | `30` | Generations per user per 24 hours |

## Notes

- Only ADMIN / PHARMACIST / STAFF profiles can use it; every call is logged as
  `ai_generate` in `activity_logs` (visible on the Admin page).
- With web search on, Claude looks for the product's leaflet / registration info
  and returns the sources it used.
- Output is a draft: the editor requires the signed-in user to tick
  "I have reviewed and approve this PIL" before saving, and the database rejects
  content saves without that approval.
