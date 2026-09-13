import { Product } from "./types";

// Mock catalog. Shape matches the `cloudcart-products` DynamoDB table (see spec.md §3),
// so this file is the only thing that changes when api.ts swaps to a real API call.
export const PRODUCTS: Product[] = [
  {
    productId: "prod_001",
    name: "Aperture X7 Mirrorless Camera",
    description:
      "24MP full-frame mirrorless camera with in-body stabilization and 4K60 video.",
    price: 1799.99,
    inventory: 12,
    category: "cameras",
  },
  {
    productId: "prod_002",
    name: "Aperture X7 Mirrorless Camera - Body Only",
    description: "Same body as the X7 kit, without the 24-70mm lens.",
    price: 1499.99,
    inventory: 18,
    category: "cameras",
  },
  {
    productId: "prod_003",
    name: "Foco Pro 50mm f/1.4 Lens",
    description: "Fast prime lens with silent autofocus, ideal for portraits.",
    price: 449.0,
    inventory: 25,
    category: "cameras",
  },
  {
    productId: "prod_004",
    name: "Vantage Point Action Camera",
    description: "Waterproof to 33ft, 5.3K video, built-in image stabilization.",
    price: 329.99,
    inventory: 40,
    category: "cameras",
  },
  {
    productId: "prod_005",
    name: "Steadicam Mini Gimbal",
    description: "3-axis handheld gimbal stabilizer for mirrorless cameras.",
    price: 189.0,
    inventory: 30,
    category: "cameras",
  },
  {
    productId: "prod_006",
    name: "TravelTripod Carbon 5-Section",
    description: "Carbon fiber tripod, folds to 16in, 15lb load capacity.",
    price: 219.99,
    inventory: 22,
    category: "cameras",
  },
  {
    productId: "prod_007",
    name: "SnapGrip MagSafe Battery Case",
    description: "5000mAh magnetic battery pack with built-in shutter button.",
    price: 59.99,
    inventory: 80,
    category: "phone-accessories",
  },
  {
    productId: "prod_008",
    name: "ClearView Tempered Glass (2-Pack)",
    description: "9H hardness screen protector with edge-to-edge coverage.",
    price: 14.99,
    inventory: 200,
    category: "phone-accessories",
  },
  {
    productId: "prod_009",
    name: "OrbitMount Magnetic Car Vent Mount",
    description: "Strong-hold magnetic phone mount for car air vents.",
    price: 19.99,
    inventory: 150,
    category: "phone-accessories",
  },
  {
    productId: "prod_010",
    name: "FastCharge 65W GaN Wall Charger",
    description: "Compact dual-port USB-C charger, fast-charges phone and laptop.",
    price: 39.99,
    inventory: 95,
    category: "phone-accessories",
  },
  {
    productId: "prod_011",
    name: "ArmorShell Drop-Proof Case",
    description: "Military-grade drop protection, raised bezel, wireless-charging safe.",
    price: 29.99,
    inventory: 120,
    category: "phone-accessories",
  },
  {
    productId: "prod_012",
    name: "LumaRing Selfie Light Clip",
    description: "Clip-on LED ring light with 3 brightness levels, USB-C rechargeable.",
    price: 24.99,
    inventory: 60,
    category: "phone-accessories",
  },
];

export function getAllProducts(): Product[] {
  return PRODUCTS;
}

export function getProductById(productId: string): Product | undefined {
  return PRODUCTS.find((p) => p.productId === productId);
}

export function getProductsByCategory(category: string): Product[] {
  return PRODUCTS.filter((p) => p.category === category);
}
