import { MetaMcpLogEntry } from "@repo/zod-types";
import { useEffect } from "react";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import { vanillaTrpcClient } from "../trpc";

interface LogsState {
  logs: MetaMcpLogEntry[];
  isLoading: boolean;
  isAutoRefreshing: boolean;
  totalCount: number;
  lastFetch: Date | null;
  /** True while the poll interval is actually running (see attachConsumer). */
  isPolling: boolean;

  // Actions. Read-only: `clearLogs` was removed with migration 0028's
  // audit_log — the backend procedure it called no longer exists. See
  // packages/trpc/src/routers/frontend/logs.ts.
  fetchLogs: () => Promise<void>;
  startAutoRefresh: () => void;
  stopAutoRefresh: () => void;
  setAutoRefresh: (enabled: boolean) => void;
  /**
   * Register a view of the logs (the live-logs page). The poll runs only while
   * at least one is attached and the document is visible. Returns the detach
   * function; use it as an effect cleanup (see useLogsPolling).
   */
  attachConsumer: () => () => void;
}

let refreshInterval: NodeJS.Timeout | null = null;
let consumerCount = 0;
const REFRESH_INTERVAL = 2000; // 2 seconds
const AUTO_REFRESH_STORAGE_KEY = "metamcp-auto-refresh-enabled";

// Helper functions for localStorage
const getStoredAutoRefreshState = (): boolean => {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
  return stored ? JSON.parse(stored) : true; // Default to true (enabled)
};

const setStoredAutoRefreshState = (enabled: boolean): void => {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, JSON.stringify(enabled));
};

export const useLogsStore = create<LogsState>()(
  subscribeWithSelector((set, get) => ({
    logs: [],
    isLoading: false,
    isAutoRefreshing: getStoredAutoRefreshState(), // Load from localStorage
    totalCount: 0,
    lastFetch: null,
    isPolling: false,

    fetchLogs: async () => {
      try {
        set({ isLoading: true });

        const response = await vanillaTrpcClient.frontend.logs.get.query({
          limit: 1000,
        });

        if (response.success) {
          set({
            logs:
              response.data?.map((log) => ({
                ...log,
                timestamp: new Date(log.timestamp),
              })) || [],
            totalCount: response.totalCount || 0,
            lastFetch: new Date(),
            isLoading: false,
          });
        }
      } catch (error) {
        console.error("Failed to fetch logs:", error);
        set({ isLoading: false });

        // Check if it's an auth error the user can't recover from by staying on
        // the page. UNAUTHORIZED = not logged in. FORBIDDEN = logged in but not
        // an admin: logs.get is adminProcedure, so without the FORBIDDEN case a
        // member on the live-logs page would run a permanent 2s 403 poll loop.
        if (error && typeof error === "object" && "message" in error) {
          const errorMessage = String(error.message);
          if (
            errorMessage.includes("UNAUTHORIZED") ||
            errorMessage.includes("You must be logged in") ||
            errorMessage.includes("FORBIDDEN") ||
            errorMessage.includes("administrator role")
          ) {
            // Stop auto-refresh — retrying won't fix a missing session or role.
            const currentState = get();
            if (currentState.isAutoRefreshing) {
              currentState.stopAutoRefresh();
              console.log(
                "Auto-refresh stopped due to authentication/authorization error",
              );
            }
          }
        }
      }
    },

    startAutoRefresh: () => {
      set({ isAutoRefreshing: true });
      setStoredAutoRefreshState(true); // Persist to localStorage
      startPolling();
    },

    stopAutoRefresh: () => {
      stopPolling();
      set({ isAutoRefreshing: false });
      setStoredAutoRefreshState(false); // Persist to localStorage
    },

    setAutoRefresh: (enabled: boolean) => {
      if (enabled) {
        get().startAutoRefresh();
      } else {
        get().stopAutoRefresh();
      }
    },

    attachConsumer: () => {
      consumerCount++;
      if (consumerCount === 1) {
        document.addEventListener("visibilitychange", onVisibilityChange);
        // Always fetch once when a consumer mounts; with auto-refresh on and
        // the tab visible, the poll's immediate fetch is that fetch.
        if (get().isAutoRefreshing && !isDocumentHidden()) {
          startPolling();
        } else {
          get().fetchLogs();
        }
      }

      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        consumerCount--;
        if (consumerCount === 0) {
          document.removeEventListener("visibilitychange", onVisibilityChange);
          // Pause only: leaving the page does not change the user's
          // auto-refresh preference.
          stopPolling();
        }
      };
    },
  })),
);

const isDocumentHidden = (): boolean =>
  typeof document !== "undefined" && document.hidden;

// The poll used to start at module init and fetch 1000 entries every 2 s on
// every page, visible or not. It now runs only while a consumer is attached,
// auto-refresh is on and the tab is visible.
function startPolling(): void {
  if (refreshInterval) return; // Already running
  if (consumerCount === 0 || isDocumentHidden()) return;
  const store = useLogsStore.getState();
  if (!store.isAutoRefreshing) return;

  // Fetch immediately
  store.fetchLogs();

  // Set up interval
  refreshInterval = setInterval(() => {
    const currentState = useLogsStore.getState();
    if (currentState.isAutoRefreshing) {
      currentState.fetchLogs();
    }
  }, REFRESH_INTERVAL);
  useLogsStore.setState({ isPolling: true });
}

function stopPolling(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  useLogsStore.setState({ isPolling: false });
}

function onVisibilityChange(): void {
  if (isDocumentHidden()) {
    stopPolling();
  } else {
    startPolling();
  }
}

/** Keep the logs store polling while the calling component is mounted. */
export function useLogsPolling(): void {
  useEffect(() => useLogsStore.getState().attachConsumer(), []);
}

// Cleanup on page unload
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  });
}
