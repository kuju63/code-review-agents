# Graph Report - code-review-agent  (2026-08-15)

## Corpus Check
- 533 files · ~330,966 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 5320 nodes · 9816 edges · 438 communities (318 shown, 120 thin omitted)
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 1255 edges (avg confidence: 0.58)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a0840c30`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- make_finding
- ReviewerConfig
- ReviewPerspective
- reviewer-runtime.ts
- A2ADataPart
- ._agent
- setup_logging
- TaskStore
- models/index.ts
- PRInfoResult
- Settings
- api_get
- _make_mcp
- required
- get_reviewer_classes
- A2A API 設計ドキュメント
- GitHubClient
- create_github_mcp_client
- _IsolatedSettings
- collect_direct_package_names
- TestPRInfoCollectorCollect
- has_production_code_change
- sanitize_error
- run_agent_evaluation.py
- OllamaUnsupportedContentSanitizer
- datetime
- detect_project_types
- Seeded set生成: 専用Seedリポジトリ方式 設計ドキュメント
- select_stack_targets.py
- build_seeded_set.py
- test_discover_candidate_prs.py
- generate_evaluation_report.py
- properties
- wait_for_task_completed
- Next.js checks
- properties
- Ollamaバックエンドが処理できないツール結果コンテンツ型の除去 設計ドキュメント
- Signal Forms
- Any
- properties
- write_jsonl
- package.json
- tests/agents/test_pr_info_collector.py
- MCP接続の安定化 設計ドキュメント (Issue #115)
- ReviewResult
- enum
- test_run_agent_evaluation_shard.py
- create_app
- test_run_agent_evaluation.py
- _build_report
- properties
- required
- make_raw_finding
- What You Must Do When Invoked
- What You Must Do When Invoked
- test_discord_notify.py
- object
- TestProductionCodeCriteria
- create_agent_skills
- required
- 位置情報欠落によるfinding/decisionのサイレントドロップ: 可視化と緩和 設計ドキュメント
- build_target
- 評価パイプライン: 構造化ロギングへの移行 設計ドキュメント
- enum
- ModelProviderFactory によるOllamaネイティブ対応 設計ドキュメント (Issue #214)
- _context
- a2a/index.ts
- review-orchestrator.ts
- required
- has_review_comments
- ReviewError
- orchestrator.service.ts
- Code Review Agent
- TestLeadEngineerAgentEvaluate
- A2ATask
- verify_github_token
- 2. 設計方針
- TestAgentSkillType
- Seeded評価を`/orchestrator`単一呼び出しへ統合する 設計ドキュメント
- Worktree Plugin Progress Notification Specification
- TestSvelteReviewer
- 2. 要検討事項（比較表 + 採用/却下理由）
- renovate.json
- test_generate_evaluation_report.py
- analyze_pr_collector_repeated.py
- ._client
- TestExtractHeadRef
- TestExtractLabelNames
- models/test_lead_engineer.py
- LLM生成パラメータの安全弁(max_tokens / frequency_penalty) 設計ドキュメント (Issue #208)
- Lead Engineer Agent 設計
- 評価パイプラインのshard分割実行 設計ドキュメント
- make_gold_item_row
- serena
- test_exceptions.py
- test_container_build.py
- run_evaluation_pipeline.sh
- graphify.js
- remove-worktree.sh
- setup-worktree.sh
- code_review_agent/a2a/__init__.py
- Review-Agent ワークフロー仕様
- code_review_agent/api/__init__.py
- tests/tools/__init__.py
- code-review-agent
- Code Review Agent Evaluation Plan
- angular-developer/SKILL.md
- 01 Injection (Confusing Data with Instructions)
- test_lead_engineer_router.py
- 3. 比較対象アプローチ
- JavaScript checks
- PR Info Collector ツール呼び出し修正 設計ドキュメント
- build_gold_set.py
- Seeded評価のスタック別レビュアールーティング仕様
- Angular Aria
- 02 Authentication & Authorization (Confusing Identity with Permission)
- 開発環境の初期セットアップ
- 09 Insecure Design (When Correct Code Implements a Flawed Design)
- React Composition Patterns
- ADR-0001: 大規模PRのレビュー除外方針
- Svelte Agent Skills Review Accuracy Spec
- 5. Re-render Optimization
- 05 Secrets Exposure (Underestimating Where Data Can Reach)
- 08 Configuration & Environment (The Gap Between "Works" and "Works Safely")
- 10 Software Integrity Failures (Trusting Without Verifying)
- 11 SSRF & Security Logging (Invisible Requests and Invisible Attacks)
- 12 Exception Handling Failures (When Error Paths Are Not Designed)
- 7. JavaScript Performance
- Quick Reference
- React/Angular Agent Skills Review Accuracy Spec
- 並列レビュー段 拡張アーキテクチャ設計
- 2. 修正方針
- 04 Software Supply Chain (The Chain of Trust and Its Blind Spots)
- Svelte Review Guidelines
- run-evaluation スキル
- PR Info Collector 正確性検証レポート（20回統計分析）
- required
- 実装フロー（プロジェクト標準 TDD フロー準拠）
- 2. Advanced CSS Animations
- Frontend PR Review Agent — System Prompt
- 03 CSRF / CORS (Request Origin and Intent Verification)
- svelte-core-bestpractices/SKILL.md
- Coding Agent Guide
- Evaluation Toolkit
- Evaluation Runbook
- 06 Security Headers & CSP (The Precision of Browser Instructions)
- 07 File Upload & Path Traversal (The Dual Nature of Files)
- 6. Rendering Performance
- Contributing Guide
- ADR-0004: MCPクライアントのセッション共有(レビュアー間)
- ADR-0006: 指摘単位の severity / impact / priority 評価方式
- 評価パイプライン設計: データ生成から実行まで
- enum
- Component Styling
- Angular Review Guidelines
- Svelte checks
- reviewing-web-security/SKILL.md
- React Composition Patterns
- 3. Server-Side Performance
- ADR-0003: MCP起動リトライ戦略
- 9. fallback率30%未満の目標に対する構造的対応 (プロンプトのみでは不足)
- GitHub MCP `streamable_http_client` 移行 設計ドキュメント
- Red Hat Hardened Image への base image 変更 spec
- PR Info Collector 正確性検証レポート（20回統計分析）
- Components
- Angular CLI MCP Server
- Template-Driven Forms
- Angular checks
- React checks
- Vue.js checks
- React Composition Patterns
- React Best Practices
- Sections
- ADR-0005: スタック別 Gold-set ターゲット選定の正規経路化
- _sanitize_cell
- docstring lint方針 設計ドキュメント
- 評価レポートへの個別PR詳細（Human Review vs Agent指摘）追加 設計ドキュメント
- 7. Phase 2運用後に判明した問題 (Issue #131)
- Seeded set生成: (ファイル, ルール)組み合わせ重複 修正 設計ドキュメント
- SkillSource
- スタック別 Gold-set ターゲット選定仕様
- Review Matching Rubric
- graphify reference: extra exports and benchmark
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
- a2a-server/package.json
- graphify reference: extra exports and benchmark
- 3.2 Phase 2: LLM推論 + 決定論的事後検証
- pull_request_template.md
- TestLeadEngineerReport
- Suggested Commands
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
- ADR-0002: ワークフロー外部化(LangFlow/Dify)の検討
- must_find
- enum
- Defining Dependency Providers
- Environment configuration
- Navigate to Routes
- pr-info-collector.ts
- Route Transition Animations
- Route Guards
- Show Routes with Outlets
- Performance checks
- 1. Eliminating Waterfalls
- 2. Bundle Size Optimization
- 8. Phase 2生成プロンプトの改善
- TestAnnotatePatch
- graphify reference: query, path, explain
- Memory Maintenance
- Side Effects with `effect` and `afterRenderEffect`
- Hierarchical Injectors
- Component Host Elements
- Router Lifecycle and Events
- Sections
- React Best Practices
- graphify reference: query, path, explain
- 1. 背景と問題
- Seeded set生成: mutation注入ロジック 要件と設計ドキュメント
- 3.1 Phase 1: 決定論的改善 (即座に着手可能) — 実装済み (Issue #111)
- test_build_seeded_set.py
- Dependent State with `linkedSignal`
- Testing Fundamentals
- Passing snippets to components
- 8. Advanced Patterns
- detect_intentional_markers
- 7.4 対応方針
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- graphify reference: incremental update and cluster-only
- Agent Architecture
- async-cheap-condition-before-await.md
- Prefer Statically Analyzable Paths
- server-hoist-static-io.md
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- Code Review Agent — Core Map
- .opencode/skills/graphify/references/extraction-spec.md
- conventions.md
- task_completion.md
- tech_stack.md
- enum
- base-reviewer.ts
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
- within_change_limits
- manifest-detection.ts
- discover_candidate_prs.py
- opencode.json
- worktree.js
- TestLoadFailedIds
- _seeded_heading
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- TestStructuredOutputDirective
- _gold_heading
- graphify reference: incremental update and cluster-only
- biome.json
- common.sh
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- .claude/CLAUDE.md
- .claude/skills/graphify/references/extraction-spec.md
- test_eval_logging.py
- a2a/request.model.ts
- TypeScript開発環境・ツールチェーン整備 設計ドキュメント (Issue #250)
- TestValidateShardArgs
- A2A API 実装プラン
- pr-info-collector.test.ts
- fetch_pr_files
- resolve_defect_line
- a2a_poll
- agent-core/package.json
- compilerOptions
- 2. 要検討事項（比較表 + 採用/却下理由）
- agent-skills-factory.ts
- health/index.ts
- lead-engineer.service.ts
- base-reviewer.review.test.ts
- agent-core/tsconfig.json
- evaluation/tsconfig.json
- tool-result-sanitizer.ts
- A2ASendTaskRequest
- compilerOptions
- evaluation/package.json
- lead-engineer.evaluate.test.ts
- TestCreateAgentSkills
- model-provider-spike.ts
- test_vue_reviewer.py
- 指摘単位3軸評価仕様 (Issue #168)
- ._resolve_decisions
- tsconfig.json
- github-mcp.test.ts
- TestAngularReview
- 12. セキュリティ設計
- 6. 環境変数リファレンス
- revalidate_existing_targets
- TestLoadTargets
- TestSvelteReview
- TestIsAllowedUrl
- TestRestrictedRedirectHandler
- 10. 検証手順
- 13. TypeScript/Zod モデル移行仕様
- 4. 各エージェントの AgentCard 定義
- parse_hunk_new_start
- test_build_gold_set.py
- TestReactReview
- 1. 概要
- 5. FastAPI アプリケーション構成
- Injection Context
- Automatic Migrations & Code Modernization
- 9. 既存コードの変更点
- test_svelte_reviewer.py
- reviewers.route.ts
- verify_a2a_api.py
- load_eval_tool_module
- TestErrorPropagation
- TestFindingDecisionOutput
- ._build_model
- .test_no_hallucination_paths_are_verbatim_from_mcp
- .__init__
- .__init__
- .__init__
- .__init__
- .test_paginates_changed_files

## God Nodes (most connected - your core abstractions)
1. `ReviewerConfig` - 106 edges
2. `PRInfoResult` - 94 edges
3. `ReviewPerspective` - 89 edges
4. `Settings` - 80 edges
5. `PRInfo` - 79 edges
6. `ReviewResult` - 79 edges
7. `RepositoryInfo` - 78 edges
8. `ReviewOutput` - 77 edges
9. `TaskStore` - 69 edges
10. `ProjectType` - 62 edges

## Surprising Connections (you probably didn't know these)
- `SemanticMatchVerdict` --uses--> `ProviderType`  [INFERRED]
  evaluation/tools/score_evaluation.py → src/code_review_agent/agents/model_provider_factory.py
- `Finding` --uses--> `ProviderType`  [INFERRED]
  evaluation/tools/score_evaluation.py → src/code_review_agent/agents/model_provider_factory.py
- `MatchedPair` --uses--> `ProviderType`  [INFERRED]
  evaluation/tools/score_evaluation.py → src/code_review_agent/agents/model_provider_factory.py
- `MatchResult` --uses--> `ProviderType`  [INFERRED]
  evaluation/tools/score_evaluation.py → src/code_review_agent/agents/model_provider_factory.py
- `TestA2AMessage` --uses--> `A2ATaskStatus`  [INFERRED]
  tests/a2a/test_models.py → src/code_review_agent/a2a/models.py

## Import Cycles
- None detected.

## Communities (438 total, 120 thin omitted)

### Community 0 - "make_finding"
Cohesion: 0.06
Nodes (37): _build_item_detail(), _exact_match(), Finding, is_match(), main(), make_llm_semantic_judge(), match_findings(), match_findings_detailed() (+29 more)

### Community 1 - "ReviewerConfig"
Cohesion: 0.06
Nodes (61): ReviewOutput, RuntimeError, Shared runtime configuration injected into each reviewer. Attributes:…, ReviewerConfig, Raised when an LLM agent call ends without a structured output result. Strands…, Build the error message from which agent failed and why it stopped. Args:…, StructuredOutputMissingError, ProviderType (+53 more)

### Community 2 - "ReviewPerspective"
Cohesion: 0.06
Nodes (69): ABC, _ReviewerT, LLMReviewAgent, Base classes for review agents in the parallel review stage. Defines the…, Interface for a reviewer in the parallel review stage. Subclasses declare their…, LLM-backed reviewer using a Strands ``Agent`` and GitHub MCP. Concrete…, ReviewAgent, Shared exception types for the review-stage and lead-engineer agents. (+61 more)

### Community 3 - "reviewer-runtime.ts"
Cohesion: 0.08
Nodes (38): app, AgentSkill, createAngularReviewerRoute(), AngularReviewerServiceOptions, createAngularReviewerService(), createReactReviewerRoute(), createReactReviewerService(), ReactReviewerServiceOptions (+30 more)

### Community 4 - "A2ADataPart"
Cohesion: 0.09
Nodes (49): A2AMessage, A2ADataPart, A2AMessage, A2ASendTaskRequest, A2ASendTaskResponse, A2ATask, A2ATextPart, AgentCapability (+41 more)

### Community 5 - "._agent"
Cohesion: 0.15
Nodes (13): FindingDecisionOutput, LLM output schema for one finding decision. Uses a finding_index reference…, _make_config(), _make_finding(), _make_result(), ReviewFinding, ReviewPerspective, ReviewPriority (+5 more)

### Community 6 - "setup_logging"
Cohesion: 0.21
Nodes (12): Shared logging configuration for evaluation/tools scripts., Configure the root logger for evaluation/tools scripts. Deliberately omits…, setup_logging(), _failed_ids_path(), main(), merge(), Any, Path (+4 more)

### Community 7 - "TaskStore"
Cohesion: 0.08
Nodes (27): LogCaptureFixture, A2ATaskStatus, StrEnum, Lifecycle state of an :class:`A2ATask`., A2ATask, Tracks :class:`A2ATask` lifecycle in memory, guarded by a single asyncio lock.…, Initialize an empty task store., Create and store a new task in the ``SUBMITTED`` state. Returns: The newly… (+19 more)

### Community 8 - "models/index.ts"
Cohesion: 0.11
Nodes (40): buildPromptAndIndex(), IndexEntry, LeadEngineerAgent, resolveDecisions(), acceptedDecisions(), byVerdict(), DecisionVerdict, EvaluationFormat (+32 more)

### Community 9 - "PRInfoResult"
Cohesion: 0.06
Nodes (38): PRInfoResult, Collect PR information from GitHub and return structured data. Connects to the…, FileChange, PRInfo, PRInfoResult, BaseModel, Diff information for a single changed file. Attributes: filePath: Relative path…, Pull request metadata and file changes. Attributes: title: PR title. pr_number:… (+30 more)

### Community 10 - "Settings"
Cohesion: 0.12
Nodes (21): BaseSettings, orchestrator_router(), APIRouter, TaskStore, Build the A2A-compatible router that drives the end-to-end review pipeline.…, _run(), pr_info_collector_router(), APIRouter (+13 more)

### Community 11 - "api_get"
Cohesion: 0.21
Nodes (9): api_get(), GET a GitHub REST API URL and return the parsed JSON body. Only…, _http_error(), HTTPError, Tests for evaluation/tools/github_api.py (Issue #224). Covers api_get's…, _response(), _side_effect_sequence(), TestApiGetRetry (+1 more)

### Community 12 - "_make_mcp"
Cohesion: 0.05
Nodes (29): _make_mcp(), PRInfoResult, Only the first _MAX_WORKSPACE_PACKAGES (20) resolved workspace directories have…, Yarn-style `{"workspaces": {"packages": [...]}}` is also read., A workspace directory whose package.json 404s is skipped, not fatal., Build a mock MCP client whose call_tool_sync dispatches by arguments. Returns:…, dependency_files reflect the repo's manifests at the PR head ref, not only the…, The root listing is pinned to the PR head SHA. (+21 more)

### Community 13 - "required"
Cohesion: 0.05
Nodes (42): description, items, minItems, type, description, $id, properties, required (+34 more)

### Community 14 - "get_reviewer_classes"
Cohesion: 0.10
Nodes (13): get_registered_reviewers(), get_reviewer_classes(), ProjectType, ReviewAgent, ReviewPerspective, Return a copy of all registered reviewer classes. Returns: A shallow copy of…, Select reviewer classes applicable to a project type. Args: project_type: The…, get_reviewer_classes routes NEXTJS/NUXT to the base framework's reviewers,… (+5 more)

### Community 15 - "A2A API 設計ドキュメント"
Cohesion: 0.20
Nodes (10): 11. 関連ドキュメント, 2.1 Pydantic モデル（`src/code_review_agent/a2a/models.py`）, 2.2 TaskStore（`src/code_review_agent/a2a/task_store.py`）, 2. A2A プロトコル実装仕様, 3.1 LangFlow ワークフロー → A2A API マッピング, 3.2 ディレクトリ構造（新規追加分）, 3. 全体アーキテクチャ, 7. `api/config.py` 実装仕様 (+2 more)

### Community 16 - "GitHubClient"
Cohesion: 0.14
Nodes (13): GitHubClient, Any, Fetch JSON data from a GitHub API path, retrying rate-limited requests up to…, Fetch repository metadata from GitHub. Parameters: repo (str): The repository…, Fetches releases for a repository. Parameters: repo (str): The repository name…, Return commit dates for the repository's most recent tags. Parameters: repo…, Fetches details for a pull request. Parameters: repo (str): Repository name in…, Collect merged pull requests updated on or after the specified timestamp.… (+5 more)

### Community 17 - "create_github_mcp_client"
Cohesion: 0.07
Nodes (28): _MCPStreams, MCPClient, ProjectType, ReviewAgent, ReviewContext, ReviewPerspective, ReviewReport, ReviewResult (+20 more)

### Community 18 - "_IsolatedSettings"
Cohesion: 0.10
Nodes (9): MonkeyPatch, PydanticBaseSettingsSource, clean_env(), _IsolatedSettings, fixture, Settings subclass for unit tests — skips .env file loading., TestResolveAgentUrl, TestSettingsDefaults (+1 more)

### Community 19 - "collect_direct_package_names"
Cohesion: 0.09
Nodes (12): collect_direct_package_names(), extract_direct_dependencies_from_package_json(), extract_direct_dependencies_from_package_lock(), extract_direct_dependencies_from_pnpm_lock(), Aggregate direct dependency names across all collected manifests.…, Extract direct dependency names from a ``package.json`` body. Args: content:…, Extract the root project's direct dependency names from ``package-lock.json``.…, Extract the root project's direct dependency names from ``pnpm-lock.yaml``.… (+4 more)

### Community 20 - "TestPRInfoCollectorCollect"
Cohesion: 0.12
Nodes (11): PRInfoCollector, Collects PR information from GitHub deterministically. Retrieves PR details and…, patch=None for all files when target-file count exceeds the limit., Tests for the deterministic collect() method., If the summary LLM raises, facts are kept and summary is empty., An infra exception from the summary LLM must not be swallowed into an empty…, If start() fails, stop() must still run (start() is inside try)., _summarize_readme passes limits={"turns": 30} by default. (+3 more)

### Community 21 - "has_production_code_change"
Cohesion: 0.11
Nodes (19): _is_target_file(), has_inline_review_comments(), has_production_code_change(), is_doc_file(), is_production_code_file(), is_qualifying_inline_comment(), is_test_file(), _normalized_path() (+11 more)

### Community 22 - "sanitize_error"
Cohesion: 0.11
Nodes (16): BaseException, Remove token-like strings from exception messages to prevent credential…, sanitize_error(), TaskStore, _run(), TaskStore, _run(), TaskStore (+8 more)

### Community 23 - "run_agent_evaluation.py"
Cohesion: 0.14
Nodes (28): _convert_ts_field_names(), _evaluate_concurrently(), evaluate_item(), _failed_ids_path(), _get_commit_hash(), _is_sharded(), main(), _maybe_generate_report() (+20 more)

### Community 24 - "OllamaUnsupportedContentSanitizer"
Cohesion: 0.06
Nodes (27): HookProvider, HookRegistry, ProjectType, ReviewContext, ReviewResult, Review the change described by ``context``. Args: context: Input boundary…, Run this reviewer's Strands ``Agent`` against ``context`` and collect its…, Serialize the review-relevant PR information into a prompt. Shared by every LLM… (+19 more)

### Community 25 - "datetime"
Cohesion: 0.19
Nodes (12): datetime, has_recent_release(), _parse_iso(), Parse an ISO 8601 timestamp. Parameters: value (str): The timestamp string to…, Determine whether a repository has released within the specified time window.…, Validate a repository's availability, archive status, star count, and recent…, validate_repo(), _fake_client() (+4 more)

### Community 26 - "detect_project_types"
Cohesion: 0.06
Nodes (26): detect_project_type_from_packages(), ProjectType, Resolve a single :class:`ProjectType` from a set of direct dependency names.…, detect_project_types(), _matches_manifest(), _matches_manifest_name(), PRInfoResult, Return True when any path in ``paths`` matches manifest ``name``. Args: paths:… (+18 more)

### Community 27 - "Seeded set生成: 専用Seedリポジトリ方式 設計ドキュメント"
Cohesion: 0.09
Nodes (23): 10. 移行チェックリスト・作業順序, 11. 対象外, 1. 背景と問題, 2.1 Angular (`kuju63/angular-seeded`), 2.2 React (`kuju63/react-seeded`), 2.3 Svelte (`kuju63/svelte-seeded`), 2.4 Vue (`kuju63/vue-seeded`), 2. 対象Seedリポジトリと59件のPR (+15 more)

### Community 28 - "select_stack_targets.py"
Cohesion: 0.07
Nodes (38): allocate_quota(), check_coverage_thresholds(), dedupe_rows(), filter_rows(), load_targets(), main(), parse_csv_arg(), Any (+30 more)

### Community 29 - "build_seeded_set.py"
Cohesion: 0.21
Nodes (14): build_seeded_item(), Defect, load_targets(), main(), _parse_pr_filter(), _print_markers(), Any, One hand-authored must_find record for a Seed PR. Attributes: path: File path… (+6 more)

### Community 30 - "test_discover_candidate_prs.py"
Cohesion: 0.10
Nodes (13): collect_review_texts(), make_llm_assessor(), BaseModel, Structured 3-axis assessment of a PR's review findings. The three axes are…, Build an assessor that classifies pull requests across severity, impact, and…, Aggregate non-blank inline comment and review bodies (any author). Returns: The…, ReviewAssessment, ReviewAssessor (+5 more)

### Community 31 - "generate_evaluation_report.py"
Cohesion: 0.16
Nodes (20): build_notification_payload(), Any, Path, Discord Webhook notification for evaluation pipeline completion. Fires once per…, Build a Discord Webhook embed payload summarizing an evaluation run. Returns: A…, POST *payload* to the Discord webhook. No-ops when *webhook_url* is unset.…, send_discord_notification(), _failed_ids_path() (+12 more)

### Community 32 - "properties"
Cohesion: 0.17
Nodes (12): properties, minimum, type, type, type, line, patch, path (+4 more)

### Community 33 - "wait_for_task_completed"
Cohesion: 0.09
Nodes (21): A2ATask, TaskStore, Shared async test helpers for the A2A reviewer router test suites., Poll ``store`` until ``task_id`` leaves the WORKING/SUBMITTED state. The…, wait_for_task_completed(), _make_app(), _pr_info_payload(), asyncio (+13 more)

### Community 34 - "Next.js checks"
Cohesion: 0.05
Nodes (39): Cache / revalidation intent, Contents, Context7 trigger examples, Data fetching location, Environment variables, Issue format, Middleware matcher, next/image dimensions (+31 more)

### Community 35 - "properties"
Cohesion: 0.12
Nodes (16): type, type, items, type, minimum, type, properties, body (+8 more)

### Community 36 - "Ollamaバックエンドが処理できないツール結果コンテンツ型の除去 設計ドキュメント"
Cohesion: 0.11
Nodes (19): 1.1 発生した事象, 1.2 根本原因, 1.3 「特定PRでだけ起きる」理由, 1.4 将来の拡張との関係, 1. 背景と問題, 2.1 `file_read`のTOOL_SPECをラップして`mode="document"`の選択肢を消す, 2.2 `BeforeModelCallEvent`で会話履歴(`messages`)を書き換える, 2. 却下した設計 (+11 more)

### Community 37 - "Signal Forms"
Cohesion: 0.06
Nodes (34): Accessing State, Async Validation, Big Form Example, Binding, Common Pitfalls (DO NOT DO THESE), Conditional Validation, Context, Creating a Form (+26 more)

### Community 38 - "Any"
Cohesion: 0.13
Nodes (13): Any, Extract the text payloads from an MCP tool result. Args: result: The dict…, Fetch PR metadata (title, body, labels, number) deterministically. Returns: The…, Fetch the full changed-file list, paging until exhausted. Returns: The raw…, List the raw ``get_file_contents`` directory entries at ``path``. Shared by…, List dependency manifest files at the repo root for the given ref. Returns the…, Fetch a repository file's text content at ``ref``, or None. Shared by README,…, Resolve a root ``package.json``'s ``workspaces`` field to paths. Supports the… (+5 more)

### Community 39 - "properties"
Cohesion: 0.12
Nodes (16): description, type, angular, react, svelte, vue, minimum, type (+8 more)

### Community 40 - "write_jsonl"
Cohesion: 0.19
Nodes (10): Tests for evaluation/tools/merge_predictions.py. Merges multiple shard…, The 'allowed via --allow-missing' wording implies the flag was active; it must…, A shard killed mid-run before _write_predictions_and_sidecar ran leaves no…, TestMergeDuplicateIds, TestMergeHappyPath, TestMergeMissingShardFile, TestMergeUnaccountedIds, TestMergeUnexpectedIds (+2 more)

### Community 41 - "package.json"
Cohesion: 0.05
Nodes (38): @biomejs/biome, husky, lint-staged, openai, dependencies, ai-sdk-ollama, openai, @strands-agents/sdk (+30 more)

### Community 42 - "tests/agents/test_pr_info_collector.py"
Cohesion: 0.13
Nodes (12): is_dependency_file(), is_target_file(), Return True if the file is a dependency manifest or lock file. Args: file_path:…, Return True if the file should be included in the review. Includes…, parametrize, Tests for the deterministic PRInfoCollector agent. The collector retrieves…, Tests for PRInfoCollector initialisation., Tests for the is_target_file helper. (+4 more)

### Community 43 - "MCP接続の安定化 設計ドキュメント (Issue #115)"
Cohesion: 0.08
Nodes (26): 1. 背景と問題, 2.1 処理フロー, 2.2 接続数の変化, 2. 全体設計, 3.1 対象となる起動呼び出し箇所(ADR-0004後の構成), 3.2 バックオフ戦略・実装位置, 3.3 リトライと`ToolProviderException`ラップの関係, 3.4 `INFRA_EXCEPTIONS`への追加 (+18 more)

### Community 44 - "ReviewResult"
Cohesion: 0.07
Nodes (30): BaseModel, A reviewer's output annotated with its identity and scope. Attributes:…, Aggregated output of the parallel review stage. This is the hand-off to the…, The free-form review payload an LLM reviewer produces. This is the schema…, ReviewOutput, ReviewReport, ReviewResult, asyncio (+22 more)

### Community 45 - "enum"
Cohesion: 0.24
Nodes (11): critical, high, low, medium, enum, type, priority, severity (+3 more)

### Community 46 - "test_run_agent_evaluation_shard.py"
Cohesion: 0.09
Nodes (8): Tests for the shard-execution support added to run_agent_evaluation.py. Covers…, Invalid --shard-index/--shard-count must be reported as one of the script's…, TestFailedIdsPath, TestIsSharded, TestMainShardValidation, TestMaybeGenerateReport, TestSelectShard, TestWritePredictionsAndSidecar

### Community 47 - "create_app"
Cohesion: 0.07
Nodes (35): angular_reviewer_router(), APIRouter, Build the A2A-compatible router for the Angular Reviewer agent. Exposes the…, lead_engineer_router(), APIRouter, Build the A2A-compatible router for the Lead Engineer agent. Exposes the…, APIRouter, Build the A2A-compatible router for the React Reviewer agent. Exposes the… (+27 more)

### Community 48 - "test_run_agent_evaluation.py"
Cohesion: 0.13
Nodes (6): Tests for evaluation/tools/run_agent_evaluation.py. These tests exercise the…, Each outcome record must carry its own label so a WARNING can't visually attach…, TestCamelCaseA2AContract, TestEvaluateConcurrentlyBoundedParallelism, TestEvaluateConcurrentlyFailureIsolation, TestEvaluateConcurrentlyOrdering

### Community 49 - "_build_report"
Cohesion: 0.38
Nodes (3): _build_report(), make_scores(), TestBuildReportIntegration

### Community 50 - "properties"
Cohesion: 0.15
Nodes (13): properties, minimum, type, type, type, line, patch, path (+5 more)

### Community 51 - "required"
Cohesion: 0.25
Nodes (8): required, category, line, patch, path, rule_id, severity, summary

### Community 52 - "make_raw_finding"
Cohesion: 0.29
Nodes (6): _finding_row(), Traceability link for one finding: Gold's review-comment ``source`` URL, or…, _ref_cell(), make_raw_finding(), TestFindingRow, TestRefCell

### Community 53 - "What You Must Do When Invoked"
Cohesion: 0.08
Nodes (24): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+16 more)

### Community 54 - "What You Must Do When Invoked"
Cohesion: 0.08
Nodes (24): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+16 more)

### Community 55 - "test_discord_notify.py"
Cohesion: 0.19
Nodes (4): Tests for evaluation/tools/discord_notify.py., _scores(), TestBuildNotificationPayload, TestSendDiscordNotification

### Community 56 - "object"
Cohesion: 0.42
Nodes (4): object, evaluate_item is the single function used to evaluate both Gold and Seeded…, Regression guard for Issue #237: stack-label fail-closed validation was removed…, TestEvaluateItem

### Community 58 - "create_agent_skills"
Cohesion: 0.16
Nodes (5): AgentSkills, create_agent_skills(), Create an AgentSkills plugin for a reviewer skill bundle. Args: skill_type:…, TestVueReview, TestWebSecurityReview

### Community 59 - "required"
Cohesion: 0.17
Nodes (11): $id, file_changes, id, pr_number, repository, stack, required, $schema (+3 more)

### Community 60 - "位置情報欠落によるfinding/decisionのサイレントドロップ: 可視化と緩和 設計ドキュメント"
Cohesion: 0.12
Nodes (15): 1. 背景と根本原因, 2. 変更①: 欠落の可視化, 3. 変更②: 位置情報の転記を明示的に指示（緩和）, 4. 非対象（Non-goals）, 5. 検証方針（評価）, これは2つの別問題である, 位置情報欠落によるfinding/decisionのサイレントドロップ: 可視化と緩和 設計ドキュメント, 根本原因（1件の再現診断から再構成） (+7 more)

### Community 61 - "build_target"
Cohesion: 0.44
Nodes (4): build_target(), Evaluate a pull request against eligibility filters and classify accepted…, Create a sample repository candidate for testing. Returns: A sample repository…, TestBuildTarget

### Community 62 - "評価パイプライン: 構造化ロギングへの移行 設計ドキュメント"
Cohesion: 0.09
Nodes (21): 1. 背景と問題, 2. 修正方針, 3. テスト, 4. 検証手順, 対象外, 根本原因, 評価パイプライン: 並行実行時ログの失敗項目誤帰属 修正 設計ドキュメント, 1. 背景と問題 (+13 more)

### Community 63 - "enum"
Cohesion: 0.29
Nodes (7): enum, type, correctness, maintainability, performance, security, category

### Community 64 - "ModelProviderFactory によるOllamaネイティブ対応 設計ドキュメント (Issue #214)"
Cohesion: 0.14
Nodes (14): 1. 背景, 2. 調査済み事実(再調査不要), 3.1 新規モジュール `src/code_review_agent/agents/model_provider_factory.py`, 3.2 設定の拡張, 3.3 呼び出し元の置き換え, 3.4 評価ツールの統一, 3. 設計, 4. 依存関係 (+6 more)

### Community 65 - "_context"
Cohesion: 0.13
Nodes (14): ReviewOrchestrator, _context(), _mock_shared_client(), _orchestrator(), asyncio, ReviewContext, run() selects, executes, and aggregates reviewers., The orchestrator creates and manages one shared GitHub MCP client for the… (+6 more)

### Community 66 - "a2a/index.ts"
Cohesion: 0.16
Nodes (25): A2ASendTaskResponseSchema, A2ATaskStatus, AgentCapability, AgentCapabilitySchema, AgentCardHttpResponse, AgentCardHttpResponseSchema, AgentCardSchema, AgentSkillSchema (+17 more)

### Community 67 - "review-orchestrator.ts"
Cohesion: 0.08
Nodes (12): ReviewAgent, ReviewerClass, PlainFakeReviewer, FakeReviewer, makePrInfo(), withFiles(), ReviewOutcome, SelectedReviewer (+4 more)

### Community 68 - "required"
Cohesion: 0.15
Nodes (14): items, type, items, type, required, type, category, line (+6 more)

### Community 69 - "has_review_comments"
Cohesion: 0.33
Nodes (3): has_review_comments(), Return whether the PR has a qualifying inline review comment. Review bodies are…, TestHasReviewComments

### Community 70 - "ReviewError"
Cohesion: 0.11
Nodes (26): Lead Engineer synthesis agent. Evaluates the aggregated outputs of the parallel…, DecisionVerdict, FindingDecision, FindingImpact, FindingPriority, FindingSeverity, LeadEngineerReport, Any (+18 more)

### Community 71 - "orchestrator.service.ts"
Cohesion: 0.10
Nodes (21): A2AOrchestratorSettings, createOrchestratorService(), DEFAULT_ORCHESTRATOR_SETTINGS, extractData(), InMemoryOrchestratorTaskStore, jsonSchemaWithOptionalDefaults(), LeadEngineerAgentClass, OrchestratorAgentClass (+13 more)

### Community 72 - "Code Review Agent"
Cohesion: 0.08
Nodes (24): 0. Requirements, 1. Clone and enter workspace, 2. Create virtual environment and install package, 3. Enable Git hooks (pre-commit), 4. Build package, 5. Run application, 6. Test, 7. Lint and format (Ruff) (+16 more)

### Community 73 - "TestLeadEngineerAgentEvaluate"
Cohesion: 0.17
Nodes (14): ReviewError, LeadEngineerAgent, Evaluates parallel reviewer outputs and produces final decisions. Consumes a…, LeadEngineerOutput, Top-level LLM output schema passed to ``Agent.structured_output``. Attributes:…, _make_report(), ReviewerConfig, ReviewReport (+6 more)

### Community 74 - "A2ATask"
Cohesion: 0.09
Nodes (17): A2APart, A2ATask, A2ATaskSchema, A2AServerSettings, createPrInfoService(), DEFAULT_A2A_SERVER_SETTINGS, extractData(), InMemoryTaskStore (+9 more)

### Community 75 - "verify_github_token"
Cohesion: 0.46
Nodes (4): FastAPI dependency that authenticates a request against the GitHub API. Args:…, verify_github_token(), asyncio, TestVerifyGithubToken

### Community 76 - "2. 設計方針"
Cohesion: 0.18
Nodes (10): 1. 背景と問題, 2.1 コンテナ起動への切り替え, 2.2 環境変数の転送方式: `--env-file` を使わない理由, 2.3 `GITHUB_TOKEN` はコンテナに渡さない, 2.4 `--network=host` が必須である理由, 2.5 停止機構をSKILL.md側に一本化する, 2.6 スクリプトの配置, 2. 設計方針 (+2 more)

### Community 79 - "Seeded評価を`/orchestrator`単一呼び出しへ統合する 設計ドキュメント"
Cohesion: 0.18
Nodes (11): 1. 背景, 2. 決定, 3.1 `evaluation/tools/run_agent_evaluation.py`, 3.2 テスト — `tests/evaluation/tools/test_run_agent_evaluation.py`, 3. 実装, 4. ルーティング不一致の解消（Issue #238、旧・既知の逸脱）, 5. タイムアウト予算への影響, 6. テスト方針 (+3 more)

### Community 80 - "Worktree Plugin Progress Notification Specification"
Cohesion: 0.40
Nodes (4): Background, Requirements, Verification, Worktree Plugin Progress Notification Specification

### Community 81 - "TestSvelteReviewer"
Cohesion: 0.20
Nodes (7): LLMReviewAgent, Technical reviewer for Svelte projects., SvelteReviewer, _context(), ReviewContext, Svelte technical reviewer metadata, prompt, and non-Svelte guard., TestSvelteReviewer

### Community 82 - "2. 要検討事項（比較表 + 採用/却下理由）"
Cohesion: 0.05
Nodes (39): 0. スライス分割方針, 1. 決定済み事項（本Issue着手前に確定していたもの）, 2.1 共有GitHub MCPクライアントの参照カウント管理, 2.2 GitHub MCPクライアントの接続ライフサイクルの所有権, 2.3 GitHub MCP接続のretry実装, 2.4 `OllamaUnsupportedContentSanitizer`のフック登録方式, 2.5 GitHub MCPクライアントのtransport構築方法, 2.6 `skills/`ディレクトリの配置 (+31 more)

### Community 83 - "renovate.json"
Cohesion: 0.25
Nodes (7): config:recommended, :gitSignOff, customManagers, extends, packageRules, $schema, semanticCommits

### Community 84 - "test_generate_evaluation_report.py"
Cohesion: 0.25
Nodes (4): Tests for evaluation/tools/generate_evaluation_report.py::_build_report. Covers…, `_generate_report`'s exit-code contract: 5 (sidecar missing), 4 (scoring…, TestFailedIdsPath, TestGenerateReportExitCodes

### Community 85 - "analyze_pr_collector_repeated.py"
Cohesion: 0.38
Nodes (5): _ci95(), main(), _prf(), Normal-approx 95% CI for the mean. Returns: A ``(low, high)`` tuple of the 95%…, _title_sim()

### Community 87 - "TestExtractHeadRef"
Cohesion: 0.38
Nodes (4): _extract_head_ref(), Return the PR head commit SHA (or ref) to pin "point in time" reads. Args:…, Tests for _extract_head_ref., TestExtractHeadRef

### Community 88 - "TestExtractLabelNames"
Cohesion: 0.38
Nodes (4): _extract_label_names(), Normalise a PR ``labels`` field into a list of label name strings. The GitHub…, Tests for _extract_label_names (handles string and dict label shapes)., TestExtractLabelNames

### Community 89 - "models/test_lead_engineer.py"
Cohesion: 0.13
Nodes (10): _make_finding(), ReviewFinding, ReviewPriority, Tests for Lead Engineer stage models., Tests for the top-level LLM output schema., Tests for the resolved FindingDecision object., Tests for DecisionVerdict enum., TestDecisionVerdict (+2 more)

### Community 90 - "LLM生成パラメータの安全弁(max_tokens / frequency_penalty) 設計ドキュメント (Issue #208)"
Cohesion: 0.20
Nodes (9): 1. 背景と問題, 2. 調査済み事実(再調査不要), 3. パラメータ探索の実験結果, 4. ゴール(緩和後), 5. 設計, 6. `.env.example`, 7. スコープ外, 8. 変更ファイル一覧 (+1 more)

### Community 91 - "Lead Engineer Agent 設計"
Cohesion: 0.09
Nodes (23): 1. 役割と責務, 2. ワークフロー内の位置づけ, 3. 技術非依存設計, 4.1 `DecisionVerdict`, 4.2 `FindingDecisionOutput`（LLM 生成用）, 4.3 `LeadEngineerOutput`（LLM 生成用）, 4.4 `FindingDecision`（最終出力）, 4.5 `LeadEngineerReport`（最終出力） (+15 more)

### Community 92 - "評価パイプラインのshard分割実行 設計ドキュメント"
Cohesion: 0.20
Nodes (10): 1. 背景と問題, 2.1 3スクリプト構成への分割, 2.2 shard分割, 2.3 サーバーshutdownの制御, 2.4 failed_ids sidecarと「既知の失敗」「未回収」の区別, 2. 設計方針, 3. 対象外(今回やらないこと), 4. テスト (+2 more)

### Community 93 - "make_gold_item_row"
Cohesion: 0.42
Nodes (4): Render one Gold PR or Seeded item's matched/missed/unmatched-agent detail.…, _render_item_detail(), make_gold_item_row(), TestRenderItemDetail

### Community 94 - "serena"
Cohesion: 0.50
Nodes (3): uvx, serena, start-mcp-server

### Community 102 - "Review-Agent ワークフロー仕様"
Cohesion: 0.09
Nodes (22): 1. システム概要, 2. Agent 一覧, 3.1 Agent-IaFfm — PR Info Collector, 3.2 Agent-9uqpG — React Code Reviewer, 3.3 Agent-jnFVH — Security Analyst, 3.4 Agent-5oeZS — Lead Engineer, 3. 各 Agent の詳細仕様, 4. ワークフロー全体図 (+14 more)

### Community 115 - "Code Review Agent Evaluation Plan"
Cohesion: 0.09
Nodes (22): 1.1 Quality / Feature Requirement Goal, 1. Goals, 2.0.1 Repository Selection Criteria, 2.0.2 PR Quality Selection Criteria, 2.0.3 Population and Sampling Operation, 2.0 Domain Coverage Policy, 2.1 Gold PR Set, 2.2 Seeded Set (+14 more)

### Community 116 - "angular-developer/SKILL.md"
Cohesion: 0.11
Nodes (14): Example: Testing with a `MatButtonHarness`, Key Concepts, Testing with Component Harnesses, Using a Harness in a Unit Test, Why Use Harnesses?, Custom & Enterprise Testing Tools, End-to-End (E2E) Testing, Setting Up and Running E2E Tests (+6 more)

### Community 117 - "01 Injection (Confusing Data with Instructions)"
Cohesion: 0.10
Nodes (20): 01 Injection (Confusing Data with Instructions), Command Injection: Injecting Instructions into a Shell, Contents, Line of reasoning in code, Line of reasoning in code, Line of reasoning in code, Line of reasoning in code, Line of reasoning in code (+12 more)

### Community 118 - "test_lead_engineer_router.py"
Cohesion: 0.29
Nodes (6): _make_app(), asyncio, FastAPI, TaskStore, _send_payload(), TestGetTask

### Community 119 - "3. 比較対象アプローチ"
Cohesion: 0.10
Nodes (19): 1.1 スキル束ねの配線がPythonコードに直書きされている, 1.2 コンテンツ変更もコードと同じCIゲートを通る, 1.3 デプロイはビルド時焼き込み、ホットリロードの仕組みがない, 1.4 今回のヒアリングで確認した優先課題, 1. 背景, 2. 統一比較観点, 3. 比較対象アプローチ, 4. 比較表 (+11 more)

### Community 120 - "JavaScript checks"
Cohesion: 0.10
Nodes (17): Contents, Implicit type coercion, Issue format, JavaScript checks, Missing error handling in Promise chains, Prototype pollution risk, `var` in new code, `==` vs `===` (+9 more)

### Community 121 - "PR Info Collector ツール呼び出し修正 設計ドキュメント"
Cohesion: 0.11
Nodes (18): 1. 背景と問題, 2.1 呼び出し経路（案A: ツールループと構造化出力の分離）, 2.2 file 一覧対処（SYSTEM_PROMPT 強化）, 2.3 本タスクの範囲外, 2.5.1 案A の実測で残った2課題, 2.5.2 着眼: ファクトを LLM に生成させない, 2.5.3 採用する設計（案E: 完全決定論化）, 2.5.4 受け入れ基準の更新（案E） (+10 more)

### Community 122 - "build_gold_set.py"
Cohesion: 0.30
Nodes (10): _api_get(), build_gold_item(), _extract_line(), load_targets(), main(), _normalize_axis(), _normalize_category(), Any (+2 more)

### Community 124 - "Seeded評価のスタック別レビュアールーティング仕様"
Cohesion: 0.22
Nodes (9): 1. 背景, 2. スコープ, 3. スタック属性の伝播, 4. Vueサポートの追加, 5. A2Aエンドポイントの追加・改名, 6. Seeded評価のルーティング変更（superseded、Issue #237で廃止）, 7. 影響を受けない設計判断, 8. テスト方針 (+1 more)

### Community 125 - "Angular Aria"
Cohesion: 0.11
Nodes (17): 10. Integration with Signal Forms, 1. Accordion, 2. Listbox, 3. Combobox, Select, and Multiselect, 4. Menu and Menubar, 5. Tabs, 6. Toolbar, 7. Tree (+9 more)

### Community 126 - "02 Authentication & Authorization (Confusing Identity with Permission)"
Cohesion: 0.11
Nodes (17): 02 Authentication & Authorization (Confusing Identity with Permission), Contents, Cryptographic Failures: When "Fast" Is a Vulnerability, JWT Misuse: Confusing "Verified" with "Trustworthy", Line of reasoning in code, Line of reasoning in code, Line of reasoning in code, Line of reasoning in code (+9 more)

### Community 127 - "開発環境の初期セットアップ"
Cohesion: 0.11
Nodes (17): AIエージェント上でのシェルスクリプト実施時, betterleaksのインストール, Development environment setup, GitHub CLIのインストール, Graphifyのセットアップ, Homebrewのインストール, pre-commitのインストール, pyenvのインストール (+9 more)

### Community 128 - "09 Insecure Design (When Correct Code Implements a Flawed Design)"
Cohesion: 0.12
Nodes (16): 09 Insecure Design (When Correct Code Implements a Flawed Design), Business Logic Flaws: "Works Correctly" Does Not Mean "Safe", Contents, Excessive Data Exposure: "Returning Too Much", Line of reasoning in code, Line of reasoning in code, Line of reasoning in code, Mass Assignment: The Blind Spot of "Assign Everything at Once" (+8 more)

### Community 129 - "React Composition Patterns"
Cohesion: 0.12
Nodes (16): 1.1 Avoid Boolean Prop Proliferation, 1.2 Use Compound Components, 1. Component Architecture, 2.1 Decouple State Management from UI, 2.2 Define Generic Context Interfaces for Dependency Injection, 2.3 Lift State into Provider Components, 2. State Management, 3.1 Create Explicit Component Variants (+8 more)

### Community 130 - "ADR-0001: 大規模PRのレビュー除外方針"
Cohesion: 0.07
Nodes (26): ADR-0001: 大規模PRのレビュー除外方針, Consequences, Context, Decision, Decision Drivers, Option 0 — 現状維持(binary fallback), Option 1 — Issue #54原案: パッチ本文の段階的トリミング, Option 2 — ユーザー提案A: ファイル単位のレビュー除外 (+18 more)

### Community 131 - "Svelte Agent Skills Review Accuracy Spec"
Cohesion: 0.12
Nodes (15): 1. Purpose, 2. Operating Constraints, 3. Current State, 4.1 Svelte Skill Bundle, 4.2 Svelte Project Type and Reviewer, 4.3 Svelte Detection, 4.4 Non-Svelte Guard, 4.5 Security Reviewer Coverage (+7 more)

### Community 132 - "5. Re-render Optimization"
Cohesion: 0.12
Nodes (16): 5.10 Subscribe to Derived State, 5.11 Use Functional setState Updates, 5.12 Use Lazy State Initialization, 5.13 Use Transitions for Non-Urgent Updates, 5.14 Use useDeferredValue for Expensive Derived Renders, 5.15 Use useRef for Transient Values, 5.1 Calculate Derived State During Rendering, 5.2 Defer State Reads to Usage Point (+8 more)

### Community 133 - "05 Secrets Exposure (Underestimating Where Data Can Reach)"
Cohesion: 0.13
Nodes (14): 05 Secrets Exposure (Underestimating Where Data Can Reach), Contents, Error Responses: "Development Detail Leaking to Production Users", Hardcoded Secrets: "Code Is Read More Widely Than You Think", Line of reasoning in code, Line of reasoning in code, Line of reasoning in code, Mechanism of impact (+6 more)

### Community 134 - "08 Configuration & Environment (The Gap Between "Works" and "Works Safely")"
Cohesion: 0.13
Nodes (14): 08 Configuration & Environment (The Gap Between "Works" and "Works Safely"), Container Configuration: Principle of Least Privilege, Contents, Debug Features Left in Production: "Developer Convenience as Attack Surface", Environment Separation: "What Does This Remove?", Line of reasoning in code, Line of reasoning in code, Line of reasoning in code (+6 more)

### Community 135 - "10 Software Integrity Failures (Trusting Without Verifying)"
Cohesion: 0.13
Nodes (14): 10 Software Integrity Failures (Trusting Without Verifying), Contents, Deserialization: Making Data Execute, Line of reasoning in code, Line of reasoning in code, Line of reasoning in code, Mechanism of impact, Mechanism of impact (+6 more)

### Community 136 - "11 SSRF & Security Logging (Invisible Requests and Invisible Attacks)"
Cohesion: 0.13
Nodes (14): 11 SSRF & Security Logging (Invisible Requests and Invisible Attacks), Contents, Line of reasoning in code, Line of reasoning in code, Logging, Mechanism of impact, Mechanism of impact, Questions to Use During Review (+6 more)

### Community 137 - "12 Exception Handling Failures (When Error Paths Are Not Designed)"
Cohesion: 0.13
Nodes (14): 12 Exception Handling Failures (When Error Paths Are Not Designed), Contents, Fail-Open: The Exception Path Grants Access, Line of reasoning in code, Line of reasoning in code, Mechanism of impact, Mechanism of impact, Mechanism of impact (+6 more)

### Community 138 - "7. JavaScript Performance"
Cohesion: 0.13
Nodes (15): 7.10 Hoist RegExp Creation, 7.11 Use flatMap to Map and Filter in One Pass, 7.12 Use Loop for Min/Max Instead of Sort, 7.13 Use Set/Map for O(1) Lookups, 7.14 Use toSorted() Instead of sort() for Immutability, 7.1 Avoid Layout Thrashing, 7.2 Build Index Maps for Repeated Lookups, 7.3 Cache Property Access in Loops (+7 more)

### Community 139 - "Quick Reference"
Cohesion: 0.13
Nodes (14): 1. Eliminating Waterfalls (CRITICAL), 2. Bundle Size Optimization (CRITICAL), 3. Server-Side Performance (HIGH), 4. Client-Side Data Fetching (MEDIUM-HIGH), 5. Re-render Optimization (MEDIUM), 6. Rendering Performance (MEDIUM), 7. JavaScript Performance (LOW-MEDIUM), 8. Advanced Patterns (LOW) (+6 more)

### Community 140 - "React/Angular Agent Skills Review Accuracy Spec"
Cohesion: 0.15
Nodes (13): 1. Purpose, 2. Operating Constraints, 3. Current State, 4.1 React Skill Enhancement, 4.2 Angular Skill Separation, 4.3 Angular-First Detection, 4.4 Security Reviewer Coverage, 4. Target Behavior (+5 more)

### Community 141 - "並列レビュー段 拡張アーキテクチャ設計"
Cohesion: 0.14
Nodes (14): 1. 背景と狙い, 2. レビュアーマトリクス（観点 × プロジェクト種別）, 3.1 入力境界 — `ReviewContext`, 3.2 レビュアー — `ReviewAgent` / `LLMReviewAgent`, 3.3 レジストリ — `registry`, 3.4 オーケストレータ — `ReviewOrchestrator`, 3.5 出力 — `ReviewReport`, 3. コンポーネント構成 (+6 more)

### Community 142 - "2. 修正方針"
Cohesion: 0.14
Nodes (14): 1. 背景と問題, 2. 修正方針, 3. テスト, 4. 検証手順, issue本文との乖離（前提の是正）, `pr_info_collector.py`, `review_orchestrator.py`, `tests/agents/test_pr_info_collector.py` (+6 more)

### Community 143 - "04 Software Supply Chain (The Chain of Trust and Its Blind Spots)"
Cohesion: 0.14
Nodes (13): 04 Software Supply Chain (The Chain of Trust and Its Blind Spots), Contents, CVE lookup resources, Known Vulnerabilities: "Starting to Use" vs. "Continuing to Use", Line of reasoning in code, Line of reasoning in code, Mechanism of impact, Mechanism of impact (+5 more)

### Community 144 - "Svelte Review Guidelines"
Cohesion: 0.14
Nodes (14): Async Svelte, Avoid legacy features, Context, `$derived`, Each blocks, `$effect`, Events, `$inspect.trace` (+6 more)

### Community 145 - "run-evaluation スキル"
Cohesion: 0.15
Nodes (13): Gold set のビルド（なければ実行）, run-evaluation スキル, Seeded set のビルド（なければ実行）, Step 1: 前提チェック, Step 2: Gold set / Seeded set の準備, Step 3: A2A サーバーを podman コンテナとして起動, Step 4: 評価スクリプトの実行, Step 5: A2A サーバーコンテナの停止 (+5 more)

### Community 146 - "PR Info Collector 正確性検証レポート（20回統計分析）"
Cohesion: 0.15
Nodes (12): 1. 正解データ（Ground Truth）, 2. 統計サマリ（成功試行 N=11）, 3. 出力タイトルの分布（再現性の指標）, 4. 全試行の生データ, 5. 修正前との対比（案A + file一覧対処の効果）, 6. 受け入れ基準の達否（暫定基準: docs/pr-info-collector-tooluse-fix-spec.md §3）, 7.1 構造化時の忠実性（copy-fidelity）の問題, 7.2 ツールループの長時間化と環境失敗（9/20） (+4 more)

### Community 147 - "required"
Cohesion: 0.14
Nodes (13): $id, file_changes, id, pr_number, repository, stack, required, $schema (+5 more)

### Community 148 - "実装フロー（プロジェクト標準 TDD フロー準拠）"
Cohesion: 0.15
Nodes (12): Context, Cycle 1: モデル基本型（`DecisionVerdict`, `FindingDecisionOutput`, `LeadEngineerOutput`, `FindingDecision`）, Cycle 2: `LeadEngineerReport`, Cycle 3: `LeadEngineerAgent._build_prompt_and_index()`, Cycle 4: `LeadEngineerAgent._resolve_decisions()`, Cycle 5: `LeadEngineerAgent.evaluate()`（統合）, Cycle 6: `__init__.py` エクスポート追加, Lead Engineer Agent 実装プラン (+4 more)

### Community 149 - "2. Advanced CSS Animations"
Cohesion: 0.15
Nodes (12): 1. Native CSS Animations (v20.2+ Recommended), 2. Advanced CSS Animations, 3. Legacy Animations DSL (Deprecated), Angular Animations, `animate.enter` and `animate.leave`, Animating Auto Height, Animating State and Styles, Defining Transitions (+4 more)

### Community 150 - "Frontend PR Review Agent — System Prompt"
Cohesion: 0.15
Nodes (12): Behavioral constraints, Frontend PR Review Agent — System Prompt, Input schema, Issue format, Output format, Role, Step 1 — Understand intent, Step 2 — Identify the stack (+4 more)

### Community 151 - "03 CSRF / CORS (Request Origin and Intent Verification)"
Cohesion: 0.15
Nodes (12): 03 CSRF / CORS (Request Origin and Intent Verification), Contents, CORS: "Disabling Protection While Thinking You're Adding It", CSRF: "One Click Makes the User Do Something They Didn't Intend", Line of reasoning in code, Line of reasoning in code, Mechanism of impact, Mechanism of impact (+4 more)

### Community 152 - "svelte-core-bestpractices/SKILL.md"
Cohesion: 0.15
Nodes (7): Function bindings, Keyed each blocks, CSP, Serialization, $inspect.trace(...), $inspect(...).with, createSubscriber

### Community 153 - "Coding Agent Guide"
Cohesion: 0.15
Nodes (13): Coding Agent Guide, Coding Rules, Development Process, Evaluation Pipeline, Frequently Used Commands, graphify, Project Overview, Quality / Feature Requirements (+5 more)

### Community 154 - "Evaluation Toolkit"
Cohesion: 0.17
Nodes (12): 1) Prepare PR target list, 2) Build Gold set automatically, 3) Build Seeded set from the dedicated seed repositories, 4) Run your review agents against both sets, 5) Evaluate with gates, Evaluation Toolkit, Known Limitations, One-Command Dataset Build (+4 more)

### Community 155 - "Evaluation Runbook"
Cohesion: 0.17
Nodes (12): 0. Preconditions, 1. Build execution target list from per-stack targets, 2. Build Gold set, 3. Build Seeded set, 4. Run review agent pipeline, 4a. Sharded execution (time-constrained environments), 5. Score evaluation, 6. Gate decision (+4 more)

### Community 156 - "06 Security Headers & CSP (The Precision of Browser Instructions)"
Cohesion: 0.17
Nodes (11): 06 Security Headers & CSP (The Precision of Browser Instructions), Contents, CSP: The Precision of "What Not to Allow", Line of reasoning in code, Line of reasoning in code, Mechanism of impact, Mechanism of impact, Other Security Headers: Problems Caused by Removal (+3 more)

### Community 157 - "07 File Upload & Path Traversal (The Dual Nature of Files)"
Cohesion: 0.17
Nodes (11): 07 File Upload & Path Traversal (The Dual Nature of Files), Contents, File Upload: Controlling What Gets Uploaded, Line of reasoning in code, Line of reasoning in code, Mechanism of impact, Mechanism of impact, Path Traversal: The Danger of "Path" as Input (+3 more)

### Community 158 - "6. Rendering Performance"
Cohesion: 0.17
Nodes (12): 6.10 Use React DOM Resource Hints, 6.11 Use useTransition Over Manual Loading States, 6.1 Animate SVG Wrapper Instead of SVG Element, 6.2 CSS content-visibility for Long Lists, 6.3 Hoist Static JSX Elements, 6.4 Optimize SVG Precision, 6.5 Prevent Hydration Mismatch Without Flickering, 6.6 Suppress Expected Hydration Mismatches (+4 more)

### Community 159 - "Contributing Guide"
Cohesion: 0.18
Nodes (11): 1. Principles, 2. Development Flow (Spec-Driven + TDD), 3. Local Development Commands, 4. Implementation and Design Rules, 5. PR Description Rules, 6. References, Build, Contributing Guide (+3 more)

### Community 160 - "ADR-0004: MCPクライアントのセッション共有(レビュアー間)"
Cohesion: 0.18
Nodes (11): ADR-0004: MCPクライアントのセッション共有(レビュアー間), Consequences, Context, Decision, 検討事項, 検討事項1: 共有範囲 → A(並列レビュー実行の内部でのみ共有)を採用, 検討事項1: 共有範囲(共有単位), 検討事項2: 共有セッションのライフサイクル管理 (+3 more)

### Community 161 - "ADR-0006: 指摘単位の severity / impact / priority 評価方式"
Cohesion: 0.10
Nodes (20): ADR-0006: 指摘単位の severity / impact / priority 評価方式, Consequences, Context, Decision, 案A: Lead Engineerが3軸を校正する, 案A: PR単位ラベルを各findingへ継承する, 案A: 完全一致と±1一致の併記, 案B: LLMで各コメントを個別分類する (+12 more)

### Community 162 - "評価パイプライン設計: データ生成から実行まで"
Cohesion: 0.18
Nodes (11): 1. 背景と狙い, 2. ディレクトリの役割分担: `evaluation/input/` と `evaluation/data/`, 3. 全体データフロー, 4. サンプリングと構成比率の可視化, 5. 実行フェーズの並行実行モデル, 6. 完了通知（Discord Webhook）, 7. 関連ドキュメント, Gold と Seeded のレビュアー選択 (+3 more)

### Community 163 - "enum"
Cohesion: 0.24
Nodes (11): enum, type, enum, type, correctness, maintainability, performance, security (+3 more)

### Community 164 - "Component Styling"
Cohesion: 0.18
Nodes (10): Component Styling, Defining Styles, External Styles, `:host`, `:host-context()`, `::ng-deep`, Special Selectors, Styles in Templates (+2 more)

### Community 165 - "Angular Review Guidelines"
Cohesion: 0.18
Nodes (11): Angular Aria, Angular Review Guidelines, Components, Dependency Injection, Forms, Pipes, Reactivity and Data Management, Routing (+3 more)

### Community 166 - "Svelte checks"
Cohesion: 0.18
Nodes (11): Contents, Context7 trigger examples, each block key, {@html} XSS, Issue format, onMount cleanup, Reactivity tracking (Svelte 4), Runes migration consistency (+3 more)

### Community 167 - "reviewing-web-security/SKILL.md"
Cohesion: 0.18
Nodes (10): 2021 (reference), 2025 (current), How to Review, OWASP Top 10 Coverage, Reference Files, Stating Review Limits, Step 1: Characterize the PR (30 seconds), Step 2: Select references by signal (+2 more)

### Community 168 - "React Composition Patterns"
Cohesion: 0.18
Nodes (10): 1. Component Architecture (HIGH), 2. State Management (MEDIUM), 3. Implementation Patterns (MEDIUM), 4. React 19 APIs (MEDIUM), Full Compiled Document, How to Use, Quick Reference, React Composition Patterns (+2 more)

### Community 169 - "3. Server-Side Performance"
Cohesion: 0.18
Nodes (10): 3.10 Use after() for Non-Blocking Operations, 3.1 Authenticate Server Actions Like API Routes, 3.2 Avoid Duplicate Serialization in RSC Props, 3.3 Avoid Shared Module State for Request Data, 3.4 Cross-Request LRU Caching, 3.5 Hoist Static I/O to Module Level, 3.6 Minimize Serialization at RSC Boundaries, 3.7 Parallel Data Fetching with Component Composition (+2 more)

### Community 170 - "ADR-0003: MCP起動リトライ戦略"
Cohesion: 0.20
Nodes (10): ADR-0003: MCP起動リトライ戦略, Consequences, Context, Decision, リトライ対象例外と非一過性エラーの扱い, 対象(リトライを適用する箇所), 方式1: リトライ間隔の戦略(バックオフ方式), 方式2: 実装手段(ライブラリ選定) (+2 more)

### Community 171 - "9. fallback率30%未満の目標に対する構造的対応 (プロンプトのみでは不足)"
Cohesion: 0.20
Nodes (10): 9.1 事象: 20件バッチ検証でfallback率100%, 9.2 モデル比較: `llama3.1:latest` (8B) vs `qwen3.5:latest` (9.7B), 9.3 対応方針(1): モデルの切り替え, 9.4 対応方針(2): 3.2.3の「再生成のリトライは行わない」の見直し, 9.5 検証観点, 9.6 残る限界, 9.7 実測結果: `qwen3.5:latest`では不足、`Ornith-1.0-35B`で目標達成, 9.8 単発測定の頑健性確認 (`--seed`違いで3回) (+2 more)

### Community 172 - "GitHub MCP `streamable_http_client` 移行 設計ドキュメント"
Cohesion: 0.20
Nodes (10): 1.1 API の変化, 1.2 `httpx.AsyncClient` の所有権問題, 1.3 検討した代替案とその却下理由, 1. 背景と問題, 2.1 この設計で解消されること, 2. 採用する設計, 3. 変更ファイル, 4. 検証手順 (+2 more)

### Community 173 - "Red Hat Hardened Image への base image 変更 spec"
Cohesion: 0.20
Nodes (9): Red Hat Hardened Image への base image 変更 spec, リスクと留意点, ロールバック, 受入条件, 変更対象, 実測結果 (podman による Step 0 調査), 移行時点で固定した digest (multi-arch index), 背景 (+1 more)

### Community 174 - "PR Info Collector 正確性検証レポート（20回統計分析）"
Cohesion: 0.20
Nodes (9): 1. 正解データ（Ground Truth）, 2. 統計サマリ（成功試行 N=20）, 3. 出力タイトルの分布（再現性の指標）, 4. 全試行の生データ, 5. 3者比較（修正前 → 案A → 決定論化）, 6. 受け入れ基準の達否（spec §2.5.4）, 7. 結論, PR Info Collector 正確性検証レポート（20回統計分析） (+1 more)

### Community 175 - "Components"
Cohesion: 0.20
Nodes (9): Component Definition, Components, Conditional Rendering (`@if`), Core Concepts, Loops (`@for`), Metadata Options, Switching Content (`@switch`), Template Control Flow (+1 more)

### Community 176 - "Angular CLI MCP Server"
Cohesion: 0.20
Nodes (9): Angular CLI MCP Server, Antigravity IDE, Available Tools (Default), Command Options, Configuration, Cursor, Experimental Tools, Gemini CLI (+1 more)

### Community 177 - "Template-Driven Forms"
Cohesion: 0.20
Nodes (9): Building the Form Template, Core Directives, Form and Control State, Resetting the Form, Setup, Submitting the Form, Template-Driven Forms, Two-Way Binding with `[(ngModel)]` (+1 more)

### Community 178 - "Angular checks"
Cohesion: 0.20
Nodes (10): Angular checks, ChangeDetectionStrategy, Contents, Context7 trigger examples, DI scope mismatch, innerHTML XSS, Issue format, Observable subscription leak (+2 more)

### Community 179 - "React checks"
Cohesion: 0.20
Nodes (10): Contents, Context7 trigger examples, Context over-provision, dangerouslySetInnerHTML XSS, Issue format, Missing cleanup, React checks, Unnecessary memoization (+2 more)

### Community 180 - "Vue.js checks"
Cohesion: 0.20
Nodes (10): Composition vs Options API consistency, computed vs method misuse, Contents, Context7 trigger examples, defineProps / defineEmits without types, Issue format, v-for key, v-html XSS (+2 more)

### Community 181 - "React Composition Patterns"
Cohesion: 0.20
Nodes (9): Component Architecture (CRITICAL), Core Principles, Creating a New Rule, Impact Levels, Implementation Patterns (MEDIUM), React Composition Patterns, Rules, State Management (HIGH) (+1 more)

### Community 182 - "React Best Practices"
Cohesion: 0.20
Nodes (9): 4.1 Deduplicate Global Event Listeners, 4.2 Use Passive Event Listeners for Scrolling Performance, 4.3 Use SWR for Automatic Deduplication, 4.4 Version and Minimize localStorage Data, 4. Client-Side Data Fetching, Abstract, React Best Practices, References (+1 more)

### Community 183 - "Sections"
Cohesion: 0.20
Nodes (9): 1. Eliminating Waterfalls (async), 2. Bundle Size Optimization (bundle), 3. Server-Side Performance (server), 4. Client-Side Data Fetching (client), 5. Re-render Optimization (rerender), 6. Rendering Performance (rendering), 7. JavaScript Performance (js), 8. Advanced Patterns (advanced) (+1 more)

### Community 184 - "ADR-0005: スタック別 Gold-set ターゲット選定の正規経路化"
Cohesion: 0.12
Nodes (17): ADR-0005: スタック別 Gold-set ターゲット選定の正規経路化, Consequences, Context, Decision, 案A: 単一の共通述語モジュールに集約し、両者が参照する, 案A: 旧経路を完全撤去し、新方式を唯一の正規入力に置換する, 案B: Gold ビルダー側の判定を生産者に手作業でコピーして揃える, 案B: 新方式用の別セレクタを追加し、旧経路と併存させる (+9 more)

### Community 185 - "_sanitize_cell"
Cohesion: 0.36
Nodes (3): Make *text* safe for one Markdown table cell. A raw newline breaks a table row…, _sanitize_cell(), TestSanitizeCell

### Community 186 - "docstring lint方針 設計ドキュメント"
Cohesion: 0.22
Nodes (8): 1. 背景と問題, 2.1 `select`を明示指定する理由(重要: 検証で判明した仕様), 2.2 `explicit-preview-rules = true` を設定する理由, 2. 採用するルール, 3. スコープ外事項, 4. 既知のリスク, 5. 影響範囲(最終確定設定での実測値), docstring lint方針 設計ドキュメント

### Community 187 - "評価レポートへの個別PR詳細（Human Review vs Agent指摘）追加 設計ドキュメント"
Cohesion: 0.22
Nodes (8): 1. 背景と問題, 2.1 `score_evaluation.py`, 2.2 `run_agent_evaluation.py`, 2. 修正方針, 3. 対象外（今回やらないこと）, 4. テスト, 5. 検証手順, 評価レポートへの個別PR詳細（Human Review vs Agent指摘）追加 設計ドキュメント

### Community 188 - "7. Phase 2運用後に判明した問題 (Issue #131)"
Cohesion: 0.22
Nodes (9): 7.1 事象と非開発者向け要約, 7.2 原因分析: 構造的原因(6/7件)と書式差(1/7件)の分離, 7.3 新しい設計原則: スニペットの自己完結性, 7.5 対象外とした案とその理由: candidate選定のasyncスコープ考慮, 7.6 Issue対応方針(3)の採用可否: 逆方向を採用した理由, 7.7 計測可能性: `generation_source`比率を評価指標に昇格, 7.8 検証観点 (実装時のテスト方針), 7.9 残る限界 (+1 more)

### Community 189 - "Seeded set生成: (ファイル, ルール)組み合わせ重複 修正 設計ドキュメント"
Cohesion: 0.22
Nodes (8): 1. 背景と問題, 2. 修正方針, 3. テスト, 4. 検証手順, Seeded set生成: (ファイル, ルール)組み合わせ重複 修正 設計ドキュメント, 対象外, 根本原因, 追加で発見した根本原因: `id` が (ファイル, ルール) の組を一意に識別できない

### Community 190 - "SkillSource"
Cohesion: 0.18
Nodes (11): SkillSource, _build_angular_review_skills(), _build_react_review_skills(), _build_svelte_review_skills(), _build_vue_review_skills(), _build_web_security_review_skills(), Build the skill bundle for the Vue technical reviewer. Unlike Angular and…, Build the skill bundle for the web security reviewer. Returns:… (+3 more)

### Community 191 - "スタック別 Gold-set ターゲット選定仕様"
Cohesion: 0.22
Nodes (9): 1. 全体データフロー, 2. リポジトリ選定条件, 3. PR 選定条件, 4. severity / impact / priority の LLM 分類, 5. 出力スキーマ, 6. 再開と上限, 7. 評価実行対象の抽出, 8. テスト方針 (+1 more)

### Community 192 - "Review Matching Rubric"
Cohesion: 0.22
Nodes (8): Category Mapping, Impact Mapping, Matching Levels, Priority Mapping, Purpose, Review Decision Scoring (Lead Engineer), Review Matching Rubric, Severity Mapping

### Community 193 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 194 - "Angular CLI Guide for Agents"
Cohesion: 0.22
Nodes (8): 1. Managing Dependencies, 2. Generating Code (`ng generate` or `ng g`), 3. Development Server & Proxying, 4. Building the Application, 5. Testing, 6. Deployment, Angular CLI Guide for Agents, Backend API Proxying

### Community 195 - "Creating and Using Services"
Cohesion: 0.22
Nodes (8): Advanced Service Patterns, Creating a Service, Creating and Using Services, Injecting a Service, Injecting into a Component, Injecting into Another Service, The `autoProvided` option, The `@Service` decorator

### Community 196 - "Data Resolvers"
Cohesion: 0.22
Nodes (8): 1. Via `ActivatedRoute` (Traditional), 2. Via Component Inputs (Modern), Accessing Resolved Data, Best Practices, Configuring the Route, Creating a Resolver, Data Resolvers, Error Handling

### Community 197 - "Define Routes"
Cohesion: 0.22
Nodes (8): Basic Configuration, Define Routes, Matching Strategy, Nested (Child) Routes, Page Titles, Redirects, Route Data and Providers, URL Paths

### Community 198 - "Inputs"
Cohesion: 0.22
Nodes (8): Best Practices, Configuration Options, Decorator-based Inputs (@Input), Inputs, Model Inputs (Two-Way Binding), Signal-based Inputs, Usage, Usage in Template

### Community 199 - "Reactive Forms"
Cohesion: 0.22
Nodes (8): Accessing Controls, Core Classes, Manual State Management, Reactive Forms, Setup, Template Binding, Unified Change Events, Updating Values

### Community 200 - "Manual Setup (Tailwind v4)"
Cohesion: 0.22
Nodes (8): 1. Install Dependencies, 2. Configure PostCSS, 3. Import Tailwind CSS, 4. Use Utility Classes, Automated Setup (Recommended), Manual Setup (Tailwind v4), Summary for AI Agents, Using Tailwind CSS with Angular

### Community 201 - "reviewing-frameworks/SKILL.md"
Cohesion: 0.22
Nodes (4): Context7 usage, Reference files, Reviewing framework-specific concerns, Shared component design checks (all frameworks)

### Community 202 - "reviewing-universal/SKILL.md"
Cohesion: 0.25
Nodes (3): Quick triage, Reference files, Reviewing universal concerns

### Community 203 - "Accessibility checks"
Cohesion: 0.22
Nodes (9): Accessibility checks, ARIA misuse, Color contrast, Contents, Focus management, Form label association, Image alt text, Interactive element semantics (+1 more)

### Community 204 - "Security checks"
Cohesion: 0.22
Nodes (9): Client-side auth bypass, Contents, CSRF surface, Environment variable misuse  🔴, Hardcoded secrets  🔴, Issue format, Security checks, Target blank without rel (+1 more)

### Community 205 - "await-expressions.md"
Cohesion: 0.22
Nodes (8): Breaking changes, Caveats, Concurrency, Error handling, Forking, Indicating loading states, Server-side rendering, Synchronized updates

### Community 206 - "a2a-server/package.json"
Cohesion: 0.11
Nodes (18): @code-review-agent/agent-core, @hono/node-server, @hono/zod-validator, dependencies, @code-review-agent/agent-core, @hono/node-server, @hono/zod-validator, devDependencies (+10 more)

### Community 207 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 208 - "3.2 Phase 2: LLM推論 + 決定論的事後検証"
Cohesion: 0.25
Nodes (8): 3.2.1 生成フロー, 3.2.2 構造化出力スキーマ (フィールド定義), 3.2.3 決定論的事後検証 (安全網、必須), 3.2.4 再現性の担保 (R6), 3.2.5 コストとレイテンシ, 3.2.6 モデル構成: 生成モデルと評価モデルの分離, 3.2.7 生成メタデータの記録, 3.2 Phase 2: LLM推論 + 決定論的事後検証

### Community 209 - "pull_request_template.md"
Cohesion: 0.25
Nodes (7): Change Details, Documentation Updates, Impact Scope, Related Issue, Risk and Rollback, Summary, Test

### Community 210 - "TestLeadEngineerReport"
Cohesion: 0.18
Nodes (5): _make_decision(), ReviewPerspective, Tests for LeadEngineerReport output, sorting, and serialisation., An accepted finding missing location is dropped from both outputs, so it should…, TestLeadEngineerReport

### Community 211 - "Suggested Commands"
Cohesion: 0.25
Nodes (7): Darwin-specific notes, Evaluation pipeline, Run, Setup, Suggested Commands, Test / Lint / Format / Type-check, Worktrees (project convention, not a generic git op)

### Community 212 - "Dependency Injection (DI) Fundamentals"
Cohesion: 0.25
Nodes (7): Creating a Service, Dependency Injection (DI) Fundamentals, How DI Works in Angular, Injecting Dependencies, Services, The `inject()` Function, Where can `inject()` be used? (Injection Context)

### Community 213 - "Route Loading Strategies"
Cohesion: 0.25
Nodes (7): Eager Loading, Injection Context and Lazy Loading, Lazy Loading, Lazy Loading Child Routes, Lazy Loading Components, Recommendation, Route Loading Strategies

### Community 214 - "Outputs (Custom Events)"
Cohesion: 0.25
Nodes (7): Best Practices, Configuration Options, Decorator-based Outputs (@Output), Function-based outputs, Outputs (Custom Events), Programmatic Subscription, Usage in Template

### Community 215 - "Pipes"
Cohesion: 0.25
Nodes (7): Built-in locale-aware pipes — use standalone formatting functions, Creating custom pipes, Custom pipes — extract the transformation function, Impure pipes, Pipes, Using pipe logic outside templates, Using pipes in templates

### Community 216 - "Async Reactivity with `resource`"
Cohesion: 0.25
Nodes (7): Aborting Requests, Async Reactivity with `resource`, Basic Usage, Local Mutation, Reactive Data Fetching with `httpResource`, Reloading Data, Resource Status Signals

### Community 217 - "Setting Up for Router Testing"
Cohesion: 0.25
Nodes (7): Best Practices, Example Setup, Example: Testing Navigation, Key Concepts, Setting Up for Router Testing, Testing with the RouterTestingHarness, Writing Router Tests

### Community 218 - "Angular Signals Overview"
Cohesion: 0.25
Nodes (7): Angular Signals Overview, Async Operations in Reactive Contexts, Computed Signals (`computed`), Exposing as Readonly, Reactive Contexts, Untracked Reads (`untracked`), Writable Signals (`signal`)

### Community 219 - "Correctness checks"
Cohesion: 0.25
Nodes (8): Async failure paths, Contents, Correctness checks, Edge cases, Intent alignment, Issue format, Race conditions, Test coverage

### Community 220 - "Dependency audit checks"
Cohesion: 0.25
Nodes (8): Bundle size, Contents, Dependency audit checks, Duplication, Issue format, Justification, License, Maintenance status

### Community 221 - "Test quality checks"
Cohesion: 0.25
Nodes (7): Assertion presence, Behavior vs implementation detail, Contents, Coverage of changed paths, Issue format, Test isolation, Test quality checks

### Community 222 - "@attach.md"
Cohesion: 0.25
Nodes (7): Attachment factories, Conditional attachments, Controlling when attachments re-run, Converting actions to attachments, Creating attachments programmatically, Inline attachments, Passing attachments to components

### Community 223 - "snippet.md"
Cohesion: 0.25
Nodes (6): Optional snippets, Exporting snippets, Programmatic snippets, Snippet scope, Snippets and slots, Typing snippets

### Community 224 - "ADR-0002: ワークフロー外部化(LangFlow/Dify)の検討"
Cohesion: 0.29
Nodes (7): ADR-0002: ワークフロー外部化(LangFlow/Dify)の検討, Consequences, Context, Decision, Decision Drivers, Message-based vs 構造化出力の比較, 所見

### Community 225 - "must_find"
Cohesion: 0.22
Nodes (9): items, type, type, description, items, minItems, type, file_changes (+1 more)

### Community 226 - "enum"
Cohesion: 0.29
Nodes (7): critical, high, low, medium, severity, enum, type

### Community 227 - "Defining Dependency Providers"
Cohesion: 0.29
Nodes (6): Automatic Provision, Defining Dependency Providers, InjectionToken, Library Pattern: `provide*` functions, Manual Provision, Scopes of Providers

### Community 228 - "Environment configuration"
Cohesion: 0.29
Nodes (6): Build-time configuration, Choosing a strategy, Configuration strategies, Environment configuration, Example, Runtime configuration (advanced)

### Community 229 - "Navigate to Routes"
Cohesion: 0.29
Nodes (6): Declarative Navigation (`RouterLink`), Navigate to Routes, Programmatic Navigation (`Router`), `router.navigate()`, `router.navigateByUrl()`, URL Parameters

### Community 230 - "pr-info-collector.ts"
Cohesion: 0.09
Nodes (25): ADR-0004, ReviewerConfig, createModelProvider(), CreateModelProviderOptions, ProviderType, mockedCreateOllama, mockedOpenAIModel, mockedVercelModel (+17 more)

### Community 231 - "Route Transition Animations"
Cohesion: 0.29
Nodes (6): Advanced Control, Best Practices, Customizing with CSS, Enabling View Transitions, How it Works, Route Transition Animations

### Community 232 - "Route Guards"
Cohesion: 0.29
Nodes (6): Applying Guards, Creating a Guard, Return Values, Route Guards, Security Note, Types of Guards

### Community 233 - "Show Routes with Outlets"
Cohesion: 0.29
Nodes (6): Basic Usage, Named Outlets (Secondary Routes), Nested Outlets, Outlet Lifecycle Events, Passing Data via `routerOutletData`, Show Routes with Outlets

### Community 234 - "Performance checks"
Cohesion: 0.29
Nodes (7): Bundle size, Contents, Image optimization, Issue format, List virtualization, Memoization opportunity, Performance checks

### Community 235 - "1. Eliminating Waterfalls"
Cohesion: 0.29
Nodes (7): 1.1 Check Cheap Conditions Before Async Flags, 1.2 Defer Await Until Needed, 1.3 Dependency-Based Parallelization, 1.4 Prevent Waterfall Chains in API Routes, 1.5 Promise.all() for Independent Operations, 1.6 Strategic Suspense Boundaries, 1. Eliminating Waterfalls

### Community 236 - "2. Bundle Size Optimization"
Cohesion: 0.29
Nodes (7): 2.1 Avoid Barrel File Imports, 2.2 Conditional Module Loading, 2.3 Defer Non-Critical Third-Party Libraries, 2.4 Dynamic Imports for Heavy Components, 2.5 Prefer Statically Analyzable Paths, 2.6 Preload Based on User Intent, 2. Bundle Size Optimization

### Community 237 - "8. Phase 2生成プロンプトの改善"
Cohesion: 0.33
Nodes (6): 8.1 事象と非開発者向け要約, 8.2 原因分析, 8.3 対応方針: プロンプトへ事後検証制約を明示 (自己完結性の原則の継続), 8.4 検証観点, 8.5 残る限界, 8. Phase 2生成プロンプトの改善

### Community 238 - "TestAnnotatePatch"
Cohesion: 0.23
Nodes (4): _annotate_patch(), Annotate each line of a unified diff with its actual file line number.…, _annotate_patch adds file line numbers to unified diff lines., TestAnnotatePatch

### Community 239 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 240 - "Memory Maintenance"
Cohesion: 0.33
Nodes (5): Add/update threshold, Discovery Model, Maintenance Actions, Memory Maintenance, Style

### Community 241 - "Side Effects with `effect` and `afterRenderEffect`"
Cohesion: 0.33
Nodes (5): Basic Usage, DOM Manipulation with `afterRenderEffect`, Render Phases, Side Effects with `effect` and `afterRenderEffect`, When to use `effect`

### Community 242 - "Hierarchical Injectors"
Cohesion: 0.33
Nodes (5): Hierarchical Injectors, `providers` vs `viewProviders`, Resolution Modifiers, Resolution Rules, Types of Injector Hierarchies

### Community 243 - "Component Host Elements"
Cohesion: 0.33
Nodes (5): Binding Collisions, Binding to the Host Element, Component Host Elements, Injecting Host Attributes, Legacy Decorators

### Community 244 - "Router Lifecycle and Events"
Cohesion: 0.33
Nodes (5): Common Router Events (Chronological), Common Use Cases, Debugging, Router Lifecycle and Events, Subscribing to Events

### Community 245 - "Sections"
Cohesion: 0.33
Nodes (5): 1. Component Architecture (architecture), 2. State Management (state), 3. Implementation Patterns (patterns), 4. React 19 APIs (react19), Sections

### Community 246 - "React Best Practices"
Cohesion: 0.33
Nodes (5): Creating a New Rule, Getting Started, React Best Practices, Rule File Structure, Structure

### Community 247 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 248 - "1. 背景と問題"
Cohesion: 0.40
Nodes (5): 1.1 発覚した事象, 1.2 直接原因: `inject_patch()` の挿入位置ロジック, 1.3 副次的原因: `language_snippets` 未定義によるランタイム不整合, 1.4 制約: 入力はunified diff patchのみ, 1. 背景と問題

### Community 249 - "Seeded set生成: mutation注入ロジック 要件と設計ドキュメント"
Cohesion: 0.40
Nodes (5): 2. 要件: mutation注入ロジックが満たすべき性質, 4. 対象外, 5. 検証観点 (実装時のテスト方針), 6. 今後の進め方, Seeded set生成: mutation注入ロジック 要件と設計ドキュメント

### Community 250 - "3.1 Phase 1: 決定論的改善 (即座に着手可能) — 実装済み (Issue #111)"
Cohesion: 0.40
Nodes (5): 3.1.1 `language_snippets` の必須化 (R7), 3.1.2 挿入位置ヒューリスティックの改善 (R1・R3の部分対応), 3.1.3 限界, 3.1 Phase 1: 決定論的改善 (即座に着手可能) — 実装済み (Issue #111), 3. ハイブリッド設計

### Community 251 - "test_build_seeded_set.py"
Cohesion: 0.18
Nodes (6): count_new_lines_before(), Count new-file lines consumed between the hunk header and insertion_idx.…, _files_response(), Tests for evaluation/tools/build_seeded_set.py (Issue #224). Covers marker…, TestCountNewLinesBefore, TestMainCLI

### Community 252 - "Dependent State with `linkedSignal`"
Cohesion: 0.40
Nodes (4): Advanced Usage: Accounting for Previous State, Basic Usage, Dependent State with `linkedSignal`, When to use `linkedSignal` vs `computed` vs `effect`

### Community 253 - "Testing Fundamentals"
Cohesion: 0.40
Nodes (4): Basic Test Structure Example, Core Philosophy: Zoneless & Async-First, TestBed and ComponentFixture, Testing Fundamentals

### Community 254 - "Passing snippets to components"
Cohesion: 0.40
Nodes (5): Explicit props, Implicit `children` snippet, Implicit props, Optional snippet props, Passing snippets to components

### Community 255 - "8. Advanced Patterns"
Cohesion: 0.40
Nodes (5): 8.1 Do Not Put Effect Events in Dependency Arrays, 8.2 Initialize App Once, Not Per Mount, 8.3 Store Event Handlers in Refs, 8.4 useEffectEvent for Stable Callback Refs, 8. Advanced Patterns

### Community 256 - "detect_intentional_markers"
Cohesion: 0.20
Nodes (6): detect_intentional_markers(), Detect all INTENTIONAL markers in one file's patch, in diff order. Language-…, Split a unified diff patch string into per-hunk line groups. Each returned…, split_hunks(), TestDetectIntentionalMarkers, TestSplitHunks

### Community 257 - "7.4 対応方針"
Cohesion: 0.50
Nodes (4): 7.4.1 V2 (`verify_only_additions_changed`) への対応: 構造的原因には手を入れない, 7.4.2 カタログ改訂: `frontend_n_plus_one_api` / `b2b2c_idor_hint`を自己完結化, 7.4.3 カタログバリデーションの追加 (再発防止), 7.4 対応方針

### Community 258 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 259 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 260 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 261 - "Agent Architecture"
Cohesion: 0.50
Nodes (3): Agent Architecture, Layering: agents/ vs api/agents/ vs a2a/, Reviewer plugin pattern (`src/code_review_agent/agents/registry.py` + `agents/base_reviewer.py`)

### Community 263 - "Prefer Statically Analyzable Paths"
Cohesion: 0.50
Nodes (3): File-System Paths, Import Paths, Prefer Statically Analyzable Paths

### Community 272 - "enum"
Cohesion: 0.29
Nodes (7): angular, react, svelte, vue, stack, enum, type

### Community 273 - "base-reviewer.ts"
Cohesion: 0.16
Nodes (26): annotatePatch(), buildPrompt(), composeSystemPrompt(), LLMReviewAgent, splitPatchLines(), context(), DefaultLLMFakeReviewer, makePrInfo() (+18 more)

### Community 351 - "within_change_limits"
Cohesion: 0.43
Nodes (3): Determine whether a pull request fits within file and line-change limits.…, within_change_limits(), TestWithinChangeLimits

### Community 352 - "manifest-detection.ts"
Cohesion: 0.32
Nodes (12): collectDirectPackageNames(), collectFields(), detectProjectTypeFromPackages(), extractDirectDependenciesFromPackageJson(), extractDirectDependenciesFromPackageLock(), extractDirectDependenciesFromPnpmLock(), isPlainRecord(), PACKAGE_PROJECT_TYPE_PRIORITY (+4 more)

### Community 353 - "discover_candidate_prs.py"
Cohesion: 0.19
Nodes (11): load_skipped_targets(), load_stack_outputs(), main(), Load existing targets only for repositories explicitly being skipped. Returns:…, Write targets grouped by stack to pr_targets_{stack}.json. Every stack in…, Load all existing stack target files for atomic revalidation. Returns:…, Discover and write per-stack Gold-set pull request targets. Returns: int: 1 if…, RepoCandidate (+3 more)

### Community 354 - "opencode.json"
Cohesion: 0.50
Nodes (3): instructions, $schema, AGENTS.setup.md

### Community 355 - "worktree.js"
Cohesion: 0.22
Nodes (10): errorMessage(), findWorkspaceByBranch(), nonEmptyMessage(), switchToWorkspace(), unwrap(), WorktreePlugin(), createToastNotifier(), sleep() (+2 more)

### Community 358 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 359 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 360 - "TestStructuredOutputDirective"
Cohesion: 0.25
Nodes (4): compose_system_prompt(), Combine a reviewer's role prompt with the shared structured-output directive.…, The shared directive that steers small models to emit the structured output…, TestStructuredOutputDirective

### Community 362 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 363 - "biome.json"
Cohesion: 0.10
Nodes (20): files, includes, formatter, enabled, indentStyle, indentWidth, lineWidth, quoteStyle (+12 more)

### Community 364 - "common.sh"
Cohesion: 0.33
Nodes (3): common.sh script, start_a2a_container.sh script, stop_a2a_container.sh script

### Community 373 - "test_eval_logging.py"
Cohesion: 0.27
Nodes (6): _clear_handlers(), fixture, Tests for evaluation/tools/eval_logging.py., Remove pytest's own root handler(s) for this test. pytest re-attaches its…, _restore_root_logger(), TestSetupLogging

### Community 374 - "a2a/request.model.ts"
Cohesion: 0.11
Nodes (27): A2ADataPart, A2ADataPartSchema, A2AMessage, A2AMessageSchema, A2APartDiscriminatedSchema, A2APartSchema, A2ATextPart, A2ATextPartSchema (+19 more)

### Community 375 - "TypeScript開発環境・ツールチェーン整備 設計ドキュメント (Issue #250)"
Cohesion: 0.11
Nodes (18): 1. 決定済み事項（Issue #250コメントより。比較検討は不要、決定と理由のみ記録する）, 2.1 pnpm workspaceのディレクトリ構成, 2.2 CI `pull_request`トリガーの広げ方, 2.3 vitestカバレッジ閾値の設定方法, 2.4 CIでのNix利用, 2.5 git hook（pre-commit）の実行主体: husky vs 既存pre-commitフレームワーク, 2. 要検討事項（比較表 + 採用/却下理由）, 3. Nix flakeに関する運用上の注意（重要） (+10 more)

### Community 377 - "A2A API 実装プラン"
Cohesion: 0.25
Nodes (7): A2A API 実装プラン, Context, アーキテクチャ上の重要な選択, 停止条件, 実装フロー, 検証対象 PR, 環境変数・.env ファイル

### Community 378 - "pr-info-collector.test.ts"
Cohesion: 0.10
Nodes (18): isInfraError(), StructuredOutputMissingError, BASE_CONFIG, createDispatch(), DispatchConfig, mcpErrorResult(), mcpJsonResult(), mcpTextResult() (+10 more)

### Community 379 - "fetch_pr_files"
Cohesion: 0.16
Nodes (10): fetch_pr_files(), _is_allowed_url(), _is_rate_limited(), Any, HTTPError, Shared GitHub REST API client for evaluation dataset builders. Extracted from…, Fetch changed files for a PR via GET /repos/{owner}/{repo}/pulls/{pr}/files.…, Only follows redirects that stay on https://api.github.com. Python's stdlib… (+2 more)

### Community 380 - "resolve_defect_line"
Cohesion: 0.32
Nodes (5): MarkerHit, One INTENTIONAL marker's location within a single file's patch. ``hunk`` is a…, Resolve the new-file line number of the defect a marker points at. With…, resolve_defect_line(), TestResolveDefectLine

### Community 381 - "a2a_poll"
Cohesion: 0.27
Nodes (11): a2a_poll(), a2a_send(), Any, Client, Shared A2A HTTP client helpers for evaluation scripts. Both…, POST a task to an A2A endpoint and return the task_id. Returns: The ``task.id``…, Poll until the task completes. Return the data part or raise on…, _format_report() (+3 more)

### Community 382 - "agent-core/package.json"
Cohesion: 0.05
Nodes (36): default, development, types, default, development, types, default, development (+28 more)

### Community 383 - "compilerOptions"
Cohesion: 0.12
Nodes (15): ESNext, compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module (+7 more)

### Community 384 - "2. 要検討事項（比較表 + 採用/却下理由）"
Cohesion: 0.14
Nodes (13): 1. 決定済み事項（本Issue着手前に確定していたもの）, 2.1 Zodのバージョン, 2.2 Enum表現, 2.3 フィールド命名（camelCase化）, 2.4 Nullable値の表現, 2.5 `ReviewContext.shared_mcp_client`の扱い, 2.6 `LeadEngineerReport`の振る舞い(accepted/rejected/to_markdown/to_evaluation_format), 2.7 ファイル配置とプレースホルダの扱い (+5 more)

### Community 385 - "agent-skills-factory.ts"
Cohesion: 0.23
Nodes (13): buildAngularReviewSkills(), buildReactReviewSkills(), buildSvelteReviewSkills(), buildVueReviewSkills(), buildWebSecurityReviewSkills(), createAgentSkills(), skillPath(), SKILLS_DIR (+5 more)

### Community 386 - "health/index.ts"
Cohesion: 0.22
Nodes (10): createHealthRoute(), CreateHealthRouteOptions, createHealthService(), HealthService, HealthRequest, HealthRequestSchema, HealthHttpResponse, HealthHttpResponseSchema (+2 more)

### Community 387 - "lead-engineer.service.ts"
Cohesion: 0.10
Nodes (17): A2ALeadEngineerSettings, createLeadEngineerService(), DEFAULT_LEAD_ENGINEER_SETTINGS, extractData(), InMemoryLeadEngineerTaskStore, jsonSchemaWithOptionalDefaults(), LeadEngineerAgentClass, LeadEngineerConfig (+9 more)

### Community 388 - "base-reviewer.review.test.ts"
Cohesion: 0.20
Nodes (7): { mockAgentCtor, mockInvoke, mockCreateModelProvider, mockCreateGithubMcpClient }, NoMcpReviewer, ReviewContext, ReviewerConfig, SkillsReviewer, StubReviewer, UrlFetchReviewer

### Community 389 - "agent-core/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, composite, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 390 - "evaluation/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, composite, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 391 - "tool-result-sanitizer.ts"
Cohesion: 0.39
Nodes (3): isUnsupported(), OllamaUnsupportedContentSanitizer, UNSUPPORTED_CONTENT_CLASSES

### Community 392 - "A2ASendTaskRequest"
Cohesion: 0.13
Nodes (6): A2ASendTaskRequest, A2ASendTaskResponse, AgentCard, LeadEngineerService, OrchestratorService, PrInfoService

### Community 393 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, composite, outDir, rootDir, types, extends, include, src (+2 more)

### Community 394 - "evaluation/package.json"
Cohesion: 0.29
Nodes (6): main, name, private, type, types, version

### Community 395 - "lead-engineer.evaluate.test.ts"
Cohesion: 0.33
Nodes (4): CONFIG, { mockAgentCtor, mockInvoke, mockCreateModelProvider }, ReviewerConfig, ReviewReport

### Community 396 - "TestCreateAgentSkills"
Cohesion: 0.22
Nodes (5): parametrize, Guards against #143: a skill's declared name and its parent directory name…, TestCreateAgentSkills, TestNone, TestSkillNameMatchesDirectory

### Community 397 - "model-provider-spike.ts"
Cohesion: 0.50
Nodes (3): ollamaModel, ollamaProvider, openaiCompatModel

### Community 398 - "test_vue_reviewer.py"
Cohesion: 0.24
Nodes (8): _make_app(), _pr_info_payload(), asyncio, FastAPI, TaskStore, _send_payload(), TestGetTask, TestSendTask

### Community 399 - "指摘単位3軸評価仕様 (Issue #168)"
Cohesion: 0.22
Nodes (9): 1. 目的, 2. 全体データフロー, 3. 軸の定義, 4. Goldラベルの生成, 5. Lead Engineer出力, 6. 照合と採点, 7. 受入条件, 8. テスト方針 (+1 more)

### Community 400 - "._resolve_decisions"
Cohesion: 0.21
Nodes (9): FindingDecision, FindingDecisionOutput, LeadEngineerReport, ReviewFinding, ReviewPerspective, ReviewReport, Build the evaluation prompt and a finding-index map simultaneously. Each…, Resolve LLM output indexes to original findings. Normalises the LLM output to… (+1 more)

### Community 406 - "12. セキュリティ設計"
Cohesion: 0.25
Nodes (8): 12.1 API 認証方式, 12.2 `llm_base_url` の扱い（SSRF 対策）, 12.3 `github_token` のリクエストボディへの混入, 12.4 例外メッセージへのトークン漏洩対策, 12.5 TaskStore TTL, 12.6 TLS（HTTPS）必須化, 12.7 AgentCard によるサービストポロジーの公開（将来の対応事項）, 12. セキュリティ設計

### Community 407 - "6. 環境変数リファレンス"
Cohesion: 0.25
Nodes (8): 6.1.1 `GITHUB_TOKEN` の扱いについて, 6.1 必須環境変数, 6.2 サービス設定（任意・デフォルト値あり）, 6.3 LLM プロバイダー・モデル設定（任意）, 6.4 AgentCard URL 設定（任意・モノリス構成では設定不要）, 6.5 GitHub MCP エンドポイント（任意）, 6.6 `.env` ファイル例（クイックスタート）, 6. 環境変数リファレンス

### Community 408 - "revalidate_existing_targets"
Cohesion: 0.50
Nodes (3): Revalidate existing classified targets against shared Gold criteria. Returns:…, revalidate_existing_targets(), TestRevalidateExistingTargets

### Community 413 - "10. 検証手順"
Cohesion: 0.33
Nodes (6): 10.1 ローカル起動, 10.2 AgentCard 確認, 10.3 フルワークフロー（Orchestrator）の検証, 10.4 Ollama 切り替えテスト, 10.5 既存テストの通過確認, 10. 検証手順

### Community 414 - "13. TypeScript/Zod モデル移行仕様"
Cohesion: 0.29
Nodes (7): 13.1 対象と配置, 13.2 命名と互換性, 13.3 検証境界, 13.4 Zod 規約, 13.5 テスト, 13.6 Health service と route の責務, 13. TypeScript/Zod モデル移行仕様

### Community 415 - "4. 各エージェントの AgentCard 定義"
Cohesion: 0.33
Nodes (6): 4.1 PR Info Collector, 4.2 React Code Reviewer, 4.3 Security Reviewer, 4.4 Lead Engineer, 4.5 Orchestrator（フルワークフロー）, 4. 各エージェントの AgentCard 定義

### Community 416 - "parse_hunk_new_start"
Cohesion: 0.47
Nodes (3): parse_hunk_new_start(), Extract the new-file start line `c` from `@@ -a,b +c,d @@`. Falls back to 1 on…, TestParseHunkNewStart

### Community 419 - "1. 概要"
Cohesion: 0.50
Nodes (4): 1.1 目的, 1.2 採用プロトコル, 1.3 デプロイ構成, 1. 概要

### Community 420 - "5. FastAPI アプリケーション構成"
Cohesion: 0.50
Nodes (4): 5.1 `api/app.py`, 5.2 エンドポイント共通テンプレート, 5.3 `__init__.py` の `main()` 変更, 5. FastAPI アプリケーション構成

### Community 421 - "Injection Context"
Cohesion: 0.40
Nodes (4): `assertInInjectionContext`, Injection Context, `runInInjectionContext`, Where is an Injection Context Available?

### Community 422 - "Automatic Migrations & Code Modernization"
Cohesion: 0.40
Nodes (4): Automatic Migrations & Code Modernization, Common Migration Schematics, Discovering Migrations, Specialized Workflow: Migrating to Standalone

### Community 423 - "9. 既存コードの変更点"
Cohesion: 0.67
Nodes (3): 9.1 `ReviewerConfig` の拡張, 9.2 `OpenAIModel` 生成部の変更（`LLMReviewAgent`, `PRInfoCollector`, `LeadEngineerAgent`）, 9. 既存コードの変更点

### Community 424 - "test_svelte_reviewer.py"
Cohesion: 0.26
Nodes (7): _make_app(), _pr_info_payload(), asyncio, FastAPI, TaskStore, _send_payload(), TestGetTask

### Community 425 - "reviewers.route.ts"
Cohesion: 0.11
Nodes (18): hono, hono, createGithubAuthMiddleware(), GithubAuthEnv, GithubAuthMiddlewareOptions, GithubAuthVariables, callMiddleware(), A2ASendTaskRequestSchema (+10 more)

### Community 427 - "verify_a2a_api.py"
Cohesion: 0.43
Nodes (7): main(), _poll_task(), Run one agent check. Returns: ``True`` on success, ``False`` on timeout or…, _require_env(), _send_task(), _verify_agent(), _write_result()

### Community 428 - "load_eval_tool_module"
Cohesion: 0.17
Nodes (6): ModuleType, load_eval_tool_module(), Shared helpers for testing standalone scripts under evaluation/tools/.…, Load a module from evaluation/tools/<filename> under the given name.…, Tests for evaluation/tools/target_criteria.py., TestInlineReviewCriteria

### Community 430 - "TestFindingDecisionOutput"
Cohesion: 0.36
Nodes (3): parametrize, Tests for the LLM output schema (finding_index reference style)., TestFindingDecisionOutput

### Community 431 - "._build_model"
Cohesion: 0.40
Nodes (3): Model, Build the model for README summarisation. Returns: Model: Configured via…, Summarise the README with a single tool-free LLM call. Returns: The 2-4…

## Knowledge Gaps
- **1841 isolated node(s):** `common.sh script`, `start_a2a_container.sh script`, `stop_a2a_container.sh script`, `uvx`, `start-mcp-server` (+1836 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **120 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ReviewerConfig` connect `ReviewerConfig` to `_context`, `ReviewPerspective`, `A2ADataPart`, `._agent`, `ReviewError`, `TestStructuredOutputDirective`, `TestLeadEngineerAgentEvaluate`, `Settings`, `PRInfoResult`, `TestAnnotatePatch`, `get_reviewer_classes`, `TestSvelteReviewer`, `.__init__`, `sanitize_error`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `ProviderType` connect `ReviewerConfig` to `make_finding`, `ReviewPerspective`, `A2ADataPart`, `._agent`, `Any`, `PRInfoResult`, `TestLeadEngineerAgentEvaluate`, `tests/agents/test_pr_info_collector.py`, `TestAnnotatePatch`, `_IsolatedSettings`, `TestPRInfoCollectorCollect`, `TestExtractHeadRef`, `OllamaUnsupportedContentSanitizer`, `TestExtractLabelNames`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `setup_logging()` connect `setup_logging` to `make_finding`, `discover_candidate_prs.py`, `verify_a2a_api.py`, `build_seeded_set.py`, `run_agent_evaluation.py`, `build_gold_set.py`, `select_stack_targets.py`, `a2a_poll`, `generate_evaluation_report.py`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Are the 39 inferred relationships involving `ReviewerConfig` (e.g. with `StructuredOutputMissingError` and `ProviderType`) actually correct?**
  _`ReviewerConfig` has 39 INFERRED edges - model-reasoned connections that need verification._
- **Are the 76 inferred relationships involving `PRInfoResult` (e.g. with `LeadEngineerSkillInput` and `ReviewerSkillInput`) actually correct?**
  _`PRInfoResult` has 76 INFERRED edges - model-reasoned connections that need verification._
- **Are the 74 inferred relationships involving `ReviewPerspective` (e.g. with `DecisionVerdict` and `FindingDecision`) actually correct?**
  _`ReviewPerspective` has 74 INFERRED edges - model-reasoned connections that need verification._
- **Are the 33 inferred relationships involving `Settings` (e.g. with `TestAgentCard` and `TestGetTask`) actually correct?**
  _`Settings` has 33 INFERRED edges - model-reasoned connections that need verification._