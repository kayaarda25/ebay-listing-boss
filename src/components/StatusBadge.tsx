import type { ListingStatus, OrderStatus, LogLevel } from "@/lib/mock-data";

const statusStyles: Record<string, string> = {
  active: "status-active",
  paused: "status-paused",
  error: "status-error",
  pending: "status-pending",
  shipped: "status-pending",
  delivered: "status-active",
  cancelled: "status-error",
};

const logStyles: Record<LogLevel, string> = {
  error: "status-error",
  warning: "status-paused",
  info: "status-pending",
};

export function StatusBadge({ status }: { status: ListingStatus | OrderStatus }) {
  return (
    <span className={`status-badge ${statusStyles[status] || "status-pending"}`}>
      {status}
    </span>
  );
}

export function LogBadge({ level }: { level: LogLevel }) {
  return (
    <span className={`status-badge ${logStyles[level]}`}>
      {level.toUpperCase()}
    </span>
  );
}
