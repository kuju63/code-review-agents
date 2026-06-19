# Frontend PR Review Agent

## File structure

```
system_prompt.md

skills/
  reviewing-universal/              共通観点（全PRで使用）
    SKILL.md                          — カテゴリ概要 + reference目次
    references/
      security.md                     — XSS・シークレット・env変数 ← 毎PR必須
      correctness.md                  — ロジック・非同期・エッジケース
      accessibility.md                — セマンティクス・ラベル・ARIA
      dependencies.md                 — 新規依存: 正当性・ライセンス・重複
      performance.md                  — バンドルサイズ・仮想化・画像最適化
      test-quality.md                 — 実装詳細テスト・isolation・assertion

  reviewing-languages/              言語別観点
    SKILL.md                          — 言語検出ロジック + reference目次
    references/
      typescript.md                   — any・型アサーション・non-null
      javascript.md                   — 暗黙変換・==・Promiseエラー処理

  reviewing-frameworks/             フレームワーク別観点
    SKILL.md                          — FW検出ロジック + 共通コンポーネント設計 + reference目次
    references/
      react.md                        — useEffect deps・cleanup・key・メモ化
      vue.md                          — Composition API・watch・computed・v-for
      angular.md                      — Observable leak・OnPush・Signals
      svelte.md                       — リアクティビティ・Runes・each key

  reviewing-metaframeworks/         メタフレームワーク別観点
    SKILL.md                          — メタFW検出ロジック + reference目次
    references/
      ssr-common.md                   — hydration mismatch・SEO・SSRペイロード ← 全メタFWで必須
      nextjs.md                       — Server/Client境界・env・image・Middleware
      nuxtjs.md                       — useFetch・runtimeConfig・Nitro
      sveltekit.md                    — load配置・env module・page options
```

## Progressive disclosure の3段階

```
起動時    : 4スキルの name + description のみロード (~400トークン)
           ↓ PRを受け取りスタックと変更種別を判定
選択時    : 該当スキルの SKILL.md をロード (各20〜30行)
           ↓ SKILL.md の reference目次を見て必要なファイルを判定
実行時    : 必要な references/*.md だけをロード (各30〜60行)
```

## ロードされるトークン量の比較

| PR の種類 | 旧構造（全スキル集約） | 新構造 |
|---|---|---|
| React + TS のロジック変更 | 864行（全スキル） | security + correctness + typescript + react = 約170行 |
| Next.js のページ追加 | 864行 | security + correctness + a11y + typescript + react + ssr-common + nextjs = 約300行 |
| 依存追加のみ | 864行 | security + dependencies + performance = 約130行 |

## スキル選択早見表

| 何が含まれているか | ロードするスキル | ロードするreference |
|---|---|---|
| 全PR | reviewing-universal | security.md |
| ロジック変更 | reviewing-universal | + correctness.md |
| HTML/テンプレート変更 | reviewing-universal | + accessibility.md |
| 新規npm依存 | reviewing-universal | + dependencies.md + performance.md |
| テストファイル | reviewing-universal | + test-quality.md |
| .ts/.tsx ファイル | reviewing-languages | typescript.md |
| .js/.jsx ファイル | reviewing-languages | javascript.md |
| React | reviewing-frameworks | react.md |
| Vue.js | reviewing-frameworks | vue.md |
| Angular | reviewing-frameworks | angular.md |
| Svelte | reviewing-frameworks | svelte.md |
| Next.js | reviewing-metaframeworks | ssr-common.md + nextjs.md |
| Nuxt.js | reviewing-metaframeworks | ssr-common.md + nuxtjs.md |
| SvelteKit | reviewing-metaframeworks | ssr-common.md + sveltekit.md |

## 新フレームワーク追加手順

既存の4スキル構造を変えずに拡張できる。

```
# 例: Solid.js を追加する場合
1. reviewing-frameworks/references/solid.md を作成
2. reviewing-frameworks/SKILL.md の Reference files テーブルに1行追加
3. system_prompt.md の Step 3 テーブルに1行追加
```

SKILL.md 本体や他のreferenceファイルには一切触れない。

## ツール使用上限（1レビューあたり）

- Context7 call pairs: 最大3回
- URL Fetch: 最大3回
