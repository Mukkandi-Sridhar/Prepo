const BY_EXTENSION: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  py: "Python", pyi: "Python",
  rb: "Ruby", go: "Go", rs: "Rust",
  java: "Java", kt: "Kotlin", kts: "Kotlin", scala: "Scala", groovy: "Groovy",
  cs: "C#", fs: "F#",
  php: "PHP", swift: "Swift", m: "Objective-C", mm: "Objective-C",
  c: "C", h: "C", cpp: "C++", cc: "C++", cxx: "C++", hpp: "C++", hh: "C++",
  dart: "Dart", ex: "Elixir", exs: "Elixir", erl: "Erlang", clj: "Clojure",
  hs: "Haskell", lua: "Lua", r: "R", jl: "Julia", zig: "Zig", nim: "Nim",
  sql: "SQL", sh: "Shell", bash: "Shell", zsh: "Shell", fish: "Shell", ps1: "PowerShell",
  html: "HTML", css: "CSS", scss: "SCSS", sass: "SCSS", less: "Less",
  vue: "Vue", svelte: "Svelte", astro: "Astro",
  json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML", xml: "XML",
  md: "Markdown", mdx: "Markdown", rst: "reStructuredText",
  tf: "Terraform", hcl: "HCL", proto: "Protobuf", graphql: "GraphQL", gql: "GraphQL",
  ipynb: "Jupyter", dockerfile: "Dockerfile", makefile: "Make", gradle: "Gradle",
};

const BY_FILENAME: Record<string, string> = {
  dockerfile: "Dockerfile",
  makefile: "Make",
  rakefile: "Ruby",
  gemfile: "Ruby",
  procfile: "Config",
  "cargo.toml": "TOML",
  "go.mod": "Go",
};

/** Languages we treat as prose or configuration rather than code for LOC stats. */
export const NON_CODE_LANGS = new Set([
  "JSON", "YAML", "TOML", "XML", "Markdown", "reStructuredText", "Config", "CSS", "SCSS", "Less", "HTML",
]);

export function detectLanguage(path: string): string {
  const base = path.split("/").pop()?.toLowerCase() ?? "";
  if (BY_FILENAME[base]) return BY_FILENAME[base]!;
  if (base.startsWith("dockerfile")) return "Dockerfile";

  const ext = base.includes(".") ? base.split(".").pop()! : "";
  return BY_EXTENSION[ext] ?? "Other";
}

/** Framework fingerprints: dependency name (or file marker) -> display name. */
const FRAMEWORK_BY_DEP: Record<string, string> = {
  next: "Next.js", react: "React", "react-dom": "React", vue: "Vue", nuxt: "Nuxt",
  svelte: "Svelte", "@sveltejs/kit": "SvelteKit", "@angular/core": "Angular", solid_js: "SolidJS",
  express: "Express", fastify: "Fastify", koa: "Koa", hono: "Hono", "@nestjs/core": "NestJS",
  "socket.io": "Socket.IO", graphql: "GraphQL", "apollo-server": "Apollo",
  prisma: "Prisma", "@prisma/client": "Prisma", "drizzle-orm": "Drizzle", typeorm: "TypeORM",
  sequelize: "Sequelize", mongoose: "Mongoose", knex: "Knex",
  django: "Django", flask: "Flask", fastapi: "FastAPI", starlette: "Starlette",
  sqlalchemy: "SQLAlchemy", celery: "Celery", pydantic: "Pydantic",
  pandas: "pandas", numpy: "NumPy", "scikit-learn": "scikit-learn", torch: "PyTorch",
  tensorflow: "TensorFlow", transformers: "Transformers", langchain: "LangChain",
  rails: "Rails", sinatra: "Sinatra",
  "spring-boot-starter": "Spring Boot", "spring-boot-starter-web": "Spring Boot",
  gin: "Gin", echo: "Echo", fiber: "Fiber", gorm: "GORM",
  actix_web: "Actix", axum: "Axum", tokio: "Tokio", rocket: "Rocket",
  laravel: "Laravel", symfony: "Symfony",
  redis: "Redis", ioredis: "Redis", bullmq: "BullMQ", "pg-boss": "pg-boss",
  kafkajs: "Kafka", amqplib: "RabbitMQ", "aws-sdk": "AWS SDK", "@aws-sdk/client-s3": "AWS S3",
  stripe: "Stripe", tailwindcss: "Tailwind CSS",
  jest: "Jest", vitest: "Vitest", mocha: "Mocha", pytest: "pytest",
  playwright: "Playwright", cypress: "Cypress", "@playwright/test": "Playwright",
};

const TEST_FRAMEWORKS = new Set([
  "Jest", "Vitest", "Mocha", "pytest", "Playwright", "Cypress",
]);

export function frameworksFromDependencies(names: string[]): string[] {
  const found = new Set<string>();
  for (const raw of names) {
    const key = raw.toLowerCase();
    if (FRAMEWORK_BY_DEP[key]) found.add(FRAMEWORK_BY_DEP[key]!);
  }
  return [...found].sort();
}

export function testFrameworksFrom(frameworks: string[]): string[] {
  return frameworks.filter((f) => TEST_FRAMEWORKS.has(f));
}

export function isTestPath(path: string): boolean {
  return /(^|\/)(tests?|__tests__|spec|e2e)\//i.test(path) || /\.(test|spec)\.[a-z]+$/i.test(path) || /(^|\/)test_[^/]+\.py$/i.test(path);
}
