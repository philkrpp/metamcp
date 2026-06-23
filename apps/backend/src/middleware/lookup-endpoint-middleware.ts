import express from "express";

import logger from "@/utils/logger";

import { endpointsRepository } from "../db/repositories/endpoints.repo";
import { ApiKeyAuthenticatedRequest } from "./api-key-oauth.middleware";

// Middleware to lookup endpoint by name and add namespace info to request
export const lookupEndpoint = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  // Express 5 / path-to-regexp v8 types params as `string | string[]`;
  // this route has a single `:endpoint_name` segment, so it is always a string.
  const endpointName = req.params.endpoint_name as string;

  try {
    const endpoint = await endpointsRepository.findByName(endpointName);
    if (!endpoint) {
      return res.status(404).json({
        error: "Endpoint not found",
        message: `No endpoint found with name: ${endpointName}`,
        timestamp: new Date().toISOString(),
      });
    }

    // Add the endpoint info to the request for use in handlers
    const authReq = req as ApiKeyAuthenticatedRequest;
    authReq.namespaceUuid = endpoint.namespace_uuid;
    authReq.endpointName = endpointName;
    authReq.endpoint = endpoint;

    next();
  } catch (error) {
    logger.error("Error looking up endpoint:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: "Failed to lookup endpoint",
      timestamp: new Date().toISOString(),
    });
  }
};
