"use client";

import { useState } from "react";
import Image from "next/image";

// Illustrations live in public/images/products/<productId>.svg. A product added to the catalog
// without one falls back to its initial, so the page never shows a broken image.
export default function ProductImage({
  productId,
  name,
  className,
  initialClassName = "text-3xl",
}: {
  productId: string;
  name: string;
  className: string; // sizing and rounding of the frame
  initialClassName?: string;
}) {
  const [missing, setMissing] = useState(false);

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-foreground/5 to-foreground/10 ${className}`}
    >
      {missing ? (
        <span className={`font-semibold text-foreground/30 ${initialClassName}`}>{name.charAt(0)}</span>
      ) : (
        <Image
          src={`/images/products/${productId}.svg`}
          alt={name}
          fill
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover"
          onError={() => setMissing(true)}
        />
      )}
    </div>
  );
}
