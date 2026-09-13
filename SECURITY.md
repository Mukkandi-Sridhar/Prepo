# Security

## Reporting a vulnerability

Open a [private security advisory](https://github.com/Mukkandi-Sridhar/Prepo/security/advisories/new) on GitHub, or email the address in the repository profile. Please don't open a public issue for anything exploitable.

Expect an acknowledgement within a week. This is a volunteer-maintained project — there is no bounty, but you will be credited in the advisory unless you'd rather not be.

## Threat model

Prepo ingests arbitrary code from the internet and sends parts of it to a third-party model provider using a credential the user supplied. Those two facts define the entire security surface.

### Untrusted repositories

**Nothing from a repository is ever executed.** No install, no build, no `package.json` scripts, no test run. Prepo only parses. This removes the whole remote-code-execution class rather than mitigating it.

The worker runs with a read-only root filesystem, a size-capped tmpfs work directory, all capabilities dropped, `no-new-privileges`, and as a non-root user. See the `worker` service in [`docker-compose.yml`](docker-compose.yml).

Archive extraction rejects absolute paths, `..` traversal, symlinks, and entries whose resolved path escapes the extraction root; it caps entry count, total uncompressed size, and compression ratio.

Clone URLs are validated against an allowlist of forge hosts, with private address ranges and cloud metadata endpoints blocked — an unvalidated clone URL is an SSRF vector. Widen it with `GIT_ALLOWED_HOSTS` if you run an internal GitLab.

### Prompt injection

Repository contents are untrusted input, and a README that says "ignore previous instructions" is a real thing you will encounter. Every piece of repo-derived text passed to a model is wrapped in delimited `<untrusted_*>` blocks with an explicit instruction that the contents are data. Combined with schema-constrained output and the stage-07 critic, a successful injection can waste a call but not change what the system does.

### Credentials

Provider API keys are encrypted with AES-256-GCM, a random IV per record, and a per-user HKDF subkey derived from `ENCRYPTION_KEY` — so a leaked ciphertext cannot be replayed against another user's row. Only the last four characters are stored in plaintext, for display.

Keys never appear in logs: there is a serializer allowlist plus a regex scrubber on anything headed for output.

Clone tokens are injected into the URL for a single `git clone` with `GIT_TERMINAL_PROMPT=0` and a stubbed askpass, never written to a credential file — and git's stderr is never echoed back to the user when a token was used, because it can contain the token.

### What is out of scope

- **The model provider.** Your code goes to whichever provider's key you configured, under their terms. Prepo cannot change that; running Ollama locally avoids it entirely.
- **Denial of service against your own instance.** Rate limits exist per user, but a self-hosted single-user deployment has no adversary worth modelling.
- **Anything requiring a valid session for your own account.** Prepo has no privilege boundary between a user and their own data.

## Operational notes

- Set `ENCRYPTION_KEY` and `AUTH_SECRET` to distinct 32-byte random values (`pnpm keygen`). Rotating `ENCRYPTION_KEY` invalidates every stored provider key; users re-paste them.
- Don't expose Postgres publicly. The port mapping in `docker-compose.yml` is a development convenience — remove it for anything internet-facing.
- Put a TLS-terminating reverse proxy in front of the app and set `APP_URL` to the public origin; OAuth callbacks and the session cookie's `secure` flag depend on it.
- `SINGLE_USER_MODE=true` disables authentication entirely. That is correct on a laptop and wrong on a public host.
