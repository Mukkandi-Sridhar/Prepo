import { CATEGORY_LABELS, DIFFICULTY_LABELS, type QuestionCategory, type Difficulty } from "@prepo/shared";

export interface ExportQuestion {
  category: string;
  difficulty: string;
  persona: string;
  stem: string;
  modelAnswer: string;
  probes: string[];
  testingFor: string;
  redFlags: string[];
  groundedness: string | number;
  citations: Array<{ path: string; startLine: number; endLine: number }>;
}

export interface ExportInput {
  projectName: string;
  commitSha: string;
  generatedAt: Date;
  questions: ExportQuestion[];
  droppedCount: number;
}

function label(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

function cite(c: { path: string; startLine: number; endLine: number }): string {
  return `${c.path}:${c.startLine}-${c.endLine}`;
}

export function toMarkdown(input: ExportInput): string {
  const byCategory = new Map<string, ExportQuestion[]>();
  for (const q of input.questions) {
    const bucket = byCategory.get(q.category);
    if (bucket) bucket.push(q);
    else byCategory.set(q.category, [q]);
  }

  const out: string[] = [
    `# Interview prep — ${input.projectName}`,
    "",
    `Generated ${input.generatedAt.toISOString().slice(0, 10)} from commit \`${input.commitSha.slice(0, 10)}\`.`,
    `${input.questions.length} questions kept · ${input.droppedCount} dropped in verification.`,
    "",
    "> Every answer below cites the lines it came from. If a citation looks wrong, trust the code.",
    "",
    "---",
    "",
  ];

  for (const [category, group] of byCategory) {
    out.push(`## ${label(CATEGORY_LABELS as Record<string, string>, category)}`, "");

    group.forEach((q, i) => {
      out.push(
        `### ${i + 1}. ${q.stem}`,
        "",
        `\`${label(DIFFICULTY_LABELS as Record<string, string>, q.difficulty)}\` · asked by the ${q.persona.replace("-", " ")} · groundedness ${Number(q.groundedness).toFixed(2)}`,
        "",
        `**What they're testing.** ${q.testingFor}`,
        "",
        "**Your answer**",
        "",
        q.modelAnswer,
        "",
      );

      if (q.probes.length) {
        out.push("**They'll follow up with**", "", ...q.probes.map((p) => `- ${p}`), "");
      }
      if (q.redFlags.length) {
        out.push("**Avoid**", "", ...q.redFlags.map((r) => `- ${r}`), "");
      }
      if (q.citations.length) {
        out.push(`**Evidence** — ${q.citations.map((c) => `\`${cite(c)}\``).join(" · ")}`, "");
      }
      out.push("---", "");
    });
  }

  return out.join("\n");
}

/**
 * Anki's simplest import format: tab-separated, HTML in fields, one card per
 * line. No dependency, no .apkg zip juggling, and it imports cleanly — the
 * user picks "Basic" and maps two columns.
 */
export function toAnkiTsv(input: ExportInput): string {
  const esc = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\t/g, " ")
      .replace(/\n/g, "<br>");

  const lines = ["#separator:tab", "#html:true", `#tags column:3`];

  for (const q of input.questions) {
    const back = [
      esc(q.modelAnswer),
      q.probes.length ? `<br><br><b>Follow-ups</b><br>${q.probes.map(esc).join("<br>")}` : "",
      q.citations.length ? `<br><br><i>${q.citations.map((c) => esc(cite(c))).join(" · ")}</i>` : "",
    ].join("");

    const tags = [`prepo::${q.category}`, `prepo::${q.difficulty}`].join(" ");
    lines.push([esc(q.stem), back, tags].join("\t"));
  }

  return lines.join("\n");
}

/**
 * Print-ready HTML. The browser's own print-to-PDF is used rather than a
 * headless Chromium dependency — it adds ~300 MB to the image to reproduce
 * something every user already has.
 */
export function toPrintableHtml(input: ExportInput): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const body = input.questions
    .map(
      (q, i) => `
<article>
  <div class="meta">${esc(label(CATEGORY_LABELS as Record<string, string>, q.category))} · ${esc(label(DIFFICULTY_LABELS as Record<string, string>, q.difficulty))}</div>
  <h3>${i + 1}. ${esc(q.stem)}</h3>
  <p class="testing"><b>Testing:</b> ${esc(q.testingFor)}</p>
  <p>${esc(q.modelAnswer).replace(/\n/g, "<br>")}</p>
  ${q.probes.length ? `<p class="probes"><b>Follow-ups:</b><br>${q.probes.map((p) => `→ ${esc(p)}`).join("<br>")}</p>` : ""}
  ${q.citations.length ? `<p class="cites">${q.citations.map((c) => esc(cite(c))).join(" · ")}</p>` : ""}
</article>`,
    )
    .join("\n");

  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>Interview prep — ${esc(input.projectName)}</title>
<style>
  @page { margin: 18mm; }
  body { font: 11pt/1.55 Georgia, serif; color: #161a19; max-width: 44em; margin: 0 auto; }
  h1 { font-family: system-ui, sans-serif; font-size: 20pt; margin: 0 0 .2em; }
  .sub { color: #646b67; font-family: ui-monospace, monospace; font-size: 9pt; margin-bottom: 2em; }
  article { break-inside: avoid; border-top: 1px solid #d5d9d2; padding-top: 1em; margin-bottom: 1.6em; }
  .meta { font-family: ui-monospace, monospace; font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; color: #1f6f5c; }
  h3 { font-family: system-ui, sans-serif; font-size: 12pt; margin: .35em 0 .6em; }
  .testing, .probes { font-size: 10pt; color: #3a413e; }
  .cites { font-family: ui-monospace, monospace; font-size: 8.5pt; color: #1f6f5c; }
</style></head>
<body>
  <h1>Interview prep — ${esc(input.projectName)}</h1>
  <div class="sub">commit ${esc(input.commitSha.slice(0, 10))} · ${input.questions.length} questions · generated ${input.generatedAt.toISOString().slice(0, 10)}</div>
  ${body}
</body></html>`;
}
