"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ConfirmSignUpForm from "@/components/auth/ConfirmSignUpForm";

export default function ConfirmPage() {
  return (
    <Suspense>
      <Confirm />
    </Suspense>
  );
}

function Confirm() {
  // ?email= is set by the sign-up and login pages, so the user doesn't retype it
  return <ConfirmSignUpForm initialEmail={useSearchParams().get("email") ?? ""} />;
}
