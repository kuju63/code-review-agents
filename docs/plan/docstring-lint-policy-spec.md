# docstring lint方針 設計ドキュメント

コーディングエージェントが生成するコードは、docstringが規約(CONTRIBUTING.md 4節
「Use Google-style doc comments」)から外れる、あるいはリファクタ後にdocstringの
記述(Args/Returns/Raises)が実装と乖離するケースがある。従来これらは機械的に検出
されておらず、レビュアーが目視で気づくしかなかった。本ドキュメントは、Ruffの設定
だけでこれを機械的に検出できるようにするための方針を確定させる。

## 1. 背景と問題

`pyproject.toml` には従来 `[tool.ruff]` セクションが存在せず、Ruffは完全にデフォルト
設定(pydocstyle系ルール非有効)で動作していた。そのため以下の2種類の逸脱がいずれも
検出されない状態だった。

1. docstringのフォーマット逸脱(Google Style規約からの逸脱、docstring自体の欠落)
2. docstringの内容が実装と食い違う逸脱(例: 値を返すのに`Returns`が無い、存在しない
   引数が`Args`に書かれている)

## 2. 採用するルール

Ruff単体で完結させる方針とし、追加ツール(pydoclint単体導入等)は採用しない。

```toml
[tool.ruff.lint]
select = [
    "E4",
    "E7",
    "E9",
    "F",
    "D",
    "DOC102",
    "DOC201",
    "DOC202",
    "DOC402",
    "DOC403",
    "DOC501",
    "DOC502",
]
preview = true
explicit-preview-rules = true

[tool.ruff.lint.pydocstyle]
convention = "google"

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["D"]
"evaluation/**" = ["D"]
```

- `D`(pydocstyle、安定ルール): Google Style規約に対するフォーマットチェック。
  `convention = "google"` により、docstringが存在しない場合の検出(D100〜D107)や
  未文書化パラメータの検出(D417)を含む、Google規約向けの標準ルールセットが有効になる。
- `DOC102/201/202/402/403/501/502`(pydoclint由来、現時点でpreview限定): 関数シグ
  ネチャ・return文/yield文/raise文と、docstringの`Args`/`Returns`/`Yields`/`Raises`
  セクションが一致しているかどうかのチェック。
  - `DOC102`: docstringにあるが実装に無い引数(Args側の余分)
  - `DOC201`/`DOC202`: 値を返すのに`Returns`が無い/`Returns`があるのに値を返さない
  - `DOC402`/`DOC403`: `yield`するのに`Yields`が無い/`Yields`があるのに`yield`しない
  - `DOC501`/`DOC502`: 例外を送出するのに`Raises`が無い/`Raises`があるのに送出しない
  - `D417`(pydocstyleの一部、`convention=google`で自動有効)がArgs側の欠落検出を担う
    ため、Args欠落検出のためにDOC系列を追加選択する必要はない。

### 2.1 `select`を明示指定する理由(重要: 検証で判明した仕様)

当初は`extend-select`(デフォルトの`E4,E7,E9,F`にD/DOCを追加するだけ)で足りると
想定していたが、実機検証で**`preview = true`を設定すると、明示的な`select`が
無い場合にRuffのデフォルトルールセット自体が`E4,E7,E9,F`から大きく拡大される**
ことが判明した。`--isolated`(設定ファイルを一切読まない状態)で`--preview`単体を
指定しても、`BLE001`(blind-except)、`SIM117`(multiple-with-statements)、`UP017`、
`RUF022`、`FURB122`、`PLR1711`など、D/DOCと無関係な多数のルールが新たに有効化
されることを確認した。`explicit-preview-rules = true`は「プレフィックス指定で
previewルールを拾わない」効果はあるが、この「未select時のデフォルト拡大」自体は
防げない。

回避策は、デフォルトで有効なはずの`E4`/`E7`/`E9`/`F`を含めて`select`に**明示的に
全列挙する**ことである。これにより`preview = true`を設定してもデフォルト拡大は
発生せず、`select`に列挙したルールのみが有効になることを実機で確認済み。

`select`を明示した結果、従来検出されていなかった`F401`(未使用import、
`evaluation/tools/build_gold_set.py`の`urllib.parse`)が1件新たに検出された。
`urllib.parse`は実際に未使用であり、既存の技術的負債である。本タスクの設定変更が
なければ気づかれなかった項目だが、設定変更の直接的な副産物のため同じPRで修正する。

### 2.2 `explicit-preview-rules = true` を設定する理由

DOCルールはRuff上で現時点(v0.15系)では全て preview 機能であり、preview mode の
有効化なしには使用できない。`explicit-preview-rules = true` を設定すると、
`"DOC"` のようなプレフィックス一括指定ではpreviewルールが有効化されず、個別ルール
コードを明示した場合のみ有効になる。これにより、将来Ruffが `D` プレフィックス配下
に新たなpreviewルールを追加した場合でも、意図せずそれらを巻き込むことを防止できる。

## 3. スコープ外事項

