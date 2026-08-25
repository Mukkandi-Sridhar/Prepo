# Prepo Evaluation Suite Report

**Executed At**: 2026-08-25T17:09:29.656Z
**Fixtures Evaluated**: 9
**Overall Result**: PASSED ✅

## Quality Gate Summary

| Metric | Result | Threshold | Status | Details |
| :--- | :--- | :--- | :--- | :--- |
| **Citation Validity** | 1 % | 1 % | ✅ PASS | 22/22 citations resolved cleanly |
| **Groundedness Score** | 0.905  | 0.85  | ✅ PASS | Mean groundedness: 0.905 across 22 questions |
| **Category Coverage** | 11 categories | 10 categories | ✅ PASS | 11/13 unique question categories populated |
| **Duplicate Rate** | 0 % | 0.03 % | ✅ PASS | 0 near-duplicate pairs out of 231 candidate pairs |
| **Cost Regression** | 1.4 USD | 1.8 USD | ✅ PASS | Spent $1.40 vs baseline $1.50 (+-6.7%) |
| **p95 Time-to-First-Question** | 18.5 s | 45 s | ✅ PASS | p95 streaming latency: 18.5s |

## Golden Fixtures Included

| ID | Repository | Stack | Description |
| :--- | :--- | :--- | :--- |
| `react-spa` | [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | React SPA | React SPA with canvas rendering and collaborative editing state |
| `django-api` | [django/django](https://github.com/django/django) | Django API | Python ORM and Web framework API surface |
| `go-microservice` | [gin-gonic/gin](https://github.com/gin-gonic/gin) | Go microservice | High performance Go HTTP web framework |
| `rust-cli` | [sharkdp/bat](https://github.com/sharkdp/bat) | Rust CLI | Rust CLI cat clone with syntax highlighting and git integration |
| `java-spring` | [spring-projects/spring-petclinic](https://github.com/spring-projects/spring-petclinic) | Java Spring | Java Spring Boot sample CRUD application with JPA & REST APIs |
| `ml-notebook` | [huggingface/transformers](https://github.com/huggingface/transformers) | ML Notebook Repo | Machine Learning models and PyTorch/TensorFlow pipelines |
| `typescript-monorepo` | [vercel/turbo](https://github.com/vercel/turbo) | Monorepo | High-performance build system monorepo (Rust core + Node bindings) |
| `bootcamp-crud` | [prepo-demo/task-manager-crud](https://github.com/prepo-demo/task-manager-crud) | Bootcamp CRUD | Bootcamp-style Node Express + Postgres task manager CRUD API |
| `messy-legacy` | [prepo-demo/legacy-php-monolith](https://github.com/prepo-demo/legacy-php-monolith) | Messy Monolith | Legacy unstructured codebase with mixed concerns and minimal docs |
