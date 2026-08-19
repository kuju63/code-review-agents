// Shared mock data + pure helpers for the PR Review Agent mockup pages.
// Ported from the Claude Design mockup project's review-data.js. Loaded as a
// plain (non-module) script — opening these pages via file:// blocks ES
// module imports under CORS, so everything is published on window.MockData.
(() => {

const STRINGS = {
  filterAll: { ja: 'すべて', en: 'All' },
  navList: { ja: 'コードレビュー一覧', en: 'Code reviews' },
  navNew: { ja: 'レビュー依頼登録', en: 'Request a review' },
  navSettings: { ja: '設定', en: 'Settings' },
  listTitle: { ja: 'コードレビュー一覧', en: 'Code reviews' },
  listSubtitle: { ja: '登録済みのプルリクエストのレビュー状況を確認できます。', en: 'Track review status for pull requests submitted to the agent.' },
  newReviewBtn: { ja: '+ レビュー依頼を登録', en: '+ Request a review' },
  submittedTitle: { ja: '登録しました。', en: 'Request submitted.' },
  filterRepoLabel: { ja: 'リポジトリ', en: 'Repository' },
  filterStatusLabel: { ja: 'レビュー状態', en: 'Review status' },
  filterSearchLabel: { ja: '検索', en: 'Search' },
  searchPlaceholder: { ja: 'PR番号やタイトルで検索', en: 'Search by PR number or title' },
  colPR: { ja: 'PR', en: 'PR' },
  colBranch: { ja: 'ブランチ', en: 'Branch' },
  colReviewStatus: { ja: 'レビュー状態', en: 'Review status' },
  colPRStatus: { ja: 'PRステータス', en: 'PR status' },
  colComments: { ja: 'コメント', en: 'Comments' },
  colUpdated: { ja: '更新日時', en: 'Updated' },
  statusNotStarted: { ja: '未実施', en: 'Not started' },
  statusInReview: { ja: 'レビュー中', en: 'In review' },
  statusWaiting: { ja: '対応待ち', en: 'Needs attention' },
  statusError: { ja: 'エラー', en: 'Error' },
  noResultsText: { ja: '条件に一致するPRがありません。', en: 'No pull requests match these filters.' },
  newTitle: { ja: 'レビュー依頼登録', en: 'Request a review' },
  newSubtitle: { ja: 'Organization、リポジトリ、PRを選択してレビューエージェントに依頼します。エージェントが受け付けるのは Organization(またはユーザー)・リポジトリ名・PR番号の3つのみです。Close済みのPRは選択できません。', en: 'Pick an organization, repository, and PR to send to the review agent. The agent only accepts an organization (or user), a repository name, and a PR number. Closed PRs cannot be selected.' },
  progressStep1: { ja: 'Organization / リポジトリを選択', en: 'Choose org / repository' },
  progressStep2: { ja: 'PRを選択', en: 'Choose a PR' },
  progressStep3: { ja: '内容を確認して送信', en: 'Review and submit' },
  orgLabel: { ja: 'Organization / ユーザー', en: 'Organization / user' },
  repoLabel: { ja: 'リポジトリ', en: 'Repository' },
  orgPlaceholder: { ja: '選択してください', en: 'Select…' },
  repoPlaceholderNoOrg: { ja: '— 先にOrganizationを選択 —', en: '— Select an organization first —' },
  prListLabel: { ja: 'プルリクエストを選択', en: 'Select a pull request' },
  payloadHeading: { ja: 'レビューエージェントへの送信内容', en: 'Sent to the review agent' },
  submitBtn: { ja: 'レビュー依頼を送信', en: 'Submit request' },
  cancelBtn: { ja: 'キャンセル', en: 'Cancel' },
  commitLabel: { ja: 'コミット', en: 'Commit' },
  filesHeading: { ja: '変更ファイル', en: 'Changed files' },
  notStartedTitle: { ja: 'レビュー未開始です。', en: 'Review has not started.' },
  notStartedSubtitle: { ja: 'エージェントはまだこのPRの解析を開始していません。しばらくしてから再度確認してください。', en: 'The agent has not started analyzing this PR yet. Check back later.' },
  analyzingTitle: { ja: 'レビュー中です', en: 'Review in progress' },
  analyzingSubtitle: { ja: 'エージェントが変更内容を解析しています。完了までしばらくお待ちください。', en: 'The agent is analyzing the changes. This may take a few minutes.' },
  errorTitle: { ja: 'レビューに失敗しました。', en: 'Review failed.' },
  errorRetriedTitle: { ja: '再試行しました。', en: 'Retry requested.' },
  errorRetriedSubtitle: { ja: 'エージェントが解析を再実行しています。完了までしばらくお待ちください。', en: 'The agent is re-running analysis. This may take a few minutes.' },
  retryBtn: { ja: '再試行', en: 'Retry' },
  aiNoteText: { ja: 'レビューエージェントによる自動生成コメントです。内容が正しくない場合は「誤検知としてマーク」してください。', en: 'This comment was generated automatically by the review agent. If it is incorrect, mark it as a false positive.' },
  resolveBtn: { ja: '対応済みにする', en: 'Mark as resolved' },
  falsePositiveBtn: { ja: '誤検知としてマーク', en: 'Mark as false positive' },
  reopenBtn: { ja: '未対応に戻す', en: 'Reopen' },
  settingsTitle: { ja: 'GitHub連携設定', en: 'GitHub connection' },
  settingsBody: { ja: 'レビューエージェントが参照するGitHubのアクセス先とPersonal Access Tokenを設定してください。', en: 'Configure the GitHub endpoint and Personal Access Token the review agent should use.' },
  githubUrlLabel: { ja: 'GitHub URL', en: 'GitHub URL' },
  githubUrlHelper: { ja: 'GitHub Enterprise Serverを利用する場合は、そのインスタンスのURLに変更してください。', en: 'Change this if you use a GitHub Enterprise Server instance.' },
  githubTokenLabel: { ja: 'Personal Access Token', en: 'Personal access token' },
  githubTokenHelper: { ja: '対象リポジトリの読み取り権限を持つトークンを入力してください。トークンはローカル環境にのみ保存されます。', en: 'Use a token with read access to the target repositories. It is stored locally only.' },
  saveBtn: { ja: '保存', en: 'Save' },
  settingsSavedTitle: { ja: '設定を保存しました。', en: 'Settings saved.' },
  collapseSidebar: { ja: '折りたたむ', en: 'Collapse' },
  toggleSidebarLabel: { ja: 'サイドバーの表示切替', en: 'Toggle sidebar' },
  closeReviewBtn: { ja: 'クローズ', en: 'Close' },
  toggleFilesLabel: { ja: '変更ファイル一覧の表示切替', en: 'Toggle changed files panel' },
  viewedLabel: { ja: '確認済み', en: 'Viewed' },
  tokenMissingTitle: { ja: 'GitHub Personal Access Tokenが未設定です。', en: 'GitHub personal access token is not set.' },
  tokenMissingSubtitle: { ja: 'レビューエージェントがGitHubにアクセスするためのPersonal Access Tokenを設定画面で登録してください。', en: 'Register a personal access token in Settings so the review agent can access GitHub.' },
  goToSettingsBtn: { ja: '設定画面を開く', en: 'Open settings' },
};

const STATUS_TAG = {
  not_started: { key: 'not_started', type: 'gray', labelKey: 'statusNotStarted' },
  analyzing: { key: 'analyzing', type: 'blue', labelKey: 'statusInReview' },
  waiting: { key: 'waiting', type: 'purple', labelKey: 'statusWaiting' },
  error: { key: 'error', type: 'red', labelKey: 'statusError' },
};
const PR_STATE_TAG = { open: { type: 'green', label: 'Open' }, closed: { type: 'gray', label: 'Closed' }, merged: { type: 'purple', label: 'Merged' } };
const CATEGORY_TAG = {
  Security: { type: 'red', label: 'Security' },
  Performance: { type: 'teal', label: 'Performance' },
  'Best Practice': { type: 'blue', label: 'Best Practice' },
  Style: { type: 'cool-gray', label: 'Style' },
};
const COMMENT_STATE_TAG = {
  resolved: { type: 'green', ja: '対応済み', en: 'Resolved' },
  false_positive: { type: 'gray', ja: '誤検知', en: 'False positive' },
};
const FILE_BADGE = {
  M: { bg: 'var(--blue-20)', color: 'var(--blue-90)' },
  A: { bg: 'var(--green-20)', color: 'var(--green-60)' },
  D: { bg: 'var(--red-20)', color: 'var(--red-60)' },
};

const REVIEWS = [
  {
    id: 'pr-482', org: 'acme-corp', repo: 'web-frontend', number: 482, title: 'ユーザー認証フローの改善',
    branch: 'feature/auth-flow', baseBranch: 'main', author: 'sato.k', prState: 'open', stage: 'reviewed',
    updatedAt: '2026-08-09 10:24', commitSha: 'a3f9c2e8d4b1f67a2c9e5d0b8f3a71c6e9d4b2a1',
    files: [
      { id: 'f1', name: 'src/components/Button.tsx', status: 'M', additions: 3, deletions: 2,
        lines: [
          ['ctx', 10, 10, "import React from 'react';"],
          ['ctx', 11, 11, ''],
          ['del', 12, '', "export function Button({ children, onClick, disabled }) {"],
          ['add', '', 12, "export function Button({ children, onClick, disabled, loading = false }) {"],
          ['ctx', 13, 13, '  return ('],
          ['del', 14, '', '    <button onClick={onClick} disabled={disabled} className="btn">'],
          ['add', '', 14, '    <button onClick={onClick} disabled={disabled || loading} className="btn">'],
          ['add', '', 15, '      {loading ? <Spinner size={16} /> : children}'],
          ['ctx', 15, 16, '    </button>'],
          ['ctx', 16, 17, '  );'],
          ['ctx', 17, 18, '}'],
        ],
        comments: [
          { id: 'c1', afterLine: 3, category: 'Style', body: 'loading のような boolean フラグは isLoading のように is / has 接頭辞を付けると、命名規則に統一感が出ます。', defaultStatus: 'resolved' },
          { id: 'c2', afterLine: 7, category: 'Best Practice', body: 'ローディング中の disabled 制御はコンポーネント内で完結していて良いですが、外部からも状態が伝わるよう aria-busy 属性の付与を推奨します。', defaultStatus: 'open' },
        ] },
      { id: 'f2', name: 'src/hooks/useAuth.ts', status: 'M', additions: 3, deletions: 2,
        lines: [
          ['ctx', 20, 20, 'export function useAuth() {'],
          ['ctx', 21, 21, '  const [user, setUser] = useState<User | null>(null);'],
          ['del', 22, '', "  const token = localStorage.getItem('token');"],
          ['add', '', 22, "  const token = sessionStorage.getItem('token');"],
          ['ctx', 23, 23, ''],
          ['del', 24, '', '  const login = async (email, password) => {'],
          ['add', '', 24, '  const login = async (email: string, password: string) => {'],
          ['add', '', 25, "    const res = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });"],
          ['ctx', 25, 26, '    return res.json();'],
          ['ctx', 26, 27, '  };'],
          ['ctx', 27, 28, '  return { user, login };'],
          ['ctx', 28, 29, '}'],
        ],
        comments: [
          { id: 'c3', afterLine: 3, category: 'Security', body: 'トークンを sessionStorage に保存すると、XSS発生時に窃取されるリスクがあります。HttpOnly Cookie での管理を検討してください。', defaultStatus: 'open' },
          { id: 'c4', afterLine: 7, category: 'Performance', body: 'fetch のたびに新しい AbortController を生成していないため、コンポーネントのアンマウント時にリクエストをキャンセルできません。', defaultStatus: 'false_positive' },
        ] },
      { id: 'f3', name: 'src/styles/tokens.css', status: 'M', additions: 1, deletions: 1,
        lines: [
          ['ctx', 1, 1, ':root {'],
          ['del', 2, '', '  --color-primary: #2563eb;'],
          ['add', '', 2, '  --color-primary: var(--blue-60);'],
          ['ctx', 3, 3, '  --color-danger: var(--red-60);'],
          ['ctx', 4, 4, '}'],
        ], comments: [] },
    ],
  },
  { id: 'pr-490', org: 'acme-corp', repo: 'web-frontend', number: 490, title: '国際化対応の追加',
    branch: 'feature/i18n', baseBranch: 'main', author: 'suzuki.t', prState: 'open', stage: 'analyzing',
    updatedAt: '2026-08-09 13:05', commitSha: '5c1e8a9f2b6d4c7e0a3f9b5d1c8e6a2f4b7d9c0e', files: [] },
  { id: 'pr-471', org: 'acme-corp', repo: 'web-frontend', number: 471, title: '決済導線のリファクタリング',
    branch: 'refactor/checkout-flow', baseBranch: 'main', author: 'sato.k', prState: 'open', stage: 'reviewed',
    updatedAt: '2026-08-07 09:40', commitSha: 'e7b4a1c9f6d2e8b5a0c3f9d6e1b8a4c7f2d5e9b0',
    files: [
      { id: 'f1', name: 'src/lib/checkout.ts', status: 'M', additions: 5, deletions: 3,
        lines: [
          ['ctx', 30, 30, 'export async function submitOrder(order: Order) {'],
          ['del', 31, '', '  const total = order.items.reduce((s, i) => s + i.price, 0);'],
          ['add', '', 31, '  const total = order.items.reduce((s, i) => s + i.price * i.qty, 0);'],
          ['ctx', 32, 32, ''],
          ['del', 33, '', "  return fetch('/api/orders', { method: 'POST', body: JSON.stringify(order) });"],
          ['add', '', 33, "  const res = await fetch('/api/orders', { method: 'POST', body: JSON.stringify({ ...order, total }) });"],
          ['add', '', 34, "  if (!res.ok) throw new Error('order failed');"],
          ['add', '', 35, '  return res.json();'],
          ['ctx', 34, 36, '}'],
        ],
        comments: [
          { id: 'c6', afterLine: 5, category: 'Security', body: 'total をクライアント側の計算結果のままサーバーに送信しています。サーバー側でも金額を再計算し、改ざんを防いでください。', defaultStatus: 'open' },
          { id: 'c7', afterLine: 2, category: 'Performance', body: 'reduce の中で毎回 price * qty を計算しています。item 数が多い場合はメモ化を検討してください。', defaultStatus: 'open' },
        ] },
    ] },
  { id: 'pr-58', org: 'acme-corp', repo: 'design-system', number: 58, title: 'Buttonコンポーネントのトークン更新',
    branch: 'chore/button-tokens', baseBranch: 'main', author: 'yamada.r', prState: 'open', stage: 'not_started',
    updatedAt: '2026-08-09 08:15', commitSha: '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567', files: [] },
  { id: 'pr-55', org: 'acme-corp', repo: 'design-system', number: 55, title: 'Chipコンポーネント追加',
    branch: 'feature/chip', baseBranch: 'main', author: 'yamada.r', prState: 'merged', stage: 'reviewed',
    updatedAt: '2026-08-05 14:00', commitSha: 'b2d5f8a1c4e7b0d3f6a9c2e5b8d1f4a7c0e3b6d9',
    files: [
      { id: 'f1', name: 'src/components/Chip.tsx', status: 'A', additions: 8, deletions: 0,
        lines: [
          ['add', '', 1, 'export function Chip({ label, onRemove }) {'],
          ['add', '', 2, '  return ('],
          ['add', '', 3, '    <span className="chip">'],
          ['add', '', 4, '      {label}'],
          ['add', '', 5, '      <button onClick={onRemove}>×</button>'],
          ['add', '', 6, '    </span>'],
          ['add', '', 7, '  );'],
          ['add', '', 8, '}'],
        ],
        comments: [
          { id: 'c8', afterLine: 4, category: 'Best Practice', body: '閉じるボタンに aria-label がないため、スクリーンリーダーで操作対象が伝わりません。', defaultStatus: 'resolved' },
          { id: 'c9', afterLine: 0, category: 'Style', body: 'className を直接指定していますが、他コンポーネントと合わせて CSS Modules を使う方針に統一しましょう。', defaultStatus: 'resolved' },
        ] },
    ] },
  { id: 'pr-210', org: 'acme-corp', repo: 'payments-api', number: 210, title: 'Webhookリトライ処理の実装',
    branch: 'feature/webhook-retry', baseBranch: 'main', author: 'suzuki.t', prState: 'open', stage: 'error',
    updatedAt: '2026-08-09 11:50', commitSha: 'f1e4d7c0b3a6f9e2d5c8b1a4f7e0d3c6b9a2f5e8', files: [],
    errorMessage: '解析中にタイムアウトが発生し、レビューを完了できませんでした。対象ファイル数が上限を超えている可能性があります。' },
];

const ORG_CATALOG = {
  'acme-corp': { repos: {
    'web-frontend': [
      { number: 482, title: 'ユーザー認証フローの改善', branch: 'feature/auth-flow', author: 'sato.k', state: 'open' },
      { number: 490, title: '国際化対応の追加', branch: 'feature/i18n', author: 'suzuki.t', state: 'open' },
      { number: 471, title: '決済導線のリファクタリング', branch: 'refactor/checkout-flow', author: 'sato.k', state: 'open' },
      { number: 486, title: '画像最適化ロジック追加', branch: 'feature/image-optimize', author: 'tanaka.m', state: 'open' },
      { number: 465, title: '旧ロゴ画像の削除', branch: 'chore/remove-old-logo', author: 'yamada.r', state: 'closed' },
    ],
    'payments-api': [
      { number: 210, title: 'Webhookリトライ処理の実装', branch: 'feature/webhook-retry', author: 'suzuki.t', state: 'open' },
      { number: 208, title: 'リトライ回数の設定化', branch: 'feature/retry-config', author: 'suzuki.t', state: 'open' },
      { number: 205, title: 'テスト用エンドポイントの削除', branch: 'chore/remove-test-endpoint', author: 'sato.k', state: 'closed' },
    ],
    'design-system': [
      { number: 58, title: 'Buttonコンポーネントのトークン更新', branch: 'chore/button-tokens', author: 'yamada.r', state: 'open' },
      { number: 60, title: 'Tooltip矢印位置の修正', branch: 'fix/tooltip-arrow', author: 'yamada.r', state: 'open' },
      { number: 55, title: 'Chipコンポーネント追加', branch: 'feature/chip', author: 'yamada.r', state: 'closed' },
      { number: 52, title: '旧アイコンセットの削除', branch: 'chore/remove-old-icons', author: 'tanaka.m', state: 'closed' },
    ],
    'mobile-app': [
      { number: 12, title: 'プッシュ通知の権限リクエストフロー', branch: 'feature/push-permission', author: 'tanaka.m', state: 'open' },
    ],
  }},
  'yamada-taro': { repos: {
    'portfolio-site': [
      { number: 3, title: 'レスポンシブ対応', branch: 'feature/responsive', author: 'yamada.r', state: 'open' },
      { number: 1, title: '初期セットアップ', branch: 'chore/init', author: 'yamada.r', state: 'closed' },
    ],
  }},
};

function L(key, lang) {
  return (STRINGS[key] && STRINGS[key][lang]) || (STRINGS[key] && STRINGS[key].ja) || '';
}

function loadLS(key, fallback) {
  try {
    const raw = localStorage.getItem('cra_' + key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch (e) { return fallback; }
}
function saveLS(key, val) {
  try { localStorage.setItem('cra_' + key, JSON.stringify(val)); } catch (e) {}
}

function getCommentStatus(c, commentStatus) { return commentStatus[c.id] || c.defaultStatus; }

function computeReviewStatus(review, commentStatus) {
  if (review.stage === 'not_started') return STATUS_TAG.not_started;
  if (review.stage === 'analyzing') return STATUS_TAG.analyzing;
  if (review.stage === 'error') return STATUS_TAG.error;
  const hasUnresolved = review.files.some((f) => (f.comments || []).some((c) => getCommentStatus(c, commentStatus) === 'open'));
  return hasUnresolved ? STATUS_TAG.waiting : null;
}

function countComments(review, commentStatus) {
  let total = 0, open = 0, resolved = 0, fp = 0;
  review.files.forEach((f) => (f.comments || []).forEach((c) => {
    total++;
    const st = getCommentStatus(c, commentStatus);
    if (st === 'open') open++; else if (st === 'resolved') resolved++; else fp++;
  }));
  return { total, open, resolved, fp };
}

function formatCommentSummary(counts, lang) {
  if (counts.total === 0) return lang === 'ja' ? '0件' : '0';
  return lang === 'ja'
    ? `${counts.total}件（対応待ち${counts.open}・対応済み${counts.resolved}・誤検知${counts.fp}）`
    : `${counts.total} (${counts.open} pending, ${counts.resolved} resolved, ${counts.fp} false positive)`;
}

function buildFileRows(file, commentStatus, lang) {
  const rows = [];
  file.lines.forEach((line, idx) => {
    const [type, oldNum, newNum, text] = line;
    const bg = type === 'add' ? 'rgba(36,161,72,0.12)' : type === 'del' ? 'rgba(218,30,40,0.10)' : 'transparent';
    const marker = type === 'add' ? '+' : type === 'del' ? '-' : ' ';
    const markerColor = type === 'add' ? 'var(--support-success)' : type === 'del' ? 'var(--support-error)' : 'var(--text-secondary)';
    rows.push({ isCode: true, isThread: false, bg, markerColor, oldNum: oldNum === '' ? '' : String(oldNum), newNum: newNum === '' ? '' : String(newNum), marker, text });
    // afterLine is compared against idx, the zero-based index into file.lines
    // (not a diff/file line number). A comment whose afterLine has no matching
    // idx is silently skipped — no error, it just never renders.
    (file.comments || []).filter((c) => c.afterLine === idx).forEach((c) => {
      const status = getCommentStatus(c, commentStatus);
      const catTag = CATEGORY_TAG[c.category] || CATEGORY_TAG.Style;
      const stateInfo = COMMENT_STATE_TAG[status];
      const accent = status === 'open' ? 'var(--blue-60)' : status === 'resolved' ? 'var(--support-success)' : 'var(--gray-50)';
      rows.push({
        isCode: false, isThread: true, accent, commentId: c.id,
        categoryTagType: catTag.type, categoryLabel: catTag.label,
        showStateTag: status !== 'open', stateTagType: stateInfo ? stateInfo.type : 'gray', stateLabel: stateInfo ? stateInfo[lang] : '',
        bodyColor: status === 'false_positive' ? 'var(--text-secondary)' : 'var(--text-primary)',
        bodyDecoration: status === 'false_positive' ? 'line-through' : 'none',
        body: c.body,
        canResolve: status === 'open', canFalsePositive: status === 'open', canReopen: status !== 'open',
      });
    });
  });
  return rows;
}

window.MockData = {
  STRINGS, STATUS_TAG, PR_STATE_TAG, CATEGORY_TAG, COMMENT_STATE_TAG, FILE_BADGE, REVIEWS, ORG_CATALOG,
  L, loadLS, saveLS, getCommentStatus, computeReviewStatus, countComments, formatCommentSummary, buildFileRows,
};

})();
