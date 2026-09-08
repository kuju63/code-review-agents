import type { z } from "@hono/zod-openapi";
import { countComments } from "./reviews.comment-counts.js";
import type {
  CommentDispositionSchema,
  FindingCategorySchema,
  FindingImpactSchema,
  FindingSeveritySchema,
} from "./reviews.enums.js";
import {
  ReviewAttemptSchema,
  ReviewFileChangeSchema,
  ReviewReportSchema,
  ReviewSchema,
} from "./reviews.schema.js";

/**
 * `docs/mocks/assets/mock-data.js` の `REVIEWS`（静的HTMLモックアップが実際に使う
 * 6件のPR）を、`reviews.route.ts` のダミーストア (`reviews.store.ts`) 用の初期データに
 * 変換したもの。mock-data.js には存在しない項目は以下のルールで導出する
 * (Issue #245)。
 *
 * | 項目 | mock-data.js | ルール |
 * |---|---|---|
 * | createdAt/updatedAt | `'2026-08-09 10:24'` (非RFC3339) | `'...T...Z'` に変換。createdAtはupdatedAtより前の値を新規に設定。 |
 * | status(domain) | `stage` | not_started→draft, analyzing→reviewing, reviewed→reviewed, error→failed |
 * | reviewStatus(表示) | `stage`+comments | 上と同じだが reviewed は open>0→waiting、open===0→completed |
 * | severity/impactCategory | category のみ | Security→high/security, Performance→medium/performance, Best Practice→medium/maintainability, Style→low/maintainability |
 * | latestAttemptId+Attempt | なし | 482/490/210は既存id (att-9f2c/att-1b3d/att-7e0d) を継続、471/55は新規id、58はnull (not_started) |
 * | comment.line | `afterLine`=file.linesへの0始まりindex | 該当行の newLine ?? oldLine に変換 (mock-data.js:287の注記通り) |
 * | commentCounts | なし | files[].comments[].disposition から countComments() で導出 (手書きしない) |
 *
 * `reviews.fixtures.ts` (reviews.yaml example の契約回帰テスト用) とは別物であり、
 * このファイルは変更しない。
 */

type FindingCategory = z.infer<typeof FindingCategorySchema>;
type FindingSeverity = z.infer<typeof FindingSeveritySchema>;
type FindingImpact = z.infer<typeof FindingImpactSchema>;
type CommentDisposition = z.infer<typeof CommentDispositionSchema>;
type DiffLineType = "ctx" | "add" | "del";
type Review = z.infer<typeof ReviewSchema>;
type ReviewAttempt = z.infer<typeof ReviewAttemptSchema>;
type ReviewReport = z.infer<typeof ReviewReportSchema>;
type ReviewFileChange = z.infer<typeof ReviewFileChangeSchema>;

const SEVERITY_BY_CATEGORY: Record<
  FindingCategory,
  { severity: FindingSeverity; impactCategory: FindingImpact }
> = {
  Security: { severity: "high", impactCategory: "security" },
  Performance: { severity: "medium", impactCategory: "performance" },
  "Best Practice": { severity: "medium", impactCategory: "maintainability" },
  Style: { severity: "low", impactCategory: "maintainability" },
};

function diffLine(
  type: DiffLineType,
  oldLine: number | null,
  newLine: number | null,
  text: string,
) {
  return { type, oldLine, newLine, text };
}

function commentFromMock(
  filePath: string,
  lines: ReturnType<typeof diffLine>[],
  afterLine: number,
  commentId: string,
  category: FindingCategory,
  body: string,
  disposition: CommentDisposition,
) {
  const line = lines[afterLine];
  if (!line) {
    throw new Error(`mock-seed: comment ${commentId} references missing line index ${afterLine}`);
  }
  const { severity, impactCategory } = SEVERITY_BY_CATEGORY[category];
  return {
    commentId,
    filePath,
    line: line.newLine ?? line.oldLine,
    category,
    severity,
    impactCategory,
    body,
    disposition,
  };
}

function fileChange(
  filePath: string,
  status: "M" | "A" | "D",
  additions: number,
  deletions: number,
  lines: ReturnType<typeof diffLine>[],
  comments: ReturnType<typeof commentFromMock>[],
): ReviewFileChange {
  return ReviewFileChangeSchema.parse({ filePath, status, additions, deletions, lines, comments });
}

