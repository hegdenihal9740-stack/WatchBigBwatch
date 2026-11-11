import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCustomer } from "@/components/CustomerAccounts";
import { AccountLayout } from "@/components/AccountLayout";
import { ProfileEditor } from "@/components/ProfileEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  consumeBrowserOAuthReturnPath,
  createAuthCallbackUrl,
  getPostAuthPath,
  readLastVisitedPath,
  readBrowserOAuthReturnPath,
  savePasswordRecoveryRequest,
  saveBrowserOAuthReturnPath,
} from "@/lib/auth-redirect";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): { view?: "profile"; next?: string } => ({
    ...(search["view"] === "profile" ? { view: "profile" as const } : {}),
    ...(typeof search["next"] === "string" ? { next: search["next"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Customer account — BIG-B" },
      { name: "description", content: "Register, sign in and manage your BIG-B customer profile." },
      { property: "og:title", content: "Customer account — BIG-B" },
      { property: "og:description", content: "Your BIG-B customer account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { user, ready, error: accountError } = useCustomer();
  const { view, next: callbackPath } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [savedReturnPath, setSavedReturnPath] = useState<string | null>(null);
  const [returnPathReady, setReturnPathReady] = useState(false);
  useEffect(() => {
    if (callbackPath) saveBrowserOAuthReturnPath(callbackPath);
    setSavedReturnPath(readBrowserOAuthReturnPath() ?? readLastVisitedPath(localStorage));
    setReturnPathReady(true);
  }, [callbackPath]);
  const returnPath = getPostAuthPath(callbackPath ?? savedReturnPath);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackError = params.get("error_description") ?? params.get("error");
    if (callbackError) {
      consumeBrowserOAuthReturnPath();
      setError(
        /missing OAuth secret|unsupported provider/i.test(callbackError)
          ? "Google sign-in is not enabled for this store yet. Please use email and password, or contact support."
          : `Sign-in could not be completed: ${callbackError}`,
      );
      return;
    }
    if (!user || !returnPathReady) return;
    consumeBrowserOAuthReturnPath();
    if (
      view !== "profile" &&
      returnPath !== `${window.location.pathname}${window.location.search}${window.location.hash}`
    ) {
      window.location.replace(returnPath);
      return;
    }
    void supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(
        ({ data, error }) => {
          if (error) setError("Your profile could not be loaded. Please try again.");
          else setName(data?.display_name ?? "");
        },
        () =>
          setError("Your profile could not be loaded. Please check your connection and try again."),
      );
  }, [user, returnPath, returnPathReady, view]);
  const changeMode = (next: typeof mode) => {
    setMode(next);
    setMessage("");
    setError("");
    setPassword("");
    setConfirmationPending(false);
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const normalizedEmail = email.trim().toLowerCase();
    try {
      if (user) {
        const { error } = await supabase
          .from("profiles")
          .upsert({ id: user.id, display_name: name.trim() });
        if (error) throw error;
        setMessage("Your profile has been saved.");
      } else if (mode === "register") {
        const callbackUrl = new URL(createAuthCallbackUrl(window.location.origin, returnPath));
        callbackUrl.searchParams.set("confirmed", "1");
        try {
          saveBrowserOAuthReturnPath(returnPath);
        } catch (storageError) {
          console.error("[Auth] Could not store registration return path", storageError);
        }
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { data: { display_name: name.trim() }, emailRedirectTo: callbackUrl.toString() },
        });
        if (error) throw error;
        if (data.user && (data.user.identities ?? []).length === 0) {
          setError(
            "This email may already have an account. Try signing in or resetting your password.",
          );
          setMode("login");
          return;
        }
        if (data.session) {
          window.location.replace(returnPath);
          return;
        }
        setConfirmationPending(!data.session);
        setMessage(
          `Check ${normalizedEmail} and open the confirmation link. You’ll return here and be signed in.`,
        );
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: new URL("/reset-password", window.location.origin).toString(),
        });
        if (error) throw error;
        try {
          savePasswordRecoveryRequest(localStorage);
        } catch (error) {
          console.error("[Auth] Could not store password recovery state", error);
        }
        setMessage("If an account exists, a password reset link has been sent.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) {
          const message = /email not confirmed/i.test(error.message)
            ? "Please confirm your email first. Check your inbox, or register again to request a new confirmation email."
            : error.message === "Invalid login credentials"
              ? 'Wrong email or password. Try again or use "Forgot password?".'
              : error.message;
          throw new Error(message);
        }
        setMessage("You are signed in.");
        window.location.replace(returnPath);
        return;
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function social() {
    setError("");
    setBusy(true);
    try {
      saveBrowserOAuthReturnPath(returnPath);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: createAuthCallbackUrl(window.location.origin, returnPath),
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (!data.url) throw new Error("Supabase did not provide a Google sign-in URL.");
      window.location.assign(data.url);
    } catch (error) {
      consumeBrowserOAuthReturnPath();
      const detail = error instanceof Error ? error.message : "";
      setError(
        /missing OAuth secret|unsupported provider|provider.*not enabled|google.*not enabled/i.test(
          detail,
        )
          ? "Google sign-in is not enabled in Supabase yet. Please use email and password, or enable Google under Supabase Authentication → Providers."
          : detail || "Sign-in could not be completed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function resendConfirmation() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter your email address first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const callbackUrl = new URL(createAuthCallbackUrl(window.location.origin, returnPath));
      callbackUrl.searchParams.set("confirmed", "1");
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: normalizedEmail,
        options: { emailRedirectTo: callbackUrl.toString() },
      });
      if (error) throw error;
      setMessage(`A new confirmation link has been sent to ${normalizedEmail}.`);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not resend the confirmation email. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await queryClient.cancelQueries();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      queryClient.clear();
      await navigate({ to: "/auth", replace: true });
      setMessage("You have signed out.");
      setPassword("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sign-out failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AccountLayout
      title={
        user
          ? "My account"
          : mode === "register"
            ? "Create your account"
            : mode === "forgot"
              ? "Reset your password"
              : "Welcome back"
      }
    >
      {!ready ? (
        <p role="status">Loading your account…</p>
      ) : (
        <>
          {accountError && !user && (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {accountError}
            </p>
          )}
          {user ? (
            <p className="mb-6 break-all text-muted-foreground">{user.email}</p>
          ) : (
            mode !== "forgot" && (
              <div className="mb-6 grid grid-cols-2 gap-2">
                <Button
                  variant={mode === "login" ? "default" : "outline"}
                  onClick={() => changeMode("login")}
                >
                  Login
                </Button>
                <Button
                  variant={mode === "register" ? "default" : "outline"}
                  onClick={() => changeMode("register")}
                >
                  Register
                </Button>
              </div>
            )
          )}
          {user && view === "profile" && (
            <ProfileEditor userId={user.id} email={user.email ?? ""} />
          )}
          {!user && (
            <form onSubmit={submit} className="space-y-5">
              {(user || mode === "register") && (
                <label className="block space-y-2 text-sm">
                  <span>Full name</span>
                  <Input
                    autoComplete="name"
                    required
                    value={name}
                    maxLength={100}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}
              {!user && (
                <label className="block space-y-2 text-sm">
                  <span>Email address</span>
                  <Input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              )}
              {!user && mode !== "forgot" && (
                <label className="block space-y-2 text-sm">
                  <span>Password</span>
                  <Input
                    type="password"
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                    required
                    minLength={mode === "register" ? 8 : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  {mode === "register" && (
                    <span className="text-muted-foreground">At least 8 characters</span>
                  )}
                </label>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {message && (
                <p role="status" className="text-sm text-foreground">
                  {message}
                </p>
              )}
              {confirmationPending && (
                <Button
                  type="button"
                  variant="link"
                  className="px-0"
                  disabled={busy}
                  onClick={() => void resendConfirmation()}
                >
                  Didn’t receive the email? Resend confirmation
                </Button>
              )}
              <Button disabled={busy} className="w-full" type="submit">
                {busy
                  ? "Please wait…"
                  : user
                    ? "Save profile"
                    : mode === "register"
                      ? "Create account"
                      : mode === "forgot"
                        ? "Send reset link"
                        : "Sign in"}
              </Button>
            </form>
          )}
          {user ? (
            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to="/account">My account</Link>
              </Button>
              {view === "profile" && (
                <Button asChild variant="outline">
                  <Link to="/account">Back to account</Link>
                </Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={signOut}>
                Sign out
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant="link"
                className="my-4 px-0"
                onClick={() => changeMode(mode === "forgot" ? "login" : "forgot")}
              >
                {mode === "forgot" ? "Back to login" : "Forgot password?"}
              </Button>
              {mode !== "forgot" && (
                <div className="account-auth-social space-y-3 border-t border-border pt-5">
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={busy}
                    onClick={() => social()}
                  >
                    Continue with Google
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </AccountLayout>
  );
}
