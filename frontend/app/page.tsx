"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// A static export has no server to send a redirect, so the browser does it
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/products");
  }, [router]);

  return null;
}
