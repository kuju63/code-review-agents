# `agents/` + `tools/` TypeScript移行 計画からの逸脱記録 (Issue #252)

設計: [docs/typescript-agents-tools-migration-spec.md](../typescript-agents-tools-migration-spec.md) §6

実装中に設計ドキュメントの決定から逸脱した場合は、#258の運用に倣い同一コミットで設計ドキュメントも更新する。

- **5.8の追加**: 当初計画(`issue-261-issue-pr-265-stacked-prs-indexed-cook.md`)は
  Python版に倣った複数type dedupeを想定していたが、`detectProjectTypes`の実際の契約(0/1件のみ)を実装時に
  確認し、単純化した。
- **`needsGithubMcp`公開ゲッターの追加(スライスBファイルへの変更)**: `usesGithubMcp`が`protected`インスタンス
  フィールド(§4.3で決定済み)であるため、オーケストレーター(本スライス)から`reviewer.usesGithubMcp`を
  直接読めないことが実装時に判明した。`base-reviewer.ts`(スライスB所有)に`ReviewAgent.needsGithubMcp`
  (`public`、デフォルト`false`)と`LLMReviewAgent`でのオーバーライド(`this.usesGithubMcp`を返す)を追加した。
  既存の`usesGithubMcp`を`public`に変更しなかったのは、サブクラス側で`protected`のまま再宣言している箇所
  (例: `base-reviewer.review.test.ts`の`NoMcpReviewer`)がTSの可視性の絞り込み禁止規則により壊れるため。
