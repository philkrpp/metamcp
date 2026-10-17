/**
 * The live-logs poll (limit 1000, every 2 s) used to start at module init, so
 * it ran on every page of the app for as long as a tab was open, visible or
 * not. It now runs only while a consumer (the live-logs page) is attached and
 * pauses while the document is hidden.
 *
 * Vitest runs in the node environment here (no jsdom/happy-dom installed), so
 * the test stubs the three browser globals the store touches: `window`,
 * `document` (an EventTarget with a writable `hidden`) and `localStorage`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("../trpc", () => ({
  vanillaTrpcClient: {
    frontend: { logs: { get: { query: queryMock } } },
  },
}));

type FakeDocument = EventTarget & { hidden: boolean };

let fakeDocument: FakeDocument;
let storage: Map<string, string>;

const setHidden = (hidden: boolean) => {
  fakeDocument.hidden = hidden;
  fakeDocument.dispatchEvent(new Event("visibilitychange"));
};

/** A fresh store module, as on a page load, with browser globals in place. */
const loadStore = async () => {
  vi.resetModules();
  return (await import("./logs-store")).useLogsStore;
};

beforeEach(() => {
  vi.useFakeTimers();
  queryMock.mockReset();
  queryMock.mockResolvedValue({ success: true, data: [], totalCount: 0 });
  storage = new Map();
  fakeDocument = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("logs store polling", () => {
  it("does not fetch or poll just because the module was loaded", async () => {
    await loadStore();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("polls every 2 s only while a consumer is attached", async () => {
    const store = await loadStore();
    const release = store.getState().attachConsumer();

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith({ limit: 1000 });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(store.getState().isPolling).toBe(true);

    release();
    expect(store.getState().isPolling).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(queryMock).toHaveBeenCalledTimes(3);
    // Leaving the page is not the user turning auto-refresh off.
    expect(store.getState().isAutoRefreshing).toBe(true);
  });

  it("pauses while the document is hidden and resumes with a fetch when visible", async () => {
    const store = await loadStore();
    const release = store.getState().attachConsumer();
    expect(queryMock).toHaveBeenCalledTimes(1);

    setHidden(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(queryMock).toHaveBeenCalledTimes(1);

    setHidden(false);
    expect(queryMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(queryMock).toHaveBeenCalledTimes(3);

    release();
    // Detached: a visibility flip no longer restarts anything.
    setHidden(true);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it("with auto-refresh switched off, a consumer gets one fetch and no poll", async () => {
    storage.set("metamcp-auto-refresh-enabled", "false");
    const store = await loadStore();
    const release = store.getState().attachConsumer();

    expect(queryMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(queryMock).toHaveBeenCalledTimes(1);

    // Turning it on from the page starts the poll.
    store.getState().setAutoRefresh(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(queryMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    release();
  });

  it("enabling auto-refresh with no consumer attached starts no poll", async () => {
    const store = await loadStore();
    store.getState().setAutoRefresh(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
