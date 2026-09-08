# Graph Report - code-review-agent  (2026-09-09)

## Corpus Check
- 515 files · ~311,768 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4173 nodes · 5822 edges · 365 communities (272 shown, 93 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 39 edges (avg confidence: 0.68)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `65440943`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- discover-candidate-prs.ts
- a2a/index.ts
- reviewer-runtime.ts
- models/index.ts
- routeTree.gen.ts
- dependencies
- Next.js Reviewer Skill
- select-stack-targets.ts
- 2. 要検討事項（比較表 + 採用/却下理由）
- generate-evaluation-report.ts
- base-reviewer.ts
- orchestrator.service.ts
- pr-info.service.ts
- Signal Forms
- lead-engineer.service.ts
- 位置情報欠落によるfinding/decisionのサイレントドロップ: 可視化と緩和 設計ドキュメント
- review.ts
- score-evaluation.ts
- reviews.mock-seed.ts
- build-gold-set.ts
- run-agent-evaluation.ts
- reviews.store.ts
- devDependencies
- build-seeded-set.ts
- properties
- lead-engineer.route.ts
- reviews/reviews.schema.ts
- a2a/request.model.ts
- A2ATask
- compilerOptions
- compilerOptions
- docs/mcp-connection-stabilization-spec.md
- 4. MCPクライアントのセッション共有設計 (ADR-0004の運用化)
- 評価パイプライン: 構造化ロギングへの移行 設計ドキュメント
- properties
- Code Review Agent
- AGENTS.md
- ADR-0010: LocalLLM流量制御 — システム全体同時実行上限の実現機構とtimeout/cancellation/straggler処理
- Review-Agent ワークフロー仕様
- Code Review Agent Evaluation Plan
- registry.ts
- reviews.route.ts
- A2A API 設計ドキュメント
- Seeded set生成: 専用Seedリポジトリ方式 設計ドキュメント
- pr-info-collector.ts
- review-list/reviews.schema.ts
- compilerOptions
- 指摘単位3軸評価仕様 (Issue #168)
- PR Info Collector ツール呼び出し修正 設計ドキュメント
- 3. 比較対象アプローチ
- JavaScript checks
- merge-predictions.ts
- health/index.ts
- pr-info-collector.test.ts
- github-rest.ts
- reviewStatus.ts
- EVALUATION_PLAN.md
- 検討事項
- 検討事項
- Lead Engineer Agent 設計
- 3. Target Behavior
- TypeScript開発環境・ツールチェーン整備 設計ドキュメント (Issue #250)
- Angular Aria
- angular-developer/SKILL.md
- web-api/src/index.ts
- ADR-0005: スタック別 Gold-set ターゲット選定の正規経路化
- 3. 採用する設計: `AfterToolCallEvent`で`event.result`を書き換える
- required
- enum
- enum
- React Composition Patterns
- agent-skills-factory.ts
- SCR-01 コードレビュー一覧画面 実装スペック
- `evaluation/` TypeScript移行 設計ドキュメント (Issue #254)
- required
- 5. Re-render Optimization
- build-seeded-set.test.ts
- scripts
- compilerOptions
- required
- 2. 要検討事項（比較表 + 採用/却下理由）
- properties
- a2a-server/package.json
- required
- 7. JavaScript Performance
- Quick Reference
- logging.ts
- openapi-contract.test.ts
- ReviewListPage.tsx
- 開発環境の初期セットアップ
- 0011. LocalLLM配信契約: Worker障害後の再配信・再起動回復・状態分離
- 2. 修正方針
- 並列レビュー段 拡張アーキテクチャ設計
- 評価パイプライン Agent実行(A2A送信/ポーリング)のTypeScript移植 設計ドキュメント (Issue #306)
- typescript
- properties
- Svelte Review Guidelines
- ReviewAgent
- Coding Agent Guide
- 2. 設計方針
- app.js
- 実装フロー（プロジェクト標準 TDD フロー準拠）
- PR Info Collector 正確性検証レポート（20回統計分析）
- required
- 2. Advanced CSS Animations
- Frontend PR Review Agent — System Prompt
- 01 Injection (Confusing Data with Instructions)
- svelte-core-bestpractices/SKILL.md
- reviews.enums.ts
- 0009. LocalLLM流量制御: Queue実装方式・システム全体同時実行上限・障害時配信契約
- 2. 設計方針
- Evaluation Toolkit
- Evaluation Runbook
- scripts
- 02 Authentication & Authorization (Confusing Identity with Permission)
- 04 Software Supply Chain (The Chain of Trust and Its Blind Spots)
- 09 Insecure Design (When Correct Code Implements a Flawed Design)
- 11 SSRF & Security Logging (Invisible Requests and Invisible Attacks)
- 12 Exception Handling Failures (When Error Paths Are Not Designed)
- 6. Rendering Performance
- エージェント開発ガイド — web-api パッケージ
- compilerOptions
- useReviewListState.ts
- package.json
- Contributing Guide
- ADR-0004: MCPクライアントのセッション共有(レビュアー間)
- 評価パイプライン設計: データ生成から実行まで
- Seeded評価を`/orchestrator`単一呼び出しへ統合する 設計ドキュメント
- Component Styling
- Angular Review Guidelines
- Svelte checks
- 03 CSRF / CORS (Request Origin and Intent Verification)
- 05 Secrets Exposure (Underestimating Where Data Can Reach)
- 08 Configuration & Environment (The Gap Between "Works" and "Works Safely")
- 10 Software Integrity Failures (Trusting Without Verifying)
- reviewing-web-security/SKILL.md
- React Composition Patterns
- 3. Server-Side Performance
- evaluation/package.json
- ReviewListPage.test.tsx
- ADR-0001: 大規模PRのレビュー除外方針
- ADR-0003: MCP起動リトライ戦略
- A2A API 実装計画・Python版設計の全文・検証手順
- 9. fallback率30%未満の目標に対する構造的対応 (プロンプトのみでは不足)
- GitHub MCP `streamable_http_client` 移行 設計ドキュメント
- React/Angular Agent Skills Review Accuracy Spec
- PR Info Collector 正確性検証レポート（20回統計分析）
- enum
- Components
- Angular CLI MCP Server
- Template-Driven Forms
- Angular checks
- React checks
- Vue.js checks
- 06 Security Headers & CSP (The Precision of Browser Instructions)
- 07 File Upload & Path Traversal (The Dual Nature of Files)
- React Composition Patterns
- React Best Practices
- Sections
- base-reviewer.review.test.ts
- ReviewsStore
- web/biome.json
- 0007-Multi-Container-Architecture-for-Scalability
- スタック別 Gold-set ターゲット選定仕様
- mock-data.js
- Model Provider Factory と生成パラメータの安全弁 設計ドキュメント
- docstring lint方針 設計ドキュメント
- 評価レポートへの個別PR詳細（Human Review vs Agent指摘）追加 設計ドキュメント
- 7. Phase 2運用後に判明した問題 (Issue #131)
- Seeded set生成: (ファイル, ルール)組み合わせ重複 修正 設計ドキュメント
- Red Hat Hardened Image への base image 変更 spec
- must_find
- Review Matching Rubric
- agent-core/tsconfig.json
- agent-core/package.json
- evaluation/tsconfig.json
- Angular CLI Guide for Agents
- Creating and Using Services
- Data Resolvers
- Define Routes
- Inputs
- Reactive Forms
- Manual Setup (Tailwind v4)
- reviewing-frameworks/SKILL.md
- reviewing-universal/SKILL.md
- Accessibility checks
- Security checks
- await-expressions.md
- エージェント開発ガイド — web パッケージ
- jsonl.ts
- web-api/biome.json
- biome.json
- enum
- enum
- 12. セキュリティ設計
- 13. TypeScript/Zod モデル移行仕様
- 6. 環境変数リファレンス
- 3.2 Phase 2: LLM推論 + 決定論的事後検証
- LLM生成パラメータの安全弁(max_tokens / frequency_penalty) 実装記録 (Issue #208)
- pull_request_template.md
- Dependency Injection (DI) Fundamentals
- Route Loading Strategies
- Outputs (Custom Events)
- Pipes
- Async Reactivity with `resource`
- Setting Up for Router Testing
- Angular Signals Overview
- Correctness checks
- Dependency audit checks
- Test quality checks
- @attach.md
- snippet.md
- ReviewerConfig
- tool-result-sanitizer.ts
- web/package.json
- Review
- renovate.json
- Suggested Commands
- react-i18next
- ADR-0002: ワークフロー外部化(LangFlow/Dify)の検討
- PR Review Agent — 画面モックアップ (Issue #243)
- A2A API 実装プラン
- @rolldown/plugin-babel
- @tanstack/router-plugin
- a2a-server/src/config.ts
- Defining Dependency Providers
- Environment configuration
- Navigate to Routes
- Route Transition Animations
- Route Guards
- Show Routes with Outlets
- Performance checks
- 1. Eliminating Waterfalls
- 2. Bundle Size Optimization
- 10. 検証手順
- 4. 各エージェントの AgentCard 定義
- 8. Phase 2生成プロンプトの改善
- Worktree Plugin Progress Notification Specification
- @testing-library/jest-dom
- Side Effects with `effect` and `afterRenderEffect`
- Hierarchical Injectors
- Component Host Elements
- Router Lifecycle and Events
- Sections
- React Best Practices
- lead-engineer.evaluate.test.ts
- verify-coderabbit-filters.mjs
- Memory Maintenance
- vite
- 1. 背景と問題
- Seeded set生成: mutation注入ロジック 要件と設計ドキュメント
- 3.1 Phase 1: 決定論的改善 (即座に着手可能) — 実装済み (Issue #111)
- ModelProviderFactory によるOllamaネイティブ対応 実装計画 (Issue #214)
- Injection Context
- Dependent State with `linkedSignal`
- Automatic Migrations & Code Modernization
- Testing Fundamentals
- Passing snippets to components
- 8. Advanced Patterns
- Review Persistence API (OpenAPI)
- 5. FastAPI アプリケーション構成
- 7.4 対応方針
- serena
- async-cheap-condition-before-await.md
- Prefer Statically Analyzable Paths
- server-hoist-static-io.md
- model-provider-spike.ts
- Agent Architecture
- 2. A2A プロトコル実装仕様
- run_evaluation_pipeline.sh
- web/tsconfig.json
- remove-worktree.sh
- Code Review Agent — Core Map
- tsconfig.json
- architecture-avoid-boolean-props.md
- architecture-compound-components.md
- patterns-children-over-render-props.md
- patterns-explicit-variants.md
- react19-no-forwardref.md
- state-context-interface.md
- state-decouple-implementation.md
- state-lift-state.md
- vercel-composition-patterns/rules/_template.md
- advanced-effect-event-deps.md
- advanced-event-handler-refs.md
- advanced-init-once.md
- advanced-use-latest.md
- async-api-routes.md
- async-dependencies.md
- async-parallel.md
- async-suspense-boundaries.md
- bundle-barrel-imports.md
- bundle-conditional.md
- bundle-defer-third-party.md
- bundle-dynamic-imports.md
- bundle-preload.md
- client-event-listeners.md
- client-localstorage-schema.md
- client-passive-event-listeners.md
- client-swr-dedup.md
- js-batch-dom-css.md
- js-cache-function-results.md
- js-cache-property-access.md
- js-cache-storage.md
- js-combine-iterations.md
- js-early-exit.md
- js-flatmap-filter.md
- js-hoist-regexp.md
- js-index-maps.md
- js-length-check-first.md
- js-min-max-loop.md
- js-request-idle-callback.md
- js-set-map-lookups.md
- js-tosorted-immutable.md
- rendering-activity.md
- rendering-animate-svg-wrapper.md
- rendering-conditional-render.md
- rendering-content-visibility.md
- rendering-hoist-jsx.md
- rendering-hydration-no-flicker.md
- rendering-hydration-suppress-warning.md
- rendering-resource-hints.md
- rendering-script-defer-async.md
- rendering-svg-precision.md
- rendering-usetransition-loading.md
- rerender-defer-reads.md
- rerender-dependencies.md
- rerender-derived-state.md
- rerender-derived-state-no-effect.md
- rerender-functional-setstate.md
- rerender-lazy-state-init.md
- rerender-memo.md
- rerender-memo-with-default-value.md
- rerender-move-effect-to-event.md
- rerender-no-inline-components.md
- rerender-simple-expression-in-memo.md
- rerender-split-combined-hooks.md
- rerender-transitions.md
- rerender-use-deferred-value.md
- rerender-use-ref-transient-values.md
- server-after-nonblocking.md
- server-auth-actions.md
- server-cache-lru.md
- server-dedup-props.md
- server-parallel-fetching.md
- server-parallel-nested-fetching.md
- server-serialization.md
- vercel-react-best-practices/rules/_template.md
- github-mcp.test.ts
- setup-worktree.sh
- conventions.md
- task_completion.md
- tech_stack.md

## God Nodes (most connected - your core abstractions)
1. `A2ATask` - 26 edges
2. `ProjectType` - 26 edges
3. `ReviewPerspective` - 24 edges
4. `createReviewerService()` - 23 edges
5. `LLMReviewAgent` - 19 edges
6. `compilerOptions` - 19 edges
7. `createOrchestratorService()` - 18 edges
8. `createLeadEngineerService()` - 17 edges
9. `PRInfoCollector` - 17 edges
10. `ReviewContext` - 17 edges

## Surprising Connections (you probably didn't know these)
- `ScoreEvaluationOptions` --references--> `ProviderType`  [EXTRACTED]
  packages/evaluation/src/score-evaluation.ts → packages/agent-core/src/agents/model-provider-factory.ts
- `DetectionRule` --references--> `ProjectType`  [EXTRACTED]
  packages/agent-core/src/agents/registry.ts → packages/agent-core/src/models/review.ts
- `main()` --indirect_call--> `candidate()`  [INFERRED]
  packages/evaluation/src/discover-candidate-prs.ts → packages/evaluation/src/discover-candidate-prs.test.ts
- `ReviewListPage()` --indirect_call--> `fetchReviews()`  [INFERRED]
  packages/web/src/features/review-list/ReviewListPage.tsx → packages/web/src/features/review-list/reviewsApi.ts
- `callMiddleware()` --calls--> `createGithubAuthMiddleware()`  [EXTRACTED]
  packages/a2a-server/src/modules/a2a/auth.middleware.test.ts → packages/a2a-server/src/modules/a2a/auth.middleware.ts

## Import Cycles
- None detected.

## Communities (365 total, 93 thin omitted)

### Community 0 - "discover-candidate-prs.ts"
Cohesion: 0.07
Nodes (51): asNumber(), asObject(), asObjectArray(), asString(), buildTarget(), CliOptions, collectReviewTexts(), createCli() (+43 more)

### Community 1 - "a2a/index.ts"
Cohesion: 0.13
Nodes (30): A2AMessageSchema, A2ASendTaskResponseSchema, A2ATaskSchema, A2ATaskStatus, AgentCapability, AgentCapabilitySchema, AgentCardHttpResponse, AgentCardHttpResponseSchema (+22 more)

### Community 2 - "reviewer-runtime.ts"
Cohesion: 0.09
Nodes (38): createAngularReviewerRoute(), AngularReviewerServiceOptions, createAngularReviewerService(), createReactReviewerRoute(), createReactReviewerService(), ReactReviewerServiceOptions, ReviewerSkillInputSchema, A2AReviewerSettings (+30 more)

### Community 3 - "models/index.ts"
Cohesion: 0.15
Nodes (30): buildPromptAndIndex(), IndexEntry, LeadEngineerAgent, resolveDecisions(), createModelProvider(), acceptedDecisions(), byVerdict(), DecisionVerdict (+22 more)

### Community 4 - "routeTree.gen.ts"
Cohesion: 0.06
Nodes (32): queryClient, Register, rootElement, router, @tanstack/react-router, indexSearchSchema, Route, Route (+24 more)

### Community 5 - "dependencies"
Cohesion: 0.07
Nodes (27): @carbon/react, i18next, i18next-resources-to-backend, dependencies, @carbon/react, i18next, i18next-resources-to-backend, react (+19 more)

### Community 6 - "Next.js Reviewer Skill"
Cohesion: 0.05
Nodes (39): Cache / revalidation intent, Contents, Context7 trigger examples, Data fetching location, Environment variables, Issue format, Middleware matcher, next/image dimensions (+31 more)

### Community 7 - "select-stack-targets.ts"
Cohesion: 0.09
Nodes (33): allocateQuota(), checkCoverageThresholds(), compareRankDescending(), dedupeRows(), DOMAIN_MIN_RATIOS, ExecutionTarget, filterRows(), IMPACTS (+25 more)

### Community 8 - "2. 要検討事項（比較表 + 採用/却下理由）"
Cohesion: 0.05
Nodes (39): 0. スライス分割方針, 1. 決定済み事項（本Issue着手前に確定していたもの）, 2.1 共有GitHub MCPクライアントの参照カウント管理, 2.2 GitHub MCPクライアントの接続ライフサイクルの所有権, 2.3 GitHub MCP接続のretry実装, 2.4 `OllamaUnsupportedContentSanitizer`のフック登録方式, 2.5 GitHub MCPクライアントのtransport構築方法, 2.6 `skills/`ディレクトリの配置 (+31 more)

### Community 9 - "generate-evaluation-report.ts"
Cohesion: 0.10
Nodes (32): send_discord_notification(), buildReport(), defaultGetCommitHash(), errorMessage(), EvaluationScores, execFileAsync, findingRow(), formatExecutedAt() (+24 more)

### Community 10 - "base-reviewer.ts"
Cohesion: 0.19
Nodes (21): annotatePatch(), buildPrompt(), composeSystemPrompt(), LLMReviewAgent, ReviewerClass, splitPatchLines(), context(), DefaultLLMFakeReviewer (+13 more)

### Community 11 - "orchestrator.service.ts"
Cohesion: 0.08
Nodes (25): app, settings, createOrchestratorRoute(), CreateOrchestratorRouteOptions, requestBody, A2AOrchestratorSettings, createOrchestratorService(), DEFAULT_ORCHESTRATOR_SETTINGS (+17 more)

### Community 12 - "pr-info.service.ts"
Cohesion: 0.09
Nodes (16): A2ASendTaskRequest, A2ASendTaskResponse, AgentCard, LeadEngineerService, A2AServerSettings, createPrInfoService(), DEFAULT_A2A_SERVER_SETTINGS, InMemoryTaskStore (+8 more)

### Community 13 - "Signal Forms"
Cohesion: 0.06
Nodes (34): Accessing State, Async Validation, Big Form Example, Binding, Common Pitfalls (DO NOT DO THESE), Conditional Validation, Context, Creating a Form (+26 more)

### Community 14 - "lead-engineer.service.ts"
Cohesion: 0.12
Nodes (19): A2AMessage, A2ALeadEngineerSettings, createLeadEngineerService(), DEFAULT_LEAD_ENGINEER_SETTINGS, extractData(), InMemoryLeadEngineerTaskStore, jsonSchemaWithOptionalDefaults(), LeadEngineerAgentClass (+11 more)

### Community 15 - "位置情報欠落によるfinding/decisionのサイレントドロップ: 可視化と緩和 設計ドキュメント"
Cohesion: 0.05
Nodes (33): 1. 背景と根本原因, 2. 変更①: 欠落の可視化, 3. 変更②: 位置情報の転記を明示的に指示（緩和）, 4. 非対象（Non-goals）, 5. 検証方針（評価）, これは2つの別問題である, 位置情報欠落によるfinding/decisionのサイレントドロップ: 可視化と緩和 設計ドキュメント, 根本原因（1件の再現診断から再構成） (+25 more)

### Community 16 - "review.ts"
Cohesion: 0.09
Nodes (21): ReviewOutcome, CONFIG, loadModules(), { mockConnect, mockDisconnect, mockCreateGithubMcpClient }, FileChange, FileChangeSchema, PRInfo, PRInfoResult (+13 more)

### Community 17 - "score-evaluation.ts"
Cohesion: 0.12
Nodes (32): defaultScore(), buildItemDetail(), EvalRow, exactMatch(), Finding, IMPACTS, isDirectExecution(), isMatch() (+24 more)

### Community 18 - "reviews.mock-seed.ts"
Cohesion: 0.06
Nodes (29): CommentDisposition, DiffLineType, fileChange(), FindingCategory, FindingImpact, FindingSeverity, MOCK_SEED_ATTEMPTS, pr471Checkout (+21 more)

### Community 19 - "build-gold-set.ts"
Cohesion: 0.10
Nodes (26): ApiGet, buildGoldItem(), BuildGoldItemDeps, CATEGORY_KEYWORDS, errorMessage(), extractLine(), FetchPrFiles, fetchReviewComments() (+18 more)

### Community 20 - "run-agent-evaluation.ts"
Cohesion: 0.11
Nodes (24): readJsonl(), CliOptions, ConcurrentResult, createCli(), evaluateConcurrently(), evaluateItem(), EvaluateItemOptions, failedIdsSidecarPath() (+16 more)

### Community 21 - "reviews.store.ts"
Cohesion: 0.08
Nodes (27): CommentCounts, countComments(), ReviewFileChange, MOCK_SEED, MOCK_SEED_REPORTS, MOCK_SEED_REVIEWS, ReviewsSeed, ALLOWED_DISPOSITION_TRANSITIONS (+19 more)

### Community 22 - "devDependencies"
Cohesion: 0.08
Nodes (25): @babel/core, babel-plugin-react-compiler, happy-dom, @happy-dom/global-registrator, devDependencies, @babel/core, babel-plugin-react-compiler, happy-dom (+17 more)

### Community 23 - "build-seeded-set.ts"
Cohesion: 0.12
Nodes (27): buildSeededItem(), buildSeededItemFromFiles(), CATEGORIES, collectPath(), detectIntentionalMarkers(), errorMessage(), FetchPrFiles, isRecord() (+19 more)

### Community 24 - "properties"
Cohesion: 0.12
Nodes (16): type, type, items, type, minimum, type, properties, body (+8 more)

### Community 25 - "lead-engineer.route.ts"
Cohesion: 0.16
Nodes (9): createGithubAuthMiddleware(), GithubAuthEnv, GithubAuthMiddlewareOptions, GithubAuthVariables, callMiddleware(), createLeadEngineerRoute(), CreateLeadEngineerRouteOptions, requestBody (+1 more)

### Community 26 - "reviews/reviews.schema.ts"
Cohesion: 0.12
Nodes (24): REVIEW_ATTEMPT_CANCELED_EXAMPLE, REVIEW_ATTEMPT_QUEUED_EXAMPLE, REVIEW_CLOSED_EXAMPLE, REVIEW_COMMENT_EXAMPLE, REVIEW_DRAFT_EXAMPLE, REVIEW_LIST_EXAMPLE, REVIEW_REPORT_EXAMPLE, REVIEW_REVIEWED_EXAMPLE (+16 more)

### Community 27 - "a2a/request.model.ts"
Cohesion: 0.11
Nodes (27): A2ADataPart, A2ADataPartDiscriminatedSchema, A2ADataPartSchema, A2APartDiscriminatedSchema, A2APartSchema, A2ASendTaskRequestSchema, A2ATextPart, A2ATextPartDiscriminatedSchema (+19 more)

### Community 28 - "A2ATask"
Cohesion: 0.08
Nodes (7): A2APart, A2ATask, LeadEngineerTaskStore, OrchestratorTaskStore, TaskStore, InMemoryReviewerTaskStore, ReviewerTaskStore

### Community 29 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, composite, outDir, rootDir, types, extends, include, node (+2 more)

### Community 30 - "compilerOptions"
Cohesion: 0.08
Nodes (25): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+17 more)

### Community 31 - "docs/mcp-connection-stabilization-spec.md"
Cohesion: 0.14
Nodes (8): MCP接続の安定化 実装計画 (Issue #115、Python版), テスト方針, 変更対象ファイル(Python版・完了済み), 検証手順, Ollamaバックエンドが処理できないツール結果コンテンツ型の除去 テスト・検証手順 (Python版), テスト方針(TDD), 検証手順, `agents/` + `tools/` TypeScript移行 計画からの逸脱記録 (Issue #252)

### Community 32 - "4. MCPクライアントのセッション共有設計 (ADR-0004の運用化)"
Cohesion: 0.09
Nodes (23): 1. 背景と問題, 2.1 処理フロー, 2.2 接続数の変化, 2. 全体設計, 3.1 対象となる起動呼び出し箇所(ADR-0004後の構成), 3.2 バックオフ戦略・実装位置, 3.3 リトライと`ToolProviderException`ラップの関係, 3.4 `INFRA_EXCEPTIONS`への追加 (+15 more)

### Community 33 - "評価パイプライン: 構造化ロギングへの移行 設計ドキュメント"
Cohesion: 0.09
Nodes (21): 1. 背景と問題, 2. 修正方針, 3. テスト, 4. 検証手順, 対象外, 根本原因, 評価パイプライン: 並行実行時ログの失敗項目誤帰属 修正 設計ドキュメント, 1. 背景と問題 (+13 more)

### Community 34 - "properties"
Cohesion: 0.17
Nodes (12): properties, minimum, type, type, type, line, patch, path (+4 more)

### Community 35 - "Code Review Agent"
Cohesion: 0.09
Nodes (23): 0. Requirements, 1. Clone and enter workspace, 2. Install dependencies, 3. Enable Git hooks (pre-commit), 4. Run application, 5. Test, 6. Lint, format, and type check (Biome / tsc), Acknowledgments (+15 more)

### Community 36 - "AGENTS.md"
Cohesion: 0.12
Nodes (8): Operating Constraints (Python-era workflow record), React/Angular Agent Skills Implementation Plan, Tests, Validation, #251以降への申し送り（当時のメモ、#249〜#255は完了済み）, Nix flakeに関する運用上の注意, Stacked PR運用（`gh` + `gh-stack`）導入手順, TypeScript開発環境・ツールチェーン整備 実装計画・運用手順 (Issue #250)

### Community 37 - "ADR-0010: LocalLLM流量制御 — システム全体同時実行上限の実現機構とtimeout/cancellation/straggler処理"
Cohesion: 0.09
Nodes (23): ADR-0010: LocalLLM流量制御 — システム全体同時実行上限の実現機構とtimeout/cancellation/straggler処理, Consequences, Context, Decision, スコープ境界, 案1: 最小実装・現状踏襲, 案2: 協調キャンセル導入, 案3: インフラ層への委譲 (+15 more)

### Community 38 - "Review-Agent ワークフロー仕様"
Cohesion: 0.09
Nodes (22): 1. システム概要, 2. Agent 一覧, 3.1 Agent-IaFfm — PR Info Collector, 3.2 Agent-9uqpG — React Code Reviewer, 3.3 Agent-jnFVH — Security Analyst, 3.4 Agent-5oeZS — Lead Engineer, 3. 各 Agent の詳細仕様, 4. ワークフロー全体図 (+14 more)

### Community 39 - "Code Review Agent Evaluation Plan"
Cohesion: 0.09
Nodes (22): 1.1 Quality / Feature Requirement Goal, 1. Goals, 2.0.1 Repository Selection Criteria, 2.0.2 PR Quality Selection Criteria, 2.0.3 Population and Sampling Operation, 2.0 Domain Coverage Policy, 2.1 Gold PR Set, 2.2 Seeded Set (+14 more)

### Community 40 - "registry.ts"
Cohesion: 0.19
Nodes (19): collectDirectPackageNames(), collectFields(), detectProjectTypeFromPackages(), extractDirectDependenciesFromPackageJson(), extractDirectDependenciesFromPackageLock(), extractDirectDependenciesFromPnpmLock(), isPlainRecord(), PACKAGE_PROJECT_TYPE_PRIORITY (+11 more)

### Community 41 - "reviews.route.ts"
Cohesion: 0.13
Nodes (19): AttemptIdParamSchema, IdempotencyKeyHeaderSchema, ListReviewsQuerySchema, ReviewIdParamSchema, ADR-0012, applyCommentDispositionRoute, cancelReviewAttemptRoute, closeReviewRoute (+11 more)

### Community 42 - "A2A API 設計ドキュメント"
Cohesion: 0.10
Nodes (21): 1.1 目的, 1.2 採用プロトコル, 1.3 デプロイ構成, 1. 概要, 2. A2Aプロトコルのデータ形状, 3. TaskStoreの設計, 4.1 モジュール構成, 4.2 Orchestrator（フルワークフロー） (+13 more)

### Community 43 - "Seeded set生成: 専用Seedリポジトリ方式 設計ドキュメント"
Cohesion: 0.10
Nodes (21): 1. 背景と問題, 2.1 Angular (`kuju63/angular-seeded`), 2.2 React (`kuju63/react-seeded`), 2.3 Svelte (`kuju63/svelte-seeded`), 2.4 Vue (`kuju63/vue-seeded`), 2. 対象Seedリポジトリと59件のPR, 3.1 マーカーの実態(59件全数調査済み), 3.2 行番号の座標系(最重要制約) (+13 more)

### Community 44 - "pr-info-collector.ts"
Cohesion: 0.14
Nodes (16): ADR-0004, isInfraError(), CallMcpTool, createMcpToolCaller(), extractHeadRef(), extractLabelNames(), extractToolTextBlocks(), isPlainRecord() (+8 more)

### Community 45 - "review-list/reviews.schema.ts"
Cohesion: 0.13
Nodes (12): CommentCounts, CommentCountsSchema, PageInfo, PageInfoSchema, PrStateSchema, ReviewListResponse, ReviewListResponseSchema, ReviewSchema (+4 more)

### Community 46 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+12 more)

### Community 47 - "指摘単位3軸評価仕様 (Issue #168)"
Cohesion: 0.06
Nodes (29): ADR-0006: 指摘単位の severity / impact / priority 評価方式, Consequences, Context, Decision, 案A: Lead Engineerが3軸を校正する, 案A: PR単位ラベルを各findingへ継承する, 案A: 完全一致と±1一致の併記, 案B: LLMで各コメントを個別分類する (+21 more)

### Community 48 - "PR Info Collector ツール呼び出し修正 設計ドキュメント"
Cohesion: 0.10
Nodes (18): PR Info Collector ツール呼び出し修正 検証手順 (Python版), 1. 背景と問題, 2.1 呼び出し経路（案A: ツールループと構造化出力の分離）, 2.2 file 一覧対処（SYSTEM_PROMPT 強化）, 2.3 本タスクの範囲外, 2.5.1 案A の実測で残った2課題, 2.5.2 着眼: ファクトを LLM に生成させない, 2.5.3 採用する設計（案E: 完全決定論化） (+10 more)

### Community 49 - "3. 比較対象アプローチ"
Cohesion: 0.10
Nodes (19): 1.1 スキル束ねの配線がPythonコードに直書きされている, 1.2 コンテンツ変更もコードと同じCIゲートを通る, 1.3 デプロイはビルド時焼き込み、ホットリロードの仕組みがない, 1.4 今回のヒアリングで確認した優先課題, 1. 背景, 2. 統一比較観点, 3. 比較対象アプローチ, 4. 比較表 (+11 more)

### Community 50 - "JavaScript checks"
Cohesion: 0.10
Nodes (17): Contents, Implicit type coercion, Issue format, JavaScript checks, Missing error handling in Promise chains, Prototype pollution risk, `var` in new code, `==` vs `===` (+9 more)

### Community 51 - "merge-predictions.ts"
Cohesion: 0.16
Nodes (14): loadFailedIds(), failedIdsPath(), isNonEmptyString(), logger, main(), merge(), MergeOptions, ParsedOptions (+6 more)

### Community 52 - "health/index.ts"
Cohesion: 0.24
Nodes (10): createHealthRoute(), CreateHealthRouteOptions, createHealthService(), HealthService, HealthRequest, HealthRequestSchema, HealthHttpResponse, HealthHttpResponseSchema (+2 more)

### Community 53 - "pr-info-collector.test.ts"
Cohesion: 0.13
Nodes (14): StructuredOutputMissingError, BASE_CONFIG, createDispatch(), DispatchConfig, mcpErrorResult(), mcpJsonResult(), mcpTextResult(), { mockAgentCtor, mockAgentInvoke, mockCreateGithubMcpClient, mockCreateModelProvider } (+6 more)

### Community 54 - "github-rest.ts"
Cohesion: 0.18
Nodes (13): apiGet, ApiGetOptions, assertAllowedUrl(), fetchPrFiles(), FetchPrFilesOptions, FileChange, GitHubHttpError, GitHubRateLimitError (+5 more)

### Community 55 - "reviewStatus.ts"
Cohesion: 0.22
Nodes (15): ReviewRow(), PrState, ReviewStatus, CommentSummary, formatPrTitle(), formatUpdatedAt(), PR_STATE_TAG_TYPE, PrStateTag (+7 more)

### Community 56 - "EVALUATION_PLAN.md"
Cohesion: 0.15
Nodes (12): Seeded set生成: 専用Seedリポジトリ方式 実装計画, テスト方針, 移行チェックリスト・作業順序, 1. 背景, 2. スコープ, 3. スタック属性の伝播, 4. Vueサポートの追加, 5. A2Aエンドポイントの追加・改名 (+4 more)

### Community 57 - "検討事項"
Cohesion: 0.10
Nodes (21): ADR-0008: コア機能と拡張機能のパッケージ境界・レイヤリングの決定, Consequences, Context, Decision, 案1: 構造変更なし・規約のみで運用, 案2: 論理分離を先行させ、物理分割はトリガー条件まで保留（段階移行）, 案3: 物理package分割とhexagonal化を即時実施, 検討事項 (+13 more)

### Community 58 - "検討事項"
Cohesion: 0.11
Nodes (18): Addendum (2026-09-05), ADR-0012: 呼び出しインターフェース抽象化（Web/CLI/A2A共有）方針の決定, Consequences, Context, Decision, 案1: 自前Gateway実装, 案2: Langflow/Difyを受信/変換層としたGateway（採用）, 案3: Contract-First（OpenAPI/codegen canonical） (+10 more)

### Community 59 - "Lead Engineer Agent 設計"
Cohesion: 0.11
Nodes (18): 1. 役割と責務, 2. ワークフロー内の位置づけ, 3. 技術非依存設計, 4. データモデル, 5. finding_index 参照方式の採用理由, 6. システムプロンプト設計方針, 7.1 現在: チャット出力, 7.2 将来: GitHub PR コメント (+10 more)

### Community 60 - "3. Target Behavior"
Cohesion: 0.11
Nodes (16): Operating Constraints (Python-era workflow record), Svelte Agent Skills Implementation Plan, Tests, Validation, 1. Purpose, 2. Current State, 3.1 Svelte Skill Bundle, 3.2 Svelte Project Type and Reviewer (+8 more)

### Community 61 - "TypeScript開発環境・ツールチェーン整備 設計ドキュメント (Issue #250)"
Cohesion: 0.11
Nodes (18): 1. 決定済み事項（Issue #250コメントより。比較検討は不要、決定と理由のみ記録する）, 2.1 pnpm workspaceのディレクトリ構成, 2.2 CI `pull_request`トリガーの広げ方, 2.3 vitestカバレッジ閾値の設定方法, 2.4 CIでのNix利用, 2.5 git hook（pre-commit）の実行主体: husky vs 既存pre-commitフレームワーク, 2. 要検討事項（比較表 + 採用/却下理由）, 3. Nix flakeに関する運用上の注意（重要） (+10 more)

### Community 62 - "Angular Aria"
Cohesion: 0.11
Nodes (17): 10. Integration with Signal Forms, 1. Accordion, 2. Listbox, 3. Combobox, Select, and Multiselect, 4. Menu and Menubar, 5. Tabs, 6. Toolbar, 7. Tree (+9 more)

### Community 63 - "angular-developer/SKILL.md"
Cohesion: 0.11
Nodes (14): Example: Testing with a `MatButtonHarness`, Key Concepts, Testing with Component Harnesses, Using a Harness in a Unit Test, Why Use Harnesses?, Custom & Enterprise Testing Tools, End-to-End (E2E) Testing, Setting Up and Running E2E Tests (+6 more)

### Community 64 - "web-api/src/index.ts"
Cohesion: 0.18
Nodes (13): createApp(), ADR-0012, AppConfig, envSchema, loadConfigFromEnv(), app, config, reviewsStore (+5 more)

### Community 65 - "ADR-0005: スタック別 Gold-set ターゲット選定の正規経路化"
Cohesion: 0.12
Nodes (17): ADR-0005: スタック別 Gold-set ターゲット選定の正規経路化, Consequences, Context, Decision, 案A: 単一の共通述語モジュールに集約し、両者が参照する, 案A: 旧経路を完全撤去し、新方式を唯一の正規入力に置換する, 案B: Gold ビルダー側の判定を生産者に手作業でコピーして揃える, 案B: 新方式用の別セレクタを追加し、旧経路と併存させる (+9 more)

### Community 66 - "3. 採用する設計: `AfterToolCallEvent`で`event.result`を書き換える"
Cohesion: 0.12
Nodes (17): 1.1 発生した事象, 1.2 根本原因, 1.3 「特定PRでだけ起きる」理由, 1.4 将来の拡張との関係, 1. 背景と問題, 2.1 `file_read`のTOOL_SPECをラップして`mode="document"`の選択肢を消す, 2.2 `BeforeModelCallEvent`で会話履歴(`messages`)を書き換える, 2. 却下した設計 (+9 more)

### Community 67 - "required"
Cohesion: 0.25
Nodes (8): required, category, line, patch, path, rule_id, severity, summary

### Community 68 - "enum"
Cohesion: 0.24
Nodes (11): critical, high, low, medium, enum, type, priority, severity (+3 more)

### Community 69 - "enum"
Cohesion: 0.29
Nodes (7): angular, react, svelte, vue, stack, enum, type

### Community 70 - "React Composition Patterns"
Cohesion: 0.12
Nodes (16): 1.1 Avoid Boolean Prop Proliferation, 1.2 Use Compound Components, 1. Component Architecture, 2.1 Decouple State Management from UI, 2.2 Define Generic Context Interfaces for Dependency Injection, 2.3 Lift State into Provider Components, 2. State Management, 3.1 Create Explicit Component Variants (+8 more)

### Community 71 - "agent-skills-factory.ts"
Cohesion: 0.23
Nodes (13): buildAngularReviewSkills(), buildReactReviewSkills(), buildSvelteReviewSkills(), buildVueReviewSkills(), buildWebSecurityReviewSkills(), createAgentSkills(), skillPath(), SKILLS_DIR (+5 more)

### Community 72 - "SCR-01 コードレビュー一覧画面 実装スペック"
Cohesion: 0.12
Nodes (15): LST-16/LST-17 の導出ルール（クライアントに`files`が無く`commentCounts`のみ）, packages/web-api 側, packages/web 側, Playwright-cliでの確認結果, SCR-01 コードレビュー一覧画面 実装スペック, ST-06（受付完了通知, LST-04/LST-A09）, スコープ境界（承認事項）, テスト方針(TDD, Vitest) (+7 more)

### Community 73 - "`evaluation/` TypeScript移行 設計ドキュメント (Issue #254)"
Cohesion: 0.12
Nodes (14): `evaluation/` TypeScript移行 実装計画 (Issue #254), 実装スライス, 検証, 1.1 移植対象, 1.2 対象外, 1. スコープ, 2. 互換性要件, 3. `is_target_file`共有方法 (+6 more)

### Community 74 - "required"
Cohesion: 0.17
Nodes (11): $id, file_changes, id, pr_number, repository, stack, required, $schema (+3 more)

### Community 75 - "5. Re-render Optimization"
Cohesion: 0.12
Nodes (16): 5.10 Subscribe to Derived State, 5.11 Use Functional setState Updates, 5.12 Use Lazy State Initialization, 5.13 Use Transitions for Non-Urgent Updates, 5.14 Use useDeferredValue for Expensive Derived Renders, 5.15 Use useRef for Transient Values, 5.1 Calculate Derived State During Rendering, 5.2 Defer State Reads to Usage Point (+8 more)

### Community 76 - "build-seeded-set.test.ts"
Cohesion: 0.15
Nodes (11): countNewLinesBefore(), Defect, FileChange, isDirectExecution(), parseHunkNewStart(), resolveDefectLine(), SeededPrTarget, defect() (+3 more)

### Community 77 - "scripts"
Cohesion: 0.04
Nodes (45): better-sqlite3, dotenv, drizzle-kit, drizzle-orm, @hono/zod-openapi, dependencies, better-sqlite3, dotenv (+37 more)

### Community 78 - "compilerOptions"
Cohesion: 0.12
Nodes (15): ESNext, compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module (+7 more)

### Community 79 - "required"
Cohesion: 0.14
Nodes (13): $id, file_changes, id, pr_number, repository, stack, required, $schema (+5 more)

### Community 81 - "2. 要検討事項（比較表 + 採用/却下理由）"
Cohesion: 0.13
Nodes (13): `models/` TypeScript移行 コミット粒度・PRタイトル規約 (Issue #251), 1. 決定済み事項（本Issue着手前に確定していたもの）, 2.1 Zodのバージョン, 2.2 Enum表現, 2.3 フィールド命名（camelCase化）, 2.4 Nullable値の表現, 2.5 `ReviewContext.shared_mcp_client`の扱い, 2.6 `LeadEngineerReport`の振る舞い(accepted/rejected/to_markdown/to_evaluation_format) (+5 more)

### Community 82 - "properties"
Cohesion: 0.15
Nodes (13): properties, minimum, type, type, type, line, patch, path (+5 more)

### Community 83 - "a2a-server/package.json"
Cohesion: 0.10
Nodes (20): @hono/zod-validator, dependencies, @code-review-agent/agent-core, hono, @hono/node-server, @hono/zod-validator, devDependencies, tsx (+12 more)

### Community 84 - "required"
Cohesion: 0.15
Nodes (14): items, type, items, type, required, type, category, line (+6 more)

### Community 85 - "7. JavaScript Performance"
Cohesion: 0.13
Nodes (15): 7.10 Hoist RegExp Creation, 7.11 Use flatMap to Map and Filter in One Pass, 7.12 Use Loop for Min/Max Instead of Sort, 7.13 Use Set/Map for O(1) Lookups, 7.14 Use toSorted() Instead of sort() for Immutability, 7.1 Avoid Layout Thrashing, 7.2 Build Index Maps for Repeated Lookups, 7.3 Cache Property Access in Loops (+7 more)

### Community 86 - "Quick Reference"
Cohesion: 0.13
Nodes (14): 1. Eliminating Waterfalls (CRITICAL), 2. Bundle Size Optimization (CRITICAL), 3. Server-Side Performance (HIGH), 4. Client-Side Data Fetching (MEDIUM-HIGH), 5. Re-render Optimization (MEDIUM), 6. Rendering Performance (MEDIUM), 7. JavaScript Performance (LOW-MEDIUM), 8. Advanced Patterns (LOW) (+6 more)

### Community 87 - "logging.ts"
Cohesion: 0.09
Nodes (19): build_notification_payload(), DiscordNotificationPayload, EmbedField, EvaluationScores, GoldScores, logger, ScoreCounts, SeededScores (+11 more)

### Community 88 - "openapi-contract.test.ts"
Cohesion: 0.21
Nodes (13): OpenApiDoc, SCHEMA_NAMES, forEachOperation(), HTTP_METHODS, isNullableNode(), loadReviewsYamlDoc(), NormalizedSchema, normalizeSchema() (+5 more)

### Community 89 - "ReviewListPage.tsx"
Cohesion: 0.18
Nodes (12): FilterBar(), FilterBarProps, STATUS_FILTER_OPTIONS, RepoGroup(), ActionNotice, hasGithubToken(), ReviewListPage(), ReviewListPageProps (+4 more)

### Community 90 - "開発環境の初期セットアップ"
Cohesion: 0.14
Nodes (14): AIエージェント上でのシェルスクリプト実施時, betterleaksのインストール, Development environment setup, GitHub CLIのインストール, Graphifyのセットアップ, Homebrewのインストール, pre-commitのインストール, shellcheckのインストール (+6 more)

### Community 91 - "0011. LocalLLM配信契約: Worker障害後の再配信・再起動回復・状態分離"
Cohesion: 0.14
Nodes (14): 0011. LocalLLM配信契約: Worker障害後の再配信・再起動回復・状態分離, Queueと実行アダプタの所有境界, 再起動・shutdown回復契約, 可観測性, 影響・フォローアップ, 案A: at-most-once（取得時ACK、障害後は再配信しない）, 案B: at-least-once（lease + heartbeat + bounded retry + fencing）, 案C: exactly-once志向（実行と全副作用を強整合transactionで確定） (+6 more)

### Community 92 - "2. 修正方針"
Cohesion: 0.14
Nodes (14): 1. 背景と問題, 2. 修正方針, 3. テスト, 4. 検証手順, issue本文との乖離（前提の是正）, `pr_info_collector.py`, `review_orchestrator.py`, `tests/agents/test_pr_info_collector.py` (+6 more)

### Community 93 - "並列レビュー段 拡張アーキテクチャ設計"
Cohesion: 0.14
Nodes (14): 1. 背景と狙い, 2. レビュアーマトリクス（観点 × プロジェクト種別）, 3.1 入力境界 — `ReviewContext`, 3.2 レビュアー — `ReviewAgent` / `LLMReviewAgent`, 3.3 レジストリ — `registry`, 3.4 オーケストレータ — `ReviewOrchestrator`, 3.5 出力 — `ReviewReport`, 3. コンポーネント構成 (+6 more)

### Community 94 - "評価パイプライン Agent実行(A2A送信/ポーリング)のTypeScript移植 設計ドキュメント (Issue #306)"
Cohesion: 0.14
Nodes (13): 1. 背景と問題, 2.1 移植対象, 2.2 対象外, 2. スコープ, 3. 変換ロジックの再利用, 4.1 タイムアウト契約, 4. A2Aワイヤプロトコル, 5.1 検証コマンド (+5 more)

### Community 96 - "properties"
Cohesion: 0.12
Nodes (16): description, type, angular, react, svelte, vue, minimum, type (+8 more)

### Community 97 - "Svelte Review Guidelines"
Cohesion: 0.14
Nodes (14): Async Svelte, Avoid legacy features, Context, `$derived`, Each blocks, `$effect`, Events, `$inspect.trace` (+6 more)

### Community 98 - "ReviewAgent"
Cohesion: 0.20
Nodes (5): ReviewAgent, PlainFakeReviewer, FakeReviewer, makePrInfo(), withFiles()

### Community 99 - "Coding Agent Guide"
Cohesion: 0.15
Nodes (13): Coding Agent Guide, Coding Rules, Development Process, Evaluation Pipeline, Frequently Used Commands, graphify, Project Overview, Quality / Feature Requirements (+5 more)

### Community 100 - "2. 設計方針"
Cohesion: 0.15
Nodes (11): 1. 背景と問題, 2.1 3スクリプト構成への分割, 2.2 shard分割, 2.3 サーバーshutdownの制御, 2.4 failed_ids sidecarと「既知の失敗」「未回収」の区別, 2. 設計方針, 3. 対象外(今回やらないこと), 評価パイプラインのshard分割実行 設計ドキュメント (+3 more)

### Community 101 - "app.js"
Cohesion: 0.41
Nodes (12): escapeHtml(), getLang(), initListPage(), initRequestPage(), initResultPage(), initSettingsPage(), mountShell(), pick() (+4 more)

### Community 102 - "実装フロー（プロジェクト標準 TDD フロー準拠）"
Cohesion: 0.15
Nodes (12): Context, Cycle 1: モデル基本型（`DecisionVerdict`, `FindingDecisionOutput`, `LeadEngineerOutput`, `FindingDecision`）, Cycle 2: `LeadEngineerReport`, Cycle 3: `LeadEngineerAgent._build_prompt_and_index()`, Cycle 4: `LeadEngineerAgent._resolve_decisions()`, Cycle 5: `LeadEngineerAgent.evaluate()`（統合）, Cycle 6: `__init__.py` エクスポート追加, Lead Engineer Agent 実装プラン (+4 more)

### Community 103 - "PR Info Collector 正確性検証レポート（20回統計分析）"
Cohesion: 0.15
Nodes (12): 1. 正解データ（Ground Truth）, 2. 統計サマリ（成功試行 N=11）, 3. 出力タイトルの分布（再現性の指標）, 4. 全試行の生データ, 5. 修正前との対比（案A + file一覧対処の効果）, 6. 受け入れ基準の達否（暫定基準: docs/pr-info-collector-tooluse-fix-spec.md §3）, 7.1 構造化時の忠実性（copy-fidelity）の問題, 7.2 ツールループの長時間化と環境失敗（9/20） (+4 more)

### Community 104 - "required"
Cohesion: 0.05
Nodes (42): description, items, minItems, type, description, $id, properties, required (+34 more)

### Community 105 - "2. Advanced CSS Animations"
Cohesion: 0.15
Nodes (12): 1. Native CSS Animations (v20.2+ Recommended), 2. Advanced CSS Animations, 3. Legacy Animations DSL (Deprecated), Angular Animations, `animate.enter` and `animate.leave`, Animating Auto Height, Animating State and Styles, Defining Transitions (+4 more)

### Community 106 - "Frontend PR Review Agent — System Prompt"
Cohesion: 0.15
Nodes (12): Behavioral constraints, Frontend PR Review Agent — System Prompt, Input schema, Issue format, Output format, Role, Step 1 — Understand intent, Step 2 — Identify the stack (+4 more)

### Community 107 - "01 Injection (Confusing Data with Instructions)"
Cohesion: 0.10
Nodes (20): 01 Injection (Confusing Data with Instructions), Command Injection: Injecting Instructions into a Shell, Contents, Line of reasoning in code, Line of reasoning in code, Line of reasoning in code, Line of reasoning in code, Line of reasoning in code (+12 more)

### Community 108 - "svelte-core-bestpractices/SKILL.md"
Cohesion: 0.15
Nodes (7): Function bindings, Keyed each blocks, CSP, Serialization, $inspect.trace(...), $inspect(...).with, createSubscriber

### Community 109 - "reviews.enums.ts"
Cohesion: 0.28
Nodes (11): AttemptStatusSchema, CommentDispositionSchema, ErrorCodeSchema, FileChangeStatusSchema, FindingCategorySchema, FindingImpactSchema, FindingSeveritySchema, PrStateSchema (+3 more)

### Community 110 - "0009. LocalLLM流量制御: Queue実装方式・システム全体同時実行上限・障害時配信契約"
Cohesion: 0.17
Nodes (12): 0009. LocalLLM流量制御: Queue実装方式・システム全体同時実行上限・障害時配信契約, 影響・フォローアップ, 案A: 即時実行（現状維持 / Do-Nothing）, 案B: bounded in-process queue + semaphore（A2Aサーバー外の Gateway/中間サービス内）, 案C: worker lease 付き永続 Queue（埋め込みDB / SQLite 等）, 案D: 外部 message broker（Redis / RabbitMQ 等）, 検討事項A: Queue実装方式（#366）, 検討事項B: システム全体のLLM同時実行上限（#367） (+4 more)

### Community 111 - "2. 設計方針"
Cohesion: 0.17
Nodes (10): 1. 背景と問題, 2.1 コンテナ起動への切り替え, 2.2 環境変数の転送方式: `--env-file` を使わない理由, 2.3 `GITHUB_TOKEN` はコンテナに渡さない, 2.4 `--network=host` が必須である理由, 2.5 停止機構をSKILL.md側に一本化する, 2.6 スクリプトの配置, 2. 設計方針 (+2 more)

### Community 112 - "Evaluation Toolkit"
Cohesion: 0.17
Nodes (12): 1) Prepare PR target list, 2) Build Gold set automatically, 3) Build Seeded set from the dedicated seed repositories, 4) Run your review agents against both sets, 5) Evaluate with gates, Evaluation Toolkit, Known Limitations, One-Command Dataset Build (+4 more)

### Community 113 - "Evaluation Runbook"
Cohesion: 0.17
Nodes (12): 0. Preconditions, 1. Build execution target list from per-stack targets, 2. Build Gold set, 3. Build Seeded set, 4. Run review agent pipeline, 4a. Time-constrained environments (sharded execution retired), 5. Score evaluation, 6. Gate decision (+4 more)

### Community 114 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, check, check:write, dev, format, format:check, lint (+3 more)

### Community 115 - "02 Authentication & Authorization (Confusing Identity with Permission)"
Cohesion: 0.11
Nodes (17): 02 Authentication & Authorization (Confusing Identity with Permission), Contents, Cryptographic Failures: When "Fast" Is a Vulnerability, JWT Misuse: Confusing "Verified" with "Trustworthy", Line of reasoning in code, Line of reasoning in code, Line of reasoning in code, Line of reasoning in code (+9 more)

### Community 116 - "04 Software Supply Chain (The Chain of Trust and Its Blind Spots)"
Cohesion: 0.14
Nodes (13): 04 Software Supply Chain (The Chain of Trust and Its Blind Spots), Contents, CVE lookup resources, Known Vulnerabilities: "Starting to Use" vs. "Continuing to Use", Line of reasoning in code, Line of reasoning in code, Mechanism of impact, Mechanism of impact (+5 more)

### Community 117 - "09 Insecure Design (When Correct Code Implements a Flawed Design)"
Cohesion: 0.12
Nodes (16): 09 Insecure Design (When Correct Code Implements a Flawed Design), Business Logic Flaws: "Works Correctly" Does Not Mean "Safe", Contents, Excessive Data Exposure: "Returning Too Much", Line of reasoning in code, Line of reasoning in code, Line of reasoning in code, Mass Assignment: The Blind Spot of "Assign Everything at Once" (+8 more)

### Community 118 - "11 SSRF & Security Logging (Invisible Requests and Invisible Attacks)"
Cohesion: 0.13
Nodes (14): 11 SSRF & Security Logging (Invisible Requests and Invisible Attacks), Contents, Line of reasoning in code, Line of reasoning in code, Logging, Mechanism of impact, Mechanism of impact, Questions to Use During Review (+6 more)

### Community 119 - "12 Exception Handling Failures (When Error Paths Are Not Designed)"
Cohesion: 0.13
Nodes (14): 12 Exception Handling Failures (When Error Paths Are Not Designed), Contents, Fail-Open: The Exception Path Grants Access, Line of reasoning in code, Line of reasoning in code, Mechanism of impact, Mechanism of impact, Mechanism of impact (+6 more)

### Community 120 - "6. Rendering Performance"
Cohesion: 0.17
Nodes (12): 6.10 Use React DOM Resource Hints, 6.11 Use useTransition Over Manual Loading States, 6.1 Animate SVG Wrapper Instead of SVG Element, 6.2 CSS content-visibility for Long Lists, 6.3 Hoist Static JSX Elements, 6.4 Optimize SVG Precision, 6.5 Prevent Hydration Mismatch Without Flickering, 6.6 Suppress Expected Hydration Mismatches (+4 more)

### Community 121 - "エージェント開発ガイド — web-api パッケージ"
Cohesion: 0.17
Nodes (12): AI Agent／Valkey 連携, API 契約, Hono／Zod OpenAPI, Kubernetes／コンテナ, REST の重要な不変条件, エージェント開発ガイド — web-api パッケージ, コマンド, テスト (+4 more)

### Community 122 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, jsx, jsxImportSource, module, outDir, rootDir, skipLibCheck, strict (+6 more)

### Community 123 - "useReviewListState.ts"
Cohesion: 0.29
Nodes (9): matchesSearch(), readCollapsedRepos(), readString(), repoKeyOf(), STORAGE_KEYS, reviews, useReviewListState, VALID_STATUS_FILTERS (+1 more)

### Community 124 - "package.json"
Cohesion: 0.05
Nodes (39): @biomejs/biome, lint-staged, openai, dependencies, ai-sdk-ollama, openai, @strands-agents/sdk, zod (+31 more)

### Community 125 - "Contributing Guide"
Cohesion: 0.18
Nodes (11): 1. Principles, 2. Development Flow (Spec-Driven + TDD), 3. Local Development Commands, 4. Implementation and Design Rules, 5. PR Description Rules, 6. References, Contributing Guide, Initial setup (+3 more)

### Community 126 - "ADR-0004: MCPクライアントのセッション共有(レビュアー間)"
Cohesion: 0.18
Nodes (11): ADR-0004: MCPクライアントのセッション共有(レビュアー間), Consequences, Context, Decision, 検討事項, 検討事項1: 共有範囲 → A(並列レビュー実行の内部でのみ共有)を採用, 検討事項1: 共有範囲(共有単位), 検討事項2: 共有セッションのライフサイクル管理 (+3 more)

### Community 127 - "評価パイプライン設計: データ生成から実行まで"
Cohesion: 0.18
Nodes (11): 1. 背景と狙い, 2. ディレクトリの役割分担: `evaluation/input/` と `evaluation/data/`, 3. 全体データフロー, 4. サンプリングと構成比率の可視化, 5. 実行フェーズの並行実行モデル, 6. 完了通知（Discord Webhook）, 7. 関連ドキュメント, Gold と Seeded のレビュアー選択 (+3 more)

### Community 128 - "Seeded評価を`/orchestrator`単一呼び出しへ統合する 設計ドキュメント"
Cohesion: 0.18
Nodes (11): 1. 背景, 2. 決定, 3.1 `evaluation/tools/run_agent_evaluation.py`, 3.2 テスト — `tests/evaluation/tools/test_run_agent_evaluation.py`, 3. 実装, 4. ルーティング不一致の解消（Issue #238、旧・既知の逸脱）, 5. タイムアウト予算への影響, 6. テスト方針 (+3 more)

### Community 129 - "Component Styling"
Cohesion: 0.18
Nodes (10): Component Styling, Defining Styles, External Styles, `:host`, `:host-context()`, `::ng-deep`, Special Selectors, Styles in Templates (+2 more)

### Community 130 - "Angular Review Guidelines"
Cohesion: 0.18
Nodes (11): Angular Aria, Angular Review Guidelines, Components, Dependency Injection, Forms, Pipes, Reactivity and Data Management, Routing (+3 more)

### Community 131 - "Svelte checks"
Cohesion: 0.18
Nodes (11): Contents, Context7 trigger examples, each block key, {@html} XSS, Issue format, onMount cleanup, Reactivity tracking (Svelte 4), Runes migration consistency (+3 more)

### Community 132 - "03 CSRF / CORS (Request Origin and Intent Verification)"
Cohesion: 0.15
Nodes (12): 03 CSRF / CORS (Request Origin and Intent Verification), Contents, CORS: "Disabling Protection While Thinking You're Adding It", CSRF: "One Click Makes the User Do Something They Didn't Intend", Line of reasoning in code, Line of reasoning in code, Mechanism of impact, Mechanism of impact (+4 more)

### Community 133 - "05 Secrets Exposure (Underestimating Where Data Can Reach)"
Cohesion: 0.13
Nodes (14): 05 Secrets Exposure (Underestimating Where Data Can Reach), Contents, Error Responses: "Development Detail Leaking to Production Users", Hardcoded Secrets: "Code Is Read More Widely Than You Think", Line of reasoning in code, Line of reasoning in code, Line of reasoning in code, Mechanism of impact (+6 more)

### Community 134 - "08 Configuration & Environment (The Gap Between "Works" and "Works Safely")"
Cohesion: 0.13
Nodes (14): 08 Configuration & Environment (The Gap Between "Works" and "Works Safely"), Container Configuration: Principle of Least Privilege, Contents, Debug Features Left in Production: "Developer Convenience as Attack Surface", Environment Separation: "What Does This Remove?", Line of reasoning in code, Line of reasoning in code, Line of reasoning in code (+6 more)

### Community 135 - "10 Software Integrity Failures (Trusting Without Verifying)"
Cohesion: 0.13
Nodes (14): 10 Software Integrity Failures (Trusting Without Verifying), Contents, Deserialization: Making Data Execute, Line of reasoning in code, Line of reasoning in code, Line of reasoning in code, Mechanism of impact, Mechanism of impact (+6 more)

### Community 136 - "reviewing-web-security/SKILL.md"
Cohesion: 0.18
Nodes (10): 2021 (reference), 2025 (current), How to Review, OWASP Top 10 Coverage, Reference Files, Stating Review Limits, Step 1: Characterize the PR (30 seconds), Step 2: Select references by signal (+2 more)

### Community 137 - "React Composition Patterns"
Cohesion: 0.18
Nodes (10): 1. Component Architecture (HIGH), 2. State Management (MEDIUM), 3. Implementation Patterns (MEDIUM), 4. React 19 APIs (MEDIUM), Full Compiled Document, How to Use, Quick Reference, React Composition Patterns (+2 more)

### Community 138 - "3. Server-Side Performance"
Cohesion: 0.18
Nodes (10): 3.10 Use after() for Non-Blocking Operations, 3.1 Authenticate Server Actions Like API Routes, 3.2 Avoid Duplicate Serialization in RSC Props, 3.3 Avoid Shared Module State for Request Data, 3.4 Cross-Request LRU Caching, 3.5 Hoist Static I/O to Module Level, 3.6 Minimize Serialization at RSC Boundaries, 3.7 Parallel Data Fetching with Component Composition (+2 more)

### Community 139 - "evaluation/package.json"
Cohesion: 0.05
Nodes (37): commander, bin, build-gold-set, build-seeded-set, discover-candidate-prs, generate-evaluation-report, merge-predictions, score-evaluation (+29 more)

### Community 140 - "ReviewListPage.test.tsx"
Cohesion: 0.20
Nodes (3): FetchLike, LOCALE_JSON, setApiFetchHandler()

### Community 141 - "ADR-0001: 大規模PRのレビュー除外方針"
Cohesion: 0.20
Nodes (10): ADR-0001: 大規模PRのレビュー除外方針, Consequences, Context, Decision, Decision Drivers, Option 0 — 現状維持(binary fallback), Option 1 — Issue #54原案: パッチ本文の段階的トリミング, Option 2 — ユーザー提案A: ファイル単位のレビュー除外 (+2 more)

### Community 142 - "ADR-0003: MCP起動リトライ戦略"
Cohesion: 0.20
Nodes (10): ADR-0003: MCP起動リトライ戦略, Consequences, Context, Decision, リトライ対象例外と非一過性エラーの扱い, 対象(リトライを適用する箇所), 方式1: リトライ間隔の戦略(バックオフ方式), 方式2: 実装手段(ライブラリ選定) (+2 more)

### Community 143 - "A2A API 実装計画・Python版設計の全文・検証手順"
Cohesion: 0.20
Nodes (10): 11. 関連ドキュメント, 3.1 LangFlow ワークフロー → A2A API マッピング, 3.2 ディレクトリ構造（新規追加分）, 3. 全体アーキテクチャ, 7. `api/config.py` 実装仕様, 8. 依存関係の変更（`pyproject.toml`）, 9.1 `ReviewerConfig` の拡張, 9.2 `OpenAIModel` 生成部の変更（`LLMReviewAgent`, `PRInfoCollector`, `LeadEngineerAgent`） (+2 more)

### Community 144 - "9. fallback率30%未満の目標に対する構造的対応 (プロンプトのみでは不足)"
Cohesion: 0.20
Nodes (10): 9.1 事象: 20件バッチ検証でfallback率100%, 9.2 モデル比較: `llama3.1:latest` (8B) vs `qwen3.5:latest` (9.7B), 9.3 対応方針(1): モデルの切り替え, 9.4 対応方針(2): 3.2.3の「再生成のリトライは行わない」の見直し, 9.5 検証観点, 9.6 残る限界, 9.7 実測結果: `qwen3.5:latest`では不足、`Ornith-1.0-35B`で目標達成, 9.8 単発測定の頑健性確認 (`--seed`違いで3回) (+2 more)

### Community 145 - "GitHub MCP `streamable_http_client` 移行 設計ドキュメント"
Cohesion: 0.20
Nodes (10): 1.1 API の変化, 1.2 `httpx.AsyncClient` の所有権問題, 1.3 検討した代替案とその却下理由, 1. 背景と問題, 2.1 この設計で解消されること, 2. 採用する設計, 3. 変更ファイル, 4. 検証手順 (+2 more)

### Community 146 - "React/Angular Agent Skills Review Accuracy Spec"
Cohesion: 0.20
Nodes (10): 1. Purpose, 2. Current State, 3.1 React Skill Enhancement, 3.2 Angular Skill Separation, 3.3 Angular-First Detection, 3.4 Security Reviewer Coverage, 3. Target Behavior, 4. Vendored Skill Sources (+2 more)

### Community 147 - "PR Info Collector 正確性検証レポート（20回統計分析）"
Cohesion: 0.20
Nodes (9): 1. 正解データ（Ground Truth）, 2. 統計サマリ（成功試行 N=20）, 3. 出力タイトルの分布（再現性の指標）, 4. 全試行の生データ, 5. 3者比較（修正前 → 案A → 決定論化）, 6. 受け入れ基準の達否（spec §2.5.4）, 7. 結論, PR Info Collector 正確性検証レポート（20回統計分析） (+1 more)

### Community 148 - "enum"
Cohesion: 0.24
Nodes (11): enum, type, enum, type, correctness, maintainability, performance, security (+3 more)

### Community 149 - "Components"
Cohesion: 0.20
Nodes (9): Component Definition, Components, Conditional Rendering (`@if`), Core Concepts, Loops (`@for`), Metadata Options, Switching Content (`@switch`), Template Control Flow (+1 more)

### Community 150 - "Angular CLI MCP Server"
Cohesion: 0.20
Nodes (9): Angular CLI MCP Server, Antigravity IDE, Available Tools (Default), Command Options, Configuration, Cursor, Experimental Tools, Gemini CLI (+1 more)

### Community 151 - "Template-Driven Forms"
Cohesion: 0.20
Nodes (9): Building the Form Template, Core Directives, Form and Control State, Resetting the Form, Setup, Submitting the Form, Template-Driven Forms, Two-Way Binding with `[(ngModel)]` (+1 more)

### Community 152 - "Angular checks"
Cohesion: 0.20
Nodes (10): Angular checks, ChangeDetectionStrategy, Contents, Context7 trigger examples, DI scope mismatch, innerHTML XSS, Issue format, Observable subscription leak (+2 more)

### Community 153 - "React checks"
Cohesion: 0.20
Nodes (10): Contents, Context7 trigger examples, Context over-provision, dangerouslySetInnerHTML XSS, Issue format, Missing cleanup, React checks, Unnecessary memoization (+2 more)

### Community 154 - "Vue.js checks"
Cohesion: 0.20
Nodes (10): Composition vs Options API consistency, computed vs method misuse, Contents, Context7 trigger examples, defineProps / defineEmits without types, Issue format, v-for key, v-html XSS (+2 more)

### Community 155 - "06 Security Headers & CSP (The Precision of Browser Instructions)"
Cohesion: 0.17
Nodes (11): 06 Security Headers & CSP (The Precision of Browser Instructions), Contents, CSP: The Precision of "What Not to Allow", Line of reasoning in code, Line of reasoning in code, Mechanism of impact, Mechanism of impact, Other Security Headers: Problems Caused by Removal (+3 more)

### Community 156 - "07 File Upload & Path Traversal (The Dual Nature of Files)"
Cohesion: 0.17
Nodes (11): 07 File Upload & Path Traversal (The Dual Nature of Files), Contents, File Upload: Controlling What Gets Uploaded, Line of reasoning in code, Line of reasoning in code, Mechanism of impact, Mechanism of impact, Path Traversal: The Danger of "Path" as Input (+3 more)

### Community 157 - "React Composition Patterns"
Cohesion: 0.20
Nodes (9): Component Architecture (CRITICAL), Core Principles, Creating a New Rule, Impact Levels, Implementation Patterns (MEDIUM), React Composition Patterns, Rules, State Management (HIGH) (+1 more)

### Community 158 - "React Best Practices"
Cohesion: 0.20
Nodes (9): 4.1 Deduplicate Global Event Listeners, 4.2 Use Passive Event Listeners for Scrolling Performance, 4.3 Use SWR for Automatic Deduplication, 4.4 Version and Minimize localStorage Data, 4. Client-Side Data Fetching, Abstract, React Best Practices, References (+1 more)

### Community 159 - "Sections"
Cohesion: 0.20
Nodes (9): 1. Eliminating Waterfalls (async), 2. Bundle Size Optimization (bundle), 3. Server-Side Performance (server), 4. Client-Side Data Fetching (client), 5. Re-render Optimization (rerender), 6. Rendering Performance (rendering), 7. JavaScript Performance (js), 8. Advanced Patterns (advanced) (+1 more)

### Community 160 - "base-reviewer.review.test.ts"
Cohesion: 0.20
Nodes (7): { mockAgentCtor, mockInvoke, mockCreateModelProvider, mockCreateGithubMcpClient }, NoMcpReviewer, ReviewContext, ReviewerConfig, SkillsReviewer, StubReviewer, UrlFetchReviewer

### Community 162 - "web/biome.json"
Cohesion: 0.13
Nodes (15): noAmbiguousAnchorText, noSvgWithoutTitle, extends, files, includes, //, !**/dist, !**/node_modules (+7 more)

### Community 163 - "0007-Multi-Container-Architecture-for-Scalability"
Cohesion: 0.22
Nodes (9): 0007-Multi-Container-Architecture-for-Scalability, 影響・フォローアップ, 案A: 単純なコンテナ・レプリカ構成 (Monolithic Container Scale-out), 案B: API Gateway + Worker Queue 構成 (Asynchronous Task Processing), 案C: 分離されたマイクロサービス構成 (Microservices with Shared State), 検討事項, 検討内容, 検討結果 (+1 more)

### Community 164 - "スタック別 Gold-set ターゲット選定仕様"
Cohesion: 0.22
Nodes (9): 1. 全体データフロー, 2. リポジトリ選定条件, 3. PR 選定条件, 4. severity / impact / priority の LLM 分類, 5. 出力スキーマ, 6. 再開と上限, 7. 評価実行対象の抽出, 8. テスト方針 (+1 more)

### Community 165 - "mock-data.js"
Cohesion: 0.31
Nodes (4): buildFileRows(), computeReviewStatus(), countComments(), getCommentStatus()

### Community 166 - "Model Provider Factory と生成パラメータの安全弁 設計ドキュメント"
Cohesion: 0.22
Nodes (9): 1. 背景, 2.1 `createModelProvider(providerType, modelId, options)`, 2.2 呼び出し元, 2. 設計, 3.1 `maxTokens`, 3.2 `frequencyPenalty`, 3. 生成パラメータの安全弁, 4. 関連ドキュメント (+1 more)

### Community 167 - "docstring lint方針 設計ドキュメント"
Cohesion: 0.22
Nodes (8): 1. 背景と問題, 2.1 `select`を明示指定する理由(重要: 検証で判明した仕様), 2.2 `explicit-preview-rules = true` を設定する理由, 2. 採用するルール, 3. スコープ外事項, 4. 既知のリスク, 5. 影響範囲(最終確定設定での実測値), docstring lint方針 設計ドキュメント

### Community 168 - "評価レポートへの個別PR詳細（Human Review vs Agent指摘）追加 設計ドキュメント"
Cohesion: 0.22
Nodes (8): 1. 背景と問題, 2.1 `score_evaluation.py`, 2.2 `run_agent_evaluation.py`, 2. 修正方針, 3. 対象外（今回やらないこと）, 4. テスト, 5. 検証手順, 評価レポートへの個別PR詳細（Human Review vs Agent指摘）追加 設計ドキュメント

### Community 169 - "7. Phase 2運用後に判明した問題 (Issue #131)"
Cohesion: 0.22
Nodes (9): 7.1 事象と非開発者向け要約, 7.2 原因分析: 構造的原因(6/7件)と書式差(1/7件)の分離, 7.3 新しい設計原則: スニペットの自己完結性, 7.5 対象外とした案とその理由: candidate選定のasyncスコープ考慮, 7.6 Issue対応方針(3)の採用可否: 逆方向を採用した理由, 7.7 計測可能性: `generation_source`比率を評価指標に昇格, 7.8 検証観点 (実装時のテスト方針), 7.9 残る限界 (+1 more)

### Community 170 - "Seeded set生成: (ファイル, ルール)組み合わせ重複 修正 設計ドキュメント"
Cohesion: 0.22
Nodes (8): 1. 背景と問題, 2. 修正方針, 3. テスト, 4. 検証手順, Seeded set生成: (ファイル, ルール)組み合わせ重複 修正 設計ドキュメント, 対象外, 根本原因, 追加で発見した根本原因: `id` が (ファイル, ルール) の組を一意に識別できない

### Community 171 - "Red Hat Hardened Image への base image 変更 spec"
Cohesion: 0.22
Nodes (9): Red Hat Hardened Image への base image 変更 spec, リスクと留意点, ロールバック, 受入条件, 変更対象, 実測結果 (podman による Step 0 調査), 移行時点で固定した digest (multi-arch index), 背景 (+1 more)

### Community 172 - "must_find"
Cohesion: 0.22
Nodes (9): items, type, type, description, items, minItems, type, file_changes (+1 more)

### Community 173 - "Review Matching Rubric"
Cohesion: 0.22
Nodes (8): Category Mapping, Impact Mapping, Matching Levels, Priority Mapping, Purpose, Review Decision Scoring (Lead Engineer), Review Matching Rubric, Severity Mapping

### Community 174 - "agent-core/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, composite, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 175 - "agent-core/package.json"
Cohesion: 0.04
Nodes (44): default, development, types, default, development, types, default, development (+36 more)

### Community 176 - "evaluation/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, composite, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 177 - "Angular CLI Guide for Agents"
Cohesion: 0.22
Nodes (8): 1. Managing Dependencies, 2. Generating Code (`ng generate` or `ng g`), 3. Development Server & Proxying, 4. Building the Application, 5. Testing, 6. Deployment, Angular CLI Guide for Agents, Backend API Proxying

### Community 178 - "Creating and Using Services"
Cohesion: 0.22
Nodes (8): Advanced Service Patterns, Creating a Service, Creating and Using Services, Injecting a Service, Injecting into a Component, Injecting into Another Service, The `autoProvided` option, The `@Service` decorator

### Community 179 - "Data Resolvers"
Cohesion: 0.22
Nodes (8): 1. Via `ActivatedRoute` (Traditional), 2. Via Component Inputs (Modern), Accessing Resolved Data, Best Practices, Configuring the Route, Creating a Resolver, Data Resolvers, Error Handling

### Community 180 - "Define Routes"
Cohesion: 0.22
Nodes (8): Basic Configuration, Define Routes, Matching Strategy, Nested (Child) Routes, Page Titles, Redirects, Route Data and Providers, URL Paths

### Community 181 - "Inputs"
Cohesion: 0.22
Nodes (8): Best Practices, Configuration Options, Decorator-based Inputs (@Input), Inputs, Model Inputs (Two-Way Binding), Signal-based Inputs, Usage, Usage in Template

### Community 182 - "Reactive Forms"
Cohesion: 0.22
Nodes (8): Accessing Controls, Core Classes, Manual State Management, Reactive Forms, Setup, Template Binding, Unified Change Events, Updating Values

### Community 183 - "Manual Setup (Tailwind v4)"
Cohesion: 0.22
Nodes (8): 1. Install Dependencies, 2. Configure PostCSS, 3. Import Tailwind CSS, 4. Use Utility Classes, Automated Setup (Recommended), Manual Setup (Tailwind v4), Summary for AI Agents, Using Tailwind CSS with Angular

### Community 184 - "reviewing-frameworks/SKILL.md"
Cohesion: 0.22
Nodes (4): Context7 usage, Reference files, Reviewing framework-specific concerns, Shared component design checks (all frameworks)

### Community 185 - "reviewing-universal/SKILL.md"
Cohesion: 0.25
Nodes (3): Quick triage, Reference files, Reviewing universal concerns

### Community 186 - "Accessibility checks"
Cohesion: 0.22
Nodes (9): Accessibility checks, ARIA misuse, Color contrast, Contents, Focus management, Form label association, Image alt text, Interactive element semantics (+1 more)

### Community 187 - "Security checks"
Cohesion: 0.22
Nodes (9): Client-side auth bypass, Contents, CSRF surface, Environment variable misuse  🔴, Hardcoded secrets  🔴, Issue format, Security checks, Target blank without rel (+1 more)

### Community 188 - "await-expressions.md"
Cohesion: 0.22
Nodes (8): Breaking changes, Caveats, Concurrency, Error handling, Forking, Indicating loading states, Server-side rendering, Synchronized updates

### Community 189 - "エージェント開発ガイド — web パッケージ"
Cohesion: 0.22
Nodes (9): routes/ 配下の命名ルール（Tanstack Router ルール）, エージェント開発ガイド — web パッケージ, コマンド, ツールチェーン 備忘, テストの実行, 技術スタック, 概要, 構成（フォルダ構成） (+1 more)

### Community 190 - "jsonl.ts"
Cohesion: 0.36
Nodes (6): RunDeps, serializeRow(), directories, writeFileAtomic(), writeJsonAtomic(), writeJsonlAtomic()

### Community 191 - "web-api/biome.json"
Cohesion: 0.25
Nodes (8): extends, files, includes, //, linter, rules, root, $schema

### Community 192 - "biome.json"
Cohesion: 0.09
Nodes (22): files, includes, formatter, enabled, indentStyle, indentWidth, lineWidth, quoteStyle (+14 more)

### Community 193 - "enum"
Cohesion: 0.29
Nodes (7): enum, type, correctness, maintainability, performance, security, category

### Community 194 - "enum"
Cohesion: 0.29
Nodes (7): critical, high, low, medium, severity, enum, type

### Community 195 - "12. セキュリティ設計"
Cohesion: 0.25
Nodes (8): 12.1 API 認証方式, 12.2 `llm_base_url` の扱い（SSRF 対策）, 12.3 `github_token` のリクエストボディへの混入, 12.4 例外メッセージへのトークン漏洩対策, 12.5 TaskStore TTL, 12.6 TLS（HTTPS）必須化, 12.7 AgentCard によるサービストポロジーの公開（将来の対応事項）, 12. セキュリティ設計

### Community 196 - "13. TypeScript/Zod モデル移行仕様"
Cohesion: 0.25
Nodes (8): 13.1 対象と配置, 13.2 命名と互換性, 13.3 検証境界, 13.4 Zod 規約, 13.5 テスト, 13.6 Health service と route の責務, 13.7 環境変数駆動の Provider 設定（Issue #297）, 13. TypeScript/Zod モデル移行仕様

### Community 197 - "6. 環境変数リファレンス"
Cohesion: 0.25
Nodes (8): 6.1.1 `GITHUB_TOKEN` の扱いについて, 6.1 必須環境変数, 6.2 サービス設定（任意・デフォルト値あり）, 6.3 LLM プロバイダー・モデル設定（任意）, 6.4 AgentCard URL 設定（任意・モノリス構成では設定不要）, 6.5 GitHub MCP エンドポイント（任意）, 6.6 `.env` ファイル例（クイックスタート）, 6. 環境変数リファレンス

### Community 198 - "3.2 Phase 2: LLM推論 + 決定論的事後検証"
Cohesion: 0.25
Nodes (8): 3.2.1 生成フロー, 3.2.2 構造化出力スキーマ (フィールド定義), 3.2.3 決定論的事後検証 (安全網、必須), 3.2.4 再現性の担保 (R6), 3.2.5 コストとレイテンシ, 3.2.6 モデル構成: 生成モデルと評価モデルの分離, 3.2.7 生成メタデータの記録, 3.2 Phase 2: LLM推論 + 決定論的事後検証

### Community 199 - "LLM生成パラメータの安全弁(max_tokens / frequency_penalty) 実装記録 (Issue #208)"
Cohesion: 0.25
Nodes (7): 1. 背景と問題（Python版実装時点の記録）, 2. 調査済み事実(Python版実装時点), 3. パラメータ探索の実験結果, 4. `.env.example`, 5. スコープ外, 6. 変更ファイル一覧（Python版・完了済み。TS移植は `packages/agent-core/src/agents/model-provider-factory.ts` に統合済み）, LLM生成パラメータの安全弁(max_tokens / frequency_penalty) 実装記録 (Issue #208)

### Community 200 - "pull_request_template.md"
Cohesion: 0.25
Nodes (7): Change Details, Documentation Updates, Impact Scope, Related Issue, Risk and Rollback, Summary, Test

### Community 201 - "Dependency Injection (DI) Fundamentals"
Cohesion: 0.25
Nodes (7): Creating a Service, Dependency Injection (DI) Fundamentals, How DI Works in Angular, Injecting Dependencies, Services, The `inject()` Function, Where can `inject()` be used? (Injection Context)

### Community 202 - "Route Loading Strategies"
Cohesion: 0.25
Nodes (7): Eager Loading, Injection Context and Lazy Loading, Lazy Loading, Lazy Loading Child Routes, Lazy Loading Components, Recommendation, Route Loading Strategies

### Community 203 - "Outputs (Custom Events)"
Cohesion: 0.25
Nodes (7): Best Practices, Configuration Options, Decorator-based Outputs (@Output), Function-based outputs, Outputs (Custom Events), Programmatic Subscription, Usage in Template

### Community 204 - "Pipes"
Cohesion: 0.25
Nodes (7): Built-in locale-aware pipes — use standalone formatting functions, Creating custom pipes, Custom pipes — extract the transformation function, Impure pipes, Pipes, Using pipe logic outside templates, Using pipes in templates

### Community 205 - "Async Reactivity with `resource`"
Cohesion: 0.25
Nodes (7): Aborting Requests, Async Reactivity with `resource`, Basic Usage, Local Mutation, Reactive Data Fetching with `httpResource`, Reloading Data, Resource Status Signals

### Community 206 - "Setting Up for Router Testing"
Cohesion: 0.25
Nodes (7): Best Practices, Example Setup, Example: Testing Navigation, Key Concepts, Setting Up for Router Testing, Testing with the RouterTestingHarness, Writing Router Tests

### Community 207 - "Angular Signals Overview"
Cohesion: 0.25
Nodes (7): Angular Signals Overview, Async Operations in Reactive Contexts, Computed Signals (`computed`), Exposing as Readonly, Reactive Contexts, Untracked Reads (`untracked`), Writable Signals (`signal`)

### Community 208 - "Correctness checks"
Cohesion: 0.25
Nodes (8): Async failure paths, Contents, Correctness checks, Edge cases, Intent alignment, Issue format, Race conditions, Test coverage

### Community 209 - "Dependency audit checks"
Cohesion: 0.25
Nodes (8): Bundle size, Contents, Dependency audit checks, Duplication, Issue format, Justification, License, Maintenance status

### Community 210 - "Test quality checks"
Cohesion: 0.25
Nodes (7): Assertion presence, Behavior vs implementation detail, Contents, Coverage of changed paths, Issue format, Test isolation, Test quality checks

### Community 211 - "@attach.md"
Cohesion: 0.25
Nodes (7): Attachment factories, Conditional attachments, Controlling when attachments re-run, Converting actions to attachments, Creating attachments programmatically, Inline attachments, Passing attachments to components

### Community 212 - "snippet.md"
Cohesion: 0.25
Nodes (6): Optional snippets, Exporting snippets, Programmatic snippets, Snippet scope, Snippets and slots, Typing snippets

### Community 213 - "ReviewerConfig"
Cohesion: 0.16
Nodes (8): ReviewerConfig, CreateModelProviderOptions, ProviderType, mockedCreateOllama, mockedOpenAIModel, mockedVercelModel, PRInfoCollectorConfig, ReviewOrchestrator

### Community 214 - "tool-result-sanitizer.ts"
Cohesion: 0.39
Nodes (3): isUnsupported(), OllamaUnsupportedContentSanitizer, UNSUPPORTED_CONTENT_CLASSES

### Community 215 - "web/package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 216 - "Review"
Cohesion: 0.32
Nodes (6): RepoGroupProps, ReviewRowProps, buildRouter(), review(), Review, RepoGroup

### Community 217 - "renovate.json"
Cohesion: 0.25
Nodes (7): config:recommended, :gitSignOff, customManagers, extends, packageRules, $schema, semanticCommits

### Community 218 - "Suggested Commands"
Cohesion: 0.25
Nodes (7): Evaluation pipeline, pre-commit hooks, Run, Setup, Suggested Commands, Test / Lint / Format / Type-check, Worktrees (project convention, not a generic git op)

### Community 220 - "ADR-0002: ワークフロー外部化(LangFlow/Dify)の検討"
Cohesion: 0.29
Nodes (7): ADR-0002: ワークフロー外部化(LangFlow/Dify)の検討, Consequences, Context, Decision, Decision Drivers, Message-based vs 構造化出力の比較, 所見

### Community 221 - "PR Review Agent — 画面モックアップ (Issue #243)"
Cohesion: 0.29
Nodes (6): PR Review Agent — 画面モックアップ (Issue #243), 動作確認したい場合, 状態の保持, 画面一覧, 設計判断：静的HTML＋依存ゼロで構成した理由, 開き方

### Community 222 - "A2A API 実装プラン"
Cohesion: 0.29
Nodes (7): A2A API 実装プラン, Context, アーキテクチャ上の重要な選択, 停止条件, 実装フロー, 検証対象 PR, 環境変数・.env ファイル

### Community 225 - "a2a-server/src/config.ts"
Cohesion: 0.43
Nodes (5): loadServerSettingsFromEnv(), parseOptionalNumber(), parseProviderType(), ProviderType, ServerSettings

### Community 226 - "Defining Dependency Providers"
Cohesion: 0.29
Nodes (6): Automatic Provision, Defining Dependency Providers, InjectionToken, Library Pattern: `provide*` functions, Manual Provision, Scopes of Providers

### Community 227 - "Environment configuration"
Cohesion: 0.29
Nodes (6): Build-time configuration, Choosing a strategy, Configuration strategies, Environment configuration, Example, Runtime configuration (advanced)

### Community 228 - "Navigate to Routes"
Cohesion: 0.29
Nodes (6): Declarative Navigation (`RouterLink`), Navigate to Routes, Programmatic Navigation (`Router`), `router.navigate()`, `router.navigateByUrl()`, URL Parameters

### Community 229 - "Route Transition Animations"
Cohesion: 0.29
Nodes (6): Advanced Control, Best Practices, Customizing with CSS, Enabling View Transitions, How it Works, Route Transition Animations

### Community 230 - "Route Guards"
Cohesion: 0.29
Nodes (6): Applying Guards, Creating a Guard, Return Values, Route Guards, Security Note, Types of Guards

### Community 231 - "Show Routes with Outlets"
Cohesion: 0.29
Nodes (6): Basic Usage, Named Outlets (Secondary Routes), Nested Outlets, Outlet Lifecycle Events, Passing Data via `routerOutletData`, Show Routes with Outlets

### Community 232 - "Performance checks"
Cohesion: 0.29
Nodes (7): Bundle size, Contents, Image optimization, Issue format, List virtualization, Memoization opportunity, Performance checks

### Community 233 - "1. Eliminating Waterfalls"
Cohesion: 0.29
Nodes (7): 1.1 Check Cheap Conditions Before Async Flags, 1.2 Defer Await Until Needed, 1.3 Dependency-Based Parallelization, 1.4 Prevent Waterfall Chains in API Routes, 1.5 Promise.all() for Independent Operations, 1.6 Strategic Suspense Boundaries, 1. Eliminating Waterfalls

### Community 234 - "2. Bundle Size Optimization"
Cohesion: 0.29
Nodes (7): 2.1 Avoid Barrel File Imports, 2.2 Conditional Module Loading, 2.3 Defer Non-Critical Third-Party Libraries, 2.4 Dynamic Imports for Heavy Components, 2.5 Prefer Statically Analyzable Paths, 2.6 Preload Based on User Intent, 2. Bundle Size Optimization

### Community 235 - "10. 検証手順"
Cohesion: 0.33
Nodes (6): 10.1 ローカル起動, 10.2 AgentCard 確認, 10.3 フルワークフロー（Orchestrator）の検証, 10.4 Ollama 切り替えテスト, 10.5 既存テストの通過確認, 10. 検証手順

### Community 236 - "4. 各エージェントの AgentCard 定義"
Cohesion: 0.33
Nodes (6): 4.1 PR Info Collector, 4.2 React Code Reviewer, 4.3 Security Reviewer, 4.4 Lead Engineer, 4.5 Orchestrator（フルワークフロー）, 4. 各エージェントの AgentCard 定義

### Community 237 - "8. Phase 2生成プロンプトの改善"
Cohesion: 0.33
Nodes (6): 8.1 事象と非開発者向け要約, 8.2 原因分析, 8.3 対応方針: プロンプトへ事後検証制約を明示 (自己完結性の原則の継続), 8.4 検証観点, 8.5 残る限界, 8. Phase 2生成プロンプトの改善

### Community 238 - "Worktree Plugin Progress Notification Specification"
Cohesion: 0.33
Nodes (4): Worktree Plugin Progress Notification: Verification Plan, Background, Requirements, Worktree Plugin Progress Notification Specification

### Community 240 - "Side Effects with `effect` and `afterRenderEffect`"
Cohesion: 0.33
Nodes (5): Basic Usage, DOM Manipulation with `afterRenderEffect`, Render Phases, Side Effects with `effect` and `afterRenderEffect`, When to use `effect`

### Community 241 - "Hierarchical Injectors"
Cohesion: 0.33
Nodes (5): Hierarchical Injectors, `providers` vs `viewProviders`, Resolution Modifiers, Resolution Rules, Types of Injector Hierarchies

### Community 242 - "Component Host Elements"
Cohesion: 0.33
Nodes (5): Binding Collisions, Binding to the Host Element, Component Host Elements, Injecting Host Attributes, Legacy Decorators

### Community 243 - "Router Lifecycle and Events"
Cohesion: 0.33
Nodes (5): Common Router Events (Chronological), Common Use Cases, Debugging, Router Lifecycle and Events, Subscribing to Events

### Community 244 - "Sections"
Cohesion: 0.33
Nodes (5): 1. Component Architecture (architecture), 2. State Management (state), 3. Implementation Patterns (patterns), 4. React 19 APIs (react19), Sections

### Community 245 - "React Best Practices"
Cohesion: 0.33
Nodes (5): Creating a New Rule, Getting Started, React Best Practices, Rule File Structure, Structure

### Community 246 - "lead-engineer.evaluate.test.ts"
Cohesion: 0.33
Nodes (4): CONFIG, { mockAgentCtor, mockInvoke, mockCreateModelProvider }, ReviewerConfig, ReviewReport

### Community 247 - "verify-coderabbit-filters.mjs"
Cohesion: 0.53
Nodes (5): EXPECTATIONS, globToRegExp(), main(), parsePathFilters(), resolveFilter()

### Community 248 - "Memory Maintenance"
Cohesion: 0.33
Nodes (5): Add/update threshold, Discovery Model, Maintenance Actions, Memory Maintenance, Style

### Community 251 - "1. 背景と問題"
Cohesion: 0.40
Nodes (5): 1.1 発覚した事象, 1.2 直接原因: `inject_patch()` の挿入位置ロジック, 1.3 副次的原因: `language_snippets` 未定義によるランタイム不整合, 1.4 制約: 入力はunified diff patchのみ, 1. 背景と問題

### Community 252 - "Seeded set生成: mutation注入ロジック 要件と設計ドキュメント"
Cohesion: 0.40
Nodes (5): 2. 要件: mutation注入ロジックが満たすべき性質, 4. 対象外, 5. 検証観点 (実装時のテスト方針), 6. 今後の進め方, Seeded set生成: mutation注入ロジック 要件と設計ドキュメント

### Community 253 - "3.1 Phase 1: 決定論的改善 (即座に着手可能) — 実装済み (Issue #111)"
Cohesion: 0.40
Nodes (5): 3.1.1 `language_snippets` の必須化 (R7), 3.1.2 挿入位置ヒューリスティックの改善 (R1・R3の部分対応), 3.1.3 限界, 3.1 Phase 1: 決定論的改善 (即座に着手可能) — 実装済み (Issue #111), 3. ハイブリッド設計

### Community 254 - "ModelProviderFactory によるOllamaネイティブ対応 実装計画 (Issue #214)"
Cohesion: 0.40
Nodes (4): ModelProviderFactory によるOllamaネイティブ対応 実装計画 (Issue #214), テスト方針(TDD), 変更ファイル一覧（Python版・完了済み。TS移植は `packages/agent-core/src/agents/model-provider-factory.ts` として完了済み）, 検証計画

### Community 255 - "Injection Context"
Cohesion: 0.40
Nodes (4): `assertInInjectionContext`, Injection Context, `runInInjectionContext`, Where is an Injection Context Available?

### Community 256 - "Dependent State with `linkedSignal`"
Cohesion: 0.40
Nodes (4): Advanced Usage: Accounting for Previous State, Basic Usage, Dependent State with `linkedSignal`, When to use `linkedSignal` vs `computed` vs `effect`

### Community 257 - "Automatic Migrations & Code Modernization"
Cohesion: 0.40
Nodes (4): Automatic Migrations & Code Modernization, Common Migration Schematics, Discovering Migrations, Specialized Workflow: Migrating to Standalone

### Community 258 - "Testing Fundamentals"
Cohesion: 0.40
Nodes (4): Basic Test Structure Example, Core Philosophy: Zoneless & Async-First, TestBed and ComponentFixture, Testing Fundamentals

### Community 259 - "Passing snippets to components"
Cohesion: 0.40
Nodes (5): Explicit props, Implicit `children` snippet, Implicit props, Optional snippet props, Passing snippets to components

### Community 260 - "8. Advanced Patterns"
Cohesion: 0.40
Nodes (5): 8.1 Do Not Put Effect Events in Dependency Arrays, 8.2 Initialize App Once, Not Per Mount, 8.3 Store Event Handlers in Refs, 8.4 useEffectEvent for Stable Callback Refs, 8. Advanced Patterns

### Community 262 - "Review Persistence API (OpenAPI)"
Cohesion: 0.50
Nodes (3): Review Persistence API (OpenAPI), ファイル, 検証

### Community 263 - "5. FastAPI アプリケーション構成"
Cohesion: 0.50
Nodes (4): 5.1 `api/app.py`, 5.2 エンドポイント共通テンプレート, 5.3 `__init__.py` の `main()` 変更, 5. FastAPI アプリケーション構成

### Community 264 - "7.4 対応方針"
Cohesion: 0.50
Nodes (4): 7.4.1 V2 (`verify_only_additions_changed`) への対応: 構造的原因には手を入れない, 7.4.2 カタログ改訂: `frontend_n_plus_one_api` / `b2b2c_idor_hint`を自己完結化, 7.4.3 カタログバリデーションの追加 (再発防止), 7.4 対応方針

### Community 265 - "serena"
Cohesion: 0.50
Nodes (3): uvx, serena, start-mcp-server

### Community 272 - "Prefer Statically Analyzable Paths"
Cohesion: 0.50
Nodes (3): File-System Paths, Import Paths, Prefer Statically Analyzable Paths

### Community 274 - "model-provider-spike.ts"
Cohesion: 0.50
Nodes (3): ollamaModel, ollamaProvider, openaiCompatModel

### Community 275 - "Agent Architecture"
Cohesion: 0.50
Nodes (3): Agent Architecture, Layering, Reviewer plugin pattern (`packages/agent-core/src/agents/registry.ts` + `base-reviewer.ts`)

### Community 276 - "2. A2A プロトコル実装仕様"
Cohesion: 0.67
Nodes (3): 2.1 Pydantic モデル（`src/code_review_agent/a2a/models.py`）, 2.2 TaskStore（`src/code_review_agent/a2a/task_store.py`）, 2. A2A プロトコル実装仕様

## Knowledge Gaps
- **2267 isolated node(s):** `uvx`, `start-mcp-server`, `$schema`, `root`, `packages/**` (+2262 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **93 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Seeded set生成: 専用Seedリポジトリ方式 設計ドキュメント` connect `Seeded set生成: 専用Seedリポジトリ方式 設計ドキュメント` to `EVALUATION_PLAN.md`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `main()` connect `discover-candidate-prs.ts` to `pr-info-collector.ts`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **What connects `uvx`, `start-mcp-server`, `$schema` to the rest of the system?**
  _2267 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `discover-candidate-prs.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06997408367271381 - nodes in this community are weakly interconnected._
- **Should `a2a/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1349527665317139 - nodes in this community are weakly interconnected._
- **Should `reviewer-runtime.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08650937689050212 - nodes in this community are weakly interconnected._
- **Should `models/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.145748987854251 - nodes in this community are weakly interconnected._