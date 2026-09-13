import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type {
  ClaimCheck,
  Evaluation,
  InterviewPlan,
  ProjectDossier,
  RedactionReport,
  RepoFacts,
  ResumeClaim,
  StarFrame,
} from "@prepo/shared";
import { EMBEDDING_DIM } from "@prepo/shared";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* ── identity ───────────────────────────────────────────────── */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    /** Sealed with the same AES-GCM vault as provider keys. */
    accessToken: jsonb("access_token").$type<{ ciphertext: string; iv: string; authTag: string } | null>(),
    scope: text("scope"),
    createdAt: createdAt(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
    byUser: index("accounts_user_idx").on(t.userId),
  }),
);

/** Single-use magic-link and OAuth state tokens. */
export const verificationTokens = pgTable("verification_tokens", {
  token: text("token").primaryKey(),
  identifier: text("identifier").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const orgs = pgTable("orgs", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"owner" | "admin" | "member">().notNull().default("member"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.orgId, t.userId] }) }),
);

/* ── credentials ────────────────────────────────────────────── */

export const providerKeys = pgTable(
  "provider_keys",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    /** null when mode = 'ephemeral' — the key never touches disk. */
    ciphertext: text("ciphertext"),
    iv: text("iv"),
    authTag: text("auth_tag"),
    last4: text("last4").notNull(),
    mode: text("mode").$type<"stored" | "ephemeral">().notNull().default("stored"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({ uniq: uniqueIndex("provider_keys_user_provider_idx").on(t.userId, t.provider) }),
);

/* ── source ─────────────────────────────────────────────────── */

export const projects = pgTable(
  "projects",
  {
    id: id(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sourceType: text("source_type").$type<"git" | "zip">().notNull(),
    sourceUrl: text("source_url"),
    visibility: text("visibility").$type<"public" | "private">().notNull().default("public"),
    currentSnapshotId: uuid("current_snapshot_id"),
    createdAt: createdAt(),
  },
  (t) => ({ byOwner: index("projects_owner_idx").on(t.ownerId) }),
);

export const repoSnapshots = pgTable(
  "repo_snapshots",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    commitSha: text("commit_sha").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    fileCount: integer("file_count").notNull().default(0),
    repoFacts: jsonb("repo_facts").$type<RepoFacts>(),
    redactionReport: jsonb("redaction_report").$type<RedactionReport>(),
    createdAt: createdAt(),
  },
  (t) => ({
    // The cache root: one snapshot per project per commit. Re-running an
    // unchanged repo costs nothing.
    uniq: uniqueIndex("repo_snapshots_project_sha_idx").on(t.projectId, t.commitSha),
  }),
);

export const sourceFiles = pgTable(
  "source_files",
  {
    id: id(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => repoSnapshots.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    lang: text("lang").notNull(),
    loc: integer("loc").notNull().default(0),
    contentSha256: text("content_sha256").notNull(),
  },
  (t) => ({
    bySnapshot: index("source_files_snapshot_idx").on(t.snapshotId),
    byHash: index("source_files_hash_idx").on(t.contentSha256),
  }),
);

/**
 * Keyed on content hash *globally*, not per user. Two people analysing forks
 * of the same repo share one cached summary — which is where most of the
 * cost saving in the whole system comes from.
 */
export const fileSummaries = pgTable("file_summaries", {
  contentSha256: text("content_sha256").primaryKey(),
  summary: text("summary").notNull(),
  model: text("model").notNull(),
  tokens: integer("tokens").notNull().default(0),
  createdAt: createdAt(),
});

export const chunks = pgTable(
  "chunks",
  {
    id: id(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => repoSnapshots.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    symbol: text("symbol"),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
  },
  (t) => ({
    bySnapshot: index("chunks_snapshot_idx").on(t.snapshotId),
  }),
);

/* ── derived ────────────────────────────────────────────────── */

export const dossiers = pgTable("dossiers", {
  id: id(),
  snapshotId: uuid("snapshot_id")
    .notNull()
    .unique()
    .references(() => repoSnapshots.id, { onDelete: "cascade" }),
  content: jsonb("content").$type<ProjectDossier>().notNull(),
  model: text("model").notNull(),
  costCents: real("cost_cents").notNull().default(0),
  createdAt: createdAt(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id").references(() => repoSnapshots.id, { onDelete: "set null" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"analyze" | "regenerate">().notNull().default("analyze"),
    state: text("state")
      .$type<"queued" | "running" | "done" | "failed" | "cancelled">()
      .notNull()
      .default("queued"),
    stage: text("stage"),
    progress: real("progress").notNull().default(0),
    error: text("error"),
    budgetCents: integer("budget_cents").notNull().default(200),
    spentCents: real("spent_cents").notNull().default(0),
    options: jsonb("options").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({ byProject: index("jobs_project_idx").on(t.projectId) }),
);

/**
 * One row per pipeline stage. input_hash is what makes crash-resume free:
 * on restart the worker skips any step whose input hash already succeeded.
 */
export const jobSteps = pgTable(
  "job_steps",
  {
    id: id(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    state: text("state").$type<"pending" | "running" | "done" | "failed">().notNull().default("pending"),
    inputHash: text("input_hash"),
    outputRef: text("output_ref"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({ uniq: uniqueIndex("job_steps_job_stage_idx").on(t.jobId, t.stage) }),
);

/* ── product ────────────────────────────────────────────────── */

export const questionSets = pgTable("question_sets", {
  id: id(),
  snapshotId: uuid("snapshot_id")
    .notNull()
    .references(() => repoSnapshots.id, { onDelete: "cascade" }),
  resumeId: uuid("resume_id"),
  roleId: uuid("role_id"),
  questionCount: integer("question_count").notNull().default(0),
  droppedCount: integer("dropped_count").notNull().default(0),
  costCents: real("cost_cents").notNull().default(0),
  createdAt: createdAt(),
});

export const questions = pgTable(
  "questions",
  {
    id: id(),
    setId: uuid("set_id")
      .notNull()
      .references(() => questionSets.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    difficulty: text("difficulty").notNull(),
    persona: text("persona").notNull(),
    stem: text("stem").notNull(),
    modelAnswer: text("model_answer").notNull(),
    probes: jsonb("probes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    testingFor: text("testing_for").notNull(),
    redFlags: jsonb("red_flags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    starFrame: jsonb("star_frame").$type<StarFrame | null>(),
    groundedness: numeric("groundedness", { precision: 3, scale: 2 }).notNull().default("0"),
    rank: real("rank").notNull().default(0),
  },
  (t) => ({ bySet: index("questions_set_idx").on(t.setId) }),
);

export const citations = pgTable(
  "citations",
  {
    id: id(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    symbol: text("symbol"),
    commitSha: text("commit_sha").notNull(),
  },
  (t) => ({ byQuestion: index("citations_question_idx").on(t.questionId) }),
);

export const resumes = pgTable("resumes", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  filename: text("filename"),
  text: text("text").notNull(),
  claims: jsonb("claims").$type<ResumeClaim[]>(),
  claimChecks: jsonb("claim_checks").$type<ClaimCheck[]>(),
  createdAt: createdAt(),
});

export const targetRoles = pgTable("target_roles", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  company: text("company"),
  jdText: text("jd_text"),
  stackWeights: jsonb("stack_weights").$type<Record<string, number>>(),
  createdAt: createdAt(),
});

/* ── practice ───────────────────────────────────────────────── */

export const practiceSessions = pgTable(
  "practice_sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    setId: uuid("set_id")
      .notNull()
      .references(() => questionSets.id, { onDelete: "cascade" }),
    mode: text("mode").$type<"quick" | "standard" | "deep">().notNull().default("standard"),
    plan: jsonb("plan").$type<InterviewPlan>(),
    state: text("state").$type<"active" | "finished" | "abandoned">().notNull().default("active"),
    startedAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({ byUser: index("practice_sessions_user_idx").on(t.userId) }),
);

export const turns = pgTable(
  "turns",
  {
    id: id(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => practiceSessions.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    role: text("role").$type<"interviewer" | "candidate">().notNull(),
    content: text("content").notNull(),
    move: text("move"),
    beatIndex: integer("beat_index"),
    createdAt: createdAt(),
  },
  (t) => ({ uniq: uniqueIndex("turns_session_idx_idx").on(t.sessionId, t.idx) }),
);

export const evaluations = pgTable("evaluations", {
  id: id(),
  sessionId: uuid("session_id")
    .notNull()
    .unique()
    .references(() => practiceSessions.id, { onDelete: "cascade" }),
  result: jsonb("result").$type<Evaluation>().notNull(),
  createdAt: createdAt(),
});

/** FSRS-style scheduling state. One card per question per user. */
export const srsCards = pgTable(
  "srs_cards",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
    stability: real("stability").notNull().default(1),
    difficulty: real("difficulty").notNull().default(5),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
  },
  (t) => ({
    uniq: uniqueIndex("srs_cards_user_question_idx").on(t.userId, t.questionId),
    byDue: index("srs_cards_due_idx").on(t.userId, t.dueAt),
  }),
);

export const reviews = pgTable("reviews", {
  id: id(),
  cardId: uuid("card_id")
    .notNull()
    .references(() => srsCards.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(), // 1 again · 2 hard · 3 good · 4 easy
  reviewedAt: createdAt(),
});

/* ── ops ────────────────────────────────────────────────────── */

export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    stage: text("stage"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    costCents: real("cost_cents").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => ({ byJob: index("usage_events_job_idx").on(t.jobId) }),
);

export const auditLog = pgTable("audit_log", {
  id: id(),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  target: text("target"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  ip: text("ip"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── relations ──────────────────────────────────────────────── */

export const projectRelations = relations(projects, ({ many, one }) => ({
  snapshots: many(repoSnapshots),
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
}));

export const snapshotRelations = relations(repoSnapshots, ({ many, one }) => ({
  project: one(projects, { fields: [repoSnapshots.projectId], references: [projects.id] }),
  files: many(sourceFiles),
  chunks: many(chunks),
  questionSets: many(questionSets),
}));

export const questionRelations = relations(questions, ({ many, one }) => ({
  set: one(questionSets, { fields: [questions.setId], references: [questionSets.id] }),
  citations: many(citations),
}));

export const setRelations = relations(questionSets, ({ many, one }) => ({
  snapshot: one(repoSnapshots, { fields: [questionSets.snapshotId], references: [repoSnapshots.id] }),
  questions: many(questions),
}));
