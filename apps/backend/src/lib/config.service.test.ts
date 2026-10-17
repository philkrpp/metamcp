import { beforeEach, describe, expect, it, vi } from "vitest";

const { getConfig } = vi.hoisted(() => ({ getConfig: vi.fn() }));

vi.mock("../db/repositories/config.repo", () => ({
  configRepo: { getConfig, setConfig: vi.fn() },
}));

import { configService } from "./config.service";

describe("configService.getMcpResetTimeoutOnProgress", () => {
  beforeEach(() => {
    getConfig.mockReset();
  });

  it("defaults to true when the key is unset", async () => {
    getConfig.mockResolvedValue(undefined);
    expect(await configService.getMcpResetTimeoutOnProgress()).toBe(true);
  });

  it("returns true when stored as 'true'", async () => {
    getConfig.mockResolvedValue({ value: "true" });
    expect(await configService.getMcpResetTimeoutOnProgress()).toBe(true);
  });

  it("returns false when stored as 'false'", async () => {
    getConfig.mockResolvedValue({ value: "false" });
    expect(await configService.getMcpResetTimeoutOnProgress()).toBe(false);
  });
});
