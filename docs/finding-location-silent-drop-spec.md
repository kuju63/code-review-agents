# 位置情報欠落によるfinding/decisionのサイレントドロップ: 可視化と緩和 設計ドキュメント

Issue: #217

`gemma-4-12B-it-qat-q4_0-gguf:Q4_0` を使った評価（commit `823b1c1`,
`report_20260802-141711-823b1c1.md`）で、Gold set・Seeded set のスコアが全指標で0.000となり、
評価に成功した18件すべてで `agent_findings` が空配列だった。本ドキュメントはその根本原因の記録と、
対応する設計判断（可視化 + プロンプト緩和）を定義する。実装計画・テスト手順は
[docs/plan/finding-location-silent-drop-spec.md](plan/finding-location-silent-drop-spec.md) を参照。

これは [docs/granite-structured-output-failure-spec.md](granite-structured-output-failure-spec.md)
（granite4.1:8bが構造化出力ツール自体を呼ばずに散文Markdownを書いてしまう失敗）の後継にあたるが、
根本原因は別物である。今回のモデルは構造化出力ツール自体の呼び出しには成功しており、
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
2. 取得した生データでは、3件とも位置情報（`filePath`/`line`）が未設定だった。一方
   `context` フィールドには対象ファイルと行番号が正確に書かれており、モデルは場所を
   正しく認識していた。
3. 評価出力への変換処理（`filePath`/`line` を持つ finding/decision だけを抽出する処理）は、
   位置情報が欠けている finding/decision を**警告もログもなく黙って除外**していた。

結果、内部的には妥当な判断が存在するにもかかわらず、評価出力上は「何も見つからなかった」と
区別がつかない形で消える。

### これは2つの別問題である

- **(A) サイレントなデータ損失（コード側の欠陥、モデル非依存）**: `filePath`/`line` を欠く
  finding/decision はどのモデルを使っていても無警告で消える。この可視性の欠如が、今回の
  切り分けに数時間を要した主因である。`filePath`/`line` を必須化するのは対策にならない —
  finding は「位置非依存な指摘」の存在を許容する設計であり、必須化すると今度はモデルが
  架空の行番号を捏造するリスクを生む。
- **(B) モデルの信頼性ギャップ**: ローカル量子化モデルは必須フィールド（`comment`/`priority`等）は
  確実に埋める一方、`context` に場所を書いた直後でも、専用のOptionalフィールド
  （`filePath`/`line`）への転記を怠る。コスト・パフォーマンス上の制約からモデルサイズの拡大は
  選択肢にないため、取れる対策はプロンプト/スキーマ側からの働きかけに限られる。

---

## 2. 変更①: 欠落の可視化

### 目的

`filePath`/`line` 欠落により finding/decision が評価出力から除外されるたびにWARNINGログを
出力し、次回以降このデバッグ（1件ずつの手動再現）を不要にする。

### 設計判断

- 対象: 評価用フォーマットへの変換処理（`LeadEngineerReport`から`{agent_findings, lead_decisions}`
  を組み立てる箇所）。
- 既存の除外条件・出力シェイプ（`agent_findings` は accept 済みかつ severity 降順、
  `lead_decisions` は全 decision の順序）は変更しない。
- `agent_findings` と `lead_decisions` は独立した出力であり、片方だけ欠落する組み合わせもある
  （例: accept だが位置なし → 両方から欠落。reject だが位置なし → `lead_decisions` のみから欠落、
  そもそも `agent_findings` の対象外）。そのため2つの出力それぞれを独立にループし、除外時に
  どちらの出力から欠落したかが分かる形で個別にログする。1件が両方から欠落する場合は2行ログ
  されるが、これは「2つの異なる出力に影響した」という正確な情報であり、重複ではない。
- ログレベルは WARNING（`granite-structured-output-failure-spec.md` で確立した先例に合わせる）。
  ログには PR ID・reviewer ID・comment の先頭部分を含め、grepで追跡できるようにする。

現行実装: `packages/agent-core/src/models/lead-engineer.ts` の `toEvaluationFormat()` /
`logDropped()`。

---

## 3. 変更②: 位置情報の転記を明示的に指示（緩和）

### 目的

モデルが `context`/`comment` に場所を書いた場合、専用の `filePath`/`line` フィールドにも
必ず転記するよう促し、(A)で可視化された欠落そのものの発生頻度を下げる。

### 設計判断

- 出力形式は各reviewer固有ではなく横断的関心事のため、
  `granite-structured-output-failure-spec.md` で確立された既存パターン（共有ディレクティブ
  定数 `STRUCTURED_OUTPUT_DIRECTIVE` を全LLM reviewerに一元的に付与する仕組み）をそのまま
  踏襲する。reviewerごとのシステムプロンプトは変更しない。
- 追記する指示は診断で観測した失敗パターンに直接対応させる: 「位置が分かっている finding は
  `filePath`/`line` を必ず設定すること。`comment`/`context` に場所を書くだけでは不十分で、
  未設定のままだと finding は評価から除外され、ユーザーに一切届かない」という理由まで含める
  （何をすべきかだけでなく、なぜ重要かを示す方が小型モデルの追従率が上がるという
  `STRUCTURED_OUTPUT_DIRECTIVE` 既存部分の設計方針に合わせる）。
- `LeadEngineerAgent` 側のプロンプトは変更しない: `filePath`/`line` を決めるのは reviewer の
  finding のみで、`LeadEngineerAgent` は既存findingを参照するだけだから。

現行実装: `packages/agent-core/src/agents/base-reviewer.ts` の `STRUCTURED_OUTPUT_DIRECTIVE`。

---

## 4. 非対象（Non-goals）

- `filePath`/`line` の必須化（1章参照: 位置非依存な指摘を壊すため）。
- `context`/`comment` からの `path:line` 正規表現フォールバック抽出（将来検討の余地はあるが、
  不要なフォールバックを追加しないという方針上、今回のスコープには含めない）。
- より大きい/非量子化モデルへの切り替え（コスト・パフォーマンス制約により対象外）。

## 5. 検証方針（評価）

コード変更はユニットテストで検証する。評価パイプラインによる再評価は本設計そのものの合否
条件には含めない — ①はログ追加のみで検出品質に影響せず、②はプロンプト緩和でモデルの
非決定的な挙動に依存するため、単発の再評価で結論を出すのは
`granite-structured-output-failure-spec.md` の教訓（「断定は避け、実行ログを根拠として提示する」）
に反する。効果測定が必要になった場合は別途 `/run-evaluation` で追跡する。
