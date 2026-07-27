# Graph Report - .  (2026-07-27)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1996 nodes · 5171 edges · 115 communities (97 shown, 18 thin omitted)
- Extraction: 76% EXTRACTED · 24% INFERRED · 0% AMBIGUOUS · INFERRED: 1218 edges (avg confidence: 0.6)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f38d9e80`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- make_finding
- ReviewerConfig
- Settings
- ReviewPerspective
- ReviewResult
- TestLeadEngineerAgentEvaluate
- base_reviewer.py
- TaskStore
- models.py
- PRInfo
- A2ADataPart
- validate_catalog
- TestPRInfoCollectorCollect
- test_build_seeded_set.py
- ReviewOrchestrator
- PRInfoResult
- GitHubClient
- create_github_mcp_client
- _IsolatedSettings
- render_seeded_item_with_generation
- PRInfoCollector
- build_gold_set.py
- build_seeded_set.py
- run_agent_evaluation.py
- TestMainCLI
- test_discover_candidate_prs.py
- detect_project_types
- inject_patch
- select_stack_targets.py
- recompute_injected_line
- make_llm_assessor
- TestLeadEngineerReport
- properties
- verify_only_additions_changed
- ProjectType
- properties
- verify_required_tokens
- discover_candidate_prs.py
- .collect
- properties
- make_raw_finding
- TestStructuredOutputDirective
- tests/agents/test_pr_info_collector.py
- get_reviewer_classes
- TestAnnotatePatch
- enum
- _build_report
- api/agents/test_pr_info_collector.py
- test_select_stack_targets.py
- test_frontend_reviewer.py
- properties
- required
- a2a_poll
- load_eval_tool_module
- TestFrontendReviewer
- test_discord_notify.py
- test_run_agent_evaluation.py
- TestProductionCodeCriteria
- create_agent_skills
- required
- passes_post_generation_checks
- build_target
- test_lead_engineer_router.py
- enum
- get_snippet_for_lang
- verify_diff_parses
- task_store.py
- test_orchestrator.py
- items
- has_review_comments
- make_gold_item_row
- make_row
- code_review_agent/__init__.py
- TestMutationGenSystemPrompt
- TestCreateAgentSkills
- _sanitize_cell
- has_production_code_change
- SkillSource
- TestAgentSkillType
- find_insertion_point
- summarize
- verify_a2a_api.py
- Path
- renovate.json
- ._client
- analyze_pr_collector_repeated.py
- within_change_limits
- _extract_head_ref
- _extract_label_names
- TestAngularReview
- TestSvelteReview
- collect_review_texts
- _seeded_heading
- _gold_heading
- serena
- test_exceptions.py
- test_container_build.py
- run_evaluation_pipeline.sh
- graphify.js
- remove-worktree.sh
- setup-worktree.sh
- code_review_agent/a2a/__init__.py
- .__init__
- code_review_agent/api/__init__.py
- tests/tools/__init__.py
- code-review-agent

## God Nodes (most connected - your core abstractions)
1. `ReviewerConfig` - 99 edges
2. `PRInfoResult` - 96 edges
3. `ReviewPerspective` - 83 edges
4. `TaskStore` - 80 edges
5. `ReviewResult` - 75 edges
6. `PRInfo` - 73 edges
7. `RepositoryInfo` - 72 edges
8. `ReviewOutput` - 70 edges
9. `ReviewContext` - 67 edges
10. `Settings` - 66 edges

## Surprising Connections (you probably didn't know these)
- `make_row()` --calls--> `StackTarget`  [INFERRED]
  tests/evaluation/tools/test_select_stack_targets.py → evaluation/tools/select_stack_targets.py
- `TestA2AMessage` --uses--> `A2ATaskStatus`  [INFERRED]
  tests/a2a/test_models.py → src/code_review_agent/a2a/models.py
- `TestA2AParts` --uses--> `A2ATaskStatus`  [INFERRED]
  tests/a2a/test_models.py → src/code_review_agent/a2a/models.py
- `TestA2ASendTaskRequest` --uses--> `A2ATaskStatus`  [INFERRED]
  tests/a2a/test_models.py → src/code_review_agent/a2a/models.py
- `TestA2ASendTaskResponse` --uses--> `A2ATaskStatus`  [INFERRED]
  tests/a2a/test_models.py → src/code_review_agent/a2a/models.py

## Import Cycles
- None detected.

## Communities (115 total, 18 thin omitted)

### Community 0 - "make_finding"
Cohesion: 0.06
Nodes (33): _build_item_detail(), Finding, is_match(), main(), make_llm_semantic_judge(), match_findings(), match_findings_detailed(), MatchedPair (+25 more)

### Community 1 - "ReviewerConfig"
Cohesion: 0.08
Nodes (47): RuntimeError, Shared runtime configuration injected into each reviewer.      Attributes:, ReviewerConfig, Raised when an LLM agent call ends without a structured output result.      Stra, StructuredOutputMissingError, AgentSkillType, StrEnum, Skill bundles available to LLM-backed reviewers. (+39 more)

### Community 2 - "Settings"
Cohesion: 0.07
Nodes (46): BaseSettings, A2ASendTaskResponse, Response body wrapping the created or updated :class:`A2ATask`., _extract_data(), Any, frontend_reviewer_router(), APIRouter, A2A router exposing the Frontend Reviewer as an independently callable agent. (+38 more)

### Community 3 - "ReviewPerspective"
Cohesion: 0.07
Nodes (37): Lead Engineer synthesis agent.  Evaluates the aggregated outputs of the parallel, Resolve LLM output indexes to original findings.          Normalises the LLM out, Data models for code review agent., DecisionVerdict, FindingDecision, FindingDecisionOutput, LeadEngineerReport, Any (+29 more)

### Community 4 - "ReviewResult"
Cohesion: 0.07
Nodes (32): ABC, Interface for a reviewer in the parallel review stage.      Subclasses declare t, Store the shared runtime configuration for this reviewer instance.          Args, ReviewAgent, _DetectionRule, A single project-type detection rule.      Rules are evaluated in list order, so, Review the change, skipping non-Svelte PRs with no findings.          The projec, A reviewer's output annotated with its identity and scope.      Attributes: (+24 more)

### Community 5 - "TestLeadEngineerAgentEvaluate"
Cohesion: 0.10
Nodes (19): LeadEngineerAgent, Evaluates parallel reviewer outputs and produces final decisions.      Consumes, Store the shared runtime configuration for this agent instance.          Args:, LeadEngineerOutput, Top-level LLM output schema passed to ``Agent.structured_output``.      Attribut, _make_config(), _make_finding(), _make_report() (+11 more)

### Community 6 - "base_reviewer.py"
Cohesion: 0.08
Nodes (33): _ReviewerT, LLMReviewAgent, Base classes for review agents in the parallel review stage.  Defines the review, LLM-backed reviewer using a Strands ``Agent`` and GitHub MCP.      Concrete revi, Agents for code review workflow., get_registered_reviewers(), Reviewer registry and project-type detection.  This module is the extension poin, Return a copy of all registered reviewer classes.      Returns:         A shallo (+25 more)

### Community 7 - "TaskStore"
Cohesion: 0.09
Nodes (20): LogCaptureFixture, A2ATaskStatus, StrEnum, Lifecycle state of an :class:`A2ATask`., Tracks :class:`A2ATask` lifecycle in memory, guarded by a single asyncio lock., Initialize an empty task store., Create and store a new task in the ``SUBMITTED`` state.          Returns:, Look up a task by id.          Returns:             The stored task, or ``None`` (+12 more)

### Community 8 - "models.py"
Cohesion: 0.12
Nodes (24): A2AMessage, A2ASendTaskRequest, A2ATask, A2ATextPart, AgentCapability, AgentCard, AgentSkill, BaseModel (+16 more)

### Community 9 - "PRInfo"
Cohesion: 0.11
Nodes (17): FileChange, PRInfo, BaseModel, Diff information for a single changed file.      Attributes:         filePath: R, Pull request metadata and file changes.      Attributes:         title: PR title, Repository owner and name.      Attributes:         owner: GitHub repository own, RepositoryInfo, The base class exposes class-level metadata. (+9 more)

### Community 10 - "A2ADataPart"
Cohesion: 0.09
Nodes (25): BaseException, A2ADataPart, A structured-data segment of an :class:`A2AMessage`., Helpers for stripping credential-like strings from error messages., Remove token-like strings from exception messages to prevent credential leakage., sanitize_error(), LeadEngineerSkillInput, BaseModel (+17 more)

### Community 11 - "validate_catalog"
Cohesion: 0.11
Nodes (10): Validate the mutation catalog and return a list of error messages.      Enforces, validate_catalog(), Regression: the word "async" appearing in a comment (not an         actual async, Issue #131 design doc §7.3/7.4.3: a snippet whose `required_tokens`     requires, A token requiring more than the bare word "await" (e.g. `await`         followed, A token like `\\bawaited\\b` references an unrelated identifier         (e.g. a, TestValidateCatalog, TestValidateCatalogRequiredTokens (+2 more)

### Community 12 - "TestPRInfoCollectorCollect"
Cohesion: 0.10
Nodes (18): _make_mcp(), Build a mock MCP client whose call_tool_sync dispatches by arguments.      Retur, Tests for the deterministic collect() method., dependency_files reflect the repo's manifests at the PR head ref,         not on, The root listing is pinned to the PR head SHA., Output is sorted regardless of server-side listing order., README is read at the PR head ref for reproducible summaries., Every returned path must come from the MCP get_files payload. (+10 more)

### Community 13 - "test_build_seeded_set.py"
Cohesion: 0.11
Nodes (22): build_seeded_items(), candidate_files(), detect_lang(), enumerate_combo_pool(), Any, Pick the file_changes eligible as a mutation target.      Prefers production fil, Enumerate every distinct (file_change, rule) pair valid for this item.      A pa, Build one Seeded item from an already-chosen (file_change, rule) combo     using (+14 more)

### Community 14 - "ReviewOrchestrator"
Cohesion: 0.12
Nodes (16): Runs applicable reviewers concurrently and aggregates their results.      Args:, Store the shared configuration injected into every selected reviewer.          A, ReviewOrchestrator, _context(), _mock_shared_client(), _orchestrator(), asyncio, Tests for the parallel review orchestrator. (+8 more)

### Community 15 - "PRInfoResult"
Cohesion: 0.10
Nodes (24): PR Info Collector agent.  Collects pull request information from GitHub and retu, PRInfoResult, Pydantic models for PR information collected from GitHub., Structured result from the PR Info Collector agent.      Attributes:         rep, BaseModel, Pydantic models for the parallel review stage.  Defines the two extension axes (, Record of a reviewer that failed, kept isolated from successes.      Attributes:, Aggregated output of the parallel review stage.      This is the hand-off to the (+16 more)

### Community 16 - "GitHubClient"
Cohesion: 0.12
Nodes (16): GitHubClient, Any, Fetch JSON data from a GitHub API path, retrying rate-limited requests up to thr, Fetch repository metadata from GitHub.          Parameters:                 repo, Fetches releases for a repository.          Parameters:                 repo (st, Return commit dates for the repository's most recent tags.          Parameters:, Fetches details for a pull request.          Parameters:                 repo (s, Collect merged pull requests updated on or after the specified timestamp. (+8 more)

### Community 17 - "create_github_mcp_client"
Cohesion: 0.10
Nodes (16): _MCPStreams, create_github_mcp_client(), _github_mcp_transport(), MCPClient, Transport for ``MCPClient`` that owns the ``httpx.AsyncClient`` lifecycle., Create an MCPClient connected to the GitHub MCP endpoint.      Args:         tok, _dummy_get_session_id(), asyncio (+8 more)

### Community 18 - "_IsolatedSettings"
Cohesion: 0.12
Nodes (9): MonkeyPatch, PydanticBaseSettingsSource, clean_env(), _IsolatedSettings, fixture, Settings subclass for unit tests — skips .env file loading., TestResolveAgentUrl, TestSettingsDefaults (+1 more)

### Community 19 - "render_seeded_item_with_generation"
Cohesion: 0.13
Nodes (10): Try the LLM generation path (design doc 3.2.1) up to `max_attempts`     times; f, render_seeded_item_with_generation(), parametrize, Golden regression for the hoppscotch#6171 miss (js_eval_injection)     that orig, Golden regression for the second known miss named in design doc 5:     vuetify#2, Issue #131: `frontend_n_plus_one_api` / `b2b2c_idor_hint` previously     require, TestRegressionIssue131SelfContainedSnippets, TestRegressionKnownMisses (+2 more)

### Community 20 - "PRInfoCollector"
Cohesion: 0.07
Nodes (14): PRInfoCollector, Collects PR information from GitHub deterministically.      Retrieves PR details, Store the GitHub/LLM connection settings used by :meth:`collect`.          Args:, Build the OpenAI-compatible model for README summarisation.          Returns:, Summarise the README with a single tool-free LLM call.          Returns:, Tests for PRInfoCollector initialisation., If the summary LLM raises, facts are kept and summary is empty., An infra exception from the summary LLM must not be swallowed into         an em (+6 more)

### Community 21 - "build_gold_set.py"
Cohesion: 0.13
Nodes (24): _api_get(), build_gold_item(), _extract_line(), _is_target_file(), load_targets(), main(), _normalize_category(), _normalize_severity() (+16 more)

### Community 22 - "build_seeded_set.py"
Cohesion: 0.10
Nodes (19): is_test_file(), main(), make_llm_mutation_generator(), MutatedPatchOutput, _pattern_references_keyword(), BaseModel, Build one Seeded item from a verified LLM mutation.      Args:         gold_item, Build a mutation generator backed by an OpenAI-compatible LLM.      Mirrors the (+11 more)

### Community 23 - "run_agent_evaluation.py"
Cohesion: 0.14
Nodes (26): build_notification_payload(), Any, Discord Webhook notification for evaluation pipeline completion.  Fires once per, Build a Discord Webhook embed payload summarizing an evaluation run.      Return, POST *payload* to the Discord webhook. No-ops when *webhook_url* is unset., send_discord_notification(), _evaluate_concurrently(), evaluate_gold_item() (+18 more)

### Community 24 - "TestMainCLI"
Cohesion: 0.13
Nodes (4): Configure a generation model without ever calling a real LLM.          Patches m, TestMainCLI, TestMainCLIEndToEnd, TestMainCLIModelConfigValidation

### Community 25 - "test_discover_candidate_prs.py"
Cohesion: 0.15
Nodes (14): datetime, has_recent_release(), _parse_iso(), Parse an ISO 8601 timestamp.      Parameters:         value (str): The timestamp, Determine whether a repository has released within the specified time window., Validate a repository's availability, archive status, star count, and recent rel, validate_repo(), _fake_client() (+6 more)

### Community 26 - "detect_project_types"
Cohesion: 0.18
Nodes (8): detect_project_types(), _matches_manifest(), Infer applicable project types from collected PR information.      Used as the d, Return True when ``path``'s basename is exactly ``name``.      Args:         pat, _pr_info(), parametrize, detect_project_types infers stacks from PR info., TestDetectProjectTypes

### Community 27 - "inject_patch"
Cohesion: 0.13
Nodes (11): inject_patch(), Inject `line_snippet` into the hunk with the most added lines.      Selects the, Split a unified diff patch string into per-hunk line groups.      Each returned, Return the index of the hunk with the most added (`+`) lines.      Ties resolve, select_target_hunk(), split_hunks(), _published_docs_resolver_patch(), Two-hunk sample modeled on hoppscotch#6171 published-docs.resolver.ts.      Hunk (+3 more)

### Community 28 - "select_stack_targets.py"
Cohesion: 0.16
Nodes (22): allocate_quota(), filter_rows(), load_targets(), main(), parse_csv_arg(), _rank(), Parse a comma-separated CLI argument.      Returns:         Trimmed non-empty va, Filter targets by stack and the three classification axes.      Returns: (+14 more)

### Community 29 - "recompute_injected_line"
Cohesion: 0.13
Nodes (9): count_new_lines_before(), parse_hunk_new_start(), Deterministically recompute the new-file line number of the     injected block,, Extract the new-file start line `c` from `@@ -a,b +c,d @@`.      Falls back to 1, Count new-file lines consumed between the hunk header and insertion_idx.      Co, recompute_injected_line(), TestCountNewLinesBefore, TestParseHunkNewStart (+1 more)

### Community 30 - "make_llm_assessor"
Cohesion: 0.13
Nodes (9): make_llm_assessor(), BaseModel, Structured 3-axis assessment of a PR's review findings.      The three axes are, Build an assessor that classifies pull requests across severity, impact, and pri, ReviewAssessment, ReviewAssessor, TestMain, TestMakeLlmAssessor (+1 more)

### Community 31 - "TestLeadEngineerReport"
Cohesion: 0.25
Nodes (3): _make_decision(), Tests for LeadEngineerReport output, sorting, and serialisation., TestLeadEngineerReport

### Community 32 - "properties"
Cohesion: 0.11
Nodes (19): items, type, properties, type, minimum, type, items, type (+11 more)

### Community 33 - "verify_only_additions_changed"
Cohesion: 0.16
Nodes (7): Phase 2 post-generation check V2: relative to `original_patch`, does     `mutate, verify_only_additions_changed(), Issue #131 (1/7 false-negative case, bitwarden index.d.ts): a     pre-existing l, Regression: normalization must not collapse internal whitespace         runs. Do, Regression: the docstring promises only *one* trailing         semicolon is norm, TestVerifyOnlyAdditionsChanged, TestVerifyOnlyAdditionsChangedWhitespaceTolerance

