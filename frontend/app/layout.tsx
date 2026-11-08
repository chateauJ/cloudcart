import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/AuthContext";
import { CartProvider } from "@/lib/CartContext";
import { CatalogProvider } from "@/lib/CatalogContext";
import { TenantProvider } from "@/lib/TenantContext";
import Navbar from "@/components/Navbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CloudCart",
  description: "Serverless e-commerce demo storefront",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TenantProvider>
          <AuthProvider>
            <CatalogProvider>
              <CartProvider>
                <Navbar />
                <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
              </CartProvider>
            </CatalogProvider>
          </AuthProvider>
        </TenantProvider>
      </body>
    </html>
  );
}
