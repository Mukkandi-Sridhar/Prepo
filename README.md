# Prepo

**Your repo, cross-examined.**

Point it at the repository on your resume. Prepo reads the code, builds a dossier, and generates the interview questions you'll actually be asked — with a model answer for each one, the follow-ups an interviewer would push into, and **citations back to the exact lines in your code**.

Then it interviews you.

```bash
git clone https://github.com/YOU/prepo && cd prepo
cp .env.example .env && pnpm keygen   # paste the two keys into .env
docker compose up -d
```

Open <http://localhost:3000>, paste your API key in Settings, add a repo. That's the whole install: Postgres, the app, and a worker. No Redis, no vector database, no cloud account.

---

## Why this instead of a question bank

Everyone puts three or four projects on their resume. In the interview, the first twenty minutes go to one of them — and most candidates fumble it, because they built the thing eight months ago and have never been asked to *defend* it.

| What people do now | Where it breaks |
|---|---|
| LeetCode / generic question banks | Zero overlap with the resume conversation, which is where most candidates actually fail |
| Pasting files into a chat window | Context runs out past a few files; no memory; invented specifics |
| Mock-interview SaaS | Subscription, and your private code on someone else's servers |
| Re-reading your own README | Documents *what* it does, never *why you chose it over the alternative* — which is the actual question |

## The one rule that makes it trustworthy

**Every factual claim in a generated answer must resolve to real lines in your code, or the question is dropped before you see it.**

A tool that confidently invents a caching layer you never wrote is worse than useless — it gets someone caught lying in an interview. So the pipeline is built around evidence:

- Deterministic facts (versions, routes, schema, dependencies) are **parsed and injected**, never generated. The model is never asked what version of React you use; it is told.
- Every citation is resolved against the real file at the real commit. A citation that doesn't resolve fails loudly.
- A **critic pass in a fresh context** re-reads the cited code and checks each claim. It never sees the generator's reasoning — a model shown its own working mostly agrees with it.
- What survives carries a visible `groundedness` score. What doesn't is counted and reported, not hidden.

On a typical run about 15–25% of generated questions are dropped. That is the feature working.

---

## What you get

**A grounded prep pack** — 60–120 questions across thirteen categories (architecture, language internals, data modeling, API design, concurrency, security, testing, DevOps, debugging, scaling, trade-offs, behavioral), each with a first-person model answer, escalating follow-up probes, what the interviewer is really testing, red flags to avoid, and file:line evidence.

**A mock interview** — an adaptive interviewer that has read your code, holds a plan, and decides each turn whether to probe deeper, move on, or challenge something you said. It scores you against a rubric where *"I don't know"* scores **high** and bluffing scores low.

**Flashcards** — FSRS-style spaced repetition over the pack, with Anki, Markdown, and PDF export.

**Resume tailoring** — paste your resume and the job description; questions get weighted toward the claims you actually made. It will also tell you which claims your code doesn't support, which is uncomfortable and much better learned here.

---

## Privacy

In self-hosted mode your code goes exactly two places: **your Postgres, and the model provider whose key you supplied.**

There is no telemetry endpoint. Not an anonymous one, not an opt-out one — the code to phone home does not exist. `TELEMETRY=off` is the default and there is nothing behind the flag yet.

Before anything reaches a model, stage 02 scans for secrets and replaces them — AWS keys, tokens, private key blocks, database URLs with passwords, hardcoded credentials. You get a report of what it found. People commit `.env` files constantly; catching that is a feature, not just hygiene.

---

## Architecture

Three containers, one database.

```
Browser ──► app (Next.js 15)          worker (pg-boss consumer)
                │                          │
                └────► Postgres 16 ◄───────┘
                       pgvector · pg-boss · LISTEN/NOTIFY
                            │
              GitHub · LLM providers · object storage
```

The single most useful decision here is that Postgres does four jobs — relational data, vector search, the job queue, and live progress. Every service you add is one a contributor has to install and you have to debug at 2am.

### The seven-stage pipeline

| # | Stage | Cost |
|---|-------|------|
| 01 | **Acquire** — shallow clone or safe ZIP extraction. Resolves to an immutable commit SHA, which is the cache key for everything downstream. | free |
| 02 | **Redact & filter** — `.gitignore` plus a curated ignore set removes 70–90% of files; the rest is scanned for secrets. | free |
| 03 | **Extract facts** — languages, dependencies with versions, routes, schema, env surface, CI, IaC, git churn. Parsed, never inferred. | free |
| 04 | **Map** — symbol-aware chunking, embeddings, per-file summaries on the fast tier, rolled up per directory. | ~60% of spend |
| 05 | **Dossier** — one frontier-model call producing architecture, decisions, weak spots, and ranked *interview hotspots*. | 1 call |
| 06 | **Generate** — parallel fan-out across category × difficulty × persona, each with its own retrieval. | ~20 calls |
| 07 | **Verify** — resolve citations, critic pass, dedupe, rank. | 1 call per question |