### Community 34 - "ProjectType"
Cohesion: 0.12
Nodes (11): Review the change described by ``context``.          Args:             context:, MCPClient, Run the parallel review stage concurrently.          Each reviewer's synchronous, Resolve which reviewers to run and the project type each targets.          A rev, Run a reviewer and release its shared-client placeholder afterward.      The pla, Run the parallel review stage synchronously.          Convenience wrapper around, _run_reviewer(), ProjectType (+3 more)

### Community 35 - "properties"
Cohesion: 0.11
Nodes (17): type, $id, type, minimum, type, properties, body, id (+9 more)

### Community 36 - "verify_required_tokens"
Cohesion: 0.18
Nodes (7): _hunk_added_indices(), _normalize_diff_line_for_compare(), Normalize a diff line's content for indentation/semicolon-tolerant     compariso, Match `original_hunk`'s body lines as an ordered subsequence of     `mutated_hun, Phase 2 post-generation check V3: do all of the rule's     `required_tokens` reg, verify_required_tokens(), TestVerifyRequiredTokens

### Community 37 - "discover_candidate_prs.py"
Cohesion: 0.19
Nodes (11): load_skipped_targets(), load_stack_outputs(), main(), Load existing targets only for repositories explicitly being skipped.      Retur, Write targets grouped by stack to pr_targets_{stack}.json.      Every stack in `, Load all existing stack target files for atomic revalidation.      Returns:, Discover and write per-stack Gold-set pull request targets.      Returns:, RepoCandidate (+3 more)

