# Prepo Eval Suite Report

**Run at:** 2026-09-01T14:56:34.184Z

This report reflects what actually ran. The smoke suite runs stages 02–03
(filter, redact, extract facts) against real local fixtures — no network,
no API key. It cannot evaluate generated question quality; only
`pnpm eval:full`, with a real database and model key, exercises the full
pipeline and scores real output.

## Smoke suite

| Fixture | Result | Files | Languages | Secrets redacted |
| :--- | :--- | :--- | :--- | :--- |
| `bootcamp-crud` | ✅ PASS | 6 | JavaScript, SQL | 3 |
| `messy-legacy` | ✅ PASS | 3 | PHP, Python | 1 |

## Full suite

Not run this time — invoke with `pnpm eval:full`.
