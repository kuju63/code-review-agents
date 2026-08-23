# 位置情報欠落によるfinding/decisionのサイレントドロップ: 実装計画

Issue: #217
設計: [docs/finding-location-silent-drop-spec.md](../finding-location-silent-drop-spec.md)

## 検証①: 欠落の可視化

- 単体テストで、`filePath`/`line` 欠落時に評価フォーマット変換処理が WARNING を出力すること
  （`agent_findings` 側 / `lead_decisions` 側それぞれ）。
- 欠落なしの通常ケースでは WARNING が出力されないこと。
- 既存の除外挙動（件数・内容）が変わらないこと。

## 検証②: 位置情報の転記を明示的に指示

- 単体テスト: `STRUCTURED_OUTPUT_DIRECTIVE` が `filePath`/`line` の設定を明示的に要求する文言を
  含むこと。
- 既存のシステムプロンプト合成テストが引き続き成立すること。
