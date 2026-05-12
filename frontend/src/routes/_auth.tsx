import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useAuth } from "../auth";
import { useTheme } from "../theme";

export const Route = createFileRoute("/_auth")({
  beforeLoad: ({ context, location }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({
        to: "/",
        search: {
          redirect: location.href,
        },
      });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  const router = useRouter();
  const navigate = Route.useNavigate();
  const auth = useAuth();
  const { theme, toggle } = useTheme();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const handleLogout = async () => {
    await auth.logout();
    await router.invalidate();
    await navigate({ to: "/" });
  };

  return (
    <div className="container-custom">
      <header className="flex items-baseline justify-between gap-6 py-6">
        <Link to="/library" className="no-underline">
          <h1 className="page-title text-xl">Readoteca</h1>
        </Link>
        <nav className="flex items-baseline gap-3">
          <Link
            to="/library"
            className={`nav-link ${pathname.includes("/library") ? "nav-link-active" : ""}`}
          >
            Library
          </Link>
          {auth.user?.displayName && (
            <span className="page-meta hidden sm:inline">{auth.user.displayName}</span>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleLogout}>
            Logout
          </button>
        </nav>
      </header>
      <main className="content-area">
        <Outlet />
      </main>
    </div>
  );
}
