"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { useLogsStore } from "@/lib/stores/logs-store";

export function LogsStatusIndicator() {
  // The dot means a poll is running right now, which happens only while the
  // live-logs page is open; the count is the last one that page fetched.
  const { totalCount, isPolling: isAutoRefreshing } = useLogsStore();
  const [mounted, setMounted] = useState(false);

  // Only render after component mounts to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Return empty div during SSR to avoid hydration mismatch
  if (!mounted) {
    return <div className="flex items-center gap-1" />;
  }

  if (totalCount === 0) {
    return (
      <div className="flex items-center gap-1">
        {isAutoRefreshing && (
          <div
            className="w-2 h-2 bg-green-500 rounded-full animate-pulse"
            title="Live updates active"
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Badge variant="outline" className="text-xs px-1.5 py-0.5">
        {totalCount}
      </Badge>
      {isAutoRefreshing && (
        <div
          className="w-2 h-2 bg-green-500 rounded-full animate-pulse"
          title="Live updates active"
        />
      )}
    </div>
  );
}
