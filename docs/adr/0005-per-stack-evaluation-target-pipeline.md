# ADR-0005: スタック別 Gold-set ターゲット選定の正規経路化

- Status: Proposed(未実装・レビュー待ち)
- Date: 2026-07-26
- Related: PR #145, [docs/goldset-per-stack-spec.md](../goldset-per-stack-spec.md), [docs/evaluation-pipeline-design.md](../evaluation-pipeline-design.md)

## Context

PR #145 (commit `4c3e398`) は評価パイプラインの Gold-set ターゲット選定を
スタック別 (React / Vue / Angular / Svelte) に再構成するため、`discover_candidate_prs.py`
を破壊的に改修し、スタックごとの `pr_targets_{stack}.json` を直接生成する新しい
「生産者」を追加した。severity / impact / priority は LLM の独立 3 軸解析で付与される。

しかし、この新方式は実行パイプラインのどこからも消費されていない。評価データ生成の
実行系 (`run_evaluation_pipeline.sh` → `convert_tagged_targets.py` → `build_gold_set.py`)
は依然として旧来の単一プール `pr_targets_b2b2c_tagged.json` を入力とする経路のままであり、
新しい 4 ファイル (計 147 ターゲット) は生成されるだけで孤立している。結果として、
どちらの経路が「正規」なのかがドキュメント上も実装上も曖昧なまま二重に存在している。

加えて、新生産者 (`discover_candidate_prs.py`) と後段の Gold ビルダー
(`build_gold_set.py`) の間には、選定基準の不一致が 2 点ある。

- **本番コード判定の不一致**: 生産者は test / doc 以外の *あらゆる* ファイル
  (backend の `.py` / `.go` を含む) を本番コード変更とみなすが、Gold ビルダーは
  frontend 拡張子 + `package.json` のみを対象ファイルとする。backend-only の PR は
  生産者を通過するが Gold ビルダーで `file_changes` が空になり黙って捨てられる。
- **レビューコメント要件の不一致**: 生産者は review body のみの PR も許容するが、
  Gold ビルダーは inline コメント (path 付き) のみを findings として抽出し、
  findings が空の PR を捨てる。`EVALUATION_PLAN.md` §2.0.2 も「inline コメントが
  1 件以上」を必須と定めており、生産者側の緩い判定はこの規範と乖離している。

