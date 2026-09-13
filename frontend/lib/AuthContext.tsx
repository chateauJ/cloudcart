"use client";

// Mock auth. Stands in for Cognito (spec.md §5) - "login" just creates a local
// user id and stores it, no password check. Swapping to real Cognito means
// replacing the body of login()/logout() and where userId comes from; every
// page that calls useAuth() stays the same.

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { readJSON, writeJSON } from "./storage";

interface AuthUser {
  userId: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const USER_KEY = "cloudcart:user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // One-time read of localStorage after mount - can't be a lazy useState
    // initializer because that would run during SSR (where window doesn't
    // exist) and mismatch what the client renders, causing a hydration error.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(readJSON<AuthUser | null>(USER_KEY, null));
    setIsLoading(false);
  }, []);

  function login(email: string) {
    const existing = readJSON<AuthUser | null>(USER_KEY, null);
    const authUser: AuthUser =
      existing && existing.email === email
        ? existing
        : { userId: crypto.randomUUID(), email };
    writeJSON(USER_KEY, authUser);
    setUser(authUser);
  }

  function logout() {
    writeJSON(USER_KEY, null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
