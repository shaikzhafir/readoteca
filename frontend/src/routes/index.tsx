import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { API_BASE_URL } from "../config/api";

export const Route = createFileRoute("/")({
  validateSearch: z.object({
    redirect: z.string().optional().catch(""),
  }),
  beforeLoad: ({ context }) => {
    if (context.auth.isAuthenticated) {
      throw redirect({ to: "/library" });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const search = Route.useSearch();

  const startGoogleLogin = () => {
    const next = search.redirect || "/library";
    window.location.assign(`${API_BASE_URL}/google/login?next=${encodeURIComponent(next)}`);
  };

  return (
    <div className="auth-container">
      <div className="auth-card fade-in">
        <h1 className="auth-title">Readoteca</h1>
        <button type="button" className="btn btn-primary w-full" onClick={startGoogleLogin}>
          Continue with Google
        </button>
      </div>
    </div>
  );
}
