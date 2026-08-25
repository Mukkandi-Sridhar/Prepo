# Contributing to Prepo

Thanks for looking. This file exists so you can tell in two minutes whether the thing you want to do is easy.

## Getting it running

```bash
pnpm install
docker compose up -d db
pnpm db:migrate
pnpm dev
```

You need Node 20.11+, pnpm, Docker, and git. You do **not** need an API key to work on stages 01–03 — the Repo Card is entirely deterministic, which makes it the easiest place to start.

## Response times

This is maintained in evenings and weekends. Expect a first reply within about a week. If something has gone quiet for longer than that, bumping the thread is welcome, not rude.

Small, focused pull requests get merged. Large ones that change several subsystems at once tend to stall — not because they're bad, but because reviewing them is a weekend rather than an evening. Open an issue first for anything structural.

## Good first issues

Each of these is a self-contained file with an existing sibling to copy.

**Add a language to the chunker.** [`packages/engine/src/chunker.ts`](packages/engine/src/chunker.ts) — add a declaration pattern to `SYMBOL_PATTERNS`. Capture group 1 must be the symbol name, because it becomes part of a citation. Add a fixture and a test.

**Add an LLM provider.** Most providers speak the OpenAI wire format, so it is one entry in `DEFAULT_BASE_URLS` in [`openai-compatible.ts`](packages/llm/src/providers/openai-compatible.ts) plus a tier block in [`models.json`](packages/llm/src/models.json). A genuinely different API means a class implementing `Provider` — see [`anthropic.ts`](packages/llm/src/providers/anthropic.ts) for the shape.

**Add a question category.** One entry in `QUESTION_CATEGORIES` and `CATEGORY_LABELS` in [`shared/src/schemas/question.ts`](packages/shared/src/schemas/question.ts), one retrieval query in `CATEGORY_QUERIES`, one line in `buildPlan`. Write the retrieval query in the vocabulary of *code*, not of interviews — the index contains source files.

**Add an export format.** One function in [`export.ts`](packages/engine/src/export.ts) and one branch in the export route.

**Improve fact extraction.** [`facts.ts`](packages/engine/src/stages/facts.ts) is pure parsing with no model involved, so it is easy to test and impossible to break subtly. Route detection for frameworks we don't cover yet is genuinely useful work.

## Changing a prompt

Prompts are versioned files under [`packages/prompts/src/`](packages/prompts/src/). To change one meaningfully, **add `v2.ts` beside `v1.ts`** and update the export in `index.ts` — don't edit a version in place once it has shipped, because generated artefacts record which version produced them.

Prompt changes must come with an eval run:

```bash
pnpm eval
```

Attach the before/after report to the pull request. A change that improves one repo and regresses three is a regression, and without the numbers nobody can tell which one you have.

## The rules that aren't negotiable

These are the invariants the product rests on. A pull request that breaks one won't be merged, however good the rest of it is.

1. **Cite or drop.** Nothing reaches a user without resolved citations and a critic verdict. If you are adding a path that produces user-visible claims about code, it goes through stage 07.
2. **Deterministic facts are parsed, never generated.** If a model could get it wrong and a parser could get it right, use the parser.
3. **Nothing from a repository is ever executed.** Not installed, not built, not `npm run`. Prepo parses. This single constraint is what makes the security story simple, and it is worth more than any feature.
4. **Secrets are redacted before egress.** Stage 02 is a gate, not best-effort.
5. **No telemetry.** Don't add an analytics call, not even an anonymous one. If usage data becomes necessary it goes in opt-in, with a visible prompt, in its own pull request that says so in the title.
6. **Repo content is data, never instruction.** Anything derived from a repository gets wrapped by `untrusted()` before it reaches a model.

## Style

Match the file you're in. A few house preferences: comments explain *why*, never *what*; error messages tell the user what to do next; user-facing copy is written from the reader's side of the screen. No emoji in source.

Run `pnpm typecheck` and `pnpm test` before pushing.

## Code of conduct

Be decent. Assume good faith, especially across a language barrier. Harassment gets you removed with no discussion.