### Community 38 - ".collect"
Cohesion: 0.18
Nodes (10): Any, Extract the text payloads from an MCP tool result.      Args:         result: Th, Collect PR information from GitHub and return structured data.          Connects, Fetch PR metadata (title, body, labels, number) deterministically.          Retu, Fetch the full changed-file list, paging until exhausted.          Returns:, List dependency manifest files at the repo root for the given ref.          Retu, Fetch the repository README text at ``ref``, or None if unavailable.          Pi, _tool_text_blocks() (+2 more)

### Community 39 - "properties"
Cohesion: 0.12
Nodes (15): description, type, $id, type, minimum, type, properties, base_source (+7 more)

### Community 40 - "make_raw_finding"
Cohesion: 0.25
Nodes (7): _finding_row(), Traceability link for one finding: Gold's review-comment ``source``     URL, or, _ref_cell(), make_raw_finding(), Tests for evaluation/tools/run_agent_evaluation.py::_build_report.  Covers the p, TestFindingRow, TestRefCell

### Community 41 - "TestStructuredOutputDirective"
Cohesion: 0.13
Nodes (9): OpenAIModel, compose_system_prompt(), Run this reviewer's Strands ``Agent`` against ``context`` and collect its output, Serialize the review-relevant PR information into a prompt.          Shared by e, Combine a reviewer's role prompt with the shared structured-output directive., Build the evaluation prompt and a finding-index map simultaneously.          Eac, Evaluate all reviewer findings and produce a final report.          Args:, The shared directive that steers small models to emit the structured     output (+1 more)

