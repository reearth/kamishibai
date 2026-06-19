---
name: video-craft
description: "Direct and edit good videos with kamishibai — the craft layer, not the engine. Use when authoring or improving a narrated explainer / lecture video, a product walkthrough, or a brand/company film: pacing and pauses, narration scripting, audio-synced reveals, motion graphics, transitions, voice direction, music, and the review loop. Pairs with the `kamishibai` skill, which covers the API."
---

# video-craft — making kamishibai videos *good*

This is the **directing and editing** layer. For the API and how the engine
works, use the `kamishibai` skill — don't restate the mechanics here, just
apply the taste below.

Everything here is **guidance, not rules** — sensible defaults for good taste.
When the requester gives a direction, brief, or explicit instruction, follow
that over anything below.

Golden rule: **the narration is the spine.** Picture serves the voice — reveal,
motion, and cuts exist to support what's being said, never to compete with it.

## Two modes (same craft, different emphasis)

- **A. Explainer / Lecture** — slide-driven, information transfer. Most of the
  weight is on script, pacing, and synced reveals.
- **B. Brand / Company film** — asset- and motion-driven, with an emotional arc.
  Adds footage, inserts, expressive voice, motion graphics, music-first editing,
  and sound design.

Both share the principles below; B adds the "Brand-film extras" section.

## Core principles

### Script the spoken word (don't read the slide)
- Rewrite bullet points into **spoken** sentences. Short sentences = room to breathe.
- **Bridge** between slides: "So far we've seen X. But there's also Y…" Continuity
  is what turns a deck into a film instead of a slideshow.
- Spell out numbers/acronyms the way they should *sound* for narration
  ("twenty twenty-six", "C-I-A").
- "Say it, then show it." Every on-screen element should have a spoken counterpart.
- **Add value the slide doesn't have.** Narrating the bullets word-for-word is
  boring — the listener can already read. Periodically weave in something that
  *isn't* on the slide to pull attention back: a plain-language gloss of the
  confusing part, a clearer rephrasing or analogy, a small aside or bit of
  feeling, or a rhetorical check-in ("this is the bit everyone trips on, right?").
  The slide is the reference; the voice is the guide that makes it click.

### Pacing & silence (間)
- Silence is an edit tool. Hold **~2s between slides**, **~3s at a chapter change**.
- Put a beat of silence **before** a transition line ("So far…") so it lands.
- Don't pack wall-to-wall narration; let a point settle before the next.

### Audio-synced reveal (karaoke)
- Split narration into **beats** (one short line per point). Reveal + **highlight**
  the element as its line begins; **dim** finished items. Reveal tables row by row.
- This guides the eye to "where we are now."

### Motion & life
- Keep the frame subtly alive (a drifting background, a pulse on the active item)
  so no shot is dead-static — but **motion is a supporting actor**. If it pulls
  focus from the message, dial it back.
- Favor steady, time-driven motion that reads as intentional, not jittery.

### Transitions
- Different layouts **ghost** when you crossfade them (two titles overlapping).
  Fix: let a scene's content **clear out just before its end**, so only the
  background changes during the blend.
- Vary the vocabulary with intent: a **swipe/wipe for summaries & conclusions**,
  a fade for normal flow, a cut for snap. Stay consistent within one video.

### Legibility & layout (video ≠ a slide)
- Bigger type than a slide deck — a video reads from across a room. One idea per
  beat. Use color **semantically** (one accent = "this is the emphasis").

### Audio mix
- Voice is primary; **music sits low (~-23 dB)**. Fade it in/out, loop it
  seamlessly, and **duck it under the narration**.
- Match the music's energy to the topic. Use **license-clean** tracks (CC0, or
  CC-BY with a credit line) — and keep the credit.

### Branding & the "frame"
- Title → (agenda) → section doors → content → recap → outro. A faint **logo
  watermark**, a **thank-you** beat, and an **animated end card** make it feel
  finished. First and last impressions carry the brand.

### Voice direction
- Shape the tone deliberately (calm lecturer vs. upbeat brand) and keep it
  **consistent**. Lock the **script before final renders** — changing wording or
  voice is the expensive part.