さらに、生産者の `--skip-repos` は本来「既に処理済みの repo をスキップして再開する」
resume 用途だったが、現在の `write_stack_outputs` は毎回 `all_targets` で全スタック
ファイルを上書きするため、`--skip-repos` を使うとスキップした repo の既存ターゲットが
`[]` に消える破壊的挙動になっている (PR #145 で旧実装の resume マージが失われた)。

これらは「新方式を評価の正規経路にする」という PR #145 の目的を完遂するために
併せて解消すべき、コンポーネント間 (生産者 ↔ セレクタ ↔ Gold ビルダー) の
責務分担とデータフロー境界に関わる意思決定である。

## 検討事項

1. 新方式 (per-stack ファイル) と旧方式 (単一 tagged プール) の共存・移行方針:
   どちらを正規経路とし、旧経路をどう扱うか。
2. 生産者と Gold ビルダーの選定基準 (本番コード判定・inline コメント要件) の不一致を
   どこで解消するか。

## 検討内容

### 検討事項1: 新方式と旧方式の移行方針

#### 案A: 旧経路を完全撤去し、新方式を唯一の正規入力に置換する

`convert_tagged_targets.py` と旧タグ JSON・中間ファイルを削除し、新しい
per-stack セレクタを追加して `pr_targets_{stack}.json` を唯一の入力とする。

| 観点 | 内容 |
| --- | --- |
| メリット | 正規経路が 1 本に定まり「どちらが正か」の曖昧さが消える。severity / impact / priority という新 3 軸を評価選定に実際に活用できる。孤立していた新方式が初めて機能する。名前 (per-stack Gold set) と実体 (実行に使われるデータ) が一致する |
| デメリット | 旧経路に依存していた RUNBOOK / README / SKILL / パイプラインスクリプトの参照を一括更新する必要があり、変更範囲が広い。旧 CLI (`--min-risk` / `--themes-any`) を使う既存の実行手順は破壊される |

#### 案B: 新方式用の別セレクタを追加し、旧経路と併存させる

旧 `convert_tagged_targets.py` を温存したまま、per-stack 専用セレクタを新規追加し、
利用者がどちらの入力を使うか選べるようにする。

| 観点 | 内容 |
| --- | --- |
| メリット | 既存の実行手順を壊さない。移行を段階的に行える |
| デメリット | 「どちらが正規経路か」の曖昧さが残り、本 ADR が解消しようとしている問題そのものが温存される。選定・集計ロジックが 2 系統に重複し、スキーマ (risk_priority/priority_themes と severity/impact/priority) が非互換なまま並存して保守負担が二重化する |

#### 案C: 現状維持 (Do Nothing) — 新方式は生成物として置くだけ

`pr_targets_{stack}.json` を生成物として残しつつ、実行系は旧経路のまま運用する。

| 観点 | 内容 |
| --- | --- |
| メリット | 追加の実装コストがゼロ。既存の実行手順に一切影響しない |
| デメリット | 新方式が永久に孤立し、PR #145 が投じた LLM 3 軸解析のコストが無駄になる。二重経路の曖昧さと、生産者↔ビルダー間の基準不一致 (黙ってターゲットが落ちる) が放置される |

### 検討事項2: 生産者と Gold ビルダーの選定基準の不一致の解消場所

#### 案A: 単一の共通述語モジュールに集約し、両者が参照する

本番コード判定と inline コメント要件を 1 つのモジュールに定義し、
`discover_candidate_prs.py` と `build_gold_set.py` の双方が import する。

| 観点 | 内容 |
| --- | --- |
| メリット | 判定基準が単一の真実の源になり、生産者を通過した PR は必ず Gold ビルダーでも受理される。将来スタックや対象拡張子が増えても 1 箇所の変更で両者に反映される |
| デメリット | 新モジュールを追加する分、ファイル構成がわずかに増える。両者が同一モジュールに依存する結合が生じる |

#### 案B: Gold ビルダー側の判定を生産者に手作業でコピーして揃える

共通化はせず、`build_gold_set.py` の判定ロジックを `discover_candidate_prs.py` にも
同等に実装して基準を一致させる。

| 観点 | 内容 |
| --- | --- |
| メリット | モジュール追加が不要で、両ファイルの独立性が保たれる |
| デメリット | 同じ基準が 2 箇所に重複し、片方だけ変更されて再び乖離するリスクが残る。名前が同じでも実体が別々に育つ典型的な劣化パターンに陥りやすい |

#### 案C: Gold ビルダー側を緩めて生産者の広い基準に合わせる

Gold ビルダーが backend ファイルや review body のみの PR も受理するよう緩和する。

| 観点 | 内容 |
| --- | --- |
| メリット | 生産者側を変えずに不一致を解消できる |
| デメリット | `EVALUATION_PLAN.md` §2.0.2 の「inline コメント必須」「frontend スコープ」という評価規範に反する。位置精度を評価できない PR や評価対象外の backend 変更が Gold set に混入し、評価の妥当性が損なわれる |

## 検討結果

### 検討事項1: 移行方針 → 案A(旧経路を完全撤去し新方式へ置換)を採用

本 ADR が解消すべき中心的課題は「正規経路の曖昧さ」であり、案 B・案 C はいずれも
その曖昧さを温存するため課題解決にならない。案 B はスキーマ非互換な 2 系統を
併存させ保守負担を二重化する点で、二重経路の弊害を最も強く残す。案 C は新方式の
コストを無駄にしたまま基準不一致も放置する。案 A は変更範囲が広く既存手順を破壊する
デメリットがあるが、per-stack 選定を正規化するという PR #145 の目的そのものと合致し、
名前と実体を一致させる唯一の選択肢である。破壊される既存手順は RUNBOOK / README /
SKILL の一括更新で追随できる範囲であり、許容する。

- 許容したトレードオフ: 旧 CLI に依存した実行手順の破壊と、関連ドキュメント・
  スクリプトの一括更新コスト。

### 検討事項2: 基準不一致の解消場所 → 案A(共通述語モジュール)を採用

案 B は同一基準を 2 箇所に重複させ、将来の再乖離リスクを残す。今回まさに
「名前は同じ判定だが実体が別々に育って乖離した」状態を修正しているのだから、
同じ構造を再生産する案 B は不適切である。案 C は評価規範 (`EVALUATION_PLAN.md`
§2.0.2) に反し、評価の妥当性を犠牲にするため採れない。案 A は判定を単一の真実の源に
することで、生産者を通過した PR が Gold ビルダーで黙って落ちる問題を構造的に防ぎ、
将来の拡張も 1 箇所で完結する。モジュール追加という小さなコストは、乖離再発の
防止という便益に見合う。

- 許容したトレードオフ: 共通述語モジュールの追加によるファイル数の微増と、
  両ツールが同一モジュールへ依存する結合。

## Decision

1. per-stack 方式 (`discover_candidate_prs.py` → `pr_targets_{stack}.json`) を評価
   ターゲット選定の唯一の正規経路とする。新規 `select_stack_targets.py` が
   4 ファイルを結合・フィルタ・サンプリングして `evaluation/data/pr_targets.json`
   (`{repository, pr_number}` のみ) を生成し、`build_gold_set.py` の入力とする。
2. 旧経路を完全撤去する: `convert_tagged_targets.py` とそのテスト、
   `pr_targets_b2b2c_tagged.json`、`pr_candidates_raw.json`、`selection_checklist.md`
   を削除し、`run_evaluation_pipeline.sh` / RUNBOOK / README / SKILL の参照を更新する。
3. 本番コード判定と inline コメント要件を単一の共通述語モジュールに集約し、
   `discover_candidate_prs.py` と `build_gold_set.py` の双方が参照する。生産者側の
   本番コード判定を frontend スコープに、レビューコメント要件を inline 必須に揃える。
4. `--skip-repos` の resume 挙動を非破壊化し、スキップした repo の既存ターゲットを
   マージして保持する。
5. 上記 3 の基準変更を既存の `pr_targets_{stack}.json` にも反映するため、
   `discover_candidate_prs.py` を再実行して 4 ファイルを再生成する。スキーマ
   (repository / pr_number / stack / repo_type / severity / impact / priority) は
   変更しない。
6. Gold の findings フィールド名 `human_findings` は、実体としては AI レビューボットの
   コメントも許容するが、Gold スキーマ・スコアラ全体に波及する rename は本 ADR の
   スコープ外とし、定義をドキュメントで明確化するに留める。

## Consequences

- 評価の正規経路が per-stack 方式 1 本に定まり、severity / impact / priority を
  実際の選定フィルタとして活用できるようになる。
- 生産者を通過した PR が Gold ビルダーで黙って落ちる不整合が構造的に解消される。
  一方、既存 4 ファイルは再生成により件数が減る可能性がある (backend-only /
  review-body-only の PR が除外されるため)。
- 旧経路に依存していた実行手順・ドキュメントは全て新経路へ更新が必要になる。
  旧 CLI (`--min-risk` / `--themes-any`) を前提とした手順は使えなくなる。
- 共通述語モジュールへの依存が生産者と Gold ビルダーの双方に生じる。将来
  対象スタック・拡張子を変える際はこのモジュールを起点に変更する。
- `human_findings` の名称と実体 (AI コメントも含む) の不一致は残る。将来、
  スキーマ移行を伴う rename を別タスクとして検討する余地がある。
