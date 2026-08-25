import { describe, expect, it } from "vitest";
import { redact } from "../redact.js";

describe("redact", () => {
  it("redacts AWS access key ID and secret key", () => {
    const raw = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const { text, findings } = redact(raw);

    expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(text).toContain("[REDACTED:aws_access_key]");
    expect(findings.length).toBeGreaterThan(0);
  });

  it("redacts GitHub personal access tokens", () => {
    const raw = "const token = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz1234';";
    const { text, findings } = redact(raw);

    expect(text).not.toContain("ghp_1234567890");
    expect(text).toContain("[REDACTED:github_token]");
    expect(findings.length).toBe(1);
  });

  it("leaves normal code untouched", () => {
    const raw = "function add(a: number, b: number) { return a + b; }";
    const { text, findings } = redact(raw);

    expect(text).toBe(raw);
    expect(findings.length).toBe(0);
  });
});
