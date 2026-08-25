export interface Chunk {
  path: string;
  symbol: string | null;
  startLine: number;
  endLine: number;
  content: string;
}

export interface Chunker {
  readonly id: string;
  chunk(path: string, lang: string, content: string): Chunk[];
}

const TARGET_CHARS = 1_400;
const MAX_CHARS = 3_600;
const MIN_CHARS = 220;

/**
 * Symbol declaration patterns per language family.
 *
 * Capture group 1, where present, is the symbol name — it becomes the chunk's
 * label and, later, part of a citation. A chunk that starts halfway through a
 * function teaches a model nothing, so the whole point of this table is that
 * splits land on declaration boundaries.
 */
const SYMBOL_PATTERNS: Record<string, RegExp> = {
  TypeScript:
    /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s+|class\s+|interface\s+|type\s+|enum\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/,
  JavaScript:
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+|class\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/,
  Python: /^(?:\s*)(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/,
  Go: /^(?:func\s+(?:\([^)]*\)\s*)?|type\s+|var\s+|const\s+)([A-Za-z_]\w*)/,
  Rust: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:fn|struct|enum|trait|impl|mod)\s+(?:<[^>]*>\s*)?([A-Za-z_]\w*)/,
  Ruby: /^\s*(?:def|class|module)\s+([A-Za-z_][\w.:]*)/,
  Java: /^\s*(?:public|private|protected|static|final|abstract|synchronized|\s)*(?:class|interface|enum|record|[\w<>[\],\s]+)\s+([A-Za-z_]\w*)\s*[({]/,
  Kotlin: /^\s*(?:public|private|internal|protected|open|override|suspend|\s)*(?:fun|class|object|interface|val|var)\s+([A-Za-z_]\w*)/,
  "C#": /^\s*(?:public|private|protected|internal|static|async|sealed|virtual|override|\s)*(?:class|interface|struct|record|enum|[\w<>[\],\s]+)\s+([A-Za-z_]\w*)\s*[({]/,
  PHP: /^\s*(?:(?:abstract|final|public|private|protected|static)\s+)*(?:function|class|interface|trait)\s+([A-Za-z_]\w*)/,
  Swift: /^\s*(?:public|private|internal|fileprivate|open|\s)*(?:func|class|struct|enum|protocol|extension)\s+([A-Za-z_]\w*)/,
  C: /^[\w*\s]+\s+\*?([A-Za-z_]\w*)\s*\([^;]*$/,
  "C++": /^[\w*:<>~\s]+\s+\*?([A-Za-z_]\w*)\s*\([^;]*$/,
  Scala: /^\s*(?:private|protected|final|sealed|implicit|\s)*(?:def|class|object|trait|case\s+class)\s+([A-Za-z_]\w*)/,
  Elixir: /^\s*(?:def|defp|defmodule|defstruct)\s+([A-Za-z_][\w.?!]*)/,
  SQL: /^\s*(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|INDEX|FUNCTION|TRIGGER|TYPE)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([\w.]+)/i,
  Shell: /^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{/,
};

// A few languages share a family; map them onto the same pattern.
const ALIASES: Record<string, string> = {
  Vue: "TypeScript", Svelte: "TypeScript", Astro: "TypeScript",
  "Objective-C": "C", Groovy: "Java", Dart: "Kotlin", F: "C#",
};

function patternFor(lang: string): RegExp | undefined {
  return SYMBOL_PATTERNS[lang] ?? SYMBOL_PATTERNS[ALIASES[lang] ?? ""];
}

/**
 * The default chunker.
 *
 * A tree-sitter implementation would be strictly better — real parse trees
 * instead of declaration regexes — but it needs a WASM grammar per language
 * shipped and loaded, which is a meaningful install burden for a tool whose
 * entire pitch is `docker compose up`. This interface exists so that swap is a
 * new class rather than a refactor, and adding a grammar is a good first issue.
 */
export class HeuristicChunker implements Chunker {
  readonly id = "heuristic-v1";

  chunk(path: string, lang: string, content: string): Chunk[] {
    const lines = content.split("\n");
    if (content.trim().length === 0) return [];

    const pattern = patternFor(lang);
    const boundaries = pattern ? this.findBoundaries(lines, pattern) : [];

    const regions =
      boundaries.length > 0 ? this.regionsFrom(lines, boundaries) : this.regionsByBlankLines(lines);

    return this.pack(path, regions, lines);
  }

  private findBoundaries(lines: string[], pattern: RegExp): Array<{ line: number; symbol: string }> {
    const out: Array<{ line: number; symbol: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Skip obvious non-declarations cheaply before running the regex.
      if (line.length === 0 || line.length > 300) continue;
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) continue;

      const match = pattern.exec(line);
      if (match?.[1]) out.push({ line: i, symbol: match[1] });
    }
    return out;
  }

  private regionsFrom(
    lines: string[],
    boundaries: Array<{ line: number; symbol: string }>,
  ): Array<{ start: number; end: number; symbol: string | null }> {
    const regions: Array<{ start: number; end: number; symbol: string | null }> = [];

    // Everything before the first declaration — imports, constants, the file
    // header comment. Useful context, so it becomes its own chunk.
    const first = boundaries[0]!.line;
    if (first > 0) regions.push({ start: 0, end: first - 1, symbol: "(imports)" });

    for (let i = 0; i < boundaries.length; i++) {
      const b = boundaries[i]!;
      const next = boundaries[i + 1];
      regions.push({ start: b.line, end: (next ? next.line : lines.length) - 1, symbol: b.symbol });
    }
    return regions;
  }

  private regionsByBlankLines(lines: string[]): Array<{ start: number; end: number; symbol: string | null }> {
    const regions: Array<{ start: number; end: number; symbol: string | null }> = [];
    let start = 0;
    let size = 0;

    for (let i = 0; i < lines.length; i++) {
      size += lines[i]!.length + 1;
      const atBlank = lines[i]!.trim() === "";
      if (size >= TARGET_CHARS && atBlank) {
        regions.push({ start, end: i, symbol: null });
        start = i + 1;
        size = 0;
      }
    }
    if (start < lines.length) regions.push({ start, end: lines.length - 1, symbol: null });
    return regions;
  }

  /** Merge regions that are too small, split ones that are too big. */
  private pack(
    path: string,
    regions: Array<{ start: number; end: number; symbol: string | null }>,
    lines: string[],
  ): Chunk[] {
    const out: Chunk[] = [];
    const slice = (a: number, b: number) => lines.slice(a, b + 1).join("\n");

    let pending: { start: number; end: number; symbols: string[] } | null = null;

    const flush = () => {
      if (!pending) return;
      const content = slice(pending.start, pending.end);
      if (content.trim().length > 0) {
        out.push({
          path,
          symbol: pending.symbols.length ? pending.symbols.slice(0, 4).join(", ") : null,
          startLine: pending.start + 1,
          endLine: pending.end + 1,
          content,
        });
      }
      pending = null;
    };

    for (const region of regions) {
      const content = slice(region.start, region.end);

      if (content.length > MAX_CHARS) {
        flush();
        for (const part of splitLarge(region.start, region.end, lines)) {
          out.push({
            path,
            symbol: region.symbol,
            startLine: part.start + 1,
            endLine: part.end + 1,
            content: slice(part.start, part.end),
          });
        }
        continue;
      }

      if (!pending) {
        pending = { start: region.start, end: region.end, symbols: region.symbol ? [region.symbol] : [] };
      } else {
        pending.end = region.end;
        if (region.symbol) pending.symbols.push(region.symbol);
      }

      if (slice(pending.start, pending.end).length >= TARGET_CHARS) flush();
    }

    flush();
    return out.filter((c) => c.content.trim().length >= Math.min(MIN_CHARS, c.content.length));
  }
}

function splitLarge(
  start: number,
  end: number,
  lines: string[],
): Array<{ start: number; end: number }> {
  const parts: Array<{ start: number; end: number }> = [];
  let cursor = start;
  let size = 0;
  let lastBlank = -1;

  for (let i = start; i <= end; i++) {
    size += lines[i]!.length + 1;
    if (lines[i]!.trim() === "") lastBlank = i;

    if (size >= TARGET_CHARS) {
      // Prefer a blank line so the split lands between statements, but never
      // walk backwards past the start of the current part.
      const cut = lastBlank > cursor ? lastBlank : i;
      parts.push({ start: cursor, end: cut });
      cursor = cut + 1;
      size = 0;
      lastBlank = -1;
    }
  }

  if (cursor <= end) parts.push({ start: cursor, end });
  return parts;
}

export const defaultChunker: Chunker = new HeuristicChunker();
