# Graph Report - .  (2026-09-12)

## Corpus Check
- Large corpus: 528 files · ~304,050 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 2342 nodes · 4192 edges · 172 communities (126 shown, 46 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 161 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Evaluation PR Discovery CLI
- Angular/React Reviewer Services
- Lead Engineer Agent
- Web App Entry & Routing
- web-api Package Dependencies
- agent-core Package Manifest
- Seeded Set Builder
- Review Mock Seed Data
- Base LLM Reviewer
- Root Package Dependencies
- Stack Target Selection
- Framework Review Skills Reference
- Evaluation Report Generator
- Evaluation Package CLI Bins
- A2A Protocol Message Schemas
- Svelte Runes Reference
- Model Provider & Ollama Sanitizer Design
- Review Orchestrator Errors
- Evaluation Score Matching
- A2A Server App & Auth Middleware
- A2A Orchestrator Service
- A2A Request Model Schemas
- A2A Lead Engineer Service
- Gold Set Builder
- Agent Evaluation Runner
- Model Provider Factory
- Web Frontend UI Dependencies
- A2A Task Store Interfaces
- web tsconfig.app.json
- React Testing Dependencies
- web-api App Bootstrap & Config
- Root Biome Config
- Angular Core Concepts Reference
- Project Manifest Detection
- PR Info Collector
- Review API Fixtures
- PR Info A2A Service
- Reviews Store
- Reviews Route Params & Schemas
- GitHub Settings API
- Finding Axis Evaluation Design
- Seeded Set Generation Design
- TypeScript Migration Plan Deviations
- a2a-server Package Dependencies
- OWASP Insecure Design & Integrity Checks
- Review List Schemas
- web-api tsconfig.node.json
- Prediction Merge Tool
- A2A Agent Card & Task RPC
- Health Check Route
- GitHub REST Client
- Review Row UI Component
- Base Image & Toolchain Migration Notes
- Frontend Agent Skills Design
- React Best Practices Rules (Effects/Async)
- Repo Governance & CI Docs
- Agent Skills Factory
- web Biome Config
- Base tsconfig
- Angular Reactive Forms
- Structured Logger
- Review Domain Enums
- OpenAPI Contract Test
- web-api tsconfig.json
- Review List Page UI
- Discord Notification Sender
- Mockup App Shell JS
- GitHub MCP Streamable HTTP Migration
- Evaluation Plan & Rubric Docs
- Vue/Svelte Framework Review Checks
- Review List Local State Hook
- A2A API Design & ADR-0001/0002
- Flow Control ADRs (0007-0012)
- a2a-server tsconfig
- Root Package Scripts
- Review List Page Tests
- PR Review Agent Screen Specs
- TypeScript Language Review Checks
- Base Reviewer Unit Tests
- Reviews Store Methods
- MCP Connection Stabilization Design
- Mock Data Store JS
- Review Mockup HTML Pages
- Angular Signal Forms & resource()
- Angular Router Guards & Events
- React/Svelte Review Checks (XSS/Effects)
- agent-core tsconfig
- JSONL Atomic Write Utilities
- evaluation tsconfig
- web-api Biome Config
- Package Dev Guides (AGENTS/CLAUDE.md)
- Ollama Tool Result Sanitizer
- RepoGroup UI Component
- Review Knowledge Provisioning Options
- a2a-server Config Loader
- Target File Detection Utility
- Angular Animations & Aria Reference
- Angular Review Checks
- React Rendering Best Practices
- Lead Engineer Evaluate Test
- Reviewer Registry Test
- MCP Startup Retry & Session Sharing (ADRs 3-4)
- Frontend/Svelte Skills Implementation Plan
- Angular Router Testing Harness
- React Composition Patterns
- web Package Manifest
- Structured Logging Migration Design
- Eval Pipeline Container & Sharding
- Worktree Plugin Progress Notification
- Serena MCP Config
- Rendering Strategy Concepts (CSR/SSR/SSG)
- Angular Template-Driven Forms
- Docstring Lint Policy
- Eval Structured Logging Module
- Evaluation Pipeline Shell Script
- Angular Pipes (Impure)
- Bundle Deferral Rules
- Event Listener Optimization Rules
- JS Caching Rules
- Array Comparison Optimization Rules
- React Conditional Rendering Rules
- React Memoization Rules
- web tsconfig
- Root tsconfig
- Eval Report Per-Item Detail Design
- Angular CurrencyPipe
- Angular DatePipe
- Angular DecimalPipe
- Angular PercentPipe
- Angular View Transitions
- Angular RouterOutlet Data
- Angular Tailwind Integration
- Array Iteration Combine Rules
- Lookup Map Optimization Rules
- SVG Rendering Optimization Rules
- Hydration Mismatch Rules
- Resource Hint Rules
- React setState Optimization Rules
- React Transition Rules
- RSC Server Caching Rules
- RSC Serialization Rules
- Server I/O Hoisting Rules
- Parallel Data Fetching Rules
- GitHub MCP Client Test
- react-i18next Dependency
- Babel Rolldown Plugin Dependency
- TanStack Router Plugin Dependency
- Jest DOM Testing Library Dependency
- TypeScript Dependency
- Vite Dependency
- Bug Report Issue Template
- Feature Request Issue Template
- Container Security Scan Workflow
- ADR-0005 Gold-Set Canonicalization
- React Rule Sections Metadata
- Conditional Module Loading Rule
- Defer Third-Party Libraries Rule
- localStorage Data Rule
- Layout Thrashing Rule
- Early Return Rule
- Hoist RegExp Rule
- Explicit Conditional Rendering Rule
- CSS content-visibility Rule
- Split Combined Hooks Rule
- useRef Transient Values Rule
- after() Non-Blocking Rule

## God Nodes (most connected - your core abstractions)
1. `A2ATask` - 26 edges
2. `ProjectType` - 26 edges
3. `ReviewPerspective` - 24 edges
4. `createReviewerService()` - 23 edges
5. `LLMReviewAgent` - 20 edges
6. `compilerOptions` - 19 edges
7. `createOrchestratorService()` - 18 edges
8. `ReviewContext` - 18 edges
9. `agents/ + tools/ TypeScript Migration Spec (Issue #252)` - 18 edges
10. `createLeadEngineerService()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `ADR-0010: システム全体LLM同時実行上限（ProviderSemaphore+協調キャンセル採用）` --references--> `loadServerSettingsFromEnv()`  [EXTRACTED]
  docs/adr/0010-localllm-concurrency-limit-and-cancellation.md → packages/a2a-server/src/config.ts
- `ADR-0010: システム全体LLM同時実行上限（ProviderSemaphore+協調キャンセル採用）` --references--> `LLMReviewAgent`  [EXTRACTED]
  docs/adr/0010-localllm-concurrency-limit-and-cancellation.md → packages/agent-core/src/agents/base-reviewer.ts
- `ADR-0010: システム全体LLM同時実行上限（ProviderSemaphore+協調キャンセル採用）` --references--> `createModelProvider()`  [EXTRACTED]
  docs/adr/0010-localllm-concurrency-limit-and-cancellation.md → packages/agent-core/src/agents/model-provider-factory.ts
- `ADR-0008: コア機能と拡張機能のパッケージ境界・レイヤリング（段階移行案2採用）` --references--> `registerReviewer()`  [EXTRACTED]
  docs/adr/0008-core-extension-boundaries.md → packages/agent-core/src/agents/registry.ts
- `ADR-0010: システム全体LLM同時実行上限（ProviderSemaphore+協調キャンセル採用）` --references--> `ReviewOrchestrator`  [EXTRACTED]
  docs/adr/0010-localllm-concurrency-limit-and-cancellation.md → packages/agent-core/src/agents/review-orchestrator.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Issue #115 MCP Stability Remediation (ADR-0003 + ADR-0004)** — concept_issue_115_mcp_connection_instability, docs_adr_0003_github_mcp_startup_retry_strategy_doc, docs_adr_0004_mcp_client_session_sharing_doc [EXTRACTED 1.00]
- **A2A API Security Design Decisions (§7)** — concept_a2a_auth_github_oauth, concept_a2a_ssrf_mitigation, concept_a2a_token_sanitization, concept_a2a_task_store [EXTRACTED 1.00]
- **Large-PR Patch Handling: Failure Mode & Remediation** — concept_issue_54_large_pr_patch_limit, concept_binary_patch_fallback_failure, docs_adr_0001_large_diff_review_scope_policy_doc [EXTRACTED 1.00]
- **LocalLLM流量制御・アーキテクチャ境界ADR意思決定群（ADR-0007〜0012）** — docs_adr_0007_multi_container_architecture_for_scalability, docs_adr_0008_core_extension_boundaries, docs_adr_0009_localllm_review_flow_control, docs_adr_0010_localllm_concurrency_limit_and_cancellation, docs_adr_0011_localllm_delivery_contract_and_recovery, docs_adr_0012_shared_invocation_boundary [EXTRACTED 1.00]
- **PR Review Agent 画面外部設計書一式（SCR-01〜04＋総論）** — docs_display_spec_index, docs_display_spec_review_list, docs_display_spec_review_request, docs_display_spec_review_result, docs_display_spec_settings [EXTRACTED 1.00]
- **評価パイプライン設計ドキュメント群（データ生成〜実行環境）** — docs_evaluation_pipeline_design, docs_goldset_per_stack_spec, docs_eval_seeded_repo_based_generation_spec, docs_eval_a2a_container_runtime_spec, docs_eval_sharded_execution_spec [EXTRACTED 1.00]
- **PR Review Agent モックアップ4画面フロー(登録→結果確認→close)** — docs_mocks_index, docs_mocks_review_request, docs_mocks_review_result, docs_mocks_settings [INFERRED 0.85]
- **Review/ReviewAttempt/A2ATask identity階層(ADR-0012 §3)** — docs_openapi_reviews_review, docs_openapi_reviews_reviewattempt, docs_openapi_reviews_a2atask [EXTRACTED 1.00]
- **A2A APIセキュリティ設計判断群(§12: 認証・SSRF・トークン漏洩・TTL)** — docs_plan_a2a_api_implementation_llm_base_url_ssrf, docs_plan_a2a_api_implementation_github_oauth_auth, docs_plan_a2a_api_implementation_sanitize_error, docs_plan_a2a_api_implementation_taskstore_ttl [EXTRACTED 1.00]
- **TypeScript移行Epic(#249配下 Sub-Issue #250→#251→#252→#254の連鎖)** — docs_plan_typescript_toolchain_spec, docs_plan_typescript_models_migration_spec, docs_plan_typescript_evaluation_migration_spec, docs_plan_typescript_agents_tools_migration_spec [EXTRACTED 1.00]
- **スタック別レビュアー拡張(React/Angular/Svelte/Vue対応とAgentSkillType拡張)** — docs_plan_react_angular_agent_skills_spec, docs_plan_svelte_agent_skills_spec, docs_plan_seeded_reviewer_stack_routing_spec [INFERRED 0.85]
- **GitHub MCPクライアントのライフサイクル堅牢化(transport/接続安定化/決定論的呼び出し)** — docs_plan_github_mcp_streamable_http_migration_spec, docs_plan_mcp_connection_stabilization_spec, docs_plan_pr_info_collector_tooluse_fix_spec [INFERRED 0.85]
- **PR Info Collector hallucination-fix evolution (bug -> Plan A -> Plan E) with measurement reports** — docs_pr_info_collector_tooluse_fix_spec_tooluse_hallucination_bug, docs_pr_info_collector_tooluse_fix_spec_plana_tool_loop_separation, docs_pr_info_collector_tooluse_fix_spec_plane_deterministic_collection, evaluation_pr_collector_accuracy_gemma4_e4b_after_fix, evaluation_pr_collector_accuracy_gemma4_e4b_deterministic [INFERRED 0.90]
- **Parallel review stage extensibility architecture (registry + orchestrator + per-stack reviewer skills)** — docs_review_agents_design_reviewer_matrix, docs_review_agents_design_registry, docs_review_agents_design_review_orchestrator, docs_react_angular_agent_skills_spec_react_review_skill, docs_react_angular_agent_skills_spec_angular_review_skill, docs_svelte_agent_skills_spec_svelte_review_skill [INFERRED 0.85]
- **Epic #249 TypeScript migration stacked sub-issue chain (toolchain -> models -> agents/tools -> evaluation -> evaluation runner)** — docs_typescript_toolchain_spec, docs_typescript_models_migration_spec, docs_typescript_agents_tools_migration_spec, docs_typescript_evaluation_migration_spec, docs_ts_agent_evaluation_runner_spec [EXTRACTED 1.00]
- **Angular Dependency Injection System** — packages_agent_core_skills_angular_developer_references_creating_services_service, packages_agent_core_skills_angular_developer_references_di_fundamentals_di, packages_agent_core_skills_angular_developer_references_injection_context_context, packages_agent_core_skills_angular_developer_references_hierarchical_injectors_injector, packages_agent_core_skills_angular_developer_references_defining_providers_provider [INFERRED 0.85]
- **Angular Signals Reactive Primitives** — packages_agent_core_skills_angular_developer_references_inputs_input, packages_agent_core_skills_angular_developer_references_outputs_output, packages_agent_core_skills_angular_developer_references_effects_effect, packages_agent_core_skills_angular_developer_references_linked_signal_linkedsignal [INFERRED 0.85]
- **Angular Router Navigation Flow** — packages_agent_core_skills_angular_developer_references_define_routes_route, packages_agent_core_skills_angular_developer_references_navigate_to_routes_navigation, packages_agent_core_skills_angular_developer_references_data_resolvers_resolver, packages_agent_core_skills_angular_developer_references_loading_strategies_loading [INFERRED 0.80]
- **Angular Router feature documentation set (guards, lifecycle, testing, outlets, animations)** — packages_agent_core_skills_angular_developer_references_route_guards_canactivate, packages_agent_core_skills_angular_developer_references_router_lifecycle_routerevents, packages_agent_core_skills_angular_developer_references_router_testing_routertestingharness, packages_agent_core_skills_angular_developer_references_show_routes_with_outlets_routeroutlet, packages_agent_core_skills_angular_developer_references_route_animations_withviewtransitions [INFERRED 0.85]
- **Angular form-building strategies (Reactive, Template-driven, Signal Forms)** — packages_agent_core_skills_angular_developer_references_reactive_forms_reactiveforms, packages_agent_core_skills_angular_developer_references_template_driven_forms_templatedrivenforms, packages_agent_core_skills_angular_developer_references_signal_forms_signalforms [INFERRED 0.85]
- **Cross-framework unsanitized-HTML-injection XSS review checks** — packages_agent_core_skills_reviewing_frameworks_references_angular_innerhtmlxss, packages_agent_core_skills_reviewing_frameworks_references_react_dangerouslysetinnerhtmlxss, packages_agent_core_skills_reviewing_frameworks_references_svelte_htmlxss, packages_agent_core_skills_reviewing_frameworks_references_vue_vhtmlxss [INFERRED 0.85]
- **Environment variable exposure across meta-frameworks and security reviews** — packages_agent_core_skills_reviewing_metaframeworks_references_nextjs, packages_agent_core_skills_reviewing_metaframeworks_references_nuxtjs, packages_agent_core_skills_reviewing_metaframeworks_references_sveltekit, packages_agent_core_skills_reviewing_universal_references_security, packages_agent_core_skills_reviewing_web_security_references_05_secrets_exposure, packages_agent_core_skills_reviewing_web_security_references_08_config_env [INFERRED 0.75]
- **OWASP Top 10 2025 categories mapped to web-security review reference files** — packages_agent_core_skills_reviewing_web_security_skill, packages_agent_core_skills_reviewing_web_security_skill_owasp_a01_broken_access_control, packages_agent_core_skills_reviewing_web_security_skill_owasp_a02_security_misconfiguration, packages_agent_core_skills_reviewing_web_security_skill_owasp_a03_supply_chain_failures, packages_agent_core_skills_reviewing_web_security_skill_owasp_a04_cryptographic_failures, packages_agent_core_skills_reviewing_web_security_skill_owasp_a05_injection, packages_agent_core_skills_reviewing_web_security_skill_owasp_a07_authentication_failures [EXTRACTED 1.00]
- **XSS, SQLi, Command Injection, SSTI, and XXE unified by 'confusing data with instructions' root cause** — packages_agent_core_skills_reviewing_web_security_references_01_input_output_xss, packages_agent_core_skills_reviewing_web_security_references_01_input_output_sql_injection, packages_agent_core_skills_reviewing_web_security_references_01_input_output_command_injection, packages_agent_core_skills_reviewing_web_security_references_01_input_output_ssti, packages_agent_core_skills_reviewing_web_security_references_01_input_output_xxe [EXTRACTED 1.00]
- **OWASP Top 10 2025 Categories Covered by Review Skill** — packages_agent_core_skills_reviewing_web_security_references_09_insecure_design_owasp_top_10_2025, packages_agent_core_skills_reviewing_web_security_references_09_insecure_design_a06_2025_insecure_design, packages_agent_core_skills_reviewing_web_security_references_10_integrity_failures_a08_2025_software_data_integrity_failures, packages_agent_core_skills_reviewing_web_security_references_11_ssrf_logging_a09_2025_security_logging_alerting_failures, packages_agent_core_skills_reviewing_web_security_references_12_exception_handling_a10_2025_mishandling_exceptional_conditions [EXTRACTED 1.00]
- **Preferred escape hatches instead of $effect** — packages_agent_core_skills_svelte_core_bestpractices_skill_effect_rune, packages_agent_core_skills_svelte_core_bestpractices_references__attach_doc, packages_agent_core_skills_svelte_core_bestpractices_references_bind_doc, packages_agent_core_skills_svelte_core_bestpractices_references__inspect_doc, packages_agent_core_skills_svelte_core_bestpractices_references_svelte_reactivity_doc [INFERRED 0.85]
- **React Composition Core Principles** — packages_agent_core_skills_vercel_composition_patterns_rules_architecture_avoid_boolean_props_boolean_prop_proliferation, packages_agent_core_skills_vercel_composition_patterns_rules_architecture_compound_components_compound_components, packages_agent_core_skills_vercel_composition_patterns_agents_generic_context_interfaces, packages_agent_core_skills_vercel_composition_patterns_agents_lift_state_into_providers, packages_agent_core_skills_vercel_composition_patterns_rules_patterns_children_over_render_props_children_over_render_props [EXTRACTED 1.00]
- **Provider-based Dependency-Injectable State Pattern** — packages_agent_core_skills_vercel_composition_patterns_rules_state_lift_state_lift_state_into_provider_components, packages_agent_core_skills_vercel_composition_patterns_rules_state_decouple_implementation_decouple_state_management_from_ui, packages_agent_core_skills_vercel_composition_patterns_rules_state_context_interface_generic_context_interfaces_for_dependency_injection [INFERRED 0.85]
- **Eliminating Waterfalls Rule Group (Section 1)** — packages_agent_core_skills_vercel_react_best_practices_rules_async_cheap_condition_before_await_check_cheap_conditions_before_async_flags, packages_agent_core_skills_vercel_react_best_practices_rules_async_defer_await_defer_await_until_needed, packages_agent_core_skills_vercel_react_best_practices_rules_async_dependencies_dependency_based_parallelization, packages_agent_core_skills_vercel_react_best_practices_rules_async_api_routes_prevent_waterfall_chains_in_api_routes, packages_agent_core_skills_vercel_react_best_practices_rules_async_parallel_promise_all_for_independent_operations, packages_agent_core_skills_vercel_react_best_practices_rules_async_suspense_boundaries_strategic_suspense_boundaries [EXTRACTED 1.00]
- **Advanced Patterns Rule Group (Section 8)** — packages_agent_core_skills_vercel_react_best_practices_rules_advanced_effect_event_deps_do_not_put_effect_events_in_dependency_arrays, packages_agent_core_skills_vercel_react_best_practices_rules_advanced_event_handler_refs_store_event_handlers_in_refs, packages_agent_core_skills_vercel_react_best_practices_rules_advanced_init_once_initialize_app_once_not_per_mount, packages_agent_core_skills_vercel_react_best_practices_rules_advanced_use_latest_useeffectevent_for_stable_callback_refs [EXTRACTED 1.00]
- **Bundle/Code-Splitting Optimization Patterns** — packages_agent_core_skills_vercel_react_best_practices_rules_bundle_conditional_conditional_module_loading, packages_agent_core_skills_vercel_react_best_practices_rules_bundle_defer_third_party_defer_non_critical_third_party_libraries, packages_agent_core_skills_vercel_react_best_practices_rules_bundle_dynamic_imports_dynamic_imports_for_heavy_components, packages_agent_core_skills_vercel_react_best_practices_rules_bundle_preload_preload_based_on_user_intent [INFERRED 0.80]
- **JS Result/Storage Caching Patterns** — packages_agent_core_skills_vercel_react_best_practices_rules_js_cache_function_results_cache_repeated_function_calls, packages_agent_core_skills_vercel_react_best_practices_rules_js_cache_property_access_cache_property_access_in_loops, packages_agent_core_skills_vercel_react_best_practices_rules_js_cache_storage_cache_storage_api_calls [INFERRED 0.80]
- **Array Iteration Efficiency Patterns** — packages_agent_core_skills_vercel_react_best_practices_rules_js_combine_iterations_combine_multiple_array_iterations, packages_agent_core_skills_vercel_react_best_practices_rules_js_flatmap_filter_use_flatmap_to_map_and_filter_in_one_pass, packages_agent_core_skills_vercel_react_best_practices_rules_js_min_max_loop_use_loop_for_min_max_instead_of_sort, packages_agent_core_skills_vercel_react_best_practices_rules_js_length_check_first_early_length_check_for_array_comparisons [INFERRED 0.75]
- **React Compiler makes manual optimization unnecessary** — packages_agent_core_skills_vercel_react_best_practices_rules_rendering_hoist_jsx_hoist_static_jsx, packages_agent_core_skills_vercel_react_best_practices_rules_rerender_functional_setstate_functional_setstate, packages_agent_core_skills_vercel_react_best_practices_rules_rerender_memo_extract_memoized_components [EXTRACTED 0.90]
- **Effect-avoidance guidance derived from 'You Might Not Need an Effect'** — packages_agent_core_skills_vercel_react_best_practices_rules_rerender_derived_state_no_effect_derived_state_no_effect, packages_agent_core_skills_vercel_react_best_practices_rules_rerender_move_effect_to_event_move_effect_to_event, packages_agent_core_skills_vercel_react_best_practices_rules_rerender_dependencies_narrow_effect_dependencies [INFERRED 0.85]
- **Correct usage patterns for memo/useMemo** — packages_agent_core_skills_vercel_react_best_practices_rules_rerender_memo_extract_memoized_components, packages_agent_core_skills_vercel_react_best_practices_rules_rerender_memo_with_default_value_memo_default_value, packages_agent_core_skills_vercel_react_best_practices_rules_rerender_simple_expression_in_memo_simple_expression_in_memo [INFERRED 0.85]
- **Server-Side Caching Techniques (per-request, cross-request, module-level)** — packages_agent_core_skills_vercel_react_best_practices_rules_server_cache_react_per_request_deduplication_with_react_cache, packages_agent_core_skills_vercel_react_best_practices_rules_server_cache_lru_cross_request_lru_caching, packages_agent_core_skills_vercel_react_best_practices_rules_server_hoist_static_io_hoist_static_io_to_module_level [INFERRED 0.75]
- **RSC Data-Flow and Serialization Optimization Group** — packages_agent_core_skills_vercel_react_best_practices_rules_server_dedup_props_avoid_duplicate_serialization_in_rsc_props, packages_agent_core_skills_vercel_react_best_practices_rules_server_serialization_minimize_serialization_at_rsc_boundaries, packages_agent_core_skills_vercel_react_best_practices_rules_server_parallel_fetching_parallel_data_fetching_with_component_composition, packages_agent_core_skills_vercel_react_best_practices_rules_server_parallel_nested_fetching_parallel_nested_data_fetching [INFERRED 0.85]
- **Duplicate AGENTS.md/CLAUDE.md Package Guide Pattern** — packages_web_api_agents_web_api_development_guide, packages_web_api_claude_web_api_development_guide, packages_web_agents_web_frontend_development_guide, packages_web_claude_web_frontend_development_guide [EXTRACTED 1.00]

## Communities (172 total, 46 thin omitted)

### Community 0 - "Evaluation PR Discovery CLI"
Cohesion: 0.07
Nodes (51): asNumber(), asObject(), asObjectArray(), asString(), buildTarget(), CliOptions, collectReviewTexts(), createCli() (+43 more)

### Community 1 - "Angular/React Reviewer Services"
Cohesion: 0.07
Nodes (38): createAngularReviewerRoute(), AngularReviewerServiceOptions, createAngularReviewerService(), createReactReviewerRoute(), createReactReviewerService(), ReactReviewerServiceOptions, A2AReviewerSettings, createReviewerService() (+30 more)

### Community 2 - "Lead Engineer Agent"
Cohesion: 0.11
Nodes (42): buildPromptAndIndex(), IndexEntry, LeadEngineerAgent, resolveDecisions(), acceptedDecisions(), byVerdict(), DecisionVerdict, EvaluationFormat (+34 more)

### Community 3 - "Web App Entry & Routing"
Cohesion: 0.06
Nodes (32): queryClient, Register, rootElement, router, @tanstack/react-router, indexSearchSchema, Route, Route (+24 more)

### Community 4 - "web-api Package Dependencies"
Cohesion: 0.04
Nodes (45): better-sqlite3, dotenv, drizzle-kit, drizzle-orm, @hono/zod-openapi, dependencies, better-sqlite3, dotenv (+37 more)

### Community 5 - "agent-core Package Manifest"
Cohesion: 0.04
Nodes (44): default, development, types, default, development, types, default, development (+36 more)

### Community 6 - "Seeded Set Builder"
Cohesion: 0.08
Nodes (38): buildSeededItem(), buildSeededItemFromFiles(), CATEGORIES, collectPath(), countNewLinesBefore(), Defect, detectIntentionalMarkers(), errorMessage() (+30 more)

### Community 7 - "Review Mock Seed Data"
Cohesion: 0.06
Nodes (36): CommentCounts, countComments(), ReviewFileChange, CommentDisposition, DiffLineType, fileChange(), FindingCategory, FindingImpact (+28 more)

### Community 8 - "Base LLM Reviewer"
Cohesion: 0.15
Nodes (22): annotatePatch(), buildPrompt(), composeSystemPrompt(), LLMReviewAgent, ReviewAgent, splitPatchLines(), context(), DefaultLLMFakeReviewer (+14 more)

### Community 9 - "Root Package Dependencies"
Cohesion: 0.05
Nodes (39): @biomejs/biome, lint-staged, openai, dependencies, ai-sdk-ollama, openai, @strands-agents/sdk, zod (+31 more)

### Community 10 - "Stack Target Selection"
Cohesion: 0.09
Nodes (33): allocateQuota(), checkCoverageThresholds(), compareRankDescending(), dedupeRows(), DOMAIN_MIN_RATIOS, ExecutionTarget, filterRows(), IMPACTS (+25 more)

### Community 11 - "Framework Review Skills Reference"
Cohesion: 0.10
Nodes (39): Next.js Checks Reference, Nuxt.js Checks Reference, SSR / Hydration Common Checks Reference, SvelteKit Checks Reference, Reviewing Meta-frameworks Skill, Accessibility Checks Reference, Correctness Checks Reference, Dependency Audit Checks Reference (+31 more)

### Community 12 - "Evaluation Report Generator"
Cohesion: 0.09
Nodes (33): send_discord_notification(), buildReport(), defaultGetCommitHash(), errorMessage(), EvaluationScores, execFileAsync, findingRow(), formatExecutedAt() (+25 more)

### Community 13 - "Evaluation Package CLI Bins"
Cohesion: 0.05
Nodes (37): commander, bin, build-gold-set, build-seeded-set, discover-candidate-prs, generate-evaluation-report, merge-predictions, score-evaluation (+29 more)

### Community 14 - "A2A Protocol Message Schemas"
Cohesion: 0.14
Nodes (29): A2AMessageSchema, A2ASendTaskResponseSchema, A2ATaskStatus, AgentCapability, AgentCapabilitySchema, AgentCardHttpResponse, AgentCardHttpResponseSchema, AgentCardSchema (+21 more)

### Community 15 - "Svelte Runes Reference"
Cohesion: 0.10
Nodes (37): @attach reference, $inspect reference, @render reference, Await expressions reference, bind reference (function bindings), each reference (keyed each blocks), hydratable reference, snippet reference (+29 more)

### Community 16 - "Model Provider & Ollama Sanitizer Design"
Cohesion: 0.07
Nodes (36): A2A API 設計ドキュメント (現行TS実装, 参照先), Model Provider Factory と生成パラメータの安全弁 設計ドキュメント, createModelProvider ファクトリ関数, frequencyPenalty 繰り返し抑制(安全弁), maxTokens 生成トークン数上限(安全弁), provider種別/llmBaseUrlのリクエスト単位オーバーライド禁止方針, Ollamaバックエンドが処理できないツール結果コンテンツ型の除去 設計ドキュメント, AfterToolCallEvent採用理由(result書き換え経路) (+28 more)

### Community 17 - "Review Orchestrator Errors"
Cohesion: 0.09
Nodes (14): ReviewerClass, isInfraError(), StructuredOutputMissingError, ReviewOrchestrator, ReviewOutcome, SelectedReviewer, CONFIG, loadModules() (+6 more)

### Community 18 - "Evaluation Score Matching"
Cohesion: 0.12
Nodes (32): defaultScore(), buildItemDetail(), EvalRow, exactMatch(), Finding, IMPACTS, isDirectExecution(), isMatch() (+24 more)

### Community 19 - "A2A Server App & Auth Middleware"
Cohesion: 0.11
Nodes (18): app, settings, createGithubAuthMiddleware(), GithubAuthEnv, GithubAuthMiddlewareOptions, GithubAuthVariables, callMiddleware(), A2ASendTaskRequestSchema (+10 more)

### Community 20 - "A2A Orchestrator Service"
Cohesion: 0.12
Nodes (21): A2AMessage, A2AOrchestratorSettings, createOrchestratorService(), DEFAULT_ORCHESTRATOR_SETTINGS, extractData(), InMemoryOrchestratorTaskStore, jsonSchemaWithOptionalDefaults(), LeadEngineerAgentClass (+13 more)

### Community 21 - "A2A Request Model Schemas"
Cohesion: 0.13
Nodes (24): A2ADataPart, A2ADataPartDiscriminatedSchema, A2ADataPartSchema, A2APartDiscriminatedSchema, A2APartSchema, A2ATextPart, A2ATextPartDiscriminatedSchema, A2ATextPartSchema (+16 more)

### Community 22 - "A2A Lead Engineer Service"
Cohesion: 0.12
Nodes (18): A2ATaskSchema, A2ALeadEngineerSettings, createLeadEngineerService(), DEFAULT_LEAD_ENGINEER_SETTINGS, extractData(), InMemoryLeadEngineerTaskStore, jsonSchemaWithOptionalDefaults(), LeadEngineerAgentClass (+10 more)

### Community 23 - "Gold Set Builder"
Cohesion: 0.10
Nodes (26): ApiGet, buildGoldItem(), BuildGoldItemDeps, CATEGORY_KEYWORDS, errorMessage(), extractLine(), FetchPrFiles, fetchReviewComments() (+18 more)

### Community 24 - "Agent Evaluation Runner"
Cohesion: 0.11
Nodes (23): CliOptions, ConcurrentResult, createCli(), evaluateConcurrently(), evaluateItem(), EvaluateItemOptions, failedIdsSidecarPath(), HttpDeadlineOptions (+15 more)

### Community 25 - "Model Provider Factory"
Cohesion: 0.10
Nodes (23): ADR-0004, ReviewerConfig, createModelProvider(), CreateModelProviderOptions, ProviderType, mockedCreateOllama, mockedOpenAIModel, mockedVercelModel (+15 more)

### Community 26 - "Web Frontend UI Dependencies"
Cohesion: 0.07
Nodes (27): @carbon/react, i18next, i18next-resources-to-backend, dependencies, @carbon/react, i18next, i18next-resources-to-backend, react (+19 more)

### Community 27 - "A2A Task Store Interfaces"
Cohesion: 0.10
Nodes (6): A2APart, A2ATask, LeadEngineerTaskStore, OrchestratorTaskStore, TaskStore, ReviewerTaskStore

### Community 28 - "web tsconfig.app.json"
Cohesion: 0.08
Nodes (25): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+17 more)

### Community 29 - "React Testing Dependencies"
Cohesion: 0.08
Nodes (25): @babel/core, babel-plugin-react-compiler, happy-dom, @happy-dom/global-registrator, devDependencies, @babel/core, babel-plugin-react-compiler, happy-dom (+17 more)

### Community 30 - "web-api App Bootstrap & Config"
Cohesion: 0.15
Nodes (18): createApp(), ADR-0012, AppConfig, envSchema, loadConfigFromEnv(), app, config, reviewsStore (+10 more)

### Community 31 - "Root Biome Config"
Cohesion: 0.09
Nodes (22): files, includes, formatter, enabled, indentStyle, indentWidth, lineWidth, quoteStyle (+14 more)

### Community 32 - "Angular Core Concepts Reference"
Cohesion: 0.13
Nodes (23): Angular CLI, Component Test Harness, Component Styling / View Encapsulation, Angular Component (@Component), Template Control Flow (@if/@for/@switch), Service (@Service decorator), Route Data Resolver (ResolveFn), Route Definition (Routes array) (+15 more)

### Community 33 - "Project Manifest Detection"
Cohesion: 0.18
Nodes (19): collectDirectPackageNames(), collectFields(), detectProjectTypeFromPackages(), extractDirectDependenciesFromPackageJson(), extractDirectDependenciesFromPackageLock(), extractDirectDependenciesFromPnpmLock(), isPlainRecord(), PACKAGE_PROJECT_TYPE_PRIORITY (+11 more)

### Community 34 - "PR Info Collector"
Cohesion: 0.17
Nodes (6): extractHeadRef(), extractLabelNames(), isPlainRecord(), PRInfoCollector, RetryOptions, withRetry()

### Community 35 - "Review API Fixtures"
Cohesion: 0.11
Nodes (20): REVIEW_ATTEMPT_CANCELED_EXAMPLE, REVIEW_ATTEMPT_QUEUED_EXAMPLE, REVIEW_CLOSED_EXAMPLE, REVIEW_COMMENT_EXAMPLE, REVIEW_DRAFT_EXAMPLE, REVIEW_LIST_EXAMPLE, REVIEW_REPORT_EXAMPLE, DiffLineSchema (+12 more)

### Community 36 - "PR Info A2A Service"
Cohesion: 0.15
Nodes (11): A2AServerSettings, createPrInfoService(), DEFAULT_A2A_SERVER_SETTINGS, InMemoryTaskStore, PrInfoServiceOptions, sanitizeError(), ScheduleTask, TaskIdFactory (+3 more)

### Community 37 - "Reviews Store"
Cohesion: 0.10
Nodes (21): MOCK_SEED, ReviewsSeed, ALLOWED_DISPOSITION_TRANSITIONS, cloneState(), CommentDisposition, createReviewsStore(), ListReviewsParams, ListReviewsResult (+13 more)

### Community 38 - "Reviews Route Params & Schemas"
Cohesion: 0.13
Nodes (19): AttemptIdParamSchema, IdempotencyKeyHeaderSchema, ListReviewsQuerySchema, ReviewIdParamSchema, ADR-0012, applyCommentDispositionRoute, cancelReviewAttemptRoute, closeReviewRoute (+11 more)

### Community 39 - "GitHub Settings API"
Cohesion: 0.13
Nodes (13): ApiVersionSchema, getGithubSettingsRoute, updateGithubSettingsRoute, validationErrorResponse, GithubSettingsSchema, GithubUrlSchema, PersonalAccessTokenSchema, UpdateGithubSettingsRequestSchema (+5 more)

### Community 40 - "Finding Axis Evaluation Design"
Cohesion: 0.12
Nodes (21): 指摘の独立3軸評価（severity/impact/priority）: PR単位の代理ラベルをGold findingへ継承し、Lead Engineerが構造化出力で3軸を必須独立付与する設計。Reviewer初期priority（severity兼用）は変更しない段階的アプローチ, 位置情報欠落によるfinding/decisionのサイレントドロップ（filePath/line必須化はせず、可視化(WARNINGログ)+プロンプト緩和の二段構えで対応。必須化は位置非依存の指摘を壊し行番号捏造を誘発するため非採用）, STRUCTURED_OUTPUT_DIRECTIVE共有パターン（全LLM reviewerへ横断的に構造化出力遵守を促す一元的プロンプト合成。reviewer個別プロンプトは変更せずcompose_system_prompt()で実行時合成し、なぜ重要かまで明示する方が小型モデルの追従率が上がるという方針）, ADR-0006: 指摘単位の severity/impact/priority 評価方式, 評価パイプラインのA2AサーバーコンテナPodman実行化 設計ドキュメント, 評価パイプラインのshard分割実行 設計ドキュメント, 指摘単位3軸評価仕様（Issue #168）, 位置情報欠落によるfinding/decisionのサイレントドロップ 可視化と緩和 設計ドキュメント（Issue #217） (+13 more)

### Community 41 - "Seeded Set Generation Design"
Cohesion: 0.11
Nodes (21): 専用Seedリポジトリ方式によるSeeded set生成（LLM/決定論的mutation注入のハイブリッド方式のfallback率が目標を安定して下回り続けた反省から、実際にopen PRとして欠陥を埋め込んだ4スタック59件の専用リポジトリへ全面移行）, Seeded set生成: 専用Seedリポジトリ方式 設計ドキュメント, 評価パイプライン設計: データ生成から実行まで, Seeded set生成: mutation注入ロジック 要件と設計(廃止済み), inject_patch() 挿入位置ロジックの構造的限界(R1-R3不充足), モデル規模依存の発見(35B級は成功・8-9B級は構造的に失敗), Phase2: LLM推論+決定論的事後検証(V1-V4)ハイブリッド設計, 自己完結性の原則(R8): snippetは周囲スコープに依存しない (+13 more)

### Community 42 - "TypeScript Migration Plan Deviations"
Cohesion: 0.10
Nodes (21): agents/ + tools/ TypeScript移行 計画からの逸脱記録 (Issue #252), needsGithubMcp公開ゲッターの追加, evaluation/ TypeScript移行 実装計画 (Issue #254), S1〜S4実装スライス計画, ReviewAgent/LLMReviewAgent base classes, ReviewOrchestrator: parallel Promise.all/race execution + error isolation, Evaluation Pipeline Agent Execution TS Migration Spec (Issue #306), run-agent-evaluation.ts: A2A send/poll + predictions.jsonl conversion (+13 more)

### Community 43 - "a2a-server Package Dependencies"
Cohesion: 0.10
Nodes (20): @hono/zod-validator, dependencies, @code-review-agent/agent-core, hono, @hono/node-server, @hono/zod-validator, devDependencies, tsx (+12 more)

### Community 44 - "OWASP Insecure Design & Integrity Checks"
Cohesion: 0.11
Nodes (21): A06:2025 Insecure Design, Business Logic Flaws, 09 Insecure Design (When Correct Code Implements a Flawed Design), Excessive Data Exposure, Mass Assignment, Missing Rate Limiting, OWASP Top 10 2025, A08:2025 Software or Data Integrity Failures (+13 more)

### Community 45 - "Review List Schemas"
Cohesion: 0.13
Nodes (12): CommentCounts, CommentCountsSchema, PageInfo, PageInfoSchema, PrStateSchema, ReviewListResponse, ReviewListResponseSchema, ReviewSchema (+4 more)

### Community 46 - "web-api tsconfig.node.json"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+12 more)

### Community 47 - "Prediction Merge Tool"
Cohesion: 0.16
Nodes (14): loadFailedIds(), failedIdsPath(), isNonEmptyString(), logger, main(), merge(), MergeOptions, ParsedOptions (+6 more)

### Community 48 - "A2A Agent Card & Task RPC"
Cohesion: 0.13
Nodes (6): A2ASendTaskRequest, A2ASendTaskResponse, AgentCard, LeadEngineerService, OrchestratorService, PrInfoService

### Community 49 - "Health Check Route"
Cohesion: 0.24
Nodes (10): createHealthRoute(), CreateHealthRouteOptions, createHealthService(), HealthService, HealthRequest, HealthRequestSchema, HealthHttpResponse, HealthHttpResponseSchema (+2 more)

### Community 50 - "GitHub REST Client"
Cohesion: 0.18
Nodes (13): apiGet, ApiGetOptions, assertAllowedUrl(), fetchPrFiles(), FetchPrFilesOptions, FileChange, GitHubHttpError, GitHubRateLimitError (+5 more)

### Community 51 - "Review Row UI Component"
Cohesion: 0.22
Nodes (15): ReviewRow(), PrState, ReviewStatus, CommentSummary, formatPrTitle(), formatUpdatedAt(), PR_STATE_TAG_TYPE, PrStateTag (+7 more)

### Community 52 - "Base Image & Toolchain Migration Notes"
Cohesion: 0.13
Nodes (18): Red Hat Hardened Image への base image 変更 spec (Issue #155、Python版当時の値), Chainguard→Red Hat hi/python移行判断, models/ TypeScript移行 コミット粒度・PRタイトル規約 (Issue #251), TypeScript開発環境・ツールチェーン整備 実装計画・運用手順 (Issue #250), gh-stack拡張のshellHook自動インストール, Nix flake未addファイル無視の運用注意, models/ TypeScript Migration Spec (Issue #251), camelCase field naming adopted since no live cross-language JSON contract exists to preserve (+10 more)

### Community 53 - "Frontend Agent Skills Design"
Cohesion: 0.15
Nodes (18): React/Angular Agent Skills Review Accuracy Spec, Angular detection prioritized over coarse React/TS heuristic; accepted tradeoff for mixed monorepos, ProjectType.ANGULAR + AngularReviewer + angular-developer skill bundle, AgentSkillType.REACT_REVIEW skill bundle (Vercel best-practices + composition-patterns), Review-Agent LangFlow Workflow Spec, Agent-5oeZS: Lead Engineer decision synthesizer (LangFlow origin), Agent-9uqpG: React Code Reviewer (gemma4:e4b, LangFlow origin), Agent-jnFVH: Security Analyst (gemma4:e4b, LangFlow origin) (+10 more)

### Community 54 - "React Best Practices Rules (Effects/Async)"
Cohesion: 0.22
Nodes (18): React Best Practices (Compiled AGENTS.md), React Best Practices README, Rule Sections Metadata, Rule File Template, Do Not Put Effect Events in Dependency Arrays, Store Event Handlers in Refs, Initialize App Once, Not Per Mount, useEffectEvent for Stable Callback Refs (+10 more)

### Community 55 - "Repo Governance & CI Docs"
Cohesion: 0.24
Nodes (17): CodeRabbit Review Configuration (.coderabbit.yaml), Pull Request Template, Build Multi-Arch Image Workflow (build-image.yml), CI Workflow (ci.yaml), Pre-commit Hooks Configuration, AGENTS.md — Coding Agent Guide, AGENTS.setup.md — Development Environment Setup, CLAUDE.md — Coding Agent Guide (Project Root) (+9 more)

### Community 56 - "Agent Skills Factory"
Cohesion: 0.23
Nodes (13): buildAngularReviewSkills(), buildReactReviewSkills(), buildSvelteReviewSkills(), buildVueReviewSkills(), buildWebSecurityReviewSkills(), createAgentSkills(), skillPath(), SKILLS_DIR (+5 more)

### Community 57 - "web Biome Config"
Cohesion: 0.13
Nodes (15): noAmbiguousAnchorText, noSvgWithoutTitle, extends, files, includes, //, !**/dist, !**/node_modules (+7 more)

### Community 58 - "Base tsconfig"
Cohesion: 0.12
Nodes (15): ESNext, compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module (+7 more)

### Community 59 - "Angular Reactive Forms"
Cohesion: 0.16
Nodes (14): FormArray, FormBuilder / NonNullableFormBuilder, FormControl, FormGroup, Reactive Forms, ReactiveFormsModule, Unified change events (control.events), applyEach() array item rule (+6 more)

### Community 60 - "Structured Logger"
Cohesion: 0.17
Nodes (9): defaultConfig(), emit(), getLogger(), LEVEL_RANK, Logger, LoggingConfig, LoggingOptions, LogLevel (+1 more)

### Community 61 - "Review Domain Enums"
Cohesion: 0.32
Nodes (12): AttemptStatusSchema, CommentDispositionSchema, ErrorCodeSchema, FileChangeStatusSchema, FindingCategorySchema, FindingImpactSchema, FindingSeveritySchema, PrStateSchema (+4 more)

### Community 62 - "OpenAPI Contract Test"
Cohesion: 0.21
Nodes (13): OpenApiDoc, SCHEMA_NAMES, forEachOperation(), HTTP_METHODS, isNullableNode(), loadReviewsYamlDoc(), NormalizedSchema, normalizeSchema() (+5 more)

### Community 63 - "web-api tsconfig.json"
Cohesion: 0.13
Nodes (14): compilerOptions, jsx, jsxImportSource, module, outDir, rootDir, skipLibCheck, strict (+6 more)

### Community 64 - "Review List Page UI"
Cohesion: 0.18
Nodes (12): FilterBar(), FilterBarProps, STATUS_FILTER_OPTIONS, RepoGroup(), ActionNotice, hasGithubToken(), ReviewListPage(), ReviewListPageProps (+4 more)

### Community 65 - "Discord Notification Sender"
Cohesion: 0.18
Nodes (10): build_notification_payload(), DiscordNotificationPayload, EmbedField, EvaluationScores, GoldScores, logger, ScoreCounts, SeededScores (+2 more)

### Community 66 - "Mockup App Shell JS"
Cohesion: 0.41
Nodes (12): escapeHtml(), getLang(), initListPage(), initRequestPage(), initResultPage(), initSettingsPage(), mountShell(), pick() (+4 more)

### Community 67 - "GitHub MCP Streamable HTTP Migration"
Cohesion: 0.23
Nodes (12): GitHub MCP streamable_http_client 移行 設計ドキュメント, httpx.AsyncClientの所有権問題(新APIの契約変化), _github_mcp_transport (httpx.AsyncClientの生成・使用・closeをtransport callable内に閉じ込める設計), PR Info Collector ツール呼び出し修正 検証手順 (Python版), PR Info Collector Tool-Use Fix Spec, Plan A: separate tool-use loop call from structured_output call (adopted then superseded), Plan E: fully deterministic collection via call_tool_sync, replacing Plan A, Root cause: structured_output() alone skips the tool-use loop, causing PR data hallucination (+4 more)

### Community 68 - "Evaluation Plan & Rubric Docs"
Cohesion: 0.20
Nodes (12): Patch bundling design: include patch content when diff size is within threshold to avoid MCP-fetch context overflow, EVALUATION_PLAN.md(参照先スタブ), Finding-level severity/impact/priority axis agreement metrics, computed post-matching to avoid selection bias, Gold PR Set: real PRs with qualifying inline review comments (human or AI bot), Matching rule: exact path + line tolerance +-5 + conditional category + optional LLM semantic judge, Release gates: hard gates (Critical Miss Rate=0, Must-Find Recall>=0.95) + soft targets, Seeded Set: 59 real PRs in dedicated per-stack seed repos with hand-authored INTENTIONAL markers, Evaluation Toolkit README (+4 more)

### Community 69 - "Vue/Svelte Framework Review Checks"
Cohesion: 0.18
Nodes (12): each block key check, Reactivity tracking check (Svelte 4 $: mutation), Runes migration consistency check, Runes reactivity check (Svelte 5 $state/$derived mutation), Composition vs Options API consistency check, computed vs method misuse check, defineProps/defineEmits without types check, v-for key check (+4 more)

### Community 70 - "Review List Local State Hook"
Cohesion: 0.29
Nodes (9): matchesSearch(), readCollapsedRepos(), readString(), repoKeyOf(), STORAGE_KEYS, reviews, useReviewListState, VALID_STATUS_FILTERS (+1 more)

### Community 71 - "A2A API Design & ADR-0001/0002"
Cohesion: 0.24
Nodes (11): A2A API Authentication: GitHub OAuth Bearer Token, Unmounted /health Module Gap (Issue #362), Google A2A (Agent-to-Agent) Protocol, A2A API SSRF Mitigation: Server-Env-Only llm_base_url, A2A TaskStore Design (per-module in-memory Map, owner check, 30-min TTL), A2A API Error Sanitization (sanitizeError, token redaction), Binary Patch Fallback Failure Mode (findings=0 ambiguity), Issue #54: Patch Size Overload Mitigation (+3 more)

### Community 72 - "Flow Control ADRs (0007-0012)"
Cohesion: 0.31
Nodes (11): API Gateway + Worker Queue構成（受付と実行を分離しLLM同時実行数をシステム全体で固定上限に制御。案A単純レプリカ/案C分離マイクロサービスより流量制御とスケーラビリティのバランスに優れると判断）, agents/application・agents/runtimeディレクトリ分離（物理package分割は保留し段階移行、reviewer拡張はDI registryへ、Strands依存はModelProvider→GitHubClient→ReviewContext型除去→ReviewPipelineの順で隔離）, at-least-once配信契約（lease+heartbeat+bounded retry+fencing token）: 重複LLM実行は許容しterminal結果のみfencingでeffectively-onceに収束させ、exactly-once志向の過剰な運用コストを回避, Langflow/Difyを受信/変換層としたGateway二層構成（受付制御層のSQLite永続Queue実装は変更せず、複数VCS Webhookの追加コストを受信層フロー追加のみに抑える。ADR-0009の外部Broker不要原則とは緊張関係を許容）, worker lease付き永続Queue（埋め込みDB/SQLite）: 外部Broker不要性と再起動耐性・将来のworker水平分離を両立する案として、bounded in-process queueより実装コストは高いが選定, ADR-0007: スケーラビリティのためのマルチコンテナ構成（API Gateway + Worker Queue採用）, ADR-0008: コア機能と拡張機能のパッケージ境界・レイヤリング（段階移行案2採用）, ADR-0009: LocalLLM流量制御 Queue実装方式（worker lease付き永続Queue採用候補） (+3 more)

### Community 73 - "a2a-server tsconfig"
Cohesion: 0.18
Nodes (10): compilerOptions, composite, outDir, rootDir, types, extends, include, node (+2 more)

### Community 74 - "Root Package Scripts"
Cohesion: 0.18
Nodes (11): scripts, build, check, check:write, dev, format, format:check, lint (+3 more)

### Community 75 - "Review List Page Tests"
Cohesion: 0.20
Nodes (3): FetchLike, LOCALE_JSON, setApiFetchHandler()

### Community 76 - "PR Review Agent Screen Specs"
Cohesion: 0.42
Nodes (10): PR Review Agent 4画面(一覧/依頼登録/結果確認/GitHub連携設定)の画面遷移・共通仕様体系, PR Review Agent 画面外部設計書 総論（画面一覧・共通仕様・画面遷移図）, SCR-01 コードレビュー一覧 画面外部設計書, SCR-02 レビュー依頼登録 画面外部設計書, SCR-03 レビュー結果確認 画面外部設計書, SCR-04 GitHub連携設定 画面外部設計書, SCR-01 コードレビュー一覧画面 実装スペック (Issue #340), クライアント側全件取得+絞り込み方針 (+2 more)

### Community 77 - "TypeScript Language Review Checks"
Cohesion: 0.20
Nodes (10): Implicit type coercion check, == vs === loose equality check, Missing error handling in Promise chains check, Prototype pollution risk check, var in new code check, any usage check, Duplicate type definitions check, Non-null assertion on unverified value check (+2 more)

### Community 78 - "Base Reviewer Unit Tests"
Cohesion: 0.20
Nodes (7): { mockAgentCtor, mockInvoke, mockCreateModelProvider, mockCreateGithubMcpClient }, NoMcpReviewer, ReviewContext, ReviewerConfig, SkillsReviewer, StubReviewer, UrlFetchReviewer

### Community 80 - "MCP Connection Stabilization Design"
Cohesion: 0.22
Nodes (9): MCPクライアントの起動リトライ+セッション共有（参照カウント方式）: 並列レビュー段の同時接続を2本から1本へ削減しつつ、PR情報収集は共有対象外のまま起動リトライのみ適用する非対称設計, ProviderSemaphore（provider/endpoint単位の共有permit pool、cancelSignal協調キャンセルと組み合わせ、Worker水平スケール時は不正確という制約を許容してでも実装コスト最小の案2を採用）, MCP接続の安定化 設計ドキュメント（Issue #115）, MCP接続の安定化 実装計画 (Issue #115、Python版), 共有MCPクライアントの参照カウント方式, ToolProviderExceptionのINFRA_EXCEPTIONS追加, インフラ例外の握りつぶし修正 設計ドキュメント (Issue #56), INFRA_EXCEPTIONSタプル(EventLoopException/MCPClientInitializationError/httpx.TransportError) (+1 more)

### Community 81 - "Mock Data Store JS"
Cohesion: 0.31
Nodes (4): buildFileRows(), computeReviewStatus(), countComments(), getCommentStatus()

### Community 82 - "Review Mockup HTML Pages"
Cohesion: 0.22
Nodes (9): コードレビュー一覧ページ (index.html), PR Review Agent 画面モックアップ README (Issue #243), Claude Designプロジェクト(ソースコードレビューエージェントUI), ES modules file:// CORS制約の発見, Personal Access Token非保存ポリシー, 静的HTML＋依存ゼロ設計判断, レビュー依頼登録ページ (review-request.html), レビュー結果確認ページ (review-result.html) (+1 more)

### Community 83 - "Angular Signal Forms & resource()"
Cohesion: 0.22
Nodes (9): httpResource() wrapper, resource() async reactivity function, Resource status signals (value/hasValue/isLoading/error/status), Using resource() inside Signal Forms validation, validateAsync() async validator, computed() derived signal, Reactive context (computed/effect/linkedSignal/templates), signal() writable signal (+1 more)

### Community 84 - "Angular Router Guards & Events"
Cohesion: 0.22
Nodes (9): CanActivate guard, CanActivateChild guard, CanDeactivate guard, CanMatch guard, NavigationCancel event, NavigationEnd event, NavigationError event, NavigationStart event (+1 more)

### Community 85 - "React/Svelte Review Checks (XSS/Effects)"
Cohesion: 0.22
Nodes (9): Context over-provision check, dangerouslySetInnerHTML XSS check, useEffect missing cleanup check, Unnecessary memoization check (useMemo/useCallback), Unstable list key check, useEffect dependency array check, {@html} XSS check, onMount cleanup check (+1 more)

### Community 86 - "agent-core tsconfig"
Cohesion: 0.22
Nodes (8): compilerOptions, composite, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 87 - "JSONL Atomic Write Utilities"
Cohesion: 0.36
Nodes (6): RunDeps, serializeRow(), directories, writeFileAtomic(), writeJsonAtomic(), writeJsonlAtomic()

### Community 88 - "evaluation tsconfig"
Cohesion: 0.22
Nodes (8): compilerOptions, composite, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 89 - "web-api Biome Config"
Cohesion: 0.25
Nodes (8): extends, files, includes, //, linter, rules, root, $schema

### Community 90 - "Package Dev Guides (AGENTS/CLAUDE.md)"
Cohesion: 0.25
Nodes (8): Authenticate Server Actions Like API Routes, web Frontend Package Development Guide (AGENTS.md), web-api Package Development Guide (AGENTS.md), web-api Package Development Guide (CLAUDE.md), web-api Quickstart (README.md), web Frontend Package Development Guide (CLAUDE.md), web Vite Entry HTML (index.html), pnpm Workspace Configuration

### Community 91 - "Ollama Tool Result Sanitizer"
Cohesion: 0.39
Nodes (3): isUnsupported(), OllamaUnsupportedContentSanitizer, UNSUPPORTED_CONTENT_CLASSES

### Community 92 - "RepoGroup UI Component"
Cohesion: 0.32
Nodes (6): RepoGroupProps, ReviewRowProps, buildRouter(), review(), Review, RepoGroup

### Community 93 - "Review Knowledge Provisioning Options"
Cohesion: 0.33
Nodes (7): Review Knowledge (Agent Skills) Provisioning Options Comparison, Option A (adopted first): declarative manifest + auto-discovery to remove code coupling, Option B: split knowledge content into a separate repo/distribution for lighter review gates, Option C: runtime hot-reload via external storage; high ops complexity given single-Pod deploy, Option D: RAG over docs; rejected as replacement, only viable as supplement, Option E: remote MCP knowledge server; best C2/C3 but highest ops cost, rejected for now, Option F: A + path-scoped lightweight CI, recommended second step

### Community 94 - "a2a-server Config Loader"
Cohesion: 0.43
Nodes (5): loadServerSettingsFromEnv(), parseOptionalNumber(), parseProviderType(), ProviderType, ServerSettings

### Community 95 - "Target File Detection Utility"
Cohesion: 0.62
Nodes (5): DEPENDENCY_FILENAMES, isDependencyFile(), isTargetFile(), TARGET_EXTENSIONS, TARGET_FILENAMES

### Community 96 - "Angular Animations & Aria Reference"
Cohesion: 0.33
Nodes (6): Angular Animations Reference, animate.enter/animate.leave native CSS animations (Angular v20.2+ recommended over legacy @angular/animations DSL), Angular Aria Reference, @angular/aria headless accessible directives (Accordion/Listbox/Combobox/Menu/Tabs/Toolbar/Tree/Grid), Angular Developer Agent Skill (SKILL.md), Angular review guidelines: version-aware, review-only (no code generation/migration execution)

### Community 97 - "Angular Review Checks"
Cohesion: 0.33
Nodes (6): ChangeDetectionStrategy.OnPush check, DI scope mismatch check, innerHTML XSS check, Observable subscription leak check, Signals misuse check (effect vs computed, mutation in computed), trackBy in ngFor/@for check

### Community 98 - "React Rendering Best Practices"
Cohesion: 0.33
Nodes (6): Use useTransition Over Manual Loading States, Defer State Reads to Usage Point, Narrow Effect Dependencies, Calculate Derived State During Rendering, Subscribe to Derived State, Put Interaction Logic in Event Handlers

### Community 99 - "Lead Engineer Evaluate Test"
Cohesion: 0.33
Nodes (4): CONFIG, { mockAgentCtor, mockInvoke, mockCreateModelProvider }, ReviewerConfig, ReviewReport

### Community 100 - "Reviewer Registry Test"
Cohesion: 0.40
Nodes (3): FakeReviewer, makePrInfo(), withFiles()

### Community 101 - "MCP Startup Retry & Session Sharing (ADRs 3-4)"
Cohesion: 0.50
Nodes (5): Issue #115: GitHub MCP Connection Instability, MCP Startup Retry: Exponential Backoff + Jitter (tenacity), MCP Client Session Sharing via Reference Counting, ADR-0003: GitHub MCP Startup Retry Strategy, ADR-0004: MCP Client Session Sharing (Between Reviewers)

### Community 102 - "Frontend/Svelte Skills Implementation Plan"
Cohesion: 0.50
Nodes (5): React/Angular Agent Skills Implementation Plan, AgentSkillType.FRONTEND_REVIEW / ANGULAR_REVIEW, 空実装スタブ先行TDDサイクル, Svelte Agent Skills Implementation Plan, AgentSkillType.SVELTE_REVIEW / svelte-core-bestpractices

### Community 103 - "Angular Router Testing Harness"
Cohesion: 0.40
Nodes (5): provideRouter() test configuration, RouterTestingHarness, Act, Wait, Assert (zoneless testing pattern), ComponentFixture, TestBed

### Community 104 - "React Composition Patterns"
Cohesion: 0.50
Nodes (5): Create Explicit Component Variants, React 19 API Changes (ref as prop, use() over useContext()), Define Generic Context Interfaces for Dependency Injection, Decouple State Management from UI, Lift State into Provider Components

### Community 105 - "web Package Manifest"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 106 - "Structured Logging Migration Design"
Cohesion: 0.50
Nodes (4): eval構造化ロギング移行 設計ドキュメント(参照先スタブ), 評価パイプライン: 並行実行時ログの失敗項目誤帰属 修正 設計ドキュメント, _run_one の印字競合による失敗項目誤帰属バグ, print_lockによるラベル付き独立行出力修正

### Community 107 - "Eval Pipeline Container & Sharding"
Cohesion: 0.50
Nodes (4): 評価パイプラインのA2Aサーバー コンテナ実行化 影響範囲, 評価パイプラインのshard分割実行 実装計画・検証記録, healthエンドポイントのポート不一致(Issue #362), shard分割・merge-predictions マージ機構

### Community 108 - "Worktree Plugin Progress Notification"
Cohesion: 0.50
Nodes (4): Worktree Plugin Progress Notification: Verification Plan, 非ブロッキングtoast通知, Worktree Plugin Progress Notification Spec, Progress toast notification requirements for worktree_create/worktree_remove long-running phases

### Community 109 - "Serena MCP Config"
Cohesion: 0.50
Nodes (3): uvx, serena, start-mcp-server

### Community 110 - "Rendering Strategy Concepts (CSR/SSR/SSG)"
Cohesion: 0.67
Nodes (4): Client-Side Rendering (CSR), Hydration (Full / Incremental / Event Replay), Static Site Generation (SSG / Prerendering), Server-Side Rendering (SSR)

### Community 111 - "Angular Template-Driven Forms"
Cohesion: 0.50
Nodes (4): NgForm directive, NgModel directive ([(ngModel)]), NgModelGroup directive, Template-Driven Forms

### Community 112 - "Docstring Lint Policy"
Cohesion: 0.67
Nodes (3): docstring lint方針 設計ドキュメント, preview=trueによるデフォルトルールセット拡大問題, Ruff D/DOCルールセット採用(Google convention)

### Community 113 - "Eval Structured Logging Module"
Cohesion: 0.67
Nodes (3): 評価パイプライン構造化ロギング移行 設計ドキュメント, eval_logging.setup_logging 共通ロギング設定モジュール, stdout/stderr分離を不変条件とする設計

### Community 115 - "Angular Pipes (Impure)"
Cohesion: 0.67
Nodes (3): Impure pipes (pure: false), Pipes (Angular template transform), PipeTransform interface

### Community 116 - "Bundle Deferral Rules"
Cohesion: 0.67
Nodes (3): Dynamic Imports for Heavy Components, Preload Based on User Intent, Defer Non-Critical Work with requestIdleCallback

### Community 117 - "Event Listener Optimization Rules"
Cohesion: 0.67
Nodes (3): Deduplicate Global Event Listeners, Use Passive Event Listeners for Scrolling Performance, Use SWR for Automatic Deduplication

### Community 118 - "JS Caching Rules"
Cohesion: 0.67
Nodes (3): Cache Repeated Function Calls, Cache Property Access in Loops, Cache Storage API Calls

### Community 119 - "Array Comparison Optimization Rules"
Cohesion: 0.67
Nodes (3): Early Length Check for Array Comparisons, Use Loop for Min/Max Instead of Sort, Use toSorted() Instead of sort() for Immutability

### Community 120 - "React Conditional Rendering Rules"
Cohesion: 0.67
Nodes (3): Use Activity Component for Show/Hide, Hoist Static JSX Elements, Don't Define Components Inside Components

### Community 121 - "React Memoization Rules"
Cohesion: 0.67
Nodes (3): Extract to Memoized Components, Extract Default Non-primitive Parameter Value from Memoized Component to Constant, Do Not Wrap a Simple Expression With a Primitive Result Type in useMemo

## Ambiguous Edges - Review These
- `models/ TypeScript移行 コミット粒度・PRタイトル規約 (Issue #251)` → `TypeScript Toolchain Setup Spec (Issue #250)`  [AMBIGUOUS]
  docs/plan/typescript-models-migration-spec.md · relation: references

## Knowledge Gaps
- **736 isolated node(s):** `uvx`, `start-mcp-server`, `$schema`, `root`, `packages/**` (+731 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **46 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `models/ TypeScript移行 コミット粒度・PRタイトル規約 (Issue #251)` and `TypeScript Toolchain Setup Spec (Issue #250)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `LeadEngineerReport` connect `Lead Engineer Agent` to `Finding Axis Evaluation Design`, `Agent Evaluation Runner`, `A2A Orchestrator Service`, `A2A Lead Engineer Service`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Why does `Lead Engineer Agent 設計` connect `Finding Axis Evaluation Design` to `Lead Engineer Agent`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `main()` connect `Evaluation PR Discovery CLI` to `PR Info Collector`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **What connects `uvx`, `start-mcp-server`, `$schema` to the rest of the system?**
  _736 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Evaluation PR Discovery CLI` be split into smaller, more focused modules?**
  _Cohesion score 0.06997408367271381 - nodes in this community are weakly interconnected._
- **Should `Angular/React Reviewer Services` be split into smaller, more focused modules?**
  _Cohesion score 0.07236544549977386 - nodes in this community are weakly interconnected._