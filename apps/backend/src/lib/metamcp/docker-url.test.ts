import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { transformDockerEnv, transformDockerUrl } from "./docker-url";

describe("docker-url", () => {
  const original = process.env.TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL;
    } else {
      process.env.TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL = original;
    }
  });

  describe("when TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL is not enabled", () => {
    beforeEach(() => {
      delete process.env.TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL;
    });

    it("leaves URLs untouched", () => {
      expect(transformDockerUrl("http://localhost:5432")).toBe(
        "http://localhost:5432",
      );
    });

    it("leaves env values untouched", () => {
      const env = { MDB_MCP_CONNECTION_STRING: "mongodb://localhost:27017" };
      expect(transformDockerEnv(env)).toEqual(env);
    });
  });

  describe("when TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL is enabled", () => {
    beforeEach(() => {
      process.env.TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL = "true";
    });

    it("rewrites localhost and 127.0.0.1 in URLs", () => {
      expect(transformDockerUrl("http://localhost:5432")).toBe(
        "http://host.docker.internal:5432",
      );
      expect(transformDockerUrl("http://127.0.0.1:5432")).toBe(
        "http://host.docker.internal:5432",
      );
    });

    it("rewrites localhost in env connection strings", () => {
      const env = {
        MDB_MCP_CONNECTION_STRING: "mongodb://user:pass@localhost:27017/db",
        UNRELATED: "some-value",
      };
      expect(transformDockerEnv(env)).toEqual({
        MDB_MCP_CONNECTION_STRING:
          "mongodb://user:pass@host.docker.internal:27017/db",
        UNRELATED: "some-value",
      });
    });

    it("returns undefined when env is undefined", () => {
      expect(transformDockerEnv(undefined)).toBeUndefined();
    });
  });
});
