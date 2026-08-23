# 指摘単位3軸評価 テスト方針 (Issue #168)

設計: [docs/finding-axis-evaluation-spec.md](../finding-axis-evaluation-spec.md)

- target選定出力が3軸を保持する。
- Gold生成が各findingへ3軸を継承し、旧形式では`unknown`を使う。
- Lead構造化出力が3軸を必須とし、値域外を拒否する。
- Leadの欠落decisionフォールバックが3軸を生成する。
- 評価形式がpriorityをseverityへ詰め替えず、3軸を独立出力する。
- severity / priorityの完全一致、隣接一致、2段階以上の不一致を検証する。
- impactの一致・不一致を検証する。
- 欠落・unknown・不正値と分母0を検証する。
- 既存の照合戻り値とSeeded hard gateの回帰を検証する。
