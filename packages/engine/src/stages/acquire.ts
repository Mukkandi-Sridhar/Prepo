import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import { config, PrepoError, type GitStats } from "@prepo/shared";

export interface AcquireResult {
  dir: string;
  commitSha: string;
  defaultBranch: string | null;
  git: GitStats;
  /** Call when the snapshot is no longer needed. */
  cleanup: () => Promise<void>;
}

/* ── URL safety ─────────────────────────────────────────────── */

const ALLOWED_HOSTS = /^(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org|git\.sr\.ht)$/i;

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|::1|0\.0\.0\.0|\[?::)/i;
const PRIVATE_172 = /^172\.(1[6-9]|2\d|3[01])\./;

/**
 * Clone URLs come from users, so they are an SSRF vector: a request to
 * 169.254.169.254 from inside a cloud worker reaches the instance metadata
 * service. An allowlist of forge hosts is blunt, but it is the control that
 * actually holds — and self-hosters who need an internal GitLab can widen it
 * with GIT_ALLOWED_HOSTS.
 */
export function assertSafeRepoUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PrepoError("invalid_input", "That does not look like a URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PrepoError("invalid_input", "Only http(s) repository URLs are supported.");
  }
  if (url.username || url.password) {
    throw new PrepoError("invalid_input", "Remove credentials from the URL — add a key in Settings instead.");
  }
  if (PRIVATE_HOST.test(url.hostname) || PRIVATE_172.test(url.hostname)) {
    throw new PrepoError("invalid_input", "That address is not reachable from the analyser.");
  }

  const extra = (process.env.GIT_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  if (!ALLOWED_HOSTS.test(url.hostname) && !extra.includes(url.hostname.toLowerCase())) {
    throw new PrepoError(
      "invalid_input",
      `${url.hostname} is not an allowed host. Add it to GIT_ALLOWED_HOSTS to permit it.`,
    );
  }
  return url;
}

export function repoNameFromUrl(url: string): string {
  const parts = url.replace(/\.git$/, "").split("/").filter(Boolean);
  return parts.slice(-2).join("/") || "repository";
}

/* ── git ────────────────────────────────────────────────────── */

function run(cmd: string, args: string[], cwd?: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "echo",
        GCM_INTERACTIVE: "never",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new PrepoError("clone_failed", `${cmd} timed out after ${timeoutMs / 1000}s.`));
    }, timeoutMs);

    child.stdout?.on("data", (d: Buffer | string) => {
      stdout += String(d);
      if (stdout.length > 20_000_000) child.kill("SIGKILL");
    });
    child.stderr?.on("data", (d: Buffer | string) => {
      stderr += String(d).slice(0, 4_000);
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(new PrepoError("clone_failed", `Could not run ${cmd}: ${err.message}`));
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(stdout);
      else reject(new PrepoError("clone_failed", stderr.trim() || `${cmd} exited with code ${code}`));
    });
  });
}

