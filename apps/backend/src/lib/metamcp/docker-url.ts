/**
 * Transforms localhost URLs to use host.docker.internal when running inside Docker.
 *
 * Gated behind the TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL env flag so it is a
 * no-op unless the operator explicitly opts in.
 */
export const transformDockerUrl = (url: string): string => {
  if (process.env.TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL === "true") {
    return url.replace(/localhost|127\.0\.0\.1/g, "host.docker.internal");
  }
  return url;
};

/**
 * Applies the same localhost -> host.docker.internal rewrite to every value of a
 * STDIO server's environment (e.g. database connection strings), mirroring the
 * transform applied to SSE/STREAMABLE_HTTP server URLs. No-op unless
 * TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL is enabled.
 */
export const transformDockerEnv = (
  env: Record<string, string> | undefined,
): Record<string, string> | undefined => {
  if (!env) {
    return env;
  }

  const transformed: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    transformed[key] =
      typeof value === "string" ? transformDockerUrl(value) : value;
  }
  return transformed;
};
