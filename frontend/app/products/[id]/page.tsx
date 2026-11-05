import { notFound } from "next/navigation";
import Link from "next/link";
import { getProduct } from "@/lib/api";
import AddToCartButton from "@/components/AddToCartButton";

export default async function ProductDetailPage(props: PageProps<"/products/[id]">) {
  const { id } = await props.params;
  const product = await getProduct(id);

  if (!product) {
    notFound();
  }

  return (
    <div>
      <Link href="/products" className="text-sm text-foreground/60 hover:underline">
        ← Back to products
      </Link>

      <div className="mt-4 grid grid-cols-1 gap-8 sm:grid-cols-2">
        <div className="flex h-72 items-center justify-center rounded-lg bg-gradient-to-br from-foreground/5 to-foreground/10 text-6xl font-semibold text-foreground/30">
          {product.name.charAt(0)}
        </div>

        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-foreground/50">
            {product.category === "cameras" ? "Camera" : "Phone Accessory"}
          </span>
          <h1 className="mt-1 text-2xl font-semibold">{product.name}</h1>
          <p className="mt-3 text-foreground/70">{product.description}</p>
          <p className="mt-4 text-2xl font-semibold">${product.price.toFixed(2)}</p>
          <p className="mt-1 text-sm text-foreground/50">
            {product.inventory > 0 ? `${product.inventory} in stock` : "Out of stock"}
          </p>

          <div className="mt-6">
            <AddToCartButton productId={product.productId} inventory={product.inventory} />
          </div>
        </div>
      </div>
    </div>
  );
}
