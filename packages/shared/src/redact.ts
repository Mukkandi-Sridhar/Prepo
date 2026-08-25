/**
 * Secret detection. This runs as a hard gate in pipeline stage 02 — nothing
 * reaches a model provider before it has been through here — and again as a
 * scrubber on anything headed for a log.
 *
 * Rules are deliberately biased toward false positives. Redacting a harmless
 * string costs a little context; leaking a live AWS key costs a lot more.
 */

export interface SecretRule {
  id: string;
  label: string;
  pattern: RegExp;
}

export const SECRET_RULES: SecretRule[] = [
  { id: "aws_access_key", label: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "aws_secret", label: "AWS secret key", pattern: /\baws_secret_access_key\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi },
  { id: "github_token", label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { id: "anthropic_key", label: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9\-_]{20,}\b/g },
  { id: "openai_key", label: "OpenAI API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9\-_]{32,}\b/g },
  { id: "google_key", label: "Google API key", pattern: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { id: "slack_token", label: "Slack token", pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { id: "stripe_key", label: "Stripe key", pattern: /\b[rs]k_(?:live|test)_[0-9A-Za-z]{16,}\b/g },
  { id: "sendgrid_key", label: "SendGrid key", pattern: /\bSG\.[A-Za-z0-9\-_]{16,}\.[A-Za-z0-9\-_]{16,}\b/g },
  { id: "private_key", label: "Private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { id: "jwt", label: "JSON Web Token", pattern: /\beyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\b/g },
  { id: "db_url", label: "Database URL with password", pattern: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/"']+:[^\s@/"']+@[^\s"'`]+/gi },
  {
    id: "generic_assignment",
    label: "Hardcoded credential",
    // KEY = "long-opaque-value" — the shape of most leaked .env files.
    pattern:
      /\b([A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET)[A-Z0-9_]*)\s*[=:]\s*["']([^"'\s]{12,})["']/g,
  },
];

/** Values that look like secrets but are obviously placeholders. */
const PLACEHOLDER = /^(?:x{4,}|\.{3,}|<[^>]+>|\$\{[^}]+\}|your[-_]?|change[-_]?me|placeholder|example|dummy|test|todo|null|none|undefined)/i;

export interface Finding {
  rule: string;
  label: string;
  line: number;
  preview: string;
}

export interface RedactResult {
  text: string;
  findings: Finding[];
}

function mask(value: string): string {
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 3)}${"*".repeat(Math.min(12, value.length - 6))}${value.slice(-3)}`;
}

/**
 * Replaces every detected secret with a labelled marker. The marker is kept
 * (rather than deleting the line) so the model can still reason about the
 * *shape* of the code — "this reads an AWS key here" is useful context, the
 * key itself is not.
 */
export function redact(text: string): RedactResult {
  const findings: Finding[] = [];
  let out = text;

  for (const rule of SECRET_RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);

    out = out.replace(re, (...args: unknown[]) => {
      // replace() passes (match, ...groups, offset, wholeString). Named groups
      // would add one more trailing arg; none of these rules use them.
      const match = args[0] as string;
      const offset = args[args.length - 2] as number;
      const source = args[args.length - 1] as string;
      const groups = args.slice(1, args.length - 2) as (string | undefined)[];

      // Prefer the most specific capture: rules that isolate the secret value
      // capture it in the last group.
      const captured = groups.filter((g) => typeof g === "string").at(-1) ?? match;
      if (PLACEHOLDER.test(captured)) return match;

      const line = countLines(source, offset);
      findings.push({ rule: rule.id, label: rule.label, line, preview: mask(captured) });

      // Keep the variable name so the model still sees *that* a credential is
      // read here — the shape is useful context, the value is not.
      if (rule.id === "generic_assignment" && typeof groups[0] === "string") {
        return `${groups[0]}="[REDACTED:${rule.id}]"`;
      }
      return `[REDACTED:${rule.id}]`;
    });
  }

  return { text: out, findings };
}

function countLines(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Log scrubber. Belt and braces on top of the serializer allowlist — there is
 * a unit test that fails if a fixture key ever survives this.
 */
export function scrubForLog(value: unknown): unknown {
  if (typeof value === "string") return redact(value).text;
  if (Array.isArray(value)) return value.map(scrubForLog);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /key|secret|token|password|authorization|ciphertext/i.test(k)
        ? "[redacted]"
        : scrubForLog(v);
    }
    return out;
  }
  return value;
}
