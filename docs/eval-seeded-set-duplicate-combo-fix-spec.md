# Seeded set生成: (ファイル, ルール)組み合わせ重複 修正 設計ドキュメント

`evaluation/tools/build_seeded_set.py` の `--multiplier >= 2` 実行時に、同一 Gold item に対して
同一の (ファイル, ルール) 組み合わせが確率的に再抽選され、内容が完全に一致する重複 Seeded item
が生成される不具合 (Issue #94) を修正する。

---

## 1. 背景と問題

現在リポジトリにコミットされている `evaluation/data/seeded_set.jsonl` (Gold 5件に対し
`--multiplier 2 --seed 42` で生成、全10行) を確認したところ、以下の重複が実在していた:

```bash
python3 -c "
import json
from collections import Counter
ids = [json.loads(l)['id'] for l in open('evaluation/data/seeded_set.jsonl') if l.strip()]
c = Counter(ids)
print(f'total={len(ids)} unique={len(set(ids))}')
print({k: v for k, v in c.items() if v > 1})
"
# => total=10 unique=9
# => {'seeded::vuetifyjs/vuetify#22788::b2b2c_idor_hint': 2}
```

`id` が完全一致するため `file_changes[].patch` も含めてbyte-for-byte同一の2エントリであり、
評価パイプライン (`run_agent_evaluation.py`) やスコアリング (`score_evaluation.py`) の
どの段階でも2件のどちらのインスタンスか原理的に区別できない。

### 根本原因

`build_seeded_item()`(旧 119-171行目)は `main()` の `for _ in range(multiplier)` ループ
(旧 197-205行目)の各反復で独立に以下を実行していた:

- `target = rnd.choice(candidates)` (旧136行目): 対象ファイルを**復元抽出**
- `rule = choose_rule(rules, lang, rnd)` (旧140行目、`choose_rule` は旧105-111行目):
  変異ルールを同様に**復元抽出**

`multiplier` の各反復間で「この Gold item に対して既に使った (ファイル, ルール) の組み合わせ」
を記録・除外する仕組みが一切ないため、確率的に同じ組み合わせが再度選ばれうる。

実データで各 Gold item の (ファイル, ルール) 組み合わせプールサイズ (候補ファイル数と、各
ファイルの言語にマッチするルール数の総和) を実測すると以下の通りで、いずれも
`multiplier=2` を大きく上回っている。つまり「プールが小さすぎて重複が避けられない」のではなく、
**復元抽出そのものが原因の偶発的重複**であることが分かる (プールサイズ ×
`1/pool_size` の確率で毎回重複しうる)。

| Gold item | candidate files | pool size (files×matching rulesの総和) |
|---|---|---|
| bitwarden/clients#20848 | 2 | 10 |
| hoppscotch/hoppscotch#6171 | 21 | 105 |
| bitwarden/clients#16156 | 2 | 10 |
| gitbutlerapp/gitbutler#14481 | 1 | 5 |
| vuetifyjs/vuetify#22788 | 2 | 10 |

なお pool size は「ファイル数 × ルール数」の単純な直積ではない。ファイルごとに
`detect_lang()` で判定される言語が異なり、`languages` 条件でマッチするルール集合も
ファイルごとに変わるため、**プールサイズ = 各候補ファイルについてマッチするルール数の総和**
となる。

発見元: `fix/eval-concurrent-log-attribution` ブランチ (#89/#95 で対応した並行実行時ログの
誤帰属修正) の実機検証中に、`--concurrency 3` の評価ログで同一ラベルの "started" が2回出力
されるのを発見し調査した結果。ログ表示側の不具合は既に修正済みで、本Issueはそれとは独立した
データ生成側の不具合。

---

## 2. 修正方針

Gold item ごとに (ファイル, ルール) の有効な組み合わせを**全列挙**し、`rnd.shuffle()` で
決定的にシャッフルしてから先頭 `min(multiplier, プールサイズ)` 件を採用する
(**非復元抽出**)。「重複時に再抽選する (retry-on-duplicate)」方式は採らない。プールが
ほぼ枯渇した状態では最後の未使用の組み合わせを引き当てるまでのリトライ回数が
非決定的に増大し、最悪ケースで無限ループになりうるため。

`build_seeded_set.py` の変更点:

- `candidate_files(gold_item)`: 対象ファイル候補の抽出 (prodファイル優先、なければ
  file_changes全体にフォールバック) を独立した関数として切り出す。ロジック自体は変更しない。
- `enumerate_combo_pool(gold_item, rules)`: `candidate_files()` の各ファイルについて、
  そのファイルの言語にマッチする各ルールとの組み合わせを全列挙する。旧 `choose_rule()` の
  復元抽出ロジックを置き換える中核。
- `render_seeded_item(gold_item, file_change, rule)`: 既に選ばれた (file_change, rule) から
  Seeded item を組み立てる。snippet注入・`seeded_changes`構築・戻り値dict構築は旧
  `build_seeded_item()` 後半と同一。
- `build_seeded_items(gold_item, rules, rnd, multiplier)`: `enumerate_combo_pool()` で
  プールを取得し、空なら `([], None)` を返す (現行の「マッチするルールがなければ0件」という
  黙示的スキップ動作を維持)。空でなければ `rnd.shuffle(pool)` し、
  `take = min(multiplier, len(pool))` 件を `render_seeded_item()` で生成して返す。
  `multiplier > len(pool)` の場合は採用数をプールサイズにクランプし、警告文字列
  (`[SEEDED-WARN] gold_id=... requested multiplier=... exceeds available combinations=...;
  clamping to N seeded item(s).`) を合わせて返す。

警告の出力先は stderr、プレフィックスは `[SEEDED-WARN]` とする。これは同ディレクトリの
`convert_tagged_targets.py` の `[COVERAGE-WARN]` パターン (`check_coverage_thresholds()` が
警告文字列を返し、`main()` が `print(warning, file=sys.stderr)`) を踏襲したもの。

`main()` の変更は、ループ内で `build_seeded_item()` を直接呼ぶ代わりに
`build_seeded_items()` を1回呼んで返った `items` を全て書き出し、`warning` があれば
stderr に出力する形に変わる。CLI引数 (`--gold/--catalog/--output/--multiplier/--seed`) は
変更しない。`--seed` を固定した場合の再現性は、`rnd.shuffle()` が同じ `random.Random`
インスタンスの状態遷移に従って決定的に動作するため維持される。

### 対象外

- 変異カタログ (`evaluation/config/seeded_mutations.json`) の内容は変更しない。
- `inject_patch()` によるパッチ注入ロジック・行番号計算は変更しない。
- CLI引数の追加・削除は行わない。

---

## 3. テスト

`tests/evaluation/tools/test_build_seeded_set.py` (新規、`tests/evaluation/conftest.py::
load_eval_tool_module` でロード) に以下を追加する:

- `TestCandidateFiles`: prodファイル優先・test-onlyフォールバックの回帰確認。
- `TestEnumerateComboPool`: プールサイズが「files × rules」ではなく「ファイルごとの
  マッチ数の総和」になること、言語が一切マッチしない場合に空プールになること。
- `TestBuildSeededItemsNoDuplicates`: 小さいプール (2ファイル×2ルール程度) に対し、
  複数シード (`range(50)`) で `build_seeded_items(..., multiplier=len(pool))` を呼び、
  返る `id` の集合に重複が生じないことを毎回検証する。本Issueで報告された重複
  (`vuetifyjs/vuetify#22788::b2b2c_idor_hint` の2重生成) が再発しないことの直接的な証拠。
- `TestBuildSeededItemsDeterminism`: 同じ seed で2回呼んで同じ順序の `id` 列が得られること。
- `TestBuildSeededItemsClampAndWarning`: プールサイズ1・`multiplier=3` で `len(items)==1`
  かつ警告文字列に gold id・requested multiplier・pool size が含まれること。プールが
  multiplierを十分上回る場合は警告が出ないこと。
- `TestBuildSeededItemsSingleFileSingleRuleRegression`: Issueが明示する単一ファイル・
  単一マッチルールのエッジケース (`multiplier` を `[1, 2, 5]` でパラメタライズし、常に
  `len(items)==1`)。
- `TestBuildSeededItemsEmptyPool`: マッチするルールがない場合 `([], None)` を返し
  例外を投げないこと。
- `TestMainCLI`: `tmp_path` + `monkeypatch.setattr(sys, "argv", ...)` + `capsys` で
  `main()` を実行し、出力JSONLに重複IDがないこと、`multiplier`超過時に
  `capsys.readouterr().err` に `[SEEDED-WARN]` が出ること (`.out` には出ないこと)。

---

## 4. 検証手順

1. `uv run pytest tests/evaluation/tools/test_build_seeded_set.py`
2. `uv run pytest` (フルスイート)
3. `uv run ruff check`
4. `uv run ruff format --check`
5. `evaluation/data/seeded_set.jsonl` を再生成:
   ```bash
   uv run python evaluation/tools/build_seeded_set.py \
     --gold evaluation/data/gold_pr_set.jsonl \
     --catalog evaluation/config/seeded_mutations.json \
     --output evaluation/data/seeded_set.jsonl \
     --multiplier 2
   ```
6. 再生成後、重複チェックのワンライナーで `total=10 unique=10 duplicates={}` を確認し、
   標準エラー出力に `[SEEDED-WARN]` が出ていないことを確認する (全 Gold item の
   プールサイズが `multiplier=2` を上回るため、出ないのが期待値)。
