import { describe, expect, it } from "vitest";
import { toAnkiTsv, toMarkdown, toPrintableHtml, type ExportInput } from "../export.js";

describe("Export module (export.ts)", () => {
  const sampleInput: ExportInput = {
    projectName: "Prepo Test Project",
    commitSha: "a1b2c3d4e5f67890",
    generatedAt: new Date("2026-08-25T12:00:00Z"),
    droppedCount: 2,
    questions: [
      {
        category: "architecture",
        difficulty: "senior",
        persona: "Tech Lead",
        stem: "How is transaction isolation handled under Redis failover?",
        modelAnswer: "The transaction in uploadService.ts wraps Postgres writes...",
        probes: ["What is the delivery guarantee of your outbox?"],
        testingFor: "Understanding side effects inside transaction boundaries",
        redFlags: ["Assuming Redis operations roll back with Postgres"],
        groundedness: 0.94,
        citations: [{ path: "src/services/uploadService.ts", startLine: 44, endLine: 71 }],
      },
    ],
  };

  it("exports formatted Markdown containing title, metadata and citations", () => {
    const md = toMarkdown(sampleInput);
    expect(md).toContain("# Interview prep — Prepo Test Project");
    expect(md).toContain("How is transaction isolation handled under Redis failover?");
    expect(md).toContain("src/services/uploadService.ts:44-71");
  });

  it("exports valid Anki TSV format with headers and tags", () => {
    const tsv = toAnkiTsv(sampleInput);
    expect(tsv).toContain("#separator:tab");
    expect(tsv).toContain("#html:true");
    expect(tsv).toContain("How is transaction isolation handled under Redis failover?");
    expect(tsv).toContain("prepo::architecture");
  });

  it("exports print-ready HTML with responsive print CSS styles", () => {
    const html = toPrintableHtml(sampleInput);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Interview prep — Prepo Test Project</title>");
    expect(html).toContain("src/services/uploadService.ts:44-71");
    expect(html).toContain("@page { margin: 18mm; }");
  });
});
