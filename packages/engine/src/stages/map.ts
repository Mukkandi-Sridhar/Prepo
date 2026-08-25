import { chunks as chunksTable, fileSummaries, inArray, sourceFiles } from "@prepo/db";
import { fileSummary } from "@prepo/prompts";
import { specFor } from "@prepo/llm";
import { defaultChunker } from "../chunker.js";
import { groupByDirectory, type CollectedFile } from "./collect.js";
import type { PipelineContext } from "../context.js";
import { chunkArray, mapLimit, mapLimitSettled } from "../util.js";

export interface MapResult {
  chunkCount: number;
  rollups: Array<{ dir: string; summary: string }>;
  summariesGenerated: number;
  summariesFromCache: number;
}

const SUMMARY_CONCURRENCY = 8;
const EMBED_BATCH = 96;

/** Files too small or too incidental to be worth a model call. */
function worthSummarising(file: CollectedFile): boolean {
  if (file.content.trim().length < 200) return false;
  if (file.lang === "JSON" && !/package\.json|composer\.json|tsconfig/.test(file.path)) return false;
  return true;
}

/**
 * Stage 04. Two independent things happen here, both cached aggressively
 * because between them they account for most of a run's cost:
 *
 *  - Chunk and embed, for retrieval later.
 *  - Summarise each file on the fast tier, then roll summaries up per
 *    directory — classic map-reduce, so stage 05 can reason about a whole
 *    repository without being handed a whole repository.
 *
 * Summaries are keyed on content hash *globally*, so a file that any user has
 * already summarised is free for everyone after them.
 */
export async function mapSemantics(
  ctx: PipelineContext,
  snapshotId: string,
  files: CollectedFile[],
): Promise<MapResult> {
  await ctx.onProgress("map", 0, `Chunking ${files.length} files`);

  /* ── chunk ───────────────────────────────────────────────── */

  const allChunks = files.flatMap((file) => defaultChunker.chunk(file.path, file.lang, file.content));

  await ctx.db
    .insert(sourceFiles)
    .values(
      files.map((f) => ({
        snapshotId,
        path: f.path,
        lang: f.lang,
        loc: f.loc,
        contentSha256: f.contentSha256,
      })),
    )
    .onConflictDoNothing();

  /* ── embed ───────────────────────────────────────────────── */

  let embedded = 0;
  for (const batch of chunkArray(allChunks, EMBED_BATCH)) {
    ctx.signal?.throwIfAborted();

    // Embedding text includes the path and symbol: a query like "where is the
    // auth middleware" should match on the file's identity, not only its body.
    const vectors = await ctx.llm.embed(
      batch.map((c) => `${c.path}${c.symbol ? ` — ${c.symbol}` : ""}\n\n${c.content}`),
    );

    await ctx.db.insert(chunksTable).values(
      batch.map((c, i) => ({
        snapshotId,
        path: c.path,
        symbol: c.symbol,
        startLine: c.startLine,
        endLine: c.endLine,
        content: c.content,
        embedding: vectors[i] ?? null,
      })),
    );

    embedded += batch.length;
    await ctx.onProgress("map", (embedded / Math.max(1, allChunks.length)) * 0.4, `Indexed ${embedded} chunks`);
  }

  /* ── summarise, with a global content-hash cache ─────────── */

  const candidates = files.filter(worthSummarising);
  const hashes = [...new Set(candidates.map((f) => f.contentSha256))];

  const cached = new Map<string, string>();
  for (const batch of chunkArray(hashes, 500)) {
    const rows = await ctx.db
      .select({ hash: fileSummaries.contentSha256, summary: fileSummaries.summary })
      .from(fileSummaries)
      .where(inArray(fileSummaries.contentSha256, batch));
    for (const row of rows) cached.set(row.hash, row.summary);
  }

  const missing = candidates.filter((f) => !cached.has(f.contentSha256));
  const model = specFor(ctx.llm.provider.id, "fast").id;
  let done = 0;

  const generated = await mapLimitSettled(missing, SUMMARY_CONCURRENCY, async (file) => {
    ctx.signal?.throwIfAborted();

    const summary = await ctx.llm.text({
      tier: "fast",
      stage: "04-summary",
      system: fileSummary.system,
      messages: [{ role: "user", content: fileSummary.user(file) }],
      maxTokens: 300,
      signal: ctx.signal,
    });

    done++;
    if (done % 5 === 0 || done === missing.length) {
      await ctx.onProgress("map", 0.4 + (done / Math.max(1, missing.length)) * 0.6, `Summarised ${done}/${missing.length} files`);
    }
    return { hash: file.contentSha256, summary: summary.trim() };
  });

  const fresh = generated.flatMap((r) => (r.ok ? [r.value] : []));
  if (fresh.length > 0) {
    for (const batch of chunkArray(fresh, 200)) {
      await ctx.db
        .insert(fileSummaries)
        .values(batch.map((s) => ({ contentSha256: s.hash, summary: s.summary, model, tokens: 0 })))
        .onConflictDoNothing();
    }
  }
  for (const s of fresh) cached.set(s.hash, s.summary);

  /* ── reduce ──────────────────────────────────────────────── */

  const groups = groupByDirectory(files);
  const rollups = [...groups.entries()]
    .map(([dir, group]) => {
      const lines = group
        .map((f) => {
          const summary = cached.get(f.contentSha256);
          return summary ? `- ${f.path} (${f.lang}, ${f.loc} loc): ${summary}` : `- ${f.path} (${f.lang})`;
        })
        .join("\n");
      return { dir, summary: lines };
    })
    .sort((a, b) => a.dir.localeCompare(b.dir));

  return {
    chunkCount: allChunks.length,
    rollups,
    summariesGenerated: fresh.length,
    summariesFromCache: candidates.length - missing.length,
  };
}

/** Re-embeds a single query string for retrieval. */
export async function embedQuery(ctx: PipelineContext, query: string): Promise<number[]> {
  const [vector] = await ctx.llm.embed([query]);
  return vector ?? [];
}

export { mapLimit };
