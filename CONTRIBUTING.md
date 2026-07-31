# コントリビューションガイド

このドキュメントは、本リポジトリにおけるコントリビューションのワークフローを定義する。

## 1. 原則

- バグ修正・機能要望については、実装を始める前に必ずIssueを作成すること。
- 大きな変更の場合は、実装前にIssue上で目的・背景・影響範囲について合意すること。
- 開発プロセスは、このドキュメントに記載する**Spec-Driven + TDD**を採用する。
- 機能の追加・変更を行う場合は、`docs/` 配下の関連ドキュメントを必ず作成・更新すること。

## 2. 開発フロー（Spec-Driven + TDD）

1. Issueを作成する

   - バグ修正: 再現手順、期待結果、実際の結果、環境の詳細を含めること。
   - 機能要望: ユーザーにとっての価値、受け入れ基準、必要に応じて非機能要件を含めること。

2. 要件を明確化し、specをファイルに残す

   - 要件、境界条件、例外シナリオを定義する。
   - 必要に応じて `plan/` および `docs/` 内の既存ドキュメントを更新する。
   - 機能の追加・変更を行う場合、`docs/` 配下の関連ドキュメントの作成・更新は必須である。

3. TDDで実装する

   - 先にテストを書く（Red）。
   - テストを通す最小限の変更を実装する（Green）。
   - リファクタリングと再検証を行う（Refactor）。

4. 品質ゲートを満たす

   - 要件が満たされていること。
   - すべてのテストが通ること。
   - テストカバレッジが75%以上であること。

5. プルリクエストを作成し、レビューフィードバックに対応する

   - PRに関連するIssueをリンクする。
   - フィードバックを反映した後、test/lint/formatを再実行し、ブランチを更新する。

## 3. ローカル開発コマンド

### 初期セットアップ

```bash
uv venv
source .venv/bin/activate
uv sync
pre-commit install
```

### テスト

```bash
uv run pytest
```

### Lintとformat

```bash
uv run ruff check
uv run ruff check --fix
uv run ruff format
uv run ruff format --check
```

### ビルド

```bash
uv build
```

## 4. 実装・設計ルール

- PEP 8に従うこと。
- 型ヒントを付けること。
- 1つのモジュールは1つの責務に集中させること。
- Googleスタイルのdocコメントを使用すること。
- 行コメントはwhy/whatに絞り、自明なコメントは避けること。

## 5. PR説明のルール

- PRの説明は `.github/pull_request_template.md` を使って記述すること。
- 最低限、以下のセクションを必ず記入すること。
- Summary（概要）
- Change Details（変更内容）
- Impact Scope（影響範囲）
- Related Issue（関連Issue）
- Test Results（テスト結果）
- Documentation Updates（ドキュメント更新）
- Risk and Rollback（リスクとロールバック）

## 6. 参考資料

- 要件判定基準: `evaluation/EVALUATION_PLAN.md`
- 評価実行手順: `evaluation/RUNBOOK.md`
