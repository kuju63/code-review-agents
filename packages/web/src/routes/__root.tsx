import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { AppShell } from "../shell/AppShell";

const RootLayout = () => (
  <>
    <AppShell />
    <TanStackRouterDevtools />
    <ReactQueryDevtools initialIsOpen={false} />
  </>
);

export const Route = createRootRoute({ component: RootLayout });
