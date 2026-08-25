function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

function list(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  get appUrl() {
    return process.env.APP_URL ?? "http://localhost:3000";
  },
  get singleUserMode() {
    return bool("SINGLE_USER_MODE", true);
  },
  get authProviders() {
    return list("AUTH_PROVIDERS");
  },
  get allowedEmailDomains() {
    return list("ALLOWED_EMAIL_DOMAINS");
  },

  limits: {
    get maxRepoBytes() {
      return num("MAX_REPO_MB", 500) * 1024 * 1024;
    },
    get maxFiles() {
      return num("MAX_FILES", 25_000);
    },
    get maxFileBytes() {
      return num("MAX_FILE_KB", 400) * 1024;
    },
    get budgetCentsPerRun() {
      return num("BUDGET_CENTS_PER_RUN", 200);
    },
    get jobConcurrency() {
      return num("JOB_CONCURRENCY", 2);
    },
    /** Above this, offer module-scoped mode instead of silently truncating. */
    get moduleScopeThreshold() {
      return num("MODULE_SCOPE_THRESHOLD", 4_000);
    },
  },

  get workDir() {
    return process.env.WORK_DIR ?? "/tmp/prepo-work";
  },
  storage: {
    get driver() {
      return (process.env.STORAGE_DRIVER ?? "local") as "local" | "s3";
    },
    get path() {
      return process.env.STORAGE_PATH ?? "./storage";
    },
  },

  get telemetry() {
    return process.env.TELEMETRY === "on";
  },
  get logLevel() {
    return process.env.LOG_LEVEL ?? "info";
  },
} as const;

export const EMBEDDING_DIM = 1536;