// --- pr-482 (web-frontend) : mock-data.js REVIEWS[0] ---------------------

const pr482ButtonLines = [
  diffLine("ctx", 10, 10, "import React from 'react';"),
  diffLine("ctx", 11, 11, ""),
  diffLine("del", 12, null, "export function Button({ children, onClick, disabled }) {"),
  diffLine(
    "add",
    null,
    12,
    "export function Button({ children, onClick, disabled, loading = false }) {",
  ),
  diffLine("ctx", 13, 13, "  return ("),
  diffLine("del", 14, null, '    <button onClick={onClick} disabled={disabled} className="btn">'),
  diffLine(
    "add",
    null,
    14,
    '    <button onClick={onClick} disabled={disabled || loading} className="btn">',
  ),
  diffLine("add", null, 15, "      {loading ? <Spinner size={16} /> : children}"),
  diffLine("ctx", 15, 16, "    </button>"),
  diffLine("ctx", 16, 17, "  );"),
  diffLine("ctx", 17, 18, "}"),
];
const pr482Button = fileChange("src/components/Button.tsx", "M", 3, 2, pr482ButtonLines, [
  commentFromMock(
    "src/components/Button.tsx",
    pr482ButtonLines,
    3,
    "c1",
    "Style",
    "loading のような boolean フラグは isLoading のように is / has 接頭辞を付けると、命名規則に統一感が出ます。",
    "resolved",
  ),
  commentFromMock(
    "src/components/Button.tsx",
    pr482ButtonLines,
    7,
    "c2",
    "Best Practice",
    "ローディング中の disabled 制御はコンポーネント内で完結していて良いですが、外部からも状態が伝わるよう aria-busy 属性の付与を推奨します。",
    "open",
  ),
]);

const pr482UseAuthLines = [
  diffLine("ctx", 20, 20, "export function useAuth() {"),
  diffLine("ctx", 21, 21, "  const [user, setUser] = useState<User | null>(null);"),
  diffLine("del", 22, null, "  const token = localStorage.getItem('token');"),
  diffLine("add", null, 22, "  const token = sessionStorage.getItem('token');"),
  diffLine("ctx", 23, 23, ""),
  diffLine("del", 24, null, "  const login = async (email, password) => {"),
  diffLine("add", null, 24, "  const login = async (email: string, password: string) => {"),
  diffLine(
    "add",
    null,
    25,
    "    const res = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });",
  ),
  diffLine("ctx", 25, 26, "    return res.json();"),
  diffLine("ctx", 26, 27, "  };"),
  diffLine("ctx", 27, 28, "  return { user, login };"),
  diffLine("ctx", 28, 29, "}"),
];
const pr482UseAuth = fileChange("src/hooks/useAuth.ts", "M", 3, 2, pr482UseAuthLines, [
  commentFromMock(
    "src/hooks/useAuth.ts",
    pr482UseAuthLines,
    3,
    "c3",
    "Security",
    "トークンを sessionStorage に保存すると、XSS発生時に窃取されるリスクがあります。HttpOnly Cookie での管理を検討してください。",
    "open",
  ),
  commentFromMock(
    "src/hooks/useAuth.ts",
    pr482UseAuthLines,
    7,
    "c4",
    "Performance",
    "fetch のたびに新しい AbortController を生成していないため、コンポーネントのアンマウント時にリクエストをキャンセルできません。",
    "false_positive",
  ),
]);

const pr482Tokens = fileChange(
  "src/styles/tokens.css",
  "M",
  1,
  1,
  [
    diffLine("ctx", 1, 1, ":root {"),
    diffLine("del", 2, null, "  --color-primary: #2563eb;"),
    diffLine("add", null, 2, "  --color-primary: var(--blue-60);"),
    diffLine("ctx", 3, 3, "  --color-danger: var(--red-60);"),
    diffLine("ctx", 4, 4, "}"),
  ],
  [],
);

const pr482Files = [pr482Button, pr482UseAuth, pr482Tokens];

// --- pr-471 (web-frontend) : mock-data.js REVIEWS[2] ----------------------

