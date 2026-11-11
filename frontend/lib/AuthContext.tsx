"use client";

// Cognito auth through Amplify (spec.md §5). Sign-in uses SRP, so the password never leaves the
// browser - the only flow prod's app client allows. Amplify keeps the tokens in localStorage and
// refreshes the access token from the refresh token, so a session survives reloads for 30 days.

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { Amplify } from "aws-amplify";
import {
  confirmSignUp,
  fetchAuthSession,
  resendSignUpCode,
  signIn,
  signOut,
  signUp,
} from "aws-amplify/auth";
import { config } from "./config";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: config.userPoolId,
      userPoolClientId: config.userPoolClientId,
      loginWith: { email: true },
      signUpVerificationMethod: "code",
    },
  },
});

interface AuthUser {
  userId: string; // Cognito's sub - the same ID the API reads from the token
  email: string;
  isStaff: boolean; // in this storefront's staff-<tenantId> group; the API checks the same thing itself
}

// What the UI does next: "DONE" means signed in, "CONFIRM_SIGN_UP" means go enter the emailed code
type AuthStep = "DONE" | "CONFIRM_SIGN_UP";

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AuthStep>;
  register: (email: string, password: string) => Promise<AuthStep>;
  confirmRegistration: (email: string, code: string) => Promise<void>;
  resendCode: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// The ID token already carries sub and email, and the access token the groups, so no extra
// Cognito call is needed. Group changes show up after the next sign-in, when new tokens are issued.
async function currentUser(): Promise<AuthUser | null> {
  try {
    const { tokens } = await fetchAuthSession();
    const { sub, email } = tokens?.idToken?.payload ?? {};
    const groups = tokens?.accessToken?.payload["cognito:groups"];
    const isStaff = Array.isArray(groups) && groups.includes(`staff-${config.tenantId}`);
    return typeof sub === "string" ? { userId: sub, email: typeof email === "string" ? email : "", isStaff } : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    setUser(await currentUser());
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // Restore the session Amplify saved in localStorage - an external-system sync after mount,
    // since localStorage doesn't exist during server rendering
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  async function login(email: string, password: string): Promise<AuthStep> {
    const { nextStep } = await signIn({ username: email, password });
    if (nextStep.signInStep === "CONFIRM_SIGN_UP") return "CONFIRM_SIGN_UP";
    if (nextStep.signInStep !== "DONE") {
      // MFA, forced password resets etc. aren't enabled on this pool, so this means a config change
      throw new Error(`This account needs a sign-in step the demo doesn't support (${nextStep.signInStep})`);
    }
    await reload();
    return "DONE";
  }

  async function register(email: string, password: string): Promise<AuthStep> {
    const { nextStep } = await signUp({
      username: email,
      password,
      options: { userAttributes: { email } },
    });
    return nextStep.signUpStep === "CONFIRM_SIGN_UP" ? "CONFIRM_SIGN_UP" : "DONE";
  }

  async function confirmRegistration(email: string, code: string): Promise<void> {
    await confirmSignUp({ username: email, confirmationCode: code });
  }

  async function resendCode(email: string): Promise<void> {
    await resendSignUpCode({ username: email });
  }

  async function logout(): Promise<void> {
    await signOut();
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, register, confirmRegistration, resendCode, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
