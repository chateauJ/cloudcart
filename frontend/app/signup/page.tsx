"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import AuthField from "@/components/auth/AuthField";

export default function SignUpPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const step = await register(email.trim(), password);
      router.push(step === "CONFIRM_SIGN_UP" ? `/confirm?email=${encodeURIComponent(email.trim())}` : "/login");
    } catch (err) {
      // e.g. "Password did not conform with policy" or "User already exists"
      setError(err instanceof Error ? err.message : "Could not sign up");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-semibold">Create an account</h1>
      <p className="mt-2 text-sm text-foreground/60">
        We&apos;ll email you a code to confirm the address.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <AuthField
          label="Email"
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <AuthField
          label="Password"
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          hint="At least 8 characters, with upper and lower case letters, a number and a symbol."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {isSubmitting ? "Creating account..." : "Sign up"}
        </button>
      </form>

      <p className="mt-6 text-sm text-foreground/60">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
