// App shell + per-screen render logic for the docs/mocks static HTML mockups.
// Ported from the Claude Design .dc.html screens (AppShell / Code Review Agent /
// Review Request / Review Result / Settings) into plain DOM string rendering,
// since these pages carry no framework runtime. Loaded as a plain (non-module)
// script so opening these pages via file:// works (ES modules are CORS-blocked
// under file://); the four screen entry points are published on window.MockPages.
(() => {

const RD = window.MockData;

const ICON = (name) => `assets/icons/${name}`;

function getLang() {
  return RD.loadLS('language', 'ja');
}
function setLang(lang) {
  RD.saveLS('language', lang);
  location.reload();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pick(keys, lang) {
  const T = {};
  keys.forEach((k) => { T[k] = RD.L(k, lang); });
  return T;
}

const NAV = [
  { key: 'list', icon: 'view.svg', labelKey: 'navList', href: 'index.html' },
  { key: 'new', icon: 'add.svg', labelKey: 'navNew', href: 'review-request.html' },
  { key: 'settings', icon: 'settings.svg', labelKey: 'navSettings', href: 'settings.html' },
];

function renderHeader(lang) {
  return `
  <div class="app-header">
    <a class="brand" href="index.html">
      <div class="brand-mark">PR</div>
      <span class="brand-name">PR Review Agent</span>
    </a>
    <div class="spacer"></div>
    <div class="lang-switch">
      <button type="button" data-lang="ja" class="${lang === 'ja' ? 'active' : ''}">JA</button>
      <button type="button" data-lang="en" class="${lang === 'en' ? 'active' : ''}">EN</button>
    </div>
    <a class="header-icon-link" href="settings.html" title="${escapeHtml(RD.L('navSettings', lang))}">
      <img class="icon" src="${ICON('settings.svg')}" alt="" />
    </a>
  </div>`;
}

function renderSidebar(active, lang, collapsed) {
  const items = NAV.map((item) => `
    <a href="${item.href}" class="${item.key === active ? 'active' : ''}" title="${escapeHtml(RD.L(item.labelKey, lang))}">
      <img class="icon" src="${ICON(item.icon)}" alt="" />
      <span>${escapeHtml(RD.L(item.labelKey, lang))}</span>
    </a>`).join('');
  return `
  <div class="app-sidebar${collapsed ? ' collapsed' : ''}" id="app-sidebar">
    ${items}
    <div class="sidebar-spacer"></div>
    <div class="sidebar-toggle" id="sidebar-toggle" title="${escapeHtml(RD.L('toggleSidebarLabel', lang))}">
      <img class="icon" id="sidebar-toggle-icon" src="${ICON(collapsed ? 'chevron-right.svg' : 'chevron-left.svg')}" alt="" />
      <span>${escapeHtml(RD.L('collapseSidebar', lang))}</span>
    </div>
  </div>`;
}

function renderBreadcrumb(items) {
  return `<div class="breadcrumb">` + items.map((it, i) => {
    const isLast = i === items.length - 1;
    const part = it.href && !isLast
      ? `<a href="${it.href}">${escapeHtml(it.label)}</a>`
      : `<span class="current">${escapeHtml(it.label)}</span>`;
    const sep = !isLast ? `<span class="sep">/</span>` : '';
    return part + sep;
  }).join('') + `</div>`;
}

function mountShell({ active, breadcrumb }) {
  const lang = getLang();
  const collapsed = RD.loadLS('sidebarCollapsed', false);
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="app-shell">
      ${renderHeader(lang)}
      <div class="app-body">
        ${renderSidebar(active, lang, collapsed)}
        <div class="app-main">
          <div class="app-main-inner">
            ${renderBreadcrumb(breadcrumb)}
            <div id="page-content"></div>
          </div>
        </div>
      </div>
    </div>`;

  root.querySelectorAll('.lang-switch button').forEach((btn) => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  });
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    const next = !RD.loadLS('sidebarCollapsed', false);
    RD.saveLS('sidebarCollapsed', next);
    document.getElementById('app-sidebar').classList.toggle('collapsed', next);
    document.getElementById('sidebar-toggle-icon').src = ICON(next ? 'chevron-right.svg' : 'chevron-left.svg');
  });

  return { lang, contentEl: document.getElementById('page-content') };
}

// ---------------------------------------------------------------------------
// List screen (docs/mocks/index.html) — review list, filters, close.
// ---------------------------------------------------------------------------
function initListPage() {
  const preLang = getLang();
  const { lang, contentEl } = mountShell({ active: 'list', breadcrumb: [{ label: RD.L('listTitle', preLang) }] });
  const T = pick(['listTitle', 'listSubtitle', 'newReviewBtn', 'submittedTitle', 'filterRepoLabel', 'filterStatusLabel',
    'filterSearchLabel', 'searchPlaceholder', 'colPR', 'colBranch', 'colReviewStatus', 'colPRStatus', 'colComments',
    'colUpdated', 'statusNotStarted', 'statusInReview', 'statusWaiting', 'statusError', 'noResultsText', 'closeReviewBtn',
    'tokenMissingTitle', 'tokenMissingSubtitle', 'goToSettingsBtn'], lang);
  const filterAll = RD.L('filterAll', lang);

  const tokenMissing = !RD.loadLS('githubToken', '').trim();
  let commentStatus = RD.loadLS('commentStatus', {});
  let closedReviewIds = RD.loadLS('closedReviewIds', {});
  let collapsedRepos = RD.loadLS('collapsedRepos', {});
  let filterRepo = filterAll;
  let filterStatus = filterAll;
  let searchQuery = '';
  const params = new URLSearchParams(location.search);
  let submittedTarget = params.get('submitted');

  const repoNames = [];
  RD.REVIEWS.forEach((r) => { const key = `${r.org}/${r.repo}`; if (!repoNames.includes(key)) repoNames.push(key); });

  function buildGroups() {
    const q = searchQuery.trim().toLowerCase();
    const groups = [];
    repoNames.forEach((full) => {
      if (filterRepo !== filterAll && filterRepo !== full) return;
      const [org, repo] = full.split('/');
      const reviews = RD.REVIEWS.filter((r) => r.org === org && r.repo === repo)
        .filter((r) => !closedReviewIds[r.id])
        .filter((r) => {
          const statusInfo = RD.computeReviewStatus(r, commentStatus);
          const statusLabel = statusInfo ? RD.L(statusInfo.labelKey, lang) : null;
          if (filterStatus !== filterAll && statusLabel !== filterStatus) return false;
          if (q && !(`${r.title} #${r.number} ${r.branch}`.toLowerCase().includes(q))) return false;
          return true;
        });
      if (reviews.length) groups.push({ full, reviews });
    });
    return groups;
  }

  function renderRow(r) {
    const statusInfo = RD.computeReviewStatus(r, commentStatus);
    const counts = RD.countComments(r, commentStatus);
    const reviewTag = statusInfo
      ? `<span class="tag tag-sm tag-${statusInfo.type}">${escapeHtml(RD.L(statusInfo.labelKey, lang))}</span>`
      : `<span style="color:var(--text-secondary);font-size:13px">—</span>`;
    const prTag = RD.PR_STATE_TAG[r.prState];
    const commentSummary = r.files.length ? (lang === 'ja' ? `${counts.total}件` : `${counts.total}`) : (r.stage === 'error' ? T.statusError : '—');
    const showCloseBtn = statusInfo === RD.STATUS_TAG.waiting || r.prState === 'closed' || r.prState === 'merged';
    return `
      <a href="review-result.html?id=${encodeURIComponent(r.id)}" class="review-row">
        <span class="cell-title">#${r.number} ${escapeHtml(r.title)}</span>
        <span class="cell-branch">${escapeHtml(r.branch)}</span>
        <span>${reviewTag}</span>
        <span class="cell-center"><span class="tag tag-sm tag-${prTag.type}">${prTag.label}</span></span>
        <span class="cell-muted">${escapeHtml(commentSummary)}</span>
        <span class="cell-muted">${escapeHtml(r.updatedAt)}</span>
        <span>${showCloseBtn ? `<button type="button" class="btn btn-ghost btn-sm" data-close-id="${r.id}">${escapeHtml(T.closeReviewBtn)}</button>` : ''}</span>
      </a>`;
  }

  function renderGroup(g) {
    const collapsed = !!collapsedRepos[g.full];
    return `
      <div class="repo-group">
        <div class="repo-group-header" data-toggle-repo="${g.full}">
          <img class="icon" src="${ICON(collapsed ? 'chevron-right.svg' : 'chevron-down.svg')}" alt="" />
          <span class="repo-name">${escapeHtml(g.full)}</span>
          <span class="repo-count">${lang === 'ja' ? `${g.reviews.length}件` : `${g.reviews.length}`}</span>
        </div>
        ${collapsed ? '' : `
        <div class="repo-group-body">
          <div class="review-table-head">
            <span>${T.colPR}</span><span>${T.colBranch}</span><span>${T.colReviewStatus}</span><span>${T.colPRStatus}</span><span>${T.colComments}</span><span>${T.colUpdated}</span><span></span>
          </div>
          ${g.reviews.map(renderRow).join('')}
        </div>`}
      </div>`;
  }

  function render() {
    let html = `<div style="display:flex;flex-direction:column;gap:20px">`;
    html += `
      <div class="list-head">
        <div>
          <h1 class="page-title">${escapeHtml(T.listTitle)}</h1>
          <p class="page-subtitle">${escapeHtml(T.listSubtitle)}</p>
        </div>
        ${!tokenMissing ? `<a href="review-request.html"><button type="button" class="btn btn-primary">${escapeHtml(T.newReviewBtn)}</button></a>` : ''}
      </div>`;

    if (tokenMissing) {
      html += `
        <div style="display:flex;flex-direction:column;gap:12px;align-items:flex-start">
          <div class="inline-notification kind-error"><div class="n-body"><span class="n-title">${escapeHtml(T.tokenMissingTitle)} </span><span class="n-subtitle">${escapeHtml(T.tokenMissingSubtitle)}</span></div></div>
          <a href="settings.html"><button type="button" class="btn btn-secondary">${escapeHtml(T.goToSettingsBtn)}</button></a>
        </div></div>`;
      contentEl.innerHTML = html;
      return;
    }

    if (submittedTarget) {
      const msg = lang === 'ja' ? `${submittedTarget} の依頼を受け付けました。エージェントがレビューを開始します。` : `Request for ${submittedTarget} received. The agent will start reviewing shortly.`;
      html += `<div class="inline-notification kind-success"><div class="n-body"><span class="n-title">${escapeHtml(T.submittedTitle)} </span><span class="n-subtitle">${escapeHtml(msg)}</span></div><img class="n-close icon" id="dismiss-banner" src="${ICON('close.svg')}" alt="" /></div>`;
    }

    html += `
      <div class="filter-row">
        <div class="field" style="max-width:240px">
          <label>${T.filterRepoLabel}</label>
          <div class="select-wrap"><select id="filter-repo">
            <option ${filterRepo === filterAll ? 'selected' : ''}>${escapeHtml(filterAll)}</option>
            ${repoNames.map((n) => `<option ${filterRepo === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
          </select></div>
        </div>
        <div class="field" style="max-width:200px">
          <label>${T.filterStatusLabel}</label>
          <div class="select-wrap"><select id="filter-status">
            ${[filterAll, T.statusNotStarted, T.statusInReview, T.statusWaiting, T.statusError].map((s) => `<option ${filterStatus === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
          </select></div>
        </div>
        <div class="field" style="max-width:280px">
          <label>${T.filterSearchLabel}</label>
          <input type="text" id="filter-search" placeholder="${escapeHtml(T.searchPlaceholder)}" value="${escapeHtml(searchQuery)}" />
        </div>
      </div>`;

    const groups = buildGroups();
    html += groups.length === 0
      ? `<div style="padding:48px;text-align:center;color:var(--text-secondary);font-size:14px">${escapeHtml(T.noResultsText)}</div>`
      : groups.map(renderGroup).join('');

    html += `</div>`;
    contentEl.innerHTML = html;
    attachEvents();
  }

  function attachEvents() {
    const dismiss = document.getElementById('dismiss-banner');
    if (dismiss) dismiss.addEventListener('click', () => { submittedTarget = null; history.replaceState({}, '', 'index.html'); render(); });
    const fr = document.getElementById('filter-repo');
    if (fr) fr.addEventListener('change', (e) => { filterRepo = e.target.value; render(); });
    const fs = document.getElementById('filter-status');
    if (fs) fs.addEventListener('change', (e) => { filterStatus = e.target.value; render(); });
    const fq = document.getElementById('filter-search');
    if (fq) fq.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const next = document.getElementById('filter-search');
      next.focus();
      next.setSelectionRange(pos, pos);
    });
    contentEl.querySelectorAll('[data-toggle-repo]').forEach((el) => {
      el.addEventListener('click', () => {
        const key = el.dataset.toggleRepo;
        collapsedRepos = { ...collapsedRepos, [key]: !collapsedRepos[key] };
        RD.saveLS('collapsedRepos', collapsedRepos);
        render();
      });
    });
    contentEl.querySelectorAll('[data-close-id]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const id = el.dataset.closeId;
        closedReviewIds = { ...closedReviewIds, [id]: true };
        RD.saveLS('closedReviewIds', closedReviewIds);
        render();
      });
    });
  }

  render();
}

