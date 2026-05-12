import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import type { AuthContext } from "../auth";

interface MyRouterContext {
  auth: AuthContext;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  return (
    <main className="main-layout">
      <Outlet />
    </main>
  );
}
