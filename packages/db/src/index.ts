import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export { sql, eq, and, or, desc, asc, inArray, isNull, count, gte, lte, lt } from "drizzle-orm";

let client: postgres.Sql | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

function connectionString(): string {
  return process.env.DATABASE_URL || "postgres://postgres:prepo@localhost:5432/prepo";
}

/**
 * A single pooled client per process. Next.js dev reloads modules constantly,
 * so it is cached on globalThis to avoid leaking connections on every edit.
 */
export function getDb() {
  if (database) return database;

  const g = globalThis as unknown as { __prepoSql?: postgres.Sql };
  client = g.__prepoSql ?? postgres(connectionString(), { max: 10, prepare: false });
  if (process.env.NODE_ENV !== "production") g.__prepoSql = client;

  database = drizzle(client, { schema });
  return database;
}

export function getSql(): postgres.Sql {
  getDb();
  return client!;
}

export async function closeDb(): Promise<void> {
  await client?.end({ timeout: 5 });
  client = undefined;
  database = undefined;
}

export type Db = ReturnType<typeof getDb>;
export { schema };
export * from "./notify.js";