### Community 42 - "tests/agents/test_pr_info_collector.py"
Cohesion: 0.17
Nodes (10): is_dependency_file(), is_target_file(), Return True if the file should be included in the review.      Includes TypeScri, Return True if the file is a dependency manifest or lock file.      Args:, parametrize, Tests for the deterministic PRInfoCollector agent.  The collector retrieves fact, Tests for the is_target_file helper., Tests for the is_dependency_file helper. (+2 more)

### Community 43 - "get_reviewer_classes"
Cohesion: 0.17
Nodes (6): get_reviewer_classes(), Select reviewer classes applicable to a project type.      Args:         project, register_reviewer adds classes; get_reviewer_classes selects them., TestRegistration, Importing the reviewers package registers both reviewers., TestRegistration

### Community 44 - "TestAnnotatePatch"
Cohesion: 0.23
Nodes (4): _annotate_patch(), Annotate each line of a unified diff with its actual file line number.      Tran, _annotate_patch adds file line numbers to unified diff lines., TestAnnotatePatch

### Community 45 - "enum"
Cohesion: 0.14
Nodes (14): high, low, medium, severity, enum, type, critical, high (+6 more)

### Community 46 - "_build_report"
Cohesion: 0.43
Nodes (3): _build_report(), make_scores(), TestBuildReportIntegration

