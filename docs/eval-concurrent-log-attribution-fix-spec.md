# 評価パイプライン: 並行実行時ログの失敗項目誤帰属 修正 設計ドキュメント

`run_agent_evaluation.py` の `_evaluate_concurrently`(`--concurrency >= 2`)で、コンソールログ上の
「どの項目が失敗したか」の見た目が、実際に失敗した項目と食い違って見えることがある不具合を修正する。

---

## 1. 背景と問題

2026-07-06の評価実行(Gold 5件 + Seeded 10件、`--concurrency 2`)で、コンソールログは
`vuetifyjs/vuetify#22788::b2b2c_idor_hint` がタイムアウトしたように見えたが、最終レポート
(`report_20260706-211813-f9b4399.md`)の「失敗アイテム」および `[WARN] N item(s) failed` ブロック
は `hoppscotch/hoppscotch#6171::b2b2c_idor_hint` を失敗アイテムとして記録していた。

### 根本原因

`evaluation/tools/run_agent_evaluation.py` の `_run_one`(`_evaluate_concurrently` 内、175-184行目):

```python
def _run_one(index: int, item: dict[str, Any]) -> None:
    label = label_fn(item)[:60]
    print(f"  [{label}] ... ", end="", flush=True)          # (A) 改行なし・ラベルのみ
    try:
        pred = evaluate_fn(item)
        results[index] = pred
        print(f"done ({len(pred['agent_findings'])} findings)")  # (B) ラベルを含まない
    except Exception as e:
        failed_flags[index] = True
        print(f"WARN: {e}")                                       # (C) ラベルを含まない
```

1. (A)が `end=""` で改行を出さないため、`--concurrency >= 2` で複数スレッドの (A) と (B)/(C) が
   ロックなしで同じ行に割り込み合う。どのスレッドの出力かは視覚的な並びでしか判別できず、
   スレッドスケジューリング次第でその並びは実際の対応関係と一致しない。
2. (B)/(C) の完了メッセージ自体にラベル(PR/Seeded ID)が含まれない。例外メッセージ
   (`evaluation/tools/a2a_client.py` の `a2a_poll` が投げる `TimeoutError`)も内部A2AタスクUUID
   のみを含み、どのGold/Seeded項目かを参照しない。

一方、`results[index]` / `failed_flags[index]` は `executor.submit(_run_one, i, item)` で
`index`/`item` がスレッドごとに引数として渡される(クロージャの遅延束縛ではない)ため、
印字競合とは独立に正しく書き込まれる。`failed_ids`・最終レポートの「失敗アイテム」欄・
`[WARN] N item(s) failed` ブロックは、すべて `_evaluate_concurrently` 呼び出し完了後に
逐次実行される箇所で構築されるため、実行順・印字競合の影響を受けず正確である。

**結論: 評価データ・スコアリングの正しさには影響しない、コンソールログ表示のみのバグ。**
ただし調査時に誤った項目を疑う原因になるため修正する。

---

## 2. 修正方針

`_run_one` の進捗表示を、開始マーカーと結果を**それぞれ改行込みの独立した1行**として出力し、
結果行には必ずラベルを含める。加えて、複数スレッドの `print` 呼び出し自体が同時に走り出力が
乱れるケースへの保険として、`threading.Lock` で print 呼び出しをガードする。

```python
def _run_one(index: int, item: dict[str, Any]) -> None:
    label = label_fn(item)[:60]
    with _print_lock:
        print(f"  [{label}] ... started", flush=True)
    try:
        pred = evaluate_fn(item)
        results[index] = pred
        with _print_lock:
            print(f"  [{label}] ... done ({len(pred['agent_findings'])} findings)")
    except Exception as e:
        failed_flags[index] = True
        with _print_lock:
            print(f"  [{label}] ... WARN: {e}")
```

`_print_lock` は `_evaluate_concurrently` 内で `threading.Lock()` として用意する。

### 対象外

- 構造化ロギング(JSON Lines化等)への変更は行わない。既存の `print` ベース進捗表示の
  最小修正に留める。
- スコアリング・レポート生成ロジック(`failed_ids` の構築箇所)は変更しない。元々正しいため。

---

## 3. テスト

`tests/evaluation/tools/test_run_agent_evaluation.py` に追加:

- `capsys` でコンソール出力をキャプチャし、`concurrency=2` 以上・複数アイテム(うち1件は例外を
  送出)を実行した際、各アイテムの完了/失敗メッセージが自分自身のラベルを含む独立した行として
  出力されることを検証する。

---

## 4. 検証手順

1. `uv run pytest tests/evaluation/tools/test_run_agent_evaluation.py`
2. `uv run ruff check`
3. `uv run ruff format --check`
