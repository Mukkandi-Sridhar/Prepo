import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Two kinds of fixture, and they are not interchangeable.
 *
 * `LocalFixture` lives inside this repo, needs no network, and costs no
 * tokens — `collect()` and `extractFacts()` (stages 02–03) can run against it
 * on every PR, in CI, with nothing configured. This is what `pnpm eval` runs
 * by default.
 *
 * `RemoteFixture` is a real public repository, used to stress the full
 * pipeline — chunking, embeddings, the dossier, question generation,
 * verification — against code this project didn't write. That costs real
 * tokens and needs a real API key, so it only runs under `pnpm eval:full`,
 * never by default and never in ordinary CI.
 *
 * Earlier versions of this file listed nine "golden repos" including two
 * (`prepo-demo/task-manager-crud`, `prepo-demo/legacy-php-monolith`) under a
 * GitHub org that does not exist, each pinned to a commit SHA that was never
 * a real hash — sequential hex, not output from git. Those two are now the
 * local fixtures below instead: same archetypes, actually real, checked into
 * this repo, no network dependency. The fabricated SHAs on the remaining
 * seven are gone too — a `RemoteFixture` resolves whatever HEAD is at run
 * time, which `runPipeline` records as the real commit it analysed.
 */

export interface LocalFixture {
  id: string;
  dir: string;
  archetype: string;
  description: string;
  /** What the smoke suite should find here — used to fail loudly, not silently pass. */
  expect: {
    minFiles: number;
    languages: string[];
    /** True if this fixture plants a fake-but-realistic secret to exercise stage 02. */
    expectRedaction: boolean;
  };
}

export const LOCAL_FIXTURES: LocalFixture[] = [
  {
    id: "bootcamp-crud",
    dir: join(here, "fixtures", "local", "bootcamp-crud"),
    archetype: "Bootcamp CRUD",
    description: "Small Express + Postgres task manager, the kind of first backend project most bootcamps produce.",
    expect: { minFiles: 4, languages: ["JavaScript"], expectRedaction: true },
  },
  {
    id: "messy-legacy",
    dir: join(here, "fixtures", "local", "messy-legacy"),
    archetype: "Messy legacy monolith",
    description: "PHP shop app with a Python script shelled out from it, string-concatenated SQL, and no separation of concerns.",
    expect: { minFiles: 3, languages: ["PHP", "Python"], expectRedaction: true },
  },
];

export interface RemoteFixture {
  id: string;
  name: string;
  url: string;
  stackType: string;
  description: string;
}

/**
 * Real repositories, used only by `pnpm eval:full`. No pinned commit SHA —
 * pinning to a value that isn't actually derived from git is worse than not
 * pinning at all, and the point of this suite is to run against whatever is
 * at HEAD right now.
 */
export const REMOTE_FIXTURES: RemoteFixture[] = [
  {
    id: "react-spa",
    name: "excalidraw/excalidraw",
    url: "https://github.com/excalidraw/excalidraw",
    stackType: "React SPA",
    description: "React SPA with canvas rendering and collaborative editing state",
  },
  {
    id: "go-microservice",
    name: "gin-gonic/gin",
    url: "https://github.com/gin-gonic/gin",
    stackType: "Go microservice",
    description: "High performance Go HTTP web framework",
  },
  {
    id: "rust-cli",
    name: "sharkdp/bat",
    url: "https://github.com/sharkdp/bat",
    stackType: "Rust CLI",
    description: "Rust CLI cat clone with syntax highlighting and git integration",
  },
  {
    id: "java-spring",
    name: "spring-projects/spring-petclinic",
    url: "https://github.com/spring-projects/spring-petclinic",
    stackType: "Java Spring",
    description: "Java Spring Boot sample CRUD application with JPA & REST APIs",
  },
];
