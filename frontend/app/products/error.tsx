"use client"; // error boundaries must be Client Components

export default function ProductsError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Products</h1>
      <p className="mt-4 text-foreground/60">
        Couldn&apos;t load products from the API
        {error instanceof Error && error.message ? ` (${error.message})` : ""}.
      </p>
      <button
        onClick={() => retry()}
        className="mt-4 rounded-md border border-foreground/15 px-3 py-1.5 text-sm font-medium hover:bg-foreground/5"
      >
        Try again
      </button>
    </div>
  );
}
