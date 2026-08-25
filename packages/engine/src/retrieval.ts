import { getSql } from "@prepo/db";
import type { PipelineContext } from "./context.js";

export interface RetrievedChunk {
  path: string;
  symbol: string | null;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/**
 * Hybrid retrieval: vector similarity plus a lexical pass over paths and
 * symbol names, merged with reciprocal rank fusion.
 *
 * The lexical half is not a nicety. Code retrieval has a lot of exact-identifier
 * queries ("where is UserService"), embeddings are mediocre at those, and when
 * the local hashing embedder is in use the lexical signal is carrying most of
 * the weight. Fusion means neither half has to be good on its own.
 */
export async function retrieve(
  ctx: PipelineContext,
  snapshotId: string,
  query: string,
  limit = 12,
): Promise<RetrievedChunk[]> {
  const sql = getSql();
  const [vector] = await ctx.llm.embed([query]);

  const semantic = vector?.length
    ? await sql<Array<RetrievedChunk & { rank: number }>>`
        SELECT path, symbol, start_line AS "startLine", end_line AS "endLine", content,
               1 - (embedding <=> ${toVectorLiteral(vector)}::vector) AS score,
               row_number() OVER (ORDER BY embedding <=> ${toVectorLiteral(vector)}::vector) AS rank
        FROM chunks
        WHERE snapshot_id = ${snapshotId} AND embedding IS NOT NULL
        ORDER BY embedding <=> ${toVectorLiteral(vector)}::vector
        LIMIT ${limit * 2}
      `
    : [];

  const terms = query
    .match(/[A-Za-z_][A-Za-z0-9_]{2,}/g)
    ?.slice(0, 12)
    .map((t) => t.toLowerCase()) ?? [];

  const lexical = terms.length
    ? await sql<Array<RetrievedChunk & { rank: number }>>`
        SELECT path, symbol, start_line AS "startLine", end_line AS "endLine", content,
               0 AS score,
               row_number() OVER (ORDER BY hits DESC) AS rank
        FROM (
          SELECT path, symbol, start_line, end_line, content,
                 (SELECT count(*) FROM unnest(${terms}::text[]) AS t
                   WHERE lower(path) LIKE '%' || t || '%'
                      OR lower(coalesce(symbol, '')) LIKE '%' || t || '%'
                      OR lower(content) LIKE '%' || t || '%') AS hits
          FROM chunks
          WHERE snapshot_id = ${snapshotId}
        ) scored
        WHERE hits > 0
        ORDER BY hits DESC
        LIMIT ${limit * 2}
      `
    : [];

  return fuse([semantic, lexical], limit);
}

/** Reciprocal rank fusion. k=60 is the value from the original TREC work. */
function fuse(lists: Array<Array<RetrievedChunk & { rank: number }>>, limit: number): RetrievedChunk[] {
  const k = 60;
  const scores = new Map<string, { chunk: RetrievedChunk; score: number }>();

  for (const list of lists) {
    for (const row of list) {
      const key = `${row.path}:${row.startLine}`;
      const existing = scores.get(key);
      const contribution = 1 / (k + Number(row.rank));
      if (existing) existing.score += contribution;
      else scores.set(key, { chunk: stripRank(row), score: contribution });
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({ ...s.chunk, score: s.score }));
}

function stripRank(row: RetrievedChunk & { rank: number }): RetrievedChunk {
  const { rank: _rank, ...chunk } = row;
  return chunk;
}

/**
 * Pulls back every stored chunk overlapping a cited line range. Used by the
 * stage-07 critic to read the code an answer claims to be describing, and by
 * the UI to show the evidence behind a question.
 */
export async function citationSource(
  snapshotId: string,
  path: string,
  startLine: number,
  endLine: number,
): Promise<{ path: string; startLine: number; endLine: number; content: string } | null> {
  const sql = getSql();
  const rows = await sql<Array<{ startLine: number; endLine: number; content: string }>>`
    SELECT start_line AS "startLine", end_line AS "endLine", content
    FROM chunks
    WHERE snapshot_id = ${snapshotId}
      AND path = ${path}
      AND start_line <= ${endLine}
      AND end_line >= ${startLine}
    ORDER BY start_line
  `;

  if (rows.length === 0) return null;

  return {
    path,
    startLine: rows[0]!.startLine,
    endLine: rows[rows.length - 1]!.endLine,
    content: rows.map((r) => r.content).join("\n"),
  };
}

/** True when a citation points at a real, stored range. Cheap and exact. */
export async function citationResolves(
  snapshotId: string,
  path: string,
  startLine: number,
  endLine: number,
): Promise<boolean> {
  const sql = getSql();
  const [row] = await sql<Array<{ ok: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM chunks
      WHERE snapshot_id = ${snapshotId}
        AND path = ${path}
        AND start_line <= ${endLine}
        AND end_line >= ${startLine}
    ) AS ok
  `;
  return row?.ok ?? false;
}
