export interface GoldenRepoFixture {
  id: string;
  name: string;
  url: string;
  commitSha: string;
  description: string;
  stackType: string;
}

export const GOLDEN_REPOS: GoldenRepoFixture[] = [
  {
    id: "react-spa",
    name: "excalidraw/excalidraw",
    url: "https://github.com/excalidraw/excalidraw",
    commitSha: "8a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b",
    description: "React SPA with canvas rendering and collaborative editing state",
    stackType: "React SPA",
  },
  {
    id: "django-api",
    name: "django/django",
    url: "https://github.com/django/django",
    commitSha: "9b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c",
    description: "Python ORM and Web framework API surface",
    stackType: "Django API",
  },
  {
    id: "go-microservice",
    name: "gin-gonic/gin",
    url: "https://github.com/gin-gonic/gin",
    commitSha: "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d",
    description: "High performance Go HTTP web framework",
    stackType: "Go microservice",
  },
  {
    id: "rust-cli",
    name: "sharkdp/bat",
    url: "https://github.com/sharkdp/bat",
    commitSha: "2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e",
    description: "Rust CLI cat clone with syntax highlighting and git integration",
    stackType: "Rust CLI",
  },
  {
    id: "java-spring",
    name: "spring-projects/spring-petclinic",
    url: "https://github.com/spring-projects/spring-petclinic",
    commitSha: "3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f",
    description: "Java Spring Boot sample CRUD application with JPA & REST APIs",
    stackType: "Java Spring",
  },
  {
    id: "ml-notebook",
    name: "huggingface/transformers",
    url: "https://github.com/huggingface/transformers",
    commitSha: "4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a",
    description: "Machine Learning models and PyTorch/TensorFlow pipelines",
    stackType: "ML Notebook Repo",
  },
  {
    id: "typescript-monorepo",
    name: "vercel/turbo",
    url: "https://github.com/vercel/turbo",
    commitSha: "5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b",
    description: "High-performance build system monorepo (Rust core + Node bindings)",
    stackType: "Monorepo",
  },
  {
    id: "bootcamp-crud",
    name: "prepo-demo/task-manager-crud",
    url: "https://github.com/prepo-demo/task-manager-crud",
    commitSha: "6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c",
    description: "Bootcamp-style Node Express + Postgres task manager CRUD API",
    stackType: "Bootcamp CRUD",
  },
  {
    id: "messy-legacy",
    name: "prepo-demo/legacy-php-monolith",
    url: "https://github.com/prepo-demo/legacy-php-monolith",
    commitSha: "7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
    description: "Legacy unstructured codebase with mixed concerns and minimal docs",
    stackType: "Messy Monolith",
  },
];
