import { getAllProducts } from "@/lib/products";
import ProductCard from "@/components/ProductCard";

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "cameras", label: "Cameras" },
  { value: "phone-accessories", label: "Phone Accessories" },
];

export default async function ProductsPage(props: PageProps<"/products">) {
  const searchParams = await props.searchParams;
  const category = typeof searchParams.category === "string" ? searchParams.category : "";

  const products = getAllProducts().filter((p) => !category || p.category === category);

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="mt-1 text-sm text-foreground/60">
            Cameras and phone accessories.
          </p>
        </div>
        <div className="flex gap-2">
          {CATEGORIES.map((c) => (
            <a
              key={c.value}
              href={c.value ? `/products?category=${c.value}` : "/products"}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                category === c.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-foreground/15 hover:bg-foreground/5"
              }`}
            >
              {c.label}
            </a>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <ProductCard key={product.productId} product={product} />
        ))}
      </div>
    </div>
  );
}
