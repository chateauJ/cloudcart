"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useCart } from "@/lib/CartContext";
import { useTenant } from "@/lib/TenantContext";
import StoreSelector from "./StoreSelector";

export default function Navbar() {
  const { user, logout } = useAuth();
  const { itemCount } = useCart();
  const tenant = useTenant();
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await logout(); // clears Amplify's stored tokens, so a reload stays logged out
    router.push("/login");
  }

  // trailingSlash: true serves /products as /products/, so compare without it
  const current = pathname.replace(/(.)\/$/, "$1");
  const linkClass = (href: string) =>
    `text-sm font-medium transition-colors hover:text-foreground ${
      current === href ? "text-foreground" : "text-foreground/60"
    }`;

  return (
    <header className="border-b border-foreground/10">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link href="/products" className="flex items-baseline gap-2">
          {/* The store's own name; CloudCart is the platform it runs on */}
          <span className="text-lg font-semibold tracking-tight">{tenant?.name ?? "\u00a0"}</span>
          <span className="text-xs text-foreground/40">on CloudCart</span>
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
              {user.isStaff && (
                <Link href="/staff" className={linkClass("/staff")}>
                  Staff
                </Link>
              )}
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
      <div className="border-t border-foreground/5">
        <div className="mx-auto flex max-w-5xl justify-end px-4 py-2">
          <StoreSelector />
        </div>
      </div>
    </header>
  );
}