### Community 47 - "api/agents/test_pr_info_collector.py"
Cohesion: 0.29
Nodes (7): _make_app(), asyncio, FastAPI, _send_payload(), TestAgentCard, TestGetTask, TestSendTask

### Community 48 - "test_select_stack_targets.py"
Cohesion: 0.22
Nodes (5): parametrize, Tests for evaluation/tools/select_stack_targets.py., row_dict(), TestLoadTargets, TestMain

### Community 49 - "test_frontend_reviewer.py"
Cohesion: 0.32
Nodes (7): _make_app(), _pr_info_payload(), asyncio, FastAPI, _send_payload(), TestAgentCard, TestGetTask

### Community 50 - "properties"
Cohesion: 0.15
Nodes (13): properties, minimum, type, type, type, line, patch, path (+5 more)

### Community 51 - "required"
Cohesion: 0.17
Nodes (13): required, line, patch, path, required, category, line, patch (+5 more)

### Community 52 - "a2a_poll"
Cohesion: 0.27
Nodes (11): a2a_poll(), a2a_send(), Any, Client, Shared A2A HTTP client helpers for evaluation scripts.  Both run_agent_evaluatio, POST a task to an A2A endpoint and return the task_id.      Returns:         The, Poll until the task completes. Return the data part or raise on failure/timeout., main() (+3 more)