Stages are idempotent and checkpointed by input hash. A worker that dies during question generation resumes there instead of re-cloning and re-embedding — so deploying mid-job is safe.

### Model routing

Tiers, not model IDs. Editing [`packages/llm/src/models.json`](packages/llm/src/models.json) is the entire process for adopting a new model.

| Tier | Used for | Why |
|---|---|---|
| `fast` | Hundreds of file summaries | Volume dominates; per-call quality barely matters after rollup |
| `balanced` | Question generation, verification, interview turns | Strong reasoning at fan-out cost |
| `frontier` | The dossier — one call | Quality compounds into every question downstream |

Routing by task rather than picking one model for everything is a 5–10× cost difference with no quality loss where it matters.

### Cost control

Four mechanisms, in order of impact: **filter before you pay** (stage 02, free), **prompt caching** on the shared dossier prefix across the stage-06 fan-out, **content-addressed caching** at two levels (`sha256(file)` → summary, globally shared across all users; `commit_sha` → dossier), and a hard `BUDGET_CENTS_PER_RUN` ceiling checked *before* each call.

Rates live in [`pricing.json`](packages/llm/src/pricing.json) with a `fetchedAt` date shown next to every estimate. Where we have no published rate the UI says *"estimate unavailable"* rather than showing `$0.00` — a price we made up is worse than no price.

---

## Configuration

Three values are required: `DATABASE_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`. Generate the last two with `pnpm keygen`. Everything else in [`.env.example`](.env.example) has a working default.

**Providers** — Anthropic, OpenAI, Google Gemini, OpenRouter, or Ollama. Set a key in `.env` or let each user paste their own in Settings; user keys are AES-256-GCM encrypted with a per-user HKDF subkey and always win over the environment.

**Auth** — `SINGLE_USER_MODE=true` (the default) means no login screen at all. For a shared deployment set it to `false` and enable `github`, `google`, or `email` magic links.

**Embeddings** — `auto` prefers Ollama, then OpenAI, then Google, then a dependency-free local hashing embedder so the app works offline. The local one matches vocabulary rather than meaning; the Settings page says so plainly when it's active.

---

## Development

```bash
pnpm install
docker compose up -d db
pnpm db:migrate
pnpm dev          # web on :3000, worker watching
```

```
prepo/
├─ apps/
│  ├─ web/          Next.js 15 — UI, auth, server actions, SSE
│  └─ worker/       pg-boss consumer
├─ packages/
│  ├─ engine/       stages 01–07, no framework imports
│  ├─ llm/          provider adapters, tier router, cost meter
│  ├─ prompts/      versioned prompt files + registry
│  ├─ db/           Drizzle schema + hand-written migrations
│  └─ shared/       zod contracts, crypto, redaction
└─ evals/           local + remote fixtures, scorers, report
```

`packages/engine` deliberately imports no framework. It is testable without booting Next.js, and it makes `npx prepo ./my-project` an afternoon rather than a refactor.

### Evals

Prompt changes feel like improvements and are frequently regressions. Two tiers:

```bash
pnpm eval        # default — stages 02–03 against real local fixtures, no network, no API key
pnpm eval:full   # opt-in — the real pipeline against real repos, needs DATABASE_URL + a model key
```

`pnpm eval` is what CI runs on every PR: it exercises filtering, secret redaction, and fact extraction against the fixtures in [`evals/fixtures/local`](evals/fixtures/local) and fails loudly if a planted secret goes unredacted or an expected language goes undetected. It cannot tell you whether generated *questions* are any good — only `pnpm eval:full` can, because that's the only mode that actually calls a model. Run it before merging a change to `packages/prompts` or `packages/engine`'s stage 04–07 logic, and attach `evals/report.md` to the PR.

---

## Contributing

Extension points are registry-based so most contributions don't touch the engine:

- **Add a language** — a symbol pattern in [`chunker.ts`](packages/engine/src/chunker.ts)
- **Add a provider** — one entry in `DEFAULT_BASE_URLS`, or a class implementing `Provider`
- **Add a question category** — one entry in the shared enum and one retrieval query
- **Add an export format** — one function in [`export.ts`](packages/engine/src/export.ts)

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## Known limits

- **Chunking is heuristic, not tree-sitter.** Declaration regexes per language rather than real parse trees — tree-sitter needs a WASM grammar shipped and loaded per language, which is a real install burden for a project whose pitch is one command. The `Chunker` interface exists so that swap is a new class, not a refactor.
- **Trivial repos produce shallower packs.** A CRUD todo app has less to interrogate. The dossier rates complexity honestly and the generator pivots to stack choices and "how would you scale this" rather than manufacturing depth.
- **Very large monorepos need scoping.** Past ~4,000 analysable files Prepo asks you to pick the modules you actually worked on. A deep pack on your part beats a vague one on everything.

## License

Apache-2.0. See [LICENSE](LICENSE).
