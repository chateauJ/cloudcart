import Link from "next/link";
import { Product } from "@/lib/types";
import ProductImage from "./ProductImage";

const CATEGORY_LABEL: Record<string, string> = {
  cameras: "Camera",
  "phone-accessories": "Phone Accessory",
};

export default function ProductCard({ product }: { product: Product }) {
  return (
    <Link
      href={`/product?id=${encodeURIComponent(product.productId)}`}
      className="group flex flex-col rounded-lg border border-foreground/10 p-4 transition-colors hover:border-foreground/30"
    >
      <ProductImage
        productId={product.productId}
        name={product.name}
        className="mb-3 aspect-[4/3] w-full rounded-md"
      />
      <span className="text-xs font-medium uppercase tracking-wide text-foreground/50">
        {CATEGORY_LABEL[product.category] ?? product.category}
      </span>
      <h3 className="mt-1 font-medium group-hover:underline">{product.name}</h3>
      <p className="mt-1 line-clamp-2 text-sm text-foreground/60">{product.description}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className="font-semibold">${product.price.toFixed(2)}</span>
        <span className="text-xs text-foreground/50">
          {product.inventory > 0 ? `${product.inventory} in stock` : "Out of stock"}
        </span>
      </div>
    </Link>
  );
}
