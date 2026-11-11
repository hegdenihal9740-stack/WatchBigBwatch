import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import {
  clearPasswordRecoveryRequest,
  consumeBrowserOAuthReturnPath,
  getOAuthCallbackReturnPath,
  isPasswordRecoveryCallbackUrl,
  isPendingPasswordRecoveryCallback,
  saveLastVisitedPath,
} from "@/lib/auth-redirect";

const CustomerContext = createContext<{ user: User | null; ready: boolean; error: string | null }>({
  user: null,
  ready: false,
  error: null,
});
export const useCustomer = () => useContext(CustomerContext);

export function CustomerAccounts({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { pathname, searchStr, hash } = useLocation();
  const queryClient = useQueryClient();
  useEffect(() => {
    saveLastVisitedPath(localStorage, `${pathname}${searchStr}${hash}`);
  }, [pathname, searchStr, hash]);
  useEffect(() => {
    let active = true;
    let authEventVersion = 0;
    if (!isSupabaseConfigured()) {
      setReady(true);
      setError("Account services are unavailable until Supabase is configured.");
      return;
    }
    const callbackUrl = new URL(window.location.href);
    let isRecoveryCallback = isPasswordRecoveryCallbackUrl(callbackUrl);
    if (!isRecoveryCallback) {
      try {
        isRecoveryCallback = isPendingPasswordRecoveryCallback(callbackUrl, localStorage);
      } catch (storageError) {
        console.error("[Auth] Could not read password recovery state", storageError);
      }
    }
    if (isRecoveryCallback) {
      try {
        clearPasswordRecoveryRequest(localStorage);
      } catch (storageError) {
        console.error("[Auth] Could not clear password recovery state", storageError);
      }
    }
    if (window.location.pathname !== "/reset-password" && isRecoveryCallback) {
      callbackUrl.pathname = "/reset-password";
      callbackUrl.searchParams.set("recovery", "1");
      window.location.replace(`${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`);
      return () => {
        active = false;
      };
    }
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      authEventVersion += 1;
      if (active) {
        setUser(session?.user ?? null);
        setReady(true);
        setError(null);
      }
      if (event === "PASSWORD_RECOVERY" && window.location.pathname !== "/reset-password") {
        window.location.replace("/reset-password?recovery=1");
        return;
      }
      if (event === "SIGNED_IN" && session?.user) {
        // The auth route must consume its own saved destination after user state
        // updates; otherwise its effect can fall back to profile after this handler
        // has already consumed the watch return path.
        if (
          window.location.pathname !== "/auth" &&
          window.location.pathname !== "/reset-password"
        ) {
          const savedReturnPath = consumeBrowserOAuthReturnPath();
          const returnPath =
            getOAuthCallbackReturnPath(callbackUrl, savedReturnPath) ?? savedReturnPath;
          if (returnPath) {
            const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            if (returnPath !== currentPath) window.location.replace(returnPath);
          }
        }
      }
      if (!["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event)) return;
      void router.invalidate();
      if (event === "SIGNED_OUT") queryClient.clear();
      else void queryClient.invalidateQueries();
    });
    const initialAuthEventVersion = authEventVersion;
    void (async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (!active || authEventVersion !== initialAuthEventVersion) return;
        if (sessionError) throw sessionError;
        if (!session) {
          setUser(null);
          setReady(true);
          setError(null);
          return;
        }

        const verificationEventVersion = authEventVersion;
        const { data, error: authError } = await supabase.auth.getUser();
        if (!active || authEventVersion !== verificationEventVersion) return;
        if (authError) {
          console.error("Could not verify the restored Supabase session.", authError);
          setUser(null);
          setReady(true);
          setError(
            "We could not verify your account right now. You can still try signing in again.",
          );
          return;
        }
        setUser(data.user);
        setReady(true);
        if (
          window.location.pathname !== "/auth" &&
          window.location.pathname !== "/reset-password"
        ) {
          const savedReturnPath = consumeBrowserOAuthReturnPath();
          const returnPath =
            getOAuthCallbackReturnPath(callbackUrl, savedReturnPath) ?? savedReturnPath;
          if (returnPath) {
            const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            if (returnPath !== currentPath) window.location.replace(returnPath);
          }
        }
      } catch (authError) {
        if (!active || authEventVersion !== initialAuthEventVersion) return;
        console.error("Could not restore the Supabase session.", authError);
        setUser(null);
        setReady(true);
        setError("We could not connect to your account. Check your connection and try again.");
      }
    })();
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router, queryClient]);
  return (
    <CustomerContext.Provider value={{ user, ready, error }}>{children}</CustomerContext.Provider>
  );
}
