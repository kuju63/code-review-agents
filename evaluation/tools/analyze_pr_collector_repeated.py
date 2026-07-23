#!/usr/bin/env python3
"""Statistically analyse repeated PRInfoCollector runs against ground truth.

Reads the jsonl produced by ``verify_pr_collector_repeated.py``, compares each
run to the GitHub ground truth for mui/material-ui#48591, and prints a
Markdown report to stdout.

Usage:
  python evaluation/tools/analyze_pr_collector_repeated.py \
      --jsonl evaluation/data/pr_collector_repeated_google_gemma-4-e4b.jsonl
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from difflib import SequenceMatcher
from pathlib import Path

# ── Ground truth from GitHub API (mui/material-ui#48591) ────────────────────
GT_TITLE = "[progress] Show runtime errors only once"
GT_PR_NUMBER = 48591
GT_LABELS = {"scope: progress"}
GT_FILES = {
    "packages/mui-material/src/CircularProgress/CircularProgress.js",
    "packages/mui-material/src/CircularProgress/CircularProgress.test.js",
    "packages/mui-material/src/LinearProgress/LinearProgress.js",
    "packages/mui-material/src/LinearProgress/LinearProgress.test.js",
    "packages/mui-utils/src/index.ts",
}
GT_BODY_KEYWORD = "48562"  # "Fixes #48562"


def _title_sim(title: str) -> float:
    return SequenceMatcher(None, title.lower(), GT_TITLE.lower()).ratio()


def _prf(pred: set[str], gold: set[str]) -> tuple[float, float, float]:
    if not pred and not gold:
        return 1.0, 1.0, 1.0
    tp = len(pred & gold)
    prec = tp / len(pred) if pred else 0.0
    rec = tp / len(gold) if gold else 0.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
    return prec, rec, f1


def _mean_sd(xs: list[float]) -> tuple[float, float]:
    if not xs:
        return float("nan"), float("nan")
    m = statistics.mean(xs)
    sd = statistics.pstdev(xs) if len(xs) > 1 else 0.0
    return m, sd


def _ci95(xs: list[float]) -> tuple[float, float]:
    """Normal-approx 95% CI for the mean.

    Returns:
        A ``(low, high)`` tuple of the 95% confidence interval bounds, or
        ``(nan, nan)`` when fewer than two samples are given.
    """
    if len(xs) < 2:
        return float("nan"), float("nan")
    m = statistics.mean(xs)
    se = statistics.stdev(xs) / math.sqrt(len(xs))
    return m - 1.96 * se, m + 1.96 * se


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jsonl", required=True)
    args = ap.parse_args()

    rows = [
        json.loads(line)
        for line in Path(args.jsonl).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    total = len(rows)
    ok = [r for r in rows if r.get("status") == "completed"]
    n = len(ok)

    title_sims, file_f1s, file_precs, file_recs = [], [], [], []
    label_jaccards, file_count_err = [], []
    elapsed = []
    title_exact = label_exact = body_ok = pr_number_correct = 0
    hallucinated_files_total = 0  # predicted files not in gold
    all_pred_titles: dict[str, int] = {}

    for r in ok:
        title = r.get("title", "") or ""
        ts = _title_sim(title)
        title_sims.append(ts)
        if title.strip() == GT_TITLE:
            title_exact += 1
        all_pred_titles[title] = all_pred_titles.get(title, 0) + 1

        pred_files = set(r.get("file_paths", []) or [])
        p, rc, f1 = _prf(pred_files, GT_FILES)
        file_precs.append(p)
        file_recs.append(rc)
        file_f1s.append(f1)
        hallucinated_files_total += len(pred_files - GT_FILES)
        file_count_err.append(abs(len(pred_files) - len(GT_FILES)))

        pred_labels = set(r.get("labels", []) or [])
        inter = len(pred_labels & GT_LABELS)
        union = len(pred_labels | GT_LABELS)
        label_jaccards.append(inter / union if union else 1.0)
        if pred_labels == GT_LABELS:
            label_exact += 1

        if r.get("pr_number") == GT_PR_NUMBER:
            pr_number_correct += 1
        body = r.get("body") or ""
        if GT_BODY_KEYWORD in body:
            body_ok += 1

        elapsed.append(r.get("elapsed_s", 0.0))

    def fmt(xs):
        m, sd = _mean_sd(xs)
        lo, hi = _ci95(xs)
        if math.isnan(lo):
            return f"{m:.3f}", f"{sd:.3f}", "n/a"
        return f"{m:.3f}", f"{sd:.3f}", f"[{lo:.3f}, {hi:.3f}]"

    def rate(count: int) -> str:
        """Format ``count/n`` as a percentage, or ``n/a`` when no runs succeeded.

        Returns:
            A string like ``"3/5 (60%)"``, or ``"count/0 (n/a)"`` when ``n``
            is zero.
        """
        if n == 0:
            return f"{count}/0 (n/a)"
        return f"{count}/{n} ({100 * count / n:.0f}%)"

    # Derive the model label from the JSONL itself rather than hardcoding it, so
    # a report generated from a different model's runs is labelled correctly.
    models = sorted({r.get("model", "") for r in rows if r.get("model")})
    model_label = ", ".join(f"`{m}`" for m in models) if models else "`(unknown)`"

    L = []
    L.append("# PR Info Collector 正確性検証レポート（20回統計分析）")
    L.append("")
    L.append(f"**モデル**: {model_label}  ")
    L.append("**対象PR**: mui/material-ui#48591  ")
    L.append("**正解取得元**: GitHub API (gh CLI)  ")
    L.append(f"**試行回数**: {total}（成功 {n} / 失敗 {total - n}）  ")
    L.append(
        "**呼び出し方式**: `PRInfoCollector.collect()` 直接呼び出し（A2A サーバ非経由）"
    )
    L.append("")
    L.append("---")
    L.append("")
    L.append("## 1. 正解データ（Ground Truth）")
    L.append("")
    L.append(f"- **Title**: `{GT_TITLE}`")
    L.append(f"- **PR Number**: {GT_PR_NUMBER}")
    L.append("- **State**: MERGED")
    L.append(f"- **Labels**: `{sorted(GT_LABELS)}`")
    L.append("- **Body**: `Fixes #48562`")
    L.append(f"- **変更ファイル（{len(GT_FILES)}件, 全て対象拡張子）**:")
    for f in sorted(GT_FILES):
        L.append(f"  - `{f}`")
    L.append("")
    L.append("---")
    L.append("")
    L.append("## 2. 統計サマリ（成功試行 N=%d）" % n)
    L.append("")
    L.append("| 指標 | 平均 | 標準偏差 | 95%CI | 完全一致率 |")
    L.append("|------|------|----------|-------|-----------|")
    tm, tsd, tci = fmt(title_sims)
    L.append(f"| Title 類似度 (0-1) | {tm} | {tsd} | {tci} | {rate(title_exact)} |")
    fp, fpsd, fpci = fmt(file_precs)
    L.append(f"| ファイルパス Precision | {fp} | {fpsd} | {fpci} | — |")
    fr, frsd, frci = fmt(file_recs)
    L.append(f"| ファイルパス Recall | {fr} | {frsd} | {frci} | — |")
    ff, ffsd, ffci = fmt(file_f1s)
    L.append(f"| ファイルパス F1 | {ff} | {ffsd} | {ffci} | — |")
    lm, lsd, lci = fmt(label_jaccards)
    L.append(f"| Label Jaccard | {lm} | {lsd} | {lci} | {rate(label_exact)} |")
    fcm, fcsd, fcci = fmt([float(x) for x in file_count_err])
    L.append(f"| ファイル数誤差 (件) | {fcm} | {fcsd} | {fcci} | — |")
    em, esd, eci = fmt(elapsed)
    L.append(f"| 実行時間 (秒) | {em} | {esd} | {eci} | — |")
    L.append("")
    L.append("### 構造項目の正答率")
    L.append("")
    L.append(f"- **PR番号一致**: {rate(pr_number_correct)}")
    L.append(f"- **Body に正解参照(#48562)を含む**: {rate(body_ok)}")
    L.append(f"- **ラベル完全一致**: {rate(label_exact)}")
    avg_hall = hallucinated_files_total / n if n else 0
    L.append(
        f"- **幻覚ファイル総数**: {hallucinated_files_total}（1試行あたり平均 {avg_hall:.2f} 件、正解集合に存在しないパス）"
    )
    correct_files_recalled = sum(
        1 for r in ok if set(r.get("file_paths", []) or []) & GT_FILES
    )
    L.append(f"- **正解ファイルを1つでも含む試行**: {rate(correct_files_recalled)}")
    L.append("")
    L.append("---")
    L.append("")
    L.append("## 3. 出力タイトルの分布（再現性の指標）")
    L.append("")
    L.append("| 生成された Title | 回数 |")
    L.append("|------------------|------|")
    for t, c in sorted(all_pred_titles.items(), key=lambda x: -x[1]):
        L.append(f"| `{t}` | {c} |")
    L.append("")
    L.append(
        "> 正解 Title と異なるタイトルが毎回生成され、かつ試行ごとにばらつく場合、"
    )
    L.append(
        "> モデルは GitHub から取得した情報を使わず内容を**創作（hallucination）**している。"
    )
    L.append("")
    L.append("---")
    L.append("")
    L.append("## 4. 全試行の生データ")
    L.append("")
    L.append(
        "| # | status | 時間(s) | Title類似度 | File F1 | ファイル数 | Label一致 |"
    )
    L.append("|---|--------|---------|-------------|---------|-----------|-----------|")
    for r in rows:
        i = r.get("run")
        if r.get("status") != "completed":
            L.append(
                f"| {i} | {r.get('status')} | {r.get('elapsed_s', '-')} | - | - | - | - |"
            )
            continue
        ts = _title_sim(r.get("title", "") or "")
        pred_files = set(r.get("file_paths", []) or [])
        _, _, f1 = _prf(pred_files, GT_FILES)
        lbl = "✓" if set(r.get("labels", []) or []) == GT_LABELS else "✗"
        L.append(
            f"| {i} | completed | {r.get('elapsed_s')} | {ts:.2f} | {f1:.2f} | {len(pred_files)} | {lbl} |"
        )
    L.append("")

    print("\n".join(L))


if __name__ == "__main__":
    main()