export async function cloneRepo(url: string, token?: string): Promise<AcquireResult> {
  const parsed = assertSafeRepoUrl(url);
  await mkdir(config.workDir, { recursive: true });
  const dir = await mkdtemp(join(config.workDir, "repo-"));

  // A token is injected into the URL rather than written to a credential file,
  // and the process env above keeps git from caching it anywhere.
  const cloneUrl = token
    ? `${parsed.protocol}//x-access-token:${token}@${parsed.host}${parsed.pathname}`
    : parsed.toString();

  try {
    // Depth 50 gives enough history for churn statistics without pulling years
    // of it. Note: --filter=blob:none is deliberately NOT used — a blobless
    // clone fetches file contents lazily, and this pipeline reads every file,
    // so it would turn one clone into thousands of round trips.
    await run("git", ["clone", "--depth", "50", "--single-branch", "--no-tags", cloneUrl, dir]);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    if (err instanceof PrepoError) {
      throw new PrepoError(
        "clone_failed",
        // Never echo git's stderr verbatim — it can contain the injected token.
        token ? "Could not clone that repository. Check the URL and that your token has access." : err.message,
      );
    }
    throw err;
  }

  const [commitSha, branch, git] = await Promise.all([
    run("git", ["rev-parse", "HEAD"], dir).then((s) => s.trim()),
    run("git", ["rev-parse", "--abbrev-ref", "HEAD"], dir)
      .then((s) => s.trim())
      .catch(() => null),
    gitStats(dir),
  ]);

  return {
    dir,
    commitSha,
    defaultBranch: branch,
    git,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

async function gitStats(dir: string): Promise<GitStats> {
  const empty: GitStats = { commits: 0, contributors: 0, firstCommit: null, lastCommit: null, hotspots: [] };

  try {
    const log = await run("git", ["log", "--format=%H%x00%an%x00%aI", "--name-only", "-n", "300"], dir);
    const churn = new Map<string, number>();
    const authors = new Set<string>();
    const dates: string[] = [];
    let commits = 0;

    for (const line of log.split("\n")) {
      if (line.includes("\0")) {
        const [, author, date] = line.split("\0");
        commits++;
        if (author) authors.add(author);
        if (date) dates.push(date);
      } else if (line.trim()) {
        churn.set(line, (churn.get(line) ?? 0) + 1);
      }
    }

    const hotspots = [...churn.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([path, changes]) => ({ path, changes }));

    dates.sort();
    return {
      commits,
      contributors: authors.size,
      firstCommit: dates[0] ?? null,
      lastCommit: dates[dates.length - 1] ?? null,
      hotspots,
    };
  } catch {
    // Shallow clones and ZIP uploads legitimately have no usable history.
    return empty;
  }
}

/* ── zip ────────────────────────────────────────────────────── */

const MAX_ENTRIES = 25_000;
const MAX_COMPRESSION_RATIO = 10;

/**
 * Archive extraction is the classic place to get owned. Four checks, all of
 * them load-bearing: no absolute paths, no `..` traversal, no symlinks (a
 * symlink to /etc/passwd would otherwise be read and summarised), and a
 * compression-ratio ceiling so a 1 MB upload cannot expand to 40 GB.
 */
export async function extractZip(zipPath: string, name: string): Promise<AcquireResult> {
  await mkdir(config.workDir, { recursive: true });
  const dir = await mkdtemp(join(config.workDir, "zip-"));
  const root = resolve(dir);

  const { size: archiveSize } = await stat(zipPath);
  let totalUncompressed = 0;
  let entries = 0;

  await new Promise<void>((resolvePromise, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return reject(new PrepoError("unsafe_archive", "Could not read that archive."));

      const fail = (message: string) => {
        zip.close();
        reject(new PrepoError("unsafe_archive", message));
      };

      zip.on("entry", (entry: yauzl.Entry) => {
        if (++entries > MAX_ENTRIES) return fail(`Archive has more than ${MAX_ENTRIES} entries.`);

        const raw = entry.fileName;
        if (raw.startsWith("/") || raw.includes("\0") || normalize(raw).split(sep).includes("..")) {
          return fail(`Archive contains an unsafe path: ${raw.slice(0, 80)}`);
        }

        // Unix mode lives in the top 16 bits of externalFileAttributes.
        const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
        if ((mode & 0xf000) === 0xa000) return fail("Archive contains symlinks, which are not supported.");

        const target = resolve(root, raw);
        if (!target.startsWith(root + sep)) return fail(`Archive entry escapes the extraction root: ${raw.slice(0, 80)}`);

        if (raw.endsWith("/")) {
          void mkdir(target, { recursive: true }).then(() => zip.readEntry(), reject);
          return;
        }

        totalUncompressed += entry.uncompressedSize;
        if (totalUncompressed > config.limits.maxRepoBytes) {
          return fail(`Archive expands beyond the ${config.limits.maxRepoBytes / 1024 / 1024} MB limit.`);
        }
        if (archiveSize > 0 && totalUncompressed / archiveSize > MAX_COMPRESSION_RATIO && totalUncompressed > 50_000_000) {
          return fail("Archive compression ratio looks like a zip bomb.");
        }

        zip.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) return fail("Could not read an entry in the archive.");
          void mkdir(dirname(target), { recursive: true })
            .then(() => pipeline(readStream, createWriteStream(target)))
            .then(() => zip.readEntry())
            .catch(reject);
        });
      });

      zip.on("end", () => resolvePromise());
      zip.on("error", () => fail("The archive is corrupt."));
      zip.readEntry();
    });
  }).catch(async (err) => {
    await rm(dir, { recursive: true, force: true });
    throw err;
  });

  // A ZIP has no commit, so the content hash stands in as the cache key: the
  // same upload twice is genuinely the same snapshot.
  const commitSha = `zip-${await hashDirectory(dir)}`;

  return {
    dir: await unwrapSingleRoot(dir),
    commitSha,
    defaultBranch: null,
    git: { commits: 0, contributors: 0, firstCommit: null, lastCommit: null, hotspots: [] },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** GitHub ZIP downloads wrap everything in `repo-main/`. Step through it. */
async function unwrapSingleRoot(dir: string): Promise<string> {
  const { readdir } = await import("node:fs/promises");
  const items = await readdir(dir, { withFileTypes: true });
  const visible = items.filter((i) => !i.name.startsWith("."));
  if (visible.length === 1 && visible[0]!.isDirectory()) return join(dir, visible[0]!.name);
  return dir;
}

async function hashDirectory(dir: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  const { readdir, stat: statFile } = await import("node:fs/promises");
  const hash = createHash("sha256");

  const walk = async (current: string): Promise<void> => {
    const items = await readdir(current, { withFileTypes: true });
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, item.name);
      if (item.isDirectory()) await walk(full);
      else {
        const s = await statFile(full);
        hash.update(`${full.slice(dir.length)}:${s.size}\n`);
      }
    }
  };

  await walk(dir);
  return hash.digest("hex").slice(0, 16);
}

export async function tempZipPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prepo-upload-"));
  return join(dir, "upload.zip");
}
