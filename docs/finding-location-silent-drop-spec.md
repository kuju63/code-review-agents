# 位置情報欠落によるfinding/decisionのサイレントドロップ: 可視化と緩和 設計ドキュメント

Issue: #217

`gemma-4-12B-it-qat-q4_0-gguf:Q4_0` を使った評価（commit `823b1c1`, `report_20260802-141711-823b1c1.md`）で、
Gold set・Seeded set のスコアが全指標で0.000となり、評価に成功した18件すべてで `agent_findings` が
空配列だった。本ドキュメントはその根本原因の記録と、対応する変更（可視化 + プロンプト緩和）を定義する。

これは `docs/granite-structured-output-failure-spec.md`（granite4.1:8bが構造化出力ツール自体を
呼ばずに散文Markdownを書いてしまう失敗）の後継にあたるが、根本原因は別物である。今回のモデルは
構造化出力ツール（`ReviewOutput`/`LeadEngineerOutput`）の呼び出し自体には成功しており、
`StructuredOutputMissingError` は発生していない。

---

## 1. 背景と根本原因

### 症状

`report_20260802-141711-823b1c1.md`:

- Gold set: Issue Recall / Precision / Severity Agreement すべて 0.000（Gold findings 91件中マッチ0件）
- Seeded set: Must-Find Recall 0.000, Critical Miss Rate 1.000
- Hard Gate: FAIL
- `agent_predictions.jsonl` を直接確認すると、失敗扱いにならなかった18件すべてで
  `agent_findings: []` / `lead_decisions: []`

### 根本原因（1件の再現診断から再構成）

`nuxt/nuxt#35799` を単独実行（concurrency=1, timeout延長）し、A2Aサーバーから完了タスクの
生レスポンスを直接取得して確認した。

1. `react-technical` レビュアーは実際に3件の正当な指摘を発見し、`LeadEngineerAgent` も
   それぞれに妥当な Accept/Reject 判断を下していた。
2. 取得した生データでは、3件とも `"file_path": null, "line": null` だった。一方
   `context` フィールドには `packages/nuxt/src/imports/module.ts` の `L224` と正確に
   書かれており、モデルは場所を正しく認識していた。
3. `LeadEngineerReport.to_evaluation_format()`（`src/code_review_agent/models/lead_engineer.py`）は
   `file_path`/`line` が欠けている finding/decision を **警告もログもなく黙って除外** する:

   ```python
   agent_findings = [... for d in self.accepted() if d.finding.file_path and d.finding.line is not None]
   lead_decisions = [... for d in self.decisions if d.finding.file_path and d.finding.line is not None]
   ```

結果、内部的には妥当な判断が存在するにもかかわらず、評価出力上は「何も見つからなかった」と
区別がつかない形で消える。

### これは2つの別問題である

- **(A) サイレントなデータ損失（コード側の欠陥、モデル非依存）**: `file_path`/`line` を欠く
  finding/decision はどのモデルを使っていても無警告で消える。この可視性の欠如が、今回の
  切り分けに数時間を要した主因である。`file_path`/`line` を必須化するのは対策にならない —
  `ReviewFinding` のdocstring自身が「位置非依存な指摘」の存在を許容しており、必須化すると
  今度はモデルが架空の行番号を捏造するリスクを生む。
- **(B) モデルの信頼性ギャップ**: ローカル量子化モデルは必須フィールド（`comment`/`priority`等）は
  確実に埋める一方、`context` に場所を書いた直後でも、専用のOptionalフィールド
  （`file_path`/`line`）への転記を怠る。今回のプロジェクトではコスト・パフォーマンス上の制約から
  モデルサイズの拡大は選択肢にないため、取れる対策はプロンプト/スキーマ側からの働きかけに限られる。

---

## 2. 変更①: 欠落の可視化

### 目的

`file_path`/`line` 欠落により finding/decision が評価出力から除外されるたびにWARNINGログを
出力し、次回以降このデバッグ（1件ずつの手動再現）を不要にする。

### 設計判断

- 変更対象: `src/code_review_agent/models/lead_engineer.py` の
  `LeadEngineerReport.to_evaluation_format()`
- 既存の除外条件・出力シェイプ（`agent_findings` は `self.accepted()` から severity 降順、
  `lead_decisions` は `self.decisions` の順序）は変更しない。既存テスト
  （`test_to_evaluation_format_excludes_*`）が引き続き成立することを確認する。