const pr471CheckoutLines = [
  diffLine("ctx", 30, 30, "export async function submitOrder(order: Order) {"),
  diffLine("del", 31, null, "  const total = order.items.reduce((s, i) => s + i.price, 0);"),
  diffLine(
    "add",
    null,
    31,
    "  const total = order.items.reduce((s, i) => s + i.price * i.qty, 0);",
  ),
  diffLine("ctx", 32, 32, ""),
  diffLine(
    "del",
    33,
    null,
    "  return fetch('/api/orders', { method: 'POST', body: JSON.stringify(order) });",
  ),
  diffLine(
    "add",
    null,
    33,
    "  const res = await fetch('/api/orders', { method: 'POST', body: JSON.stringify({ ...order, total }) });",
  ),
  diffLine("add", null, 34, "  if (!res.ok) throw new Error('order failed');"),
  diffLine("add", null, 35, "  return res.json();"),
  diffLine("ctx", 34, 36, "}"),
];
const pr471Checkout = fileChange("src/lib/checkout.ts", "M", 4, 2, pr471CheckoutLines, [
  commentFromMock(
    "src/lib/checkout.ts",
    pr471CheckoutLines,
    5,
    "c6",
    "Security",
    "total をクライアント側の計算結果のままサーバーに送信しています。サーバー側でも金額を再計算し、改ざんを防いでください。",
    "open",
  ),
  commentFromMock(
    "src/lib/checkout.ts",
    pr471CheckoutLines,
    2,
    "c7",
    "Performance",
    "reduce の中で毎回 price * qty を計算しています。item 数が多い場合はメモ化を検討してください。",
    "open",
  ),
]);

const pr471Files = [pr471Checkout];

// --- pr-55 (design-system) : mock-data.js REVIEWS[4] ----------------------

const pr55ChipLines = [
  diffLine("add", null, 1, "export function Chip({ label, onRemove }) {"),
  diffLine("add", null, 2, "  return ("),
  diffLine("add", null, 3, '    <span className="chip">'),
  diffLine("add", null, 4, "      {label}"),
  diffLine("add", null, 5, "      <button onClick={onRemove}>×</button>"),
  diffLine("add", null, 6, "    </span>"),
  diffLine("add", null, 7, "  );"),
  diffLine("add", null, 8, "}"),
];
const pr55Chip = fileChange("src/components/Chip.tsx", "A", 8, 0, pr55ChipLines, [
  commentFromMock(
    "src/components/Chip.tsx",
    pr55ChipLines,
    4,
    "c8",
    "Best Practice",
    "閉じるボタンに aria-label がないため、スクリーンリーダーで操作対象が伝わりません。",
    "resolved",
  ),
  commentFromMock(
    "src/components/Chip.tsx",
    pr55ChipLines,
    0,
    "c9",
    "Style",
    "className を直接指定していますが、他コンポーネントと合わせて CSS Modules を使う方針に統一しましょう。",
    "resolved",
  ),
]);

const pr55Files = [pr55Chip];

// --- Review / ReviewAttempt / ReviewReport ---------------------------------

function reviewStatusForReviewed(open: number): "waiting" | "completed" {
  return open > 0 ? "waiting" : "completed";
}

const pr482Counts = countComments(pr482Files);
const pr471Counts = countComments(pr471Files);
const pr55Counts = countComments(pr55Files);
const zeroCounts = { total: 0, open: 0, resolved: 0, falsePositive: 0 };

