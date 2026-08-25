import type { Dependency, GitStats, RepoFacts, RouteFact, TableFact } from "@prepo/shared";
import { frameworksFromDependencies, NON_CODE_LANGS, testFrameworksFrom } from "../langs.js";
import type { CollectedFile, CollectResult } from "./collect.js";

/**
 * Stage 03. Every value here was parsed out of the repository — not one field
 * was produced by a model.
 *
 * This is the cheapest stage and the most valuable one. It costs nothing, it
 * runs before any API key is needed (which is why the Repo Card works with no
 * key at all), and injecting it into every downstream prompt removes an entire
 * class of hallucination: the model is never asked what version of React the
 * project uses, it is told.
 */
export function extractFacts(input: {
  name: string;
  commitSha: string;
  defaultBranch: string | null;
  git: GitStats;
  collected: CollectResult;
  scopedModules?: string[];
}): RepoFacts {
  const { files } = input.collected;
  const byPath = new Map(files.map((f) => [f.path, f]));

  const dependencies = extractDependencies(files);
  const frameworks = frameworksFromDependencies(dependencies.map((d) => d.name));

  const languages = languageCensus(files);
  const totalLoc = files.reduce((sum, f) => sum + f.loc, 0);

  return {
    name: input.name,
    commitSha: input.commitSha,
    defaultBranch: input.defaultBranch,
    description: descriptionFrom(byPath),

    fileCount: input.collected.totalFilesSeen,
    analysedFileCount: files.length,
    totalLoc,
    sizeBytes: input.collected.sizeBytes,

    languages,
    frameworks,
    dependencies,

    entrypoints: findEntrypoints(files, byPath),
    routes: extractRoutes(files),
    tables: extractTables(files),
    envVars: extractEnvVars(files),

    hasDockerfile: files.some((f) => /(^|\/)Dockerfile/i.test(f.path)),
    hasCompose: files.some((f) => /(^|\/)docker-compose\.ya?ml$/i.test(f.path)),
    ciProviders: detectCi(files),
    iac: detectIac(files),
    testFrameworks: testFrameworksFrom(frameworks),
    testFileCount: files.filter((f) => f.isTest).length,

    readme: input.collected.readme,
    git: input.git,
    scopedModules: input.scopedModules ?? [],
  };
}

/* ── languages ──────────────────────────────────────────────── */

function languageCensus(files: CollectedFile[]): RepoFacts["languages"] {
  const counts = new Map<string, { files: number; loc: number }>();

  for (const file of files) {
    if (NON_CODE_LANGS.has(file.lang) || file.lang === "Other") continue;
    const current = counts.get(file.lang) ?? { files: 0, loc: 0 };
    current.files++;
    current.loc += file.loc;
    counts.set(file.lang, current);
  }

  const total = [...counts.values()].reduce((sum, c) => sum + c.loc, 0) || 1;
  return [...counts.entries()]
    .map(([lang, c]) => ({ lang, files: c.files, loc: c.loc, share: c.loc / total }))
    .sort((a, b) => b.loc - a.loc);
}

/* ── dependencies ───────────────────────────────────────────── */

