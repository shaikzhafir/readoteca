import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { useAuth } from "../auth";

export const Route = createFileRoute("/auth/callback")({
  validateSearch: z.object({
    next: z.string().optional().catch("/library"),
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();

  useEffect(() => {
    auth.refresh().then((user) => {
      void navigate({ to: user ? search.next || "/library" : "/" });
    });
  }, [auth, navigate, search.next]);

  return (
    <div className="auth-container">
      <div className="auth-card text-center">Signing you in…</div>
    </div>
  );
}