### Community 53 - "load_eval_tool_module"
Cohesion: 0.17
Nodes (6): ModuleType, load_eval_tool_module(), Shared helpers for testing standalone scripts under evaluation/tools/.  evaluati, Load a module from evaluation/tools/<filename> under the given name.      evalua, Tests for evaluation/tools/target_criteria.py., TestInlineReviewCriteria

### Community 54 - "TestFrontendReviewer"
Cohesion: 0.14
Nodes (4): Security reviewer metadata and prompt., Frontend technical reviewer metadata and prompt., TestFrontendReviewer, TestSecurityReviewer

### Community 55 - "test_discord_notify.py"
Cohesion: 0.19
Nodes (4): Tests for evaluation/tools/discord_notify.py., _scores(), TestBuildNotificationPayload, TestSendDiscordNotification

### Community 56 - "test_run_agent_evaluation.py"
Cohesion: 0.15
Nodes (6): Tests for the concurrency changes in evaluation/tools/run_agent_evaluation.py., Each outcome line must carry its own label so a WARN can't visually         atta, TestEvaluateConcurrentlyBoundedParallelism, TestEvaluateConcurrentlyFailureIsolation, TestEvaluateConcurrentlyOrdering, TestSeededItemReviewerParallelism

### Community 58 - "create_agent_skills"
Cohesion: 0.23
Nodes (5): AgentSkills, create_agent_skills(), Create an AgentSkills plugin for a reviewer skill bundle.      Args:         ski, TestFrontendReview, TestWebSecurityReview

### Community 59 - "required"
Cohesion: 0.20
Nodes (12): id, required, file_changes, id, pr_number, repository, required, base_source (+4 more)

