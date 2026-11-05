"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import AuthField from "./AuthField";

export default function ConfirmSignUpForm({ initialEmail }: { initialEmail: string }) {
  const { confirmRegistration, resendCode } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await confirmRegistration(email.trim(), code.trim());
      router.push("/login?confirmed=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm the code");
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    setError(null);
    setNotice(null);
    try {
      await resendCode(email.trim());
      setNotice("A new code is on its way.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend the code");
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-semibold">Confirm your email</h1>
      <p className="mt-2 text-sm text-foreground/60">Enter the 6-digit code Cognito emailed you.</p>

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
          label="Confirmation code"
          id="code"
          inputMode="numeric"
          required
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {notice && <p className="text-sm text-green-700">{notice}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {isSubmitting ? "Confirming..." : "Confirm"}
        </button>
        <button type="button" onClick={handleResend} className="text-sm text-foreground/60 underline">
          Resend code
        </button>
      </form>
    </div>
  );
}
