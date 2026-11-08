"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  // ?confirmed=1 is set by the confirmation page after a successful sign-up
  return <LoginForm justConfirmed={useSearchParams().get("confirmed") === "1"} />;
}
