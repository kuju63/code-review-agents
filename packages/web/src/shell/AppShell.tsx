import { Breadcrumb, BreadcrumbItem, IconButton, Theme } from "@carbon/react";
import { Add, ChevronLeft, ChevronRight, Settings, View } from "@carbon/react/icons";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import styles from "./AppShell.module.scss";
import { useSidebarCollapsed } from "./useSidebarCollapsed";

interface NavItem {
  to: "/" | "/review-request" | "/settings";
  labelKey: "nav.list" | "nav.reviewRequest" | "nav.settings";
  Icon: ComponentType<{ "aria-hidden"?: boolean }>;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", labelKey: "nav.list", Icon: View },
  { to: "/review-request", labelKey: "nav.reviewRequest", Icon: Add },
  { to: "/settings", labelKey: "nav.settings", Icon: Settings },
];

/**
 * `/review-result` is a drill-down from a review row (ReviewRow.tsx), not a
 * sidebar destination, so it's kept out of NAV_ITEMS but still needs its own
 * breadcrumb label instead of falling back to NAV_ITEMS[0] ("list").
 */
const BREADCRUMB_ITEMS: readonly {
  to: string;
  labelKey: NavItem["labelKey"] | "reviewResult.title";
}[] = [...NAV_ITEMS, { to: "/review-result", labelKey: "reviewResult.title" }];

/** COM-01/03/04/05/06, minimal per the SCR-01 spec's scope boundary: no language switch (COM-02). */
export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const current = BREADCRUMB_ITEMS.find((item) => item.to === pathname) ?? BREADCRUMB_ITEMS[0];

  return (
    <div className={styles.shell}>
      {/* g100: Carbon components (IconButton's icon, tooltip, focus ring) are not
          background-aware — without this they render in the white theme's dark
          icon color, which disappears against this dark header. */}
      <Theme theme="g100" as="header" className={styles.header}>
        <Link to="/" className={styles.brand}>
          {t("nav.brand")}
        </Link>
        <IconButton
          label={t("nav.settings")}
          kind="ghost"
          onClick={() => navigate({ to: "/settings" })}
        >
          <Settings />
        </IconButton>
      </Theme>
      <div className={styles.body}>
        <nav
          className={collapsed ? `${styles.sidebar} ${styles.sidebarCollapsed}` : styles.sidebar}
          aria-label={t("nav.list")}
        >
          {NAV_ITEMS.map(({ to, labelKey, Icon }) => (
            <Link
              key={to}
              to={to}
              className={styles.navLink}
              activeProps={{ className: styles.navLinkActive }}
              activeOptions={{ exact: to === "/" }}
              aria-label={t(labelKey)}
            >
              <Icon aria-hidden />
              {!collapsed && <span className={styles.navLabel}>{t(labelKey)}</span>}
            </Link>
          ))}
          <div className={styles.sidebarSpacer} />
          <IconButton
            label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
            kind="ghost"
            align="right"
            onClick={toggleCollapsed}
          >
            {collapsed ? <ChevronRight /> : <ChevronLeft />}
          </IconButton>
        </nav>
        <main className={styles.main}>
          <div className={styles.breadcrumbWrap}>
            <Breadcrumb noTrailingSlash>
              <BreadcrumbItem isCurrentPage>{t(current.labelKey)}</BreadcrumbItem>
            </Breadcrumb>
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
