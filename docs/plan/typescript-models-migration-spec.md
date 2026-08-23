# `models/` TypeScript移行 コミット粒度・PRタイトル規約 (Issue #251)

設計: [docs/typescript-models-migration-spec.md](../typescript-models-migration-spec.md)
（`typescript-toolchain-spec.md` §6/§7 の申し送り事項）

- PRタイトル: `feat: migrate models/ to TypeScript types + Zod schemas (Issue #251)`
- コミット単位:
  1. 本ドキュメント（スペックのロールバックポイント）
  2. `pr-info.ts`（RED→GREEN→REFACTOR）
  3. `review.ts`（`pr-info.ts`に依存）
  4. `lead-engineer.ts` + `index.ts`バレル更新 + プレースホルダ削除
  5. 必要であればリファクタ後の品質ゲート通過コミット
