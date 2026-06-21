# Aurae backend (engine prototype)

Working chat engine for the soul-friend companion app: age-gated signup,
4-persona chat via Claude, crisis safety screening that always runs first,
and a privacy-conscious "insight profile" that grows from summarized
patterns instead of raw transcripts.

Verified end to end with `test_smoke.py` (mocked Claude calls, no API key
needed to run the test).

## Run it for real

```
pip install -r requirements.txt
export OPENROUTER_API_KEY=sk-or-v1-...
uvicorn main:app --reload
```

Billing and routing go through OpenRouter, but the model underneath is
still Claude (`anthropic/claude-sonnet-4.6` for replies, `anthropic/claude-haiku-4.5`
for the fast mood/triage pass) — switching to OpenRouter doesn't trade
away response quality, it just changes which key pays for it.

**About the key from your very first `app.py`:** that file had an OpenRouter
key hardcoded directly in the source (`api_key="sk-or-v1-0be82c..."`). That
key has been exposed in plaintext in this chat and possibly in git history.
Please revoke/rotate that one in your OpenRouter dashboard — it's separate
from the new `kimkcc` key and isn't safe to keep using.

**About the Gemini key shown in Google AI Studio:** that screenshot showed
the full, unmasked key value (unlike the OpenRouter dashboard, which masks
most of the key). That key should be treated as compromised too — delete
it in Google AI Studio and generate a fresh one for `GEMINI_API_KEY`. This
codebase never stores or hardcodes that key; it only reads it from the
environment at runtime.

- `POST /signup` — body: `{name, age_confirmed, gender_preference, companion_id}`.
  Returns 403 if `age_confirmed` is false. This check cannot be bypassed
  from the client; it's enforced server-side.
- `POST /chat` — body: `{user_id, message}`. Crisis screening
  (`safety.py`) runs before any persona logic. If triggered, the persona's
  voice stays consistent but the reply always includes the 988 hotline and
  the Claude call is skipped entirely for that turn.

## What's real vs. what's a placeholder

- Chat logic, persona system prompts, crisis screening, insight extraction,
  and the SQLite schema are real and tested.
- `voice_id` fields in `personas.json` are placeholders — wire these up to
  actual ElevenLabs voice IDs once you've designed/cloned the voices.
- The insight extraction prompt (`claude_client.extract_insights`) is a
  first draft. Worth iterating on once you see real conversation data —
  e.g. add more comfort_style categories, or split "topics" from "things
  to check in on later."

## Wiring up your character video assets

All four characters now share the same shape:

```
assets/
  Chloe_Assets/   Chloe_neutral.mp4  Chloe_smile.mp4  Chloe_joy.mp4
                  Chloe_think.mp4    Chloe_wink.mp4   Chloe_question.mp4
                  Chloe_face.png
  Ethan_Assets/   same pattern, "Ethan_" prefix
  Jayden_Assets/  same pattern, "Jayden_" prefix
  Maya_Assets/    same pattern, but think has two variants:
                  Maya_think.mp4  Maya_think1.mp4
```

The model still picks from an 8-tag vocabulary (`neutral, smile, joy,
blush, pout, think, wink, question`) — `blush`/`pout` aren't in anyone's
file set right now, so they fall back through `asset_map.FALLBACK_CHAIN`
to the nearest emotion (`blush` → `joy`, `pout` → `think`). If you add
those clips for any character later, just add them to that character's
`emotion_files` in `asset_map.py` and they'll be picked up automatically.

If you add more characters later, add them to `CHARACTER_ASSETS` in
`asset_map.py`, ideally following this same 6-file shape.

`main.py` auto-mounts this folder at `/assets` if it exists, so a returned
`asset_path` like `assets/Chloe_Assets/Chloe_smile.mp4` is directly
servable at `https://your-host/assets/Chloe_Assets/Chloe_smile.mp4`. Set
`ASSET_ROOT` env var if you want a different folder name or an absolute
path to a CDN-synced directory instead.

Every `/chat` reply returns `emotion_tag` and `asset_path` — the model
picks one tag every turn via `[EMO:...]`, which is parsed out before the
text reaches the user. Maya's `think`/`think1` pair rotates so the same
clip never plays twice in a row; everyone else currently has one file per
emotion, so there's nothing to rotate until more variants are added.

## Mood + cultural resonance + real-time info

Each turn now also runs through:

- `mood.py` — a fast Haiku call that reads the emotional tone of the
  message (mood tag, intensity 1-5, a life-theme category) and whether the
  reply genuinely needs current real-world info.
- `resonance.py` — an optional, sparing reference to a widely-known
  American film/TV/book title that matches the detected life-theme, passed
  to the model as inspiration only — it's explicitly instructed to never
  quote dialogue, lyrics, or text, just reference the title/feeling.
- `realtime_search.py` — backed by Gemini's "Grounding with Google Search"
  tool. Reads `GEMINI_API_KEY` from the environment. No-op (returns `None`,
  never raises) until that's set, so the chat flow degrades gracefully
  without it. Results are length-capped and run through a placeholder
  content filter before ever reaching the persona's context — replace
  that filter with a real moderation pass before launch.



1. **Crisis detection is keyword-based right now.** That's fine for a
   prototype, but it will both miss things and over-trigger on casual
   phrases ("this homework is killing me"). Before launch, get a real
   safety classifier and have someone with clinical background review the
   response copy and escalation paths.
2. **Data retention policy.** Decide and document how long raw
   `ChatMessage` rows live before being purged, separate from the
   longer-lived summarized `UserInsightProfile`. Build the user-facing
   "export my data" / "delete my data" endpoints before launch — US state
   privacy laws (CCPA and similar) require this, and so will app store
   review for anything framed as an emotional/companion app.
3. **Age verification.** This prototype takes a self-reported checkbox.
   Real age verification (and a clear path for what happens if someone
   fails it) needs a legal/compliance decision, not just an engineering
   one — this is the single biggest risk area for an app like this in
   the US market right now.