// ---------------------------------------------------------------------------
// Request screen (docs/mocks/review-request.html) — org/repo/PR selection.
// ---------------------------------------------------------------------------
function initRequestPage() {
  const preLang = getLang();
  const { lang, contentEl } = mountShell({
    active: 'new',
    breadcrumb: [{ label: RD.L('navList', preLang), href: 'index.html' }, { label: RD.L('navNew', preLang) }],
  });
  const T = pick(['newTitle', 'newSubtitle', 'progressStep1', 'progressStep2', 'progressStep3', 'orgLabel', 'repoLabel',
    'orgPlaceholder', 'repoPlaceholderNoOrg', 'prListLabel', 'payloadHeading', 'submitBtn', 'cancelBtn',
    'tokenMissingTitle', 'tokenMissingSubtitle', 'goToSettingsBtn'], lang);
  const tokenMissing = !RD.loadLS('githubToken', '').trim();

  let newOrg = '';
  let newRepo = '';
  let newPR = null;

  function render() {
    let html = `<div class="screen-narrow" style="display:flex;flex-direction:column;gap:24px">`;
    html += `<div><h1 class="page-title">${escapeHtml(T.newTitle)}</h1><p class="page-subtitle" style="max-width:620px">${escapeHtml(T.newSubtitle)}</p></div>`;

    if (tokenMissing) {
      html += `
        <div style="display:flex;flex-direction:column;gap:12px;align-items:flex-start">
          <div class="inline-notification kind-error"><div class="n-body"><span class="n-title">${escapeHtml(T.tokenMissingTitle)} </span><span class="n-subtitle">${escapeHtml(T.tokenMissingSubtitle)}</span></div></div>
          <a href="settings.html"><button type="button" class="btn btn-secondary">${escapeHtml(T.goToSettingsBtn)}</button></a>
        </div></div>`;
      contentEl.innerHTML = html;
      return;
    }

    const current = newPR ? 2 : newRepo ? 1 : 0;
    const steps = [T.progressStep1, T.progressStep2, T.progressStep3];
    html += `<div class="progress-indicator">` + steps.map((s, i) => `
      <div class="progress-step ${i < current ? 'done' : i === current ? 'current' : ''}">
        <div class="progress-dot"></div><div class="progress-label">${escapeHtml(s)}</div>
      </div>
      ${i < steps.length - 1 ? `<div class="progress-line ${i < current ? 'done' : ''}"></div>` : ''}`).join('') + `</div>`;

    const orgOptions = [T.orgPlaceholder, ...Object.keys(RD.ORG_CATALOG)];
    const repoOptions = newOrg ? [T.orgPlaceholder, ...Object.keys(RD.ORG_CATALOG[newOrg].repos)] : [T.repoPlaceholderNoOrg];
    const repoValue = newRepo || (newOrg ? T.orgPlaceholder : T.repoPlaceholderNoOrg);
    html += `<div style="display:flex;gap:24px;flex-wrap:wrap">
      <div class="field" style="max-width:280px">
        <label>${T.orgLabel}</label>
        <div class="select-wrap"><select id="org-select">
          ${orgOptions.map((o) => `<option ${((newOrg || T.orgPlaceholder) === o) ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
        </select></div>
      </div>
      <div class="field" style="max-width:280px">
        <label>${T.repoLabel}</label>
        <div class="select-wrap"><select id="repo-select" ${newOrg ? '' : 'disabled'}>
          ${repoOptions.map((o) => `<option ${repoValue === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
        </select></div>
      </div>
    </div>`;

    if (newRepo) {
      const prList = RD.ORG_CATALOG[newOrg].repos[newRepo].filter((pr) => pr.state !== 'closed');
      html += `<div style="display:flex;flex-direction:column;gap:10px">
        <div style="font-size:12px;color:var(--text-secondary)">${T.prListLabel}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${prList.map((pr) => `
            <div class="pr-card ${newPR === pr.number ? 'selected' : ''}" data-pr="${pr.number}">
              <div class="pr-card-main">
                <span class="pr-card-title">#${pr.number} ${escapeHtml(pr.title)}</span>
                <span class="pr-card-meta">${escapeHtml(pr.branch)} · ${escapeHtml(pr.author)}</span>
              </div>
              <span class="tag tag-sm tag-green">Open</span>
            </div>`).join('')}
        </div>
      </div>`;
    }

    if (newPR) {
      const payload = `organization: ${newOrg}\nrepository: ${newRepo}\npull_request: ${newPR}`;
      html += `<div style="background:var(--layer-01);padding:20px;display:flex;flex-direction:column;gap:12px;max-width:520px">
        <div style="font-size:12px;color:var(--text-secondary)">${T.payloadHeading}</div>
        <pre class="payload-pre">${escapeHtml(payload)}</pre>
        <div style="display:flex;gap:12px">
          <button type="button" class="btn btn-primary" id="submit-request">${escapeHtml(T.submitBtn)}</button>
          <a href="index.html"><button type="button" class="btn btn-ghost">${escapeHtml(T.cancelBtn)}</button></a>
        </div>
      </div>`;
    }

    html += `</div>`;
    contentEl.innerHTML = html;
    attachEvents();
  }

  function attachEvents() {
    const orgSel = document.getElementById('org-select');
    if (orgSel) orgSel.addEventListener('change', (e) => {
      const v = e.target.value;
      newOrg = v === T.orgPlaceholder ? '' : v;
      newRepo = ''; newPR = null;
      render();
    });
    const repoSel = document.getElementById('repo-select');
    if (repoSel) repoSel.addEventListener('change', (e) => {
      const v = e.target.value;
      newRepo = (v === T.orgPlaceholder || v === T.repoPlaceholderNoOrg) ? '' : v;
      newPR = null;
      render();
    });
    contentEl.querySelectorAll('[data-pr]').forEach((el) => {
      el.addEventListener('click', () => { newPR = Number(el.dataset.pr); render(); });
    });
    const submitBtn = document.getElementById('submit-request');
    if (submitBtn) submitBtn.addEventListener('click', () => {
      if (!newOrg || !newRepo || !newPR) return;
      location.href = `index.html?submitted=${encodeURIComponent(newOrg + '/' + newRepo + ' #' + newPR)}`;
    });
  }

  render();
}

// ---------------------------------------------------------------------------
// Result screen (docs/mocks/review-result.html) — diff viewer + comments.
// ---------------------------------------------------------------------------
function initResultPage() {
  const preLang = getLang();
  const params = new URLSearchParams(location.search);
  const reviewId = params.get('id') || RD.REVIEWS[0].id;
  const review = RD.REVIEWS.find((r) => r.id === reviewId) || RD.REVIEWS[0];

  const { lang, contentEl } = mountShell({
    active: 'list',
    breadcrumb: [{ label: RD.L('navList', preLang), href: 'index.html' }, { label: `${review.org}/${review.repo} #${review.number}` }],
  });
  const T = pick(['navList', 'commitLabel', 'filesHeading', 'colComments', 'notStartedTitle', 'notStartedSubtitle',
    'analyzingTitle', 'analyzingSubtitle', 'errorTitle', 'errorRetriedTitle', 'errorRetriedSubtitle', 'retryBtn',
    'aiNoteText', 'resolveBtn', 'falsePositiveBtn', 'reopenBtn', 'toggleFilesLabel', 'viewedLabel'], lang);

  let commentStatus = RD.loadLS('commentStatus', {});
  let selectedFileId = review.files[0] ? review.files[0].id : null;
  let filePanelCollapsed = RD.loadLS('filePanelCollapsed', false);
  let viewedFiles = RD.loadLS(`viewedFiles_${review.id}`, {});
  let errorRetried = false;

  function render() {
    const statusInfo = RD.computeReviewStatus(review, commentStatus);
    const counts = RD.countComments(review, commentStatus);
    const prTag = RD.PR_STATE_TAG[review.prState];
    const hasFiles = review.files.length > 0;

    let html = `<div style="display:flex;flex-direction:column;gap:20px">`;
    html += `
      <div class="result-head">
        <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
          <div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap">
            <h1 class="page-title compact" style="line-height:1.3">#${review.number} ${escapeHtml(review.title)}</h1>
            <span class="tag tag-${prTag.type}">${prTag.label}</span>
            ${statusInfo ? `<span class="tag tag-${statusInfo.type}">${escapeHtml(RD.L(statusInfo.labelKey, lang))}</span>` : ''}
          </div>
          <div style="font-size:13px;font-family:var(--font-mono);color:var(--text-secondary)">${escapeHtml(review.org)}/${escapeHtml(review.repo)} · ${escapeHtml(review.baseBranch)} ← <a href="https://github.com/${encodeURIComponent(review.org)}/${encodeURIComponent(review.repo)}/tree/${encodeURIComponent(review.branch)}" target="_blank" rel="noopener noreferrer">${escapeHtml(review.branch)}</a></div>
          <div style="font-size:12px;color:var(--text-secondary)">${T.commitLabel}: <a href="https://github.com/${encodeURIComponent(review.org)}/${encodeURIComponent(review.repo)}/commit/${review.commitSha}" target="_blank" rel="noopener noreferrer" style="font-family:var(--font-mono)">${review.commitSha.slice(0, 7)}</a></div>
        </div>
        ${hasFiles ? `
        <div style="text-align:right;font-size:12px;color:var(--text-secondary);white-space:nowrap;line-height:1.8">
          <div>${T.filesHeading}: ${review.files.length} (<span style="color:var(--support-success)">+${review.files.reduce((s, f) => s + f.additions, 0)}</span> <span style="color:var(--support-error)">-${review.files.reduce((s, f) => s + f.deletions, 0)}</span>)</div>
          <div>${T.colComments}: ${escapeHtml(RD.formatCommentSummary(counts, lang))}</div>
        </div>` : ''}
      </div>`;

    if (review.stage === 'not_started') {
      html += `<div class="inline-notification"><div class="n-body"><span class="n-title">${escapeHtml(T.notStartedTitle)} </span><span class="n-subtitle">${escapeHtml(T.notStartedSubtitle)}</span></div></div>`;
    } else if (review.stage === 'analyzing') {
      html += `<div style="display:flex;align-items:center;gap:12px;background:var(--layer-01);padding:16px 20px;max-width:520px">
        <div class="spinner"></div>
        <div><div style="font-size:14px;font-weight:600;color:var(--text-primary)">${escapeHtml(T.analyzingTitle)}</div><div style="font-size:13px;color:var(--text-secondary)">${escapeHtml(T.analyzingSubtitle)}</div></div>
      </div>`;
    } else if (review.stage === 'error') {
      html += errorRetried
        ? `<div class="inline-notification"><div class="n-body"><span class="n-title">${escapeHtml(T.errorRetriedTitle)} </span><span class="n-subtitle">${escapeHtml(T.errorRetriedSubtitle)}</span></div></div>`
        : `<div style="display:flex;flex-direction:column;gap:12px;align-items:flex-start">
             <div class="inline-notification kind-error"><div class="n-body"><span class="n-title">${escapeHtml(T.errorTitle)} </span><span class="n-subtitle">${escapeHtml(review.errorMessage || '')}</span></div></div>
             <button type="button" class="btn btn-secondary" id="retry-review">${escapeHtml(T.retryBtn)}</button>
           </div>`;
    }

    if (hasFiles) {
      const selectedFile = review.files.find((f) => f.id === selectedFileId) || review.files[0];
      html += `<div class="diff-viewer">
        <div class="file-panel ${filePanelCollapsed ? 'collapsed' : ''}">
          <div class="file-panel-head">
            ${filePanelCollapsed ? '' : `<span>${T.filesHeading}</span>`}
            <div class="file-panel-toggle" id="file-panel-toggle" title="${escapeHtml(T.toggleFilesLabel)}">
              <img class="icon" src="${ICON(filePanelCollapsed ? 'chevron-right.svg' : 'chevron-left.svg')}" alt="" />
            </div>
          </div>
          ${review.files.map((f) => renderFileRow(f, selectedFile, filePanelCollapsed, viewedFiles)).join('')}
        </div>
        <div class="diff-pane">
          <div class="diff-pane-head">
            <span style="font-family:var(--font-mono);font-size:13px">${escapeHtml(selectedFile.name)}</span>
            <div style="display:flex;align-items:center;gap:16px">
              <span style="font-size:12px;color:var(--text-secondary)">+${selectedFile.additions} -${selectedFile.deletions}</span>
              <label class="checkbox-row"><input type="checkbox" id="selected-file-viewed" ${viewedFiles[selectedFile.id] ? 'checked' : ''} /> ${escapeHtml(T.viewedLabel)}</label>
            </div>
          </div>
          <div class="diff-body">
            ${RD.buildFileRows(selectedFile, commentStatus, lang).map((row) => renderDiffRow(row, T)).join('')}
          </div>
        </div>
      </div>`;
    }

    html += `</div>`;
    contentEl.innerHTML = html;
    attachEvents(review);
  }

  function renderFileRow(f, selectedFile, collapsed, viewedFiles) {
    const selected = f.id === selectedFile.id;
    const badge = RD.FILE_BADGE[f.status] || RD.FILE_BADGE.M;
    const commentCount = (f.comments || []).length;
    const viewed = !!viewedFiles[f.id];
    if (collapsed) {
      return `<div class="file-row collapsed ${selected ? 'selected' : ''}" data-select-file="${f.id}" title="${escapeHtml(f.name)}">
        <span class="file-badge" style="background:${badge.bg};color:${badge.color}">${f.status}</span>
      </div>`;
    }
    return `<div class="file-row ${selected ? 'selected' : ''}">
      <label class="checkbox-row" style="flex-shrink:0" title="${escapeHtml(RD.L('viewedLabel', getLang()))}">
        <input type="checkbox" data-viewed-file="${f.id}" ${viewed ? 'checked' : ''} />
      </label>
      <div class="file-row-main" data-select-file="${f.id}" style="opacity:${viewed ? 0.6 : 1}">
        <div class="file-row-name">
          <span class="file-badge" style="background:${badge.bg};color:${badge.color}">${f.status}</span>
          <span class="file-name" style="text-decoration:${viewed ? 'line-through' : 'none'}">${escapeHtml(f.name)}</span>
        </div>
        <div class="file-row-stats">
          <span style="color:var(--support-success)">+${f.additions}</span>
          <span style="color:var(--support-error)">-${f.deletions}</span>
          ${commentCount > 0 ? `<span class="comment-badge">${commentCount}</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  function renderDiffRow(row, T) {
    if (row.isCode) {
      return `<div class="diff-line" style="background:${row.bg}">
        <span class="diff-num">${row.oldNum}</span>
        <span class="diff-num">${row.newNum}</span>
        <span class="diff-marker" style="color:${row.markerColor}">${row.marker}</span>
        <span class="diff-text">${escapeHtml(row.text)}</span>
      </div>`;
    }
    return `<div class="comment-thread" style="border-left-color:${row.accent}">
      <div class="comment-thread-tags">
        <span class="ai-label" title="${escapeHtml(T.aiNoteText)}">AI</span>
        <span class="tag tag-sm tag-${row.categoryTagType}">${escapeHtml(row.categoryLabel)}</span>
        ${row.showStateTag ? `<span class="tag tag-sm tag-${row.stateTagType}">${escapeHtml(row.stateLabel)}</span>` : ''}
      </div>
      <div style="font-size:14px;line-height:1.6;max-width:820px;color:${row.bodyColor};text-decoration:${row.bodyDecoration}">${escapeHtml(row.body)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${row.canResolve ? `<button type="button" class="btn btn-ghost btn-sm" data-comment-action="resolved" data-comment-id="${row.commentId}">${escapeHtml(T.resolveBtn)}</button>` : ''}
        ${row.canFalsePositive ? `<button type="button" class="btn btn-ghost btn-sm" data-comment-action="false_positive" data-comment-id="${row.commentId}">${escapeHtml(T.falsePositiveBtn)}</button>` : ''}
        ${row.canReopen ? `<button type="button" class="btn btn-ghost btn-sm" data-comment-action="open" data-comment-id="${row.commentId}">${escapeHtml(T.reopenBtn)}</button>` : ''}
      </div>
    </div>`;
  }

  function attachEvents(review) {
    const retryBtn = document.getElementById('retry-review');
    if (retryBtn) retryBtn.addEventListener('click', () => { errorRetried = true; render(); });
    const toggle = document.getElementById('file-panel-toggle');
    if (toggle) toggle.addEventListener('click', () => {
      filePanelCollapsed = !filePanelCollapsed;
      RD.saveLS('filePanelCollapsed', filePanelCollapsed);
      render();
    });
    contentEl.querySelectorAll('[data-select-file]').forEach((el) => {
      el.addEventListener('click', () => { selectedFileId = el.dataset.selectFile; render(); });
    });
    contentEl.querySelectorAll('[data-viewed-file]').forEach((el) => {
      el.addEventListener('click', (e) => e.stopPropagation());
      el.addEventListener('change', (e) => {
        const id = el.dataset.viewedFile;
        viewedFiles = { ...viewedFiles, [id]: e.target.checked };
        RD.saveLS(`viewedFiles_${review.id}`, viewedFiles);
        render();
      });
    });
    const selViewed = document.getElementById('selected-file-viewed');
    if (selViewed) selViewed.addEventListener('change', (e) => {
      const selectedFile = review.files.find((f) => f.id === selectedFileId) || review.files[0];
      viewedFiles = { ...viewedFiles, [selectedFile.id]: e.target.checked };
      RD.saveLS(`viewedFiles_${review.id}`, viewedFiles);
      render();
    });
    contentEl.querySelectorAll('[data-comment-action]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.commentId;
        const action = el.dataset.commentAction;
        commentStatus = { ...commentStatus, [id]: action };
        RD.saveLS('commentStatus', commentStatus);
        render();
      });
    });
  }

  render();
}

// ---------------------------------------------------------------------------
// Settings screen (docs/mocks/settings.html) — GitHub URL / PAT.
// ---------------------------------------------------------------------------
function initSettingsPage() {
  const preLang = getLang();
  const { lang, contentEl } = mountShell({ active: 'settings', breadcrumb: [{ label: RD.L('navSettings', preLang) }] });
  const T = pick(['settingsTitle', 'settingsBody', 'settingsSavedTitle', 'githubUrlLabel', 'githubUrlHelper',
    'githubTokenLabel', 'githubTokenHelper', 'saveBtn'], lang);

  let githubUrl = RD.loadLS('githubUrl', 'https://github.com');
  let githubToken = RD.loadLS('githubToken', '');
  let settingsSaved = false;

  function render() {
    let html = `<div class="screen-form" style="display:flex;flex-direction:column;gap:24px">`;
    html += `<div><h1 class="page-title compact">${escapeHtml(T.settingsTitle)}</h1><p class="page-subtitle">${escapeHtml(T.settingsBody)}</p></div>`;
    if (settingsSaved) {
      html += `<div class="inline-notification kind-success"><div class="n-body"><span class="n-title">${escapeHtml(T.settingsSavedTitle)}</span></div><img class="n-close icon" id="dismiss-saved" src="${ICON('close.svg')}" alt="" /></div>`;
    }
    html += `<div style="display:flex;flex-direction:column;gap:20px">
      <div class="field">
        <label>${T.githubUrlLabel}</label>
        <input type="text" id="github-url" placeholder="https://github.com" value="${escapeHtml(githubUrl)}" />
        <span class="helper">${T.githubUrlHelper}</span>
      </div>
      <div class="field">
        <label>${T.githubTokenLabel}</label>
        <input type="password" id="github-token" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" value="${escapeHtml(githubToken)}" />
        <span class="helper">${T.githubTokenHelper}</span>
      </div>
    </div>`;
    html += `<div><button type="button" class="btn btn-primary" id="save-settings">${escapeHtml(T.saveBtn)}</button></div>`;
    html += `</div>`;
    contentEl.innerHTML = html;
    attachEvents();
  }

  function attachEvents() {
    document.getElementById('github-url').addEventListener('input', (e) => {
      githubUrl = e.target.value; RD.saveLS('githubUrl', githubUrl); settingsSaved = false;
    });
    document.getElementById('github-token').addEventListener('input', (e) => {
      githubToken = e.target.value; RD.saveLS('githubToken', githubToken); settingsSaved = false;
    });
    document.getElementById('save-settings').addEventListener('click', () => { settingsSaved = true; render(); });
    const dismiss = document.getElementById('dismiss-saved');
    if (dismiss) dismiss.addEventListener('click', () => { settingsSaved = false; render(); });
  }

  render();
}

window.MockPages = { initListPage, initRequestPage, initResultPage, initSettingsPage };

})();