- `agent_findings` と `lead_decisions` は独立した出力であり、片方だけ欠落する組み合わせもある
  （例: accept だが位置なし → 両方から欠落。reject だが位置なし → `lead_decisions` のみから欠落、
  そもそも `agent_findings` の対象外）。そのため2つのリスト内包表記をそれぞれ明示的なループに
  展開し、除外時にどちらの出力から欠落したかが分かる形で個別にログする。1件が両方から欠落する
  場合は2行ログされるが、これは「2つの異なる出力に影響した」という正確な情報であり、
  重複ではない。
- ログレベルは WARNING（`docs/granite-structured-output-failure-spec.md` の
  `task_store.py` での先例に合わせる）。ログには `pr_id` ・ reviewer_id ・ comment の先頭部分を
  含め、grepで追跡できるようにする。

### 検証

- 単体テスト（`caplog`）で、`file_path`/`line` 欠落時に `to_evaluation_format()` が WARNING を
  出力すること（`agent_findings` 側 / `lead_decisions` 側それぞれ）。
- 欠落なしの通常ケースでは WARNING が出力されないこと。
- 既存の除外挙動（件数・内容）が変わらないこと。

---

## 3. 変更②: 位置情報の転記を明示的に指示（緩和）

### 目的

モデルが `context`/`comment` に場所を書いた場合、専用の `file_path`/`line` フィールドにも
必ず転記するよう促し、(A)で可視化された欠落そのものの発生頻度を下げる。

### 設計判断

- 出力形式は各reviewer固有ではなく横断的関心事のため、
  `docs/granite-structured-output-failure-spec.md` で確立された既存パターン（共有ディレクティブ
  定数 `STRUCTURED_OUTPUT_DIRECTIVE` を `base_reviewer.py` に一元化し、`compose_system_prompt()`
  経由で全LLM reviewerに付与）をそのまま踏襲する。reviewerごとの `system_prompt` 定数は変更しない。
- 変更対象: `src/code_review_agent/agents/base_reviewer.py` の `STRUCTURED_OUTPUT_DIRECTIVE`
- 追記する指示は診断で観測した失敗パターンに直接対応させる: 「位置が分かっている finding は
  `file_path`/`line` を必ず設定すること。`comment`/`context` に場所を書くだけでは不十分で、
  未設定のままだと finding は評価から除外され、ユーザーに一切届かない」という理由まで含める
  （何をすべきかだけでなく、なぜ重要かを示す方が小型モデルの追従率が上がるという
  `STRUCTURED_OUTPUT_DIRECTIVE` 既存部分の設計方針に合わせる）。
- `LeadEngineerAgent` 側のプロンプトは変更しない: `file_path`/`line` を決めるのは reviewer の
  `ReviewFinding` のみで、`LeadEngineerAgent` は既存findingを参照するだけだから
  （`_build_prompt_and_index` / `_resolve_decisions`）。

### 検証

- 単体テスト: `STRUCTURED_OUTPUT_DIRECTIVE` が `file_path`/`line` の設定を明示的に要求する文言を
  含むこと（`tests/agents/test_reviewers.py::TestStructuredOutputDirective`）。
- 既存の `compose_system_prompt`/reviewer合成プロンプトのテストが引き続き成立すること。

---

## 4. 非対象（Non-goals）

- `file_path`/`line` の必須化（1章参照: 位置非依存な指摘を壊すため）。
- `context`/`comment` からの `path:line` 正規表現フォールバック抽出（将来検討の余地はあるが、
  不要なフォールバックを追加しないという方針上、今回のスコープには含めない）。
- より大きい/非量子化モデルへの切り替え（コスト・パフォーマンス制約により対象外）。

## 5. 検証方針（評価）

コード変更はユニットテストで検証する。評価パイプライン（`evaluation/EVALUATION_PLAN.md`）による
再評価は本ドキュメントの変更そのものの合否条件には含めない — ①はログ追加のみで検出品質に影響せず、
②はプロンプト緩和でモデルの非決定的な挙動に依存するため、単発の再評価で結論を出すのは
`granite-structured-output-failure-spec.md` の教訓（「断定は避け、実行ログを根拠として提示する」）
に反する。効果測定が必要になった場合は別途 `/run-evaluation` で追跡する。