### Community 60 - "passes_post_generation_checks"
Cohesion: 0.23
Nodes (6): passes_post_generation_checks(), Apply V1 -> V2 -> V3 -> V4 (design doc 3.2.3) in order, short-circuiting     on, Phase 2 post-generation check V4: for a rule whose target runtime is     `"node", verify_runtime_consistency(), TestPassesPostGenerationChecks, TestVerifyRuntimeConsistency

### Community 61 - "build_target"
Cohesion: 0.50
Nodes (3): build_target(), Evaluate a pull request against eligibility filters and classify accepted target, TestBuildTarget

### Community 62 - "test_lead_engineer_router.py"
Cohesion: 0.29
Nodes (7): _make_app(), asyncio, FastAPI, _send_payload(), TestAgentCard, TestGetTask, TestSendTask

### Community 63 - "enum"
Cohesion: 0.24
Nodes (11): enum, type, category, enum, type, correctness, maintainability, performance (+3 more)

### Community 64 - "get_snippet_for_lang"
Cohesion: 0.24
Nodes (6): build_generation_prompt(), get_snippet_for_lang(), Build the user prompt for one (file, rule) mutation generation call.      Args:, Look up the language-specific snippet for `rule`.      `validate_catalog` is exp, TestBuildGenerationPrompt, TestGetSnippetForLang

### Community 65 - "verify_diff_parses"
Cohesion: 0.31
Nodes (3): Phase 2 post-generation check V1: is `mutated_patch` a syntactically     well-fo, verify_diff_parses(), TestVerifyDiffParses

### Community 66 - "task_store.py"
Cohesion: 0.27
Nodes (7): In-memory storage for A2A tasks, with lock-guarded mutation and TTL expiry., _make_app(), _pr_info_payload(), FastAPI, _send_payload(), TestAgentCard, TestSendTask

### Community 67 - "test_orchestrator.py"
Cohesion: 0.35
Nodes (6): _make_app(), asyncio, FastAPI, _send_payload(), TestAgentCard, TestGetTask

### Community 68 - "items"
Cohesion: 0.20
Nodes (10): items, type, items, type, type, items, type, file_changes (+2 more)

### Community 69 - "has_review_comments"
Cohesion: 0.33
Nodes (3): has_review_comments(), Return whether the PR has a qualifying inline review comment.      Review bodies, TestHasReviewComments

### Community 70 - "make_gold_item_row"
Cohesion: 0.42
Nodes (4): Render one Gold PR or Seeded item's matched/missed/unmatched-agent detail., _render_item_detail(), make_gold_item_row(), TestRenderItemDetail

### Community 71 - "make_row"
Cohesion: 0.27
Nodes (5): dedupe_rows(), Remove duplicate repository and pull-request pairs.      Returns:         De-dup, make_row(), TestFilterAndDedupe, TestSelection

### Community 72 - "code_review_agent/__init__.py"
Cohesion: 0.22
Nodes (5): Shared exception types for the review-stage and lead-engineer agents., Parallel review orchestrator.  Selects the reviewers applicable to a PR (by proj, Code Review Agent — multi-agent code review orchestration., GitHub MCP client factory.  Provides a shared factory for creating MCPClient ins, Shared tools for code review agents.

### Community 73 - "TestMutationGenSystemPrompt"
Cohesion: 0.20
Nodes (3): Asserts the system prompt teaches the model the constraints that     V1-V4 (and, The worked example's headers must not teach the model an         internally-inco, TestMutationGenSystemPrompt

### Community 74 - "TestCreateAgentSkills"
Cohesion: 0.22
Nodes (5): parametrize, Guards against #143: a skill's declared name and its parent         directory na, TestCreateAgentSkills, TestNone, TestSkillNameMatchesDirectory

### Community 75 - "_sanitize_cell"
Cohesion: 0.36
Nodes (3): Make *text* safe for one Markdown table cell.      A raw newline breaks a table, _sanitize_cell(), TestSanitizeCell

### Community 76 - "has_production_code_change"
Cohesion: 0.36
Nodes (3): has_production_code_change(), Return ``True`` when at least one changed production file has a patch., TestHasProductionCodeChange

### Community 77 - "SkillSource"
Cohesion: 0.22
Nodes (9): SkillSource, _build_angular_review_skills(), _build_frontend_review_skills(), _build_svelte_review_skills(), _build_web_security_review_skills(), Build the skill bundle for the web security reviewer.      Returns:         list, Build the skill bundle for the frontend technical reviewer.      The bundle comb, Build the skill bundle for the Angular technical reviewer.      The bundle pairs (+1 more)

### Community 79 - "find_insertion_point"
Cohesion: 0.39
Nodes (3): find_insertion_point(), Pick the index in `hunk_lines` (header at index 0) to insert after.      Prefere, TestFindInsertionPoint

### Community 80 - "summarize"
Cohesion: 0.36
Nodes (6): check_coverage_thresholds(), Any, Compare selected targets with the evaluation coverage policy.      Returns:, Build distributions and advisory coverage warnings.      Returns:         JSON-s, summarize(), TestSummaryAndCoverage

### Community 81 - "verify_a2a_api.py"
Cohesion: 0.43
Nodes (7): main(), _poll_task(), Run one agent check.      Returns:         ``True`` on success, ``False`` on tim, _require_env(), _send_task(), _verify_agent(), _write_result()

### Community 82 - "Path"
Cohesion: 0.36
Nodes (3): main(), Path, TestErrorPropagation

### Community 83 - "renovate.json"
Cohesion: 0.25
Nodes (7): config:recommended, :gitSignOff, customManagers, extends, packageRules, $schema, semanticCommits

### Community 85 - "analyze_pr_collector_repeated.py"
Cohesion: 0.38
Nodes (5): _ci95(), main(), _prf(), Normal-approx 95% CI for the mean.      Returns:         A ``(low, high)`` tuple, _title_sim()

### Community 86 - "within_change_limits"
Cohesion: 0.43
Nodes (3): Determine whether a pull request fits within file and line-change limits.      P, within_change_limits(), TestWithinChangeLimits

### Community 87 - "_extract_head_ref"
Cohesion: 0.38
Nodes (4): _extract_head_ref(), Return the PR head commit SHA (or ref) to pin "point in time" reads.      Args:, Tests for _extract_head_ref., TestExtractHeadRef

### Community 88 - "_extract_label_names"
Cohesion: 0.38
Nodes (4): _extract_label_names(), Normalise a PR ``labels`` field into a list of label name strings.      The GitH, Tests for _extract_label_names (handles string and dict label shapes)., TestExtractLabelNames

### Community 91 - "collect_review_texts"
Cohesion: 0.50
Nodes (3): collect_review_texts(), Aggregate non-blank inline comment and review bodies (any author).      Returns:, TestCollectReviewTexts

### Community 94 - "serena"
Cohesion: 0.50
Nodes (3): uvx, serena, start-mcp-server

## Knowledge Gaps
- **76 isolated node(s):** `uvx`, `start-mcp-server`, `$schema`, `$id`, `title` (+71 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `make_llm_mutation_generator()` connect `build_seeded_set.py` to `TestStructuredOutputDirective`?**
  _High betweenness centrality (0.160) - this node is a cross-community bridge._
- **Why does `PRInfoCollector` connect `PRInfoCollector` to `Settings`, `.collect`, `base_reviewer.py`, `code_review_agent/__init__.py`, `A2ADataPart`, `tests/agents/test_pr_info_collector.py`, `TestPRInfoCollectorCollect`, `PRInfoResult`, `Path`, `_extract_head_ref`, `_extract_label_names`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Why does `Settings` connect `Settings` to `task_store.py`, `test_orchestrator.py`, `ReviewResult`, `TaskStore`, `code_review_agent/__init__.py`, `A2ADataPart`, `api/agents/test_pr_info_collector.py`, `test_frontend_reviewer.py`, `_IsolatedSettings`, `test_lead_engineer_router.py`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Are the 36 inferred relationships involving `ReviewerConfig` (e.g. with `StructuredOutputMissingError` and `LeadEngineerAgent`) actually correct?**
  _`ReviewerConfig` has 36 INFERRED edges - model-reasoned connections that need verification._
- **Are the 72 inferred relationships involving `PRInfoResult` (e.g. with `LeadEngineerSkillInput` and `ReviewerSkillInput`) actually correct?**
  _`PRInfoResult` has 72 INFERRED edges - model-reasoned connections that need verification._
- **Are the 61 inferred relationships involving `ReviewPerspective` (e.g. with `DecisionVerdict` and `FindingDecision`) actually correct?**
  _`ReviewPerspective` has 61 INFERRED edges - model-reasoned connections that need verification._
- **Are the 27 inferred relationships involving `TaskStore` (e.g. with `A2AMessage` and `A2ATask`) actually correct?**
  _`TaskStore` has 27 INFERRED edges - model-reasoned connections that need verification._