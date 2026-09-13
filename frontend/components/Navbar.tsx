"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useCart } from "@/lib/CartContext";

export default function Navbar() {
  const { user, logout } = useAuth();
  const { itemCount } = useCart();
  const pathname = usePathname();
  const router = useRouter();

  function handleLogout() {
    logout();
    router.push("/login");
  }

  const linkClass = (href: string) =>
    `text-sm font-medium transition-colors hover:text-foreground ${
      pathname === href ? "text-foreground" : "text-foreground/60"
    }`;

  return (
    <header className="border-b border-foreground/10">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link href="/products" className="text-lg font-semibold tracking-tight">
          CloudCart
        </Link>

        <nav className="flex items-center gap-6">
          <Link href="/products" className={linkClass("/products")}>
            Products
          </Link>
          {user && (
            <>
              <Link href="/cart" className={linkClass("/cart")}>
                Cart{itemCount > 0 ? ` (${itemCount})` : ""}
              </Link>
              <Link href="/orders" className={linkClass("/orders")}>
                Orders
              </Link>
            </>
          )}

          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-foreground/60">{user.email}</span>
              <button
                onClick={handleLogout}
                className="rounded-md border border-foreground/15 px-3 py-1.5 text-sm font-medium hover:bg-foreground/5"
              >
                Log out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90"
            >
              Log in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
