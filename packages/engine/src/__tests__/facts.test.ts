import { describe, expect, it } from "vitest";
import { extractFacts } from "../stages/facts.js";

describe("extractFacts", () => {
  it("extracts deterministic repository facts from collected files", () => {
    const facts = extractFacts({
      name: "sample-repo",
      commitSha: "abc1234567890",
      defaultBranch: "main",
      git: {
        commits: 42,
        contributors: 3,
        firstCommit: "2026-01-01",
        lastCommit: "2026-08-25",
        hotspots: [{ path: "src/index.ts", changes: 15 }],
      },
      collected: {
        totalFilesSeen: 4,
        sizeBytes: 1024,
        readme: null,
        files: [
          {
            path: "package.json",
            lang: "JSON",
            loc: 25,
            bytes: 500,
            isTest: false,
            contentSha256: "sha1",
            content: JSON.stringify({
              dependencies: { express: "^4.18.2", dotenv: "^16.0.0" },
              devDependencies: { typescript: "^5.0.0" },
            }),
          },
          {
            path: "src/index.ts",
            lang: "TypeScript",
            loc: 50,
            bytes: 800,
            isTest: false,
            contentSha256: "sha2",
            content: "import express from 'express';\nconst app = express();\napp.get('/health', (req, res) => res.send('OK'));",
          },
          {
            path: "docker-compose.yml",
            lang: "YAML",
            loc: 15,
            bytes: 300,
            isTest: false,
            contentSha256: "sha3",
            content: "services:\n  web:\n    image: node:20",
          },
        ],
        modules: ["src"],
        redaction: { scanned: 3, findings: [] },
      },
    });

    expect(facts.name).toBe("sample-repo");
    expect(facts.totalLoc).toBe(90);
    expect(facts.languages.some((l) => l.lang === "TypeScript")).toBe(true);
    expect(facts.dependencies.some((d) => d.name === "express")).toBe(true);
    expect(facts.routes.some((r) => r.path === "/health")).toBe(true);
    expect(facts.hasCompose).toBe(true);
  });
});