export const MOCK_SEED_REVIEWS: Review[] = [
  ReviewSchema.parse({
    apiVersion: "1.0.0",
    reviewId: "pr-482",
    organization: "acme-corp",
    repository: "web-frontend",
    pullRequest: 482,
    title: "ユーザー認証フローの改善",
    branch: "feature/auth-flow",
    baseBranch: "main",
    author: "sato.k",
    commitSha: "a3f9c2e8d4b1f67a2c9e5d0b8f3a71c6e9d4b2a1",
    prState: "open",
    status: "reviewed",
    reviewStatus: reviewStatusForReviewed(pr482Counts.open),
    latestAttemptId: "att-9f2c",
    commentCounts: pr482Counts,
    errorMessage: null,
    createdAt: "2026-08-09T10:00:00Z",
    updatedAt: "2026-08-09T10:24:00Z",
  }),
  ReviewSchema.parse({
    apiVersion: "1.0.0",
    reviewId: "pr-490",
    organization: "acme-corp",
    repository: "web-frontend",
    pullRequest: 490,
    title: "国際化対応の追加",
    branch: "feature/i18n",
    baseBranch: "main",
    author: "suzuki.t",
    commitSha: "5c1e8a9f2b6d4c7e0a3f9b5d1c8e6a2f4b7d9c0e",
    prState: "open",
    status: "reviewing",
    reviewStatus: "analyzing",
    latestAttemptId: "att-1b3d",
    commentCounts: zeroCounts,
    errorMessage: null,
    createdAt: "2026-08-09T12:00:00Z",
    updatedAt: "2026-08-09T13:05:00Z",
  }),
  ReviewSchema.parse({
    apiVersion: "1.0.0",
    reviewId: "pr-471",
    organization: "acme-corp",
    repository: "web-frontend",
    pullRequest: 471,
    title: "決済導線のリファクタリング",
    branch: "refactor/checkout-flow",
    baseBranch: "main",
    author: "sato.k",
    commitSha: "e7b4a1c9f6d2e8b5a0c3f9d6e1b8a4c7f2d5e9b0",
    prState: "open",
    status: "reviewed",
    reviewStatus: reviewStatusForReviewed(pr471Counts.open),
    latestAttemptId: "att-4a6f",
    commentCounts: pr471Counts,
    errorMessage: null,
    createdAt: "2026-08-07T09:00:00Z",
    updatedAt: "2026-08-07T09:40:00Z",
  }),
  ReviewSchema.parse({
    apiVersion: "1.0.0",
    reviewId: "pr-58",
    organization: "acme-corp",
    repository: "design-system",
    pullRequest: 58,
    title: "Buttonコンポーネントのトークン更新",
    branch: "chore/button-tokens",
    baseBranch: "main",
    author: "yamada.r",
    commitSha: "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567",
    prState: "open",
    status: "draft",
    reviewStatus: "not_started",
    latestAttemptId: null,
    commentCounts: zeroCounts,
    errorMessage: null,
    createdAt: "2026-08-09T08:10:00Z",
    updatedAt: "2026-08-09T08:15:00Z",
  }),
  ReviewSchema.parse({
    apiVersion: "1.0.0",
    reviewId: "pr-55",
    organization: "acme-corp",
    repository: "design-system",
    pullRequest: 55,
    title: "Chipコンポーネント追加",
    branch: "feature/chip",
    baseBranch: "main",
    author: "yamada.r",
    commitSha: "b2d5f8a1c4e7b0d3f6a9c2e5b8d1f4a7c0e3b6d9",
    prState: "merged",
    status: "reviewed",
    reviewStatus: reviewStatusForReviewed(pr55Counts.open),
    latestAttemptId: "att-c8a1",
    commentCounts: pr55Counts,
    errorMessage: null,
    createdAt: "2026-08-05T13:30:00Z",
    updatedAt: "2026-08-05T14:00:00Z",
  }),
  ReviewSchema.parse({
    apiVersion: "1.0.0",
    reviewId: "pr-210",
    organization: "acme-corp",
    repository: "payments-api",
    pullRequest: 210,
    title: "Webhookリトライ処理の実装",
    branch: "feature/webhook-retry",
    baseBranch: "main",
    author: "suzuki.t",
    commitSha: "f1e4d7c0b3a6f9e2d5c8b1a4f7e0d3c6b9a2f5e8",
    prState: "open",
    status: "failed",
    reviewStatus: "error",
    latestAttemptId: "att-7e0d",
    commentCounts: zeroCounts,
    errorMessage:
      "解析中にタイムアウトが発生し、レビューを完了できませんでした。対象ファイル数が上限を超えている可能性があります。",
    createdAt: "2026-08-09T11:00:00Z",
    updatedAt: "2026-08-09T11:50:00Z",
  }),
];

