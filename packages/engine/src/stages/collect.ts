import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { config, PrepoError, redact, type RedactionReport } from "@prepo/shared";
import { detectLanguage, isTestPath, NON_CODE_LANGS } from "../langs.js";
import { looksBinary, looksGenerated, parseGitignore, shouldIgnore, type IgnoreRules } from "../ignore.js";

export interface CollectedFile {
  path: string;
  lang: string;
  loc: number;
  bytes: number;
  /** Already redacted. Nothing else in the pipeline sees the raw text. */
  content: string;
  contentSha256: string;
  isTest: boolean;
}

export interface CollectResult {
  files: CollectedFile[];
  totalFilesSeen: number;
  sizeBytes: number;
  redaction: RedactionReport;
  readme: string | null;
  /** Top-level directories, for module-scoped mode on very large repos. */
  modules: string[];
}

/**
 * Stage 02. Walk, filter, redact — in that order, and the order matters:
 * filtering first means the expensive secret scan only runs on files that
 * survived, and redaction happens before anything is handed onward, so no
 * later stage can accidentally be the first to touch a raw credential.
 */
export async function collect(dir: string, scopedModules: string[] = []): Promise<CollectResult> {
  const rules: IgnoreRules = { extra: [] };
  try {
    rules.extra = parseGitignore(await readFile(join(dir, ".gitignore"), "utf8"));
  } catch {
    // No .gitignore is entirely normal.
  }

  const files: CollectedFile[] = [];
  const findings: RedactionReport["findings"] = [];
  const modules = new Set<string>();

  let totalFilesSeen = 0;
  let sizeBytes = 0;
  let scanned = 0;
  let readme: string | null = null;

  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      // Symlinks are skipped outright rather than followed: a link out of the
      // repository is either a mistake or an attack, and neither is worth reading.
      if (entry.isSymbolicLink()) continue;

      const full = join(current, entry.name);
      const path = relative(dir, full).split("\\").join("/");

      if (entry.isDirectory()) {
        if (shouldIgnore(`${path}/x`, rules)) continue;
        if (!path.includes("/")) modules.add(path);
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;

      totalFilesSeen++;
      if (totalFilesSeen > config.limits.maxFiles) {
        throw new PrepoError(
          "repo_too_large",
          `This repository has more than ${config.limits.maxFiles.toLocaleString()} files. Pick specific modules to analyse instead.`,
        );
      }

      if (shouldIgnore(path, rules)) continue;
      if (scopedModules.length > 0 && !scopedModules.some((m) => path === m || path.startsWith(`${m}/`))) {
        continue;
      }

      const info = await stat(full).catch(() => null);
      if (!info) continue;

      sizeBytes += info.size;
      if (sizeBytes > config.limits.maxRepoBytes) {
        throw new PrepoError(
          "repo_too_large",
          `This repository exceeds the ${Math.round(config.limits.maxRepoBytes / 1024 / 1024)} MB limit.`,
        );
      }
      if (info.size > config.limits.maxFileBytes || info.size === 0) continue;

      const buffer = await readFile(full).catch(() => null);
      if (!buffer || looksBinary(buffer)) continue;

      const raw = buffer.toString("utf8");
      if (looksGenerated(raw)) continue;

      scanned++;
      const { text, findings: fileFindings } = redact(raw);
      for (const f of fileFindings) {
        findings.push({ rule: f.rule, path, line: f.line, preview: f.preview });
      }

      const lang = detectLanguage(path);
      files.push({
        path,
        lang,
        loc: NON_CODE_LANGS.has(lang) ? 0 : text.split("\n").length,
        bytes: info.size,
        content: text,
        contentSha256: createHash("sha256").update(text).digest("hex"),
        isTest: isTestPath(path),
      });

      if (!readme && /^readme(\.[a-z]+)?$/i.test(entry.name)) readme = text;
    }
  };

  await walk(dir);

  // Deterministic order so the same commit produces the same rollups, which is
  // what lets the dossier prefix stay byte-stable and therefore cacheable.
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    files,
    totalFilesSeen,
    sizeBytes,
    redaction: { scanned, findings },
    readme,
    modules: [...modules].sort(),
  };
}

/** Groups files by their top-level-ish directory for the stage-04 rollup. */
export function groupByDirectory(files: CollectedFile[], maxDepth = 2): Map<string, CollectedFile[]> {
  const groups = new Map<string, CollectedFile[]>();

  for (const file of files) {
    const parts = file.path.split("/");
    const key = parts.length <= 1 ? "(root)" : parts.slice(0, Math.min(maxDepth, parts.length - 1)).join("/");
    const bucket = groups.get(key);
    if (bucket) bucket.push(file);
    else groups.set(key, [file]);
  }
  return groups;
}