function extractDependencies(files: CollectedFile[]): Dependency[] {
  const out: Dependency[] = [];
  const seen = new Set<string>();

  const push = (ecosystem: string, name: string, version: string, dev = false) => {
    const key = `${ecosystem}:${name}`;
    if (seen.has(key) || !name) return;
    seen.add(key);
    out.push({ ecosystem, name, version: version || "*", dev });
  };

  for (const file of files) {
    const base = file.path.split("/").pop() ?? "";

    if (base === "package.json") {
      try {
        const pkg = JSON.parse(file.content) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        for (const [name, version] of Object.entries(pkg.dependencies ?? {})) push("npm", name, version);
        for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) push("npm", name, version, true);
      } catch {
        // A malformed package.json is the project's problem, not ours.
      }
    }

    if (base === "requirements.txt" || /requirements.*\.txt$/.test(base)) {
      for (const line of file.content.split("\n")) {
        const m = /^\s*([A-Za-z0-9._-]+)\s*(?:[><=!~]+\s*([\w.*]+))?/.exec(line);
        if (m?.[1] && !line.trim().startsWith("#")) push("pypi", m[1], m[2] ?? "*");
      }
    }

    if (base === "pyproject.toml") {
      for (const m of file.content.matchAll(/^\s*([A-Za-z0-9._-]+)\s*=\s*["']([^"']+)["']/gm)) {
        push("pypi", m[1]!, m[2]!);
      }
      for (const m of file.content.matchAll(/["']([A-Za-z0-9._-]+)\s*(?:[><=~^]+\s*([\w.]+))?["']/g)) {
        if (m[2]) push("pypi", m[1]!, m[2]);
      }
    }

    if (base === "go.mod") {
      for (const m of file.content.matchAll(/^\s*([\w./-]+)\s+(v[\w.+-]+)/gm)) {
        push("go", m[1]!, m[2]!);
      }
    }

    if (base === "Cargo.toml") {
      for (const m of file.content.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/gm)) {
        push("cargo", m[1]!, m[2] ?? m[3] ?? "*");
      }
    }

    if (base === "pom.xml") {
      for (const m of file.content.matchAll(
        /<artifactId>([^<]+)<\/artifactId>\s*(?:<version>([^<]+)<\/version>)?/g,
      )) {
        push("maven", m[1]!, m[2] ?? "*");
      }
    }

    if (base.startsWith("build.gradle")) {
      for (const m of file.content.matchAll(/["']([\w.-]+):([\w.-]+):([\w.\-+]+)["']/g)) {
        push("maven", m[2]!, m[3]!);
      }
    }

    if (base === "Gemfile") {
      for (const m of file.content.matchAll(/^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/gm)) {
        push("gem", m[1]!, m[2] ?? "*");
      }
    }

    if (base === "composer.json") {
      try {
        const pkg = JSON.parse(file.content) as { require?: Record<string, string> };
        for (const [name, version] of Object.entries(pkg.require ?? {})) push("composer", name, version);
      } catch {
        /* ignore */
      }
    }
  }

  return out;
}

/* ── entrypoints ────────────────────────────────────────────── */

function findEntrypoints(files: CollectedFile[], byPath: Map<string, CollectedFile>): string[] {
  const found = new Set<string>();

  const pkg = byPath.get("package.json");
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg.content) as { main?: string; scripts?: Record<string, string> };
      if (parsed.main) found.add(parsed.main.replace(/^\.\//, ""));
      const start = parsed.scripts?.start ?? parsed.scripts?.dev;
      if (start) {
        const m = /([\w./-]+\.(?:ts|js|mjs|cjs))/.exec(start);
        if (m?.[1]) found.add(m[1]);
      }
    } catch {
      /* ignore */
    }
  }

  const patterns = [
    /^(src\/)?(main|index|app|server|cli)\.(ts|js|py|go|rs|rb|java|php)$/,
    /^cmd\/[^/]+\/main\.go$/,
    /^manage\.py$/,
    /^(src\/)?main\/java\/.*Application\.java$/,
    /^app\/(page|layout)\.(tsx|jsx)$/,
    /^wsgi\.py$|^asgi\.py$/,
  ];

  for (const file of files) {
    if (patterns.some((p) => p.test(file.path))) found.add(file.path);
  }
  return [...found].sort().slice(0, 12);
}

/* ── routes ─────────────────────────────────────────────────── */

const ROUTE_PATTERNS: Array<{ re: RegExp; method?: string }> = [
  // Express / Koa / Hono / Fastify: app.get("/users/:id", …)
  { re: /\b(?:app|router|api|server|r)\.(get|post|put|patch|delete|all|head|options)\s*\(\s*["'`]([^"'`]+)["'`]/gi },
  // FastAPI / Flask decorators: @app.get("/users")
  { re: /@(?:app|router|api|blueprint|bp)\.(get|post|put|patch|delete|route)\s*\(\s*["']([^"']+)["']/gi },
  // Django: path("users/<int:id>", …)
  { re: /\b(?:path|re_path|url)\s*\(\s*r?["']([^"']+)["']/g, method: "ANY" },
  // Spring: @GetMapping("/users")
  { re: /@(Get|Post|Put|Patch|Delete|Request)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g },
  // Go net/http and chi: mux.HandleFunc("/users", …)
  { re: /\.(?:HandleFunc|Handle|Get|Post|Put|Patch|Delete)\s*\(\s*["']([^"']+)["']/g, method: "ANY" },
  // Rails: get "users" => "users#index"
  { re: /^\s*(get|post|put|patch|delete)\s+["']([^"']+)["']/gim },
];

function extractRoutes(files: CollectedFile[]): RouteFact[] {
  const routes: RouteFact[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (file.isTest || NON_CODE_LANGS.has(file.lang)) continue;

    // Next.js and similar file-system routers encode the path in the path.
    const fsRoute = fileSystemRoute(file.path);
    if (fsRoute) {
      const key = `${fsRoute.method} ${fsRoute.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        routes.push({ ...fsRoute, file: file.path, line: 1 });
      }
      continue;
    }

    for (const { re, method: fixed } of ROUTE_PATTERNS) {
      for (const match of file.content.matchAll(new RegExp(re.source, re.flags))) {
        const groups = match.slice(1).filter((g): g is string => typeof g === "string");
        const path = groups[groups.length - 1]!;
        const method = (fixed ?? groups[0] ?? "ANY").toUpperCase();
        if (!path.startsWith("/") && !fixed) continue;

        const key = `${method} ${path}`;
        if (seen.has(key)) continue;
        seen.add(key);

        routes.push({
          method: method === "ROUTE" || method === "ALL" ? "ANY" : method,
          path,
          file: file.path,
          line: lineOf(file.content, match.index ?? 0),
        });
        if (routes.length >= 300) return routes;
      }
    }
  }
  return routes;
}

function fileSystemRoute(path: string): { method: string; path: string } | null {
  // app/api/users/[id]/route.ts  ->  /api/users/:id
  const next = /^(?:src\/)?app\/(.+)\/route\.(?:ts|js|tsx|jsx)$/.exec(path);
  if (next) {
    return { method: "ANY", path: `/${next[1]!.replace(/\[\.\.\.(\w+)\]/g, "*").replace(/\[(\w+)\]/g, ":$1").replace(/\(\w+\)\//g, "")}` };
  }
  const pages = /^(?:src\/)?pages\/api\/(.+)\.(?:ts|js)$/.exec(path);
  if (pages) {
    return { method: "ANY", path: `/api/${pages[1]!.replace(/\[(\w+)\]/g, ":$1").replace(/\/index$/, "")}` };
  }
  return null;
}

/* ── tables ─────────────────────────────────────────────────── */

function extractTables(files: CollectedFile[]): TableFact[] {
  const tables: TableFact[] = [];
  const seen = new Set<string>();

  const add = (name: string, columns: string[], source: string) => {
    const clean = name.replace(/["'`\[\]]/g, "");
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    tables.push({ name: clean, columns: columns.slice(0, 24), source });
  };

  for (const file of files) {
    // Raw SQL — migrations, schema dumps.
    for (const m of file.content.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([\w.]+)["'`]?\s*\(([\s\S]*?)\n\s*\)/gi,
    )) {
      const columns = (m[2] ?? "")
        .split("\n")
        .map((l) => /^\s*["'`]?(\w+)["'`]?\s+\w/.exec(l)?.[1])
        .filter((c): c is string => Boolean(c) && !/^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|CHECK|INDEX)$/i.test(c as string));
      add(m[1]!, columns, file.path);
    }

    // Prisma
    for (const m of file.content.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      const columns = [...(m[2] ?? "").matchAll(/^\s*(\w+)\s+\w/gm)].map((c) => c[1]!);
      add(m[1]!, columns, file.path);
    }

    // Drizzle
    for (const m of file.content.matchAll(/(\w+)\s*=\s*(?:pg|mysql|sqlite)Table\s*\(\s*["'`](\w+)["'`]\s*,\s*\{([\s\S]*?)\n\s*\}/g)) {
      const columns = [...(m[3] ?? "").matchAll(/^\s*(\w+)\s*:/gm)].map((c) => c[1]!);
      add(m[2]!, columns, file.path);
    }

    // SQLAlchemy
    for (const m of file.content.matchAll(/__tablename__\s*=\s*["'](\w+)["']/g)) {
      add(m[1]!, [], file.path);
    }

    // Django models
    for (const m of file.content.matchAll(/^class\s+(\w+)\s*\(\s*(?:models\.)?Model\s*\)\s*:([\s\S]*?)(?=^class|\Z)/gm)) {
      const columns = [...(m[2] ?? "").matchAll(/^\s{4}(\w+)\s*=\s*models\./gm)].map((c) => c[1]!);
      add(m[1]!.toLowerCase(), columns, file.path);
    }

    // Mongoose
    for (const m of file.content.matchAll(/new\s+(?:mongoose\.)?Schema\s*\(\s*\{([\s\S]*?)\n\s*\}/g)) {
      const columns = [...(m[1] ?? "").matchAll(/^\s*(\w+)\s*:/gm)].map((c) => c[1]!);
      const name = /(?:const|let|var)\s+(\w+)Schema/.exec(file.content)?.[1];
      if (name) add(name.toLowerCase(), columns, file.path);
    }

    if (tables.length >= 120) break;
  }

  return tables;
}

/* ── env vars ───────────────────────────────────────────────── */

const ENV_PATTERNS = [
  /process\.env(?:\.(\w+)|\[["'](\w+)["']\])/g,
  /os\.(?:environ(?:\.get)?\s*[[(]\s*["'](\w+)["']|getenv\s*\(\s*["'](\w+)["'])/g,
  /ENV\s*\[\s*["'](\w+)["']\s*\]/g,
  /System\.getenv\s*\(\s*["'](\w+)["']\s*\)/g,
  /std::env::var\s*\(\s*["'](\w+)["']\s*\)/g,
  /os\.Getenv\s*\(\s*["'](\w+)["']\s*\)/g,
  /@Value\s*\(\s*["']\$\{(\w+)/g,
];

function extractEnvVars(files: CollectedFile[]): string[] {
  const found = new Set<string>();

  for (const file of files) {
    for (const pattern of ENV_PATTERNS) {
      for (const m of file.content.matchAll(new RegExp(pattern.source, pattern.flags))) {
        const name = m.slice(1).find((g): g is string => typeof g === "string");
        // Filter out the noise from destructuring and single letters.
        if (name && name.length > 1 && /^[A-Z][A-Z0-9_]*$/.test(name)) found.add(name);
      }
    }
    // .env.example is a declaration of intent and usually the most complete list.
    if (/\.env\.(example|sample|template)$/.test(file.path)) {
      for (const m of file.content.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)) found.add(m[1]!);
    }
  }
  return [...found].sort();
}

/* ── infra ──────────────────────────────────────────────────── */

function detectCi(files: CollectedFile[]): string[] {
  const found = new Set<string>();
  for (const f of files) {
    if (f.path.startsWith(".github/workflows/")) found.add("GitHub Actions");
    if (f.path === ".gitlab-ci.yml") found.add("GitLab CI");
    if (f.path.startsWith(".circleci/")) found.add("CircleCI");
    if (/^Jenkinsfile/.test(f.path)) found.add("Jenkins");
    if (/^azure-pipelines\.ya?ml$/.test(f.path)) found.add("Azure Pipelines");
    if (/^\.travis\.ya?ml$/.test(f.path)) found.add("Travis CI");
    if (/^(bitbucket-pipelines|buildkite)\.ya?ml$/.test(f.path)) found.add("Buildkite");
  }
  return [...found].sort();
}

function detectIac(files: CollectedFile[]): string[] {
  const found = new Set<string>();
  for (const f of files) {
    if (f.path.endsWith(".tf") || f.path.endsWith(".tfvars")) found.add("Terraform");
    if (/(^|\/)Chart\.ya?ml$/.test(f.path)) found.add("Helm");
    if (/(^|\/)(k8s|kubernetes|manifests|deploy)\/.*\.ya?ml$/.test(f.path)) found.add("Kubernetes");
    if (/^serverless\.ya?ml$/.test(f.path)) found.add("Serverless Framework");
    if (/(^|\/)(template|cloudformation)\.ya?ml$/.test(f.path)) found.add("CloudFormation");
    if (/(^|\/)Pulumi\.ya?ml$/.test(f.path)) found.add("Pulumi");
    if (/^(fly\.toml|render\.ya?ml|vercel\.json|netlify\.toml|railway\.json)$/.test(f.path)) found.add("PaaS config");
    if (/(^|\/)ansible\//.test(f.path) || /^playbook\.ya?ml$/.test(f.path)) found.add("Ansible");
  }
  return [...found].sort();
}

function descriptionFrom(byPath: Map<string, CollectedFile>): string | null {
  const pkg = byPath.get("package.json");
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg.content) as { description?: string };
      if (parsed.description) return parsed.description;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}
