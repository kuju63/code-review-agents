import { useCallback, useRef, useState } from "react";

export interface UseReviewRequestSelection {
  organization: string | null;
  repository: string | null;
  pullRequest: number | null;
  /** 0=Organization/リポジトリを選択, 1=PRを選択, 2=内容を確認して送信 (§1.2)。 */
  step: 0 | 1 | 2;
  /** (organization, repository, pullRequest)の組ごとに1回だけ生成し、同一選択への再送で使い回す。 */
  idempotencyKey: string;
  selectOrganization: (organization: string) => void;
  selectRepository: (repository: string) => void;
  selectPullRequest: (pullRequest: number) => void;
  /** VL-04: PRのみ選択解除し、organization/repositoryは維持する。 */
  clearPullRequest: () => void;
}

/**
 * SCR-02 RR-04/05/07の選択状態とOP-01/OP-02のカスケードクリア、進捗ステップ
 * (§1.2)を管理する。データ取得(react-query)には関与しない。
 */
export function useReviewRequestSelection(): UseReviewRequestSelection {
  const [organization, setOrganization] = useState<string | null>(null);
  const [repository, setRepository] = useState<string | null>(null);
  const [pullRequest, setPullRequest] = useState<number | null>(null);

  const selectOrganization = useCallback((next: string) => {
    setOrganization(next);
    setRepository(null);
    setPullRequest(null);
  }, []);

  const selectRepository = useCallback((next: string) => {
    setRepository(next);
    setPullRequest(null);
  }, []);

  const selectPullRequest = useCallback((next: number) => {
    setPullRequest(next);
  }, []);

  const clearPullRequest = useCallback(() => {
    setPullRequest(null);
  }, []);

  const step: 0 | 1 | 2 = pullRequest !== null ? 2 : repository !== null ? 1 : 0;

  // Stable across re-renders/retries of the same (org, repo, pr) selection
  // (OP-05/ST-06 double-submit prevention); regenerates only when the
  // selection actually changes. Held in a ref (not useMemo) because useMemo
  // is only a cache React may discard and recompute at any time, which would
  // silently break double-submit prevention.
  const selectionSignature = [organization, repository, pullRequest].join("|");
  const selectionSignatureRef = useRef(selectionSignature);
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  if (selectionSignatureRef.current !== selectionSignature) {
    selectionSignatureRef.current = selectionSignature;
    idempotencyKeyRef.current = crypto.randomUUID();
  }
  const idempotencyKey = idempotencyKeyRef.current;

  return {
    organization,
    repository,
    pullRequest,
    step,
    idempotencyKey,
    selectOrganization,
    selectRepository,
    selectPullRequest,
    clearPullRequest,
  };
}