- `numpy`/`pep257` conventionとの併用は対象外。プロジェクト全体でGoogle Styleに統一する。
- Args/Returnsの型注釈をdocstring側にも重複記載することの強制は対象外(型情報は関数
  シグネチャの型ヒントを正とし、docstringは意味・制約の説明に専念する)。
- テストコード(`tests/`配下)へのdocstring必須化(`D`系列)は対象外とする。ユニット
  テストの関数名自体が仕様を表現しているため、テスト関数への一律docstring強制は
  可読性向上に寄与しない。実測では`tests/`に`D`系列だけで838件検出されており、
  一律強制は非現実的である。`per-file-ignores`で`tests/**`の`D`系列のみを除外する。
- 評価パイプラインツール(`evaluation/`配下)も同様に`D`系列を対象外とする。当初の
  スコープには含めていなかったが、`ruff check`はプロジェクトルート全体
  (`evaluation/`含む)を対象に実行されるため、設定を有効化すると`evaluation/tools/`
  配下12ファイルにも97件(D系列94件+F401 1件+DOC系列2件)が検出されることが判明した。
  `evaluation/`は分析・データセット構築用のツール群であり`src/`のプロダクション
  コードと性質が異なるため、`tests/`と同じ扱い(D系列除外・DOC系列は適用)とする方針
  をユーザーに確認の上で決定した。
- いずれの場合も`DOC`系列(Args/Returns等の実装整合性チェック)は除外しない。
  docstringを書く場合、その内容が実装と食い違っていないことは`tests/`・
  `evaluation/`も含め全体で保証する。

## 4. 既知のリスク

- DOCルールはRuffのpreview機能であり、将来のRuffアップデートでルールの挙動やルール
  コードの割り当てが変わる可能性がある。`explicit-preview-rules = true` により影響
  範囲を個別コード指定に限定しているが、Ruffのメジャー/マイナーバージョンアップ時は
  `uv run ruff check --statistics` の結果を確認し、想定通りのルールのみが有効である
  ことを都度確認する。
- **`preview = true`はデフォルトルールセットを拡大しうる**(2.1節)。将来Ruffの
  仕様がさらに変わり、`select`明示指定でもデフォルト拡大を防げなくなる可能性はゼロ
  ではない。Ruffバージョンアップ時は必ず`--isolated --preview`相当の検証を行い、
  意図しないルールが混入していないことを確認する。
- `pyproject.toml`の`ruff` devの依存指定は従来`ruff>=0.15.20`で上限が無く、
  pre-commit側は`rev: v0.15.15`とバージョンが独立していた。今回の検証で
  preview機能の挙動がRuffのバージョン間で予想外に変わりうることを実際に確認した
  ため、上限固定(`ruff>=0.15.20,<0.16`)とpre-commit revの同期(`v0.15.20`)を
  本タスクで合わせて行う。

## 5. 影響範囲(最終確定設定での実測値)

2026-07-23時点、最終確定した`pyproject.toml`設定で`uv run ruff check --statistics .`
を実行した結果、**104件**を検出。

| ルール | 件数 | 対象 | 内容 | 対応方法 |
|---|---|---|---|---|
| DOC201 | 44 | src(10)/tests(4)/evaluation(30) | `Returns`セクション欠落 | 実装確認の上で手動追記 |
| D100 | 13 | src | モジュールdocstring欠落 | 手動追記 |
| D101 | 12 | src | クラスdocstring欠落 | 手動追記 |
| D103 | 8 | src | 関数docstring欠落 | 手動追記 |
| D102 | 7 | src | メソッドdocstring欠落 | 手動追記 |
| DOC501 | 7 | src(4)/evaluation(3) | `Raises`セクション欠落 | 実装確認の上で手動追記 |
| D107 | 6 | src | `__init__`docstring欠落 | 手動追記 |
| D104 | 4 | src | パッケージ(`__init__.py`)docstring欠落 | 手動追記 |
| D205 | 1 | src | サマリ行後の空行不足 | 手動修正(`convention=google`では自動修正非対応) |
| DOC402 | 1 | src | `Yields`セクション欠落 | 実装確認の上で手動追記 |
| F401 | 1 | evaluation | 未使用import(`urllib.parse`) | `--fix`で自動修正 |

`D`系列(51件、D100/D101/D102/D103/D104/D107/D205)は`src/code_review_agent/`配下
のみが対象(`tests/`・`evaluation/`は除外)。`DOC`系列(52件)と`F401`(1件)は
プロジェクト全体が対象。

自動修正(`--fix`)可能なのは`F401`の1件のみ。探索段階で見積もっていた
「D413(セクション後空行不足)49件は自動修正可能」という前提は誤りで、
`convention="google"`を設定するとそもそも`D413`はルールセットから外れる
(google conventionではセクション後の空行を必須としない)ため0件になる。
すなわち検出された104件のうち103件は手動でのdocstring追記・修正が必要。

D417・DOC102(Args側の欠落・余分)はいずれも0件であり、既存コードの引数ドキュメント
には変更を加えない。