export const MOCK_SEED_ATTEMPTS: ReviewAttempt[] = [
  ReviewAttemptSchema.parse({
    apiVersion: "1.0.0",
    attemptId: "att-9f2c",
    reviewId: "pr-482",
    status: "succeeded",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-09T10:20:00Z",
    startedAt: "2026-08-09T10:21:00Z",
    finishedAt: "2026-08-09T10:24:00Z",
  }),
  ReviewAttemptSchema.parse({
    apiVersion: "1.0.0",
    attemptId: "att-1b3d",
    reviewId: "pr-490",
    status: "running",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-09T13:00:00Z",
    startedAt: "2026-08-09T13:01:00Z",
    finishedAt: null,
  }),
  ReviewAttemptSchema.parse({
    apiVersion: "1.0.0",
    attemptId: "att-4a6f",
    reviewId: "pr-471",
    status: "succeeded",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-07T09:10:00Z",
    startedAt: "2026-08-07T09:11:00Z",
    finishedAt: "2026-08-07T09:40:00Z",
  }),
  ReviewAttemptSchema.parse({
    apiVersion: "1.0.0",
    attemptId: "att-c8a1",
    reviewId: "pr-55",
    status: "succeeded",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-05T13:40:00Z",
    startedAt: "2026-08-05T13:41:00Z",
    finishedAt: "2026-08-05T14:00:00Z",
  }),
  ReviewAttemptSchema.parse({
    apiVersion: "1.0.0",
    attemptId: "att-7e0d",
    reviewId: "pr-210",
    status: "failed",
    errorCode: "timeout",
    errorMessage:
      "解析中にタイムアウトが発生し、レビューを完了できませんでした。対象ファイル数が上限を超えている可能性があります。",
    createdAt: "2026-08-09T11:05:00Z",
    startedAt: "2026-08-09T11:06:00Z",
    finishedAt: "2026-08-09T11:50:00Z",
  }),
  // pr-58 は stage: not_started のため ReviewAttempt を持たない (latestAttemptId: null)。
];

export const MOCK_SEED_REPORTS: Record<string, ReviewReport> = {
  "pr-482": ReviewReportSchema.parse({
    apiVersion: "1.0.0",
    reviewId: "pr-482",
    attemptId: "att-9f2c",
    overallSummary: "認証フローの改善。セキュリティ観点で2件の対応推奨。",
    files: pr482Files,
    commentCounts: pr482Counts,
  }),
  "pr-490": ReviewReportSchema.parse({
    apiVersion: "1.0.0",
    reviewId: "pr-490",
    attemptId: "att-1b3d",
    overallSummary: "国際化対応の解析を実行中です。",
    files: [],
    commentCounts: zeroCounts,
  }),
  "pr-471": ReviewReportSchema.parse({
    apiVersion: "1.0.0",
    reviewId: "pr-471",
    attemptId: "att-4a6f",
    overallSummary: "決済導線のリファクタリング。金額計算のサーバー側検証を推奨。",
    files: pr471Files,
    commentCounts: pr471Counts,
  }),
  "pr-55": ReviewReportSchema.parse({
    apiVersion: "1.0.0",
    reviewId: "pr-55",
    attemptId: "att-c8a1",
    overallSummary: "Chipコンポーネント追加。アクセシビリティ観点の指摘は対応済み。",
    files: pr55Files,
    commentCounts: pr55Counts,
  }),
  "pr-210": ReviewReportSchema.parse({
    apiVersion: "1.0.0",
    reviewId: "pr-210",
    attemptId: "att-7e0d",
    overallSummary: "Webhookリトライ処理の解析に失敗しました。",
    files: [],
    commentCounts: zeroCounts,
  }),
  // pr-58 は attempt が存在しないため ReviewReport を持たない
  // (getReport は最新attemptの成否を先に判定するため、この不在に到達する前に
  // conflict を返す — reviews.store.ts 参照)。
};

export interface ReviewsSeed {
  reviews: Review[];
  attempts: ReviewAttempt[];
  reports: Record<string, ReviewReport>;
}

export const MOCK_SEED: ReviewsSeed = {
  reviews: MOCK_SEED_REVIEWS,
  attempts: MOCK_SEED_ATTEMPTS,
  reports: MOCK_SEED_REPORTS,
};