## Brand-film extras (mode B)

- **Assets:** B-roll, screen recordings, photos, icons, a brand kit, SFX. Pre-grade
  color and normalize footage up front. Mind licensing — for a company video with
  people or places, get releases.
- **Inserts / cutaways:** keep the voice going and cut to footage, a screen-record
  demo, picture-in-picture, or **lower-thirds** (name/title supers). Keep inserts
  short (1–3s) and return on rhythm.
- **Vocal expression (prosody):** vary the tone **per section** (high energy for
  vision, calm for credentials, warm for the CTA). Punctuation and sentence length
  shape delivery too. For an emotional hero film, consider a **human voice-over** —
  know the ceiling of synthetic voices and choose deliberately.
- **Motion graphics:** kinetic typography synced to the voice, **count-up stats**,
  animated charts, icon motion, line draw-ons, masks/wipes, a **logo build**,
  parallax, gentle pseudo-camera moves. Lean into it — this is where a brand film
  earns its polish.
- **Music-first editing:** cut to the beat and design an **energy curve**
  (problem → vision → what we do → proof → CTA).
- **Sound design:** transition whooshes and stingers give motion a sense of weight.

## Build loop

1. **Outline the direction on paper first.** Before building anything, write a
   lightweight **text treatment** — per scene or cut, a few bullets: what's
   *said* (narration intent), what's *shown*, the *motion / transition* approach,
   and the *tone*. Not storyboard art — just structured prose. Share it and align
   on direction, *then* pilot. This catches "wrong direction" before a single
   frame renders — cheaper even than the pilot. If the requester gives direction
   (a brand, a reference, a mood), fold it in and make it concrete in the outline.
2. **Write the full narration script and get it signed off *before* synthesizing.**
   Once the spoken lines are written, show them to the requester (plain text — the
   whole script) and lock it before the first TTS run. Synthesis costs money per
   line and editing the wording re-bills *and* re-times that line, so revisions
   are nearly free as text and expensive once voiced. One review here avoids
   re-synthesizing on rework — even a modest deck adds up.
3. **Pilot.** Build the first few scenes, lock the look/voice/pacing, get
   sign-off, *then* scale to the whole thing. Direction changes are cheap early.
4. **Render → watch on a real device → inspect the frames.** Eyeballing stills is
   the fastest way to catch flicker, overflow, or mistimed reveals.
5. Iterate freely on visuals and timing; change narration wording/voice sparingly.
6. Keep a reusable scene/component layer and data-driven slides so 40 slides aren't
   40 hand-built files.

## Anti-patterns (hard-won)

- Reading bullet points verbatim; no bridges between slides → feels like a robot
  narrating a PDF.
- Wall-to-wall narration with no pauses → exhausting; nothing lands.
- Revealing a whole dense slide at once → the viewer reads ahead and tunes the
  voice out.
- Motion that competes with the message → distracting.
- Crossfading two different layouts without clearing content first → ghosting.
- Music too loud or not ducked → it fights the voice. Unlicensed music → don't.
- Synthesizing TTS before the script is approved → you pay to voice lines you'll
  re-cut. Get script sign-off first.
- Re-editing narration wording late and often → slow and costly. Lock the script first.
- Jumping straight into building with no written direction outline → the wrong
  creative direction only surfaces after you've built, not before.
- Building every scene before validating the style on a pilot → expensive rework.

## Pre-ship checklist

- [ ] Narration is spoken, not read; slides bridge into each other.
- [ ] Pauses: ~2s between slides, ~3s at chapter changes, a beat before transitions.
- [ ] Reveals track the voice; the active point is highlighted.
- [ ] No flicker and no text ghosting on transitions (inspect the frames).
- [ ] Text fits and is legible at full screen; one idea per beat.
- [ ] Voice tone is consistent and intentional; numbers/acronyms read correctly.
- [ ] Music is low and ducked, fades in/out, and is licensed (and credited).
- [ ] Branded frame: title, watermark, outro / end card.
- [ ] The timeline length matches the content — no blank tail at the end.
