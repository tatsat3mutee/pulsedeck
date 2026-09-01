# decks/

Every Markdown deck in this folder is checked by [`lint-decks.yml`](../.github/workflows/lint-decks.yml)
on every push and pull request, using `pulsedeck lint`. A deck with a lint
error fails the build; a deck with a lint warning does too, since the
workflow runs with the default `--max-warnings 0`.

Add a deck by dropping a `.md` file in here — no registration step, the
workflow discovers files with `find`. Present one locally with:

```bash
npm run build
node dist/index.js decks/sample-enablement-deck.md --theme carbon
```

`sample-enablement-deck.md` is a template: a lint-clean deck in the `carbon`
theme, showing the patterns an AI/dev-enablement deck actually needs —
speaker notes, a Mermaid diagram, a tagged code fence, incremental reveals,
and a table — without tripping the `---`-inside-a-code-fence trap described
in the root [`README.md`](../README.md#slide-separators) and in the
`sdlc-to-pulsedeck` skill.
