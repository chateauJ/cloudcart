import { OrderStatus } from "@/lib/types";

const STYLES: Record<OrderStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  RESERVED: "bg-blue-100 text-blue-800",
  READY_FOR_PICKUP: "bg-green-100 text-green-800",
  FULFILLED: "bg-green-100 text-green-800",
  EXPIRED: "bg-foreground/10 text-foreground/60",
  FAILED: "bg-red-100 text-red-800",
};

export default function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STYLES[status]}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
