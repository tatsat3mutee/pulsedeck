---
name: sdlc-to-pulsedeck
description: Turn an SDLC-framework document (a runbook, an RCA, an onboarding doc, a design doc) into a pulsedeck Markdown deck that passes `pulsedeck lint` on the first try. Use when asked to turn a doc, runbook, or writeup into slides or a deck for an internal presentation.
---

# sdlc-to-pulsedeck

Status: **draft, generic**. Written before a real SDLC Agentic Framework
document was available to build against. It teaches pulsedeck's actual
Markdown contract precisely — that part is not a placeholder — but the
worked example at the end is a stand-in. Replace it with a real framework
output once one exists, and tighten the process section against what
that document's structure actually looks like.

## What this produces

A `.md` file that:
- Presents cleanly with `node dist/index.js <file> --theme carbon` (or
  `pulsedeck <file> --theme carbon` once the package is installed)
- Passes `node dist/index.js lint <file>` with zero errors and zero warnings
- Reads as a deck, not a paginated copy of the source document

## pulsedeck's Markdown contract

Get these six things right and a deck lints clean on the first pass.

### 1. Slide separators are `---` alone on a line — and are not fence-aware

```markdown
# First slide

Content.

---

## Second slide

Content.
```

Two things about `---` catch people out, and both come directly from how
`parseSlides` in `src/parser.ts` splits the document — a plain
`markdown.split(/\n[ \t]*---[ \t]*\n/)` over the whole file, with no
awareness of code fences:

- **A `---` line inside a fenced code block still splits the deck.** If the
  source document has a code sample, config file, or terminal output that
  contains a bare `---` line (a YAML document separator, a Markdown table
  rule pasted as literal text, a horizontal divider in sample output), that
  line will break the slide in two. Reword it, indent it, or replace it with
  `----` or `- - -` inside the fence — anything that isn't exactly `---`.
- **`---` on the very first line is not a separator.** A source doc that
  opens with YAML frontmatter (`---\ntitle: ...\n---`) will have that
  frontmatter block swallowed into slide one as literal text instead of
  being treated as metadata. Strip frontmatter before conversion.
- For a horizontal rule *inside* a slide (not a slide break), use `***` or
  `___` instead of `---`.

### 2. Speaker notes are an HTML comment at the end of a slide

```markdown
## Deployment Strategy

Rolling deployment with zero downtime.

<!-- notes: Review database migration rollout steps before advancing. -->
```

`<!-- note: ... -->` (singular) also works. Put source-document context that
doesn't belong on the slide itself here — the "why," caveats, the answer to
the question someone in the room will ask — rather than cramming it into
bullets. Notes are stripped from the rendered slide, the HTML export, and
the PDF; they only ever show up in the editor's notes panel while
presenting from there.

### 3. Code fences need a language tag

An untagged fence (` ``` ` with nothing after it) is a lint **warning**, and
the default `--max-warnings 0` means it fails CI. Tag every fence:
`bash`, `typescript`, `yaml`, `json`, `text` — `text` is a legitimate tag
for plain output/logs, better than leaving it bare.

### 4. Reach for Mermaid, not bullets, for anything that is actually a shape

If the source document has a flow, a sequence, a state machine, or a
dependency graph — described in prose, or drawn as ASCII art — redraw it as
a `mermaid` fence rather than flattening it into nested bullets:

````markdown
```mermaid
graph LR
  A[Request] --> B[Auth]
  B --> C[Handler]
  C --> D[Response]
```
````

A process with more than about four sequential steps, or any decision
branch, reads faster as a diagram than as bullets a presenter has to narrate
in order. Bullets are for a list of independent, unordered facts — not
"first this happens, then that."

### 5. Incremental reveals for anything meant to land one point at a time

```markdown
## Root cause

- Connection pool exhausted under retry storm {reveal}
- Retry backoff had no jitter {reveal}
- Fixed in v2.3, verified in staging {reveal}
```

Use sparingly — a slide where everything is `{reveal}` just makes the
presenter click four times for one slide. Reserve it for RCA-style
"here's what we thought, here's what was actually true" moments, or a
build-up to a conclusion.

### 6. Images need alt text and (usually) a layout directive

```markdown
![Request flow through the auth service](diagram.png "right")
```

A missing alt text is a lint warning. `"right"` / `"left"` / `"bg"` control
layout; `opacity:0.8` is combinable. Source documents rarely have images
that survive the conversion (most runbook/RCA screenshots are
environment-specific and stale by presentation time) — when in doubt, redraw
the diagram in Mermaid instead of carrying a screenshot forward.

## Process

1. **Read the source document whole** before writing a single slide. Note
   its natural sections — these usually become slide boundaries — and
   anything that's a diagram wearing prose as a disguise (see rule 4).
2. **Strip anything that isn't presentation content**: frontmatter, a table
   of contents, revision history, internal ticket links that mean nothing
   outside the room.
3. **One idea per slide.** A section with three distinct points is three
   slides, not one slide with three headers stacked. If a slide's bullets
   are individually longer than a sentence, split it.
4. **Draft the deck** using the six rules above. Prefer `##` for slide
   titles (h1 reads as a section/title slide, per the theme's role
   mapping — save it for the opening and closing slides).
5. **Carry non-slide context into speaker notes**, not new bullets.
6. **Lint before presenting anything**:
   ```bash
   node dist/index.js lint path/to/deck.md
   ```
   Fix every error and warning — do not ship a deck with
   `--max-warnings` raised to get around a real problem. A warning is
   almost always telling you something true (an untagged fence, a heading
   that's actually a full sentence, a slide that's become a wall of text).
7. **Present it once** with the house theme before calling it done:
   ```bash
   node dist/index.js path/to/deck.md --theme carbon
   ```
   Check for overflow (content that got clipped rather than split across
   slides) and confirm the Mermaid diagrams and tables actually render.

## Worked example (generic — replace once a real framework doc exists)

Given a source doc shaped like a typical SDLC runbook —

```text
# Incident Response Runbook: API Gateway Timeouts

## Overview
Steps to diagnose and resolve gateway timeout spikes.

## Detection
Alert fires when p99 latency > 2s for 5 minutes...

## Diagnosis steps
1. Check upstream service health
2. Check connection pool saturation
3. Check for a recent deploy

## Resolution
...

## Postmortem template
...
```

— a reasonable slide mapping is: title slide from the H1, one slide for
"what triggers this" (Overview + Detection folded together, since Detection
is usually one paragraph), one slide with the numbered diagnosis steps as
`{reveal}` bullets or, if the steps branch on a check's outcome, as a
Mermaid `graph TD` decision tree instead, one slide for resolution, and a
closing slide pointing at the postmortem template rather than reproducing
it (a template belongs linked, not slide-ified).

What this example does *not* yet cover, because no real framework doc was
available to check against: how the SDLC Agentic Framework's own generators
structure their output (heading depth, whether steps are always numbered
lists or sometimes tables, whether diagrams already exist as Mermaid or need
to be authored from scratch). Tighten this section against a real sample
before relying on it for anything but a rough first pass.
