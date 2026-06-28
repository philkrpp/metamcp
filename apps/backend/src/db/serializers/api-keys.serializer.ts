export class ApiKeysSerializer {
  static serializeApiKey(dbApiKey: {
    uuid: string;
    name: string;
    key: string;
    created_at: Date;
    is_active: boolean;
  }) {
    return {
      uuid: dbApiKey.uuid,
      name: dbApiKey.name,
      key: dbApiKey.key,
      created_at: dbApiKey.created_at,
      is_active: dbApiKey.is_active,
    };
  }

  static serializeApiKeyList(
    dbApiKeys: Array<{
      uuid: string;
      name: string;
      key: string;
      created_at: Date;
      is_active: boolean;
      user_id: string | null;
      restrict_endpoints: boolean;
      endpoint_uuids: string[];
    }>,
  ) {
    return dbApiKeys.map((apiKey) => ({
      uuid: apiKey.uuid,
      name: apiKey.name,
      key: apiKey.key,
      created_at: apiKey.created_at,
      is_active: apiKey.is_active,
      user_id: apiKey.user_id,
      restrict_endpoints: apiKey.restrict_endpoints,
      endpoint_uuids: apiKey.endpoint_uuids,
    }));
  }

  static serializeCreateApiKeyResponse(dbApiKey: {
    uuid: string;
    name: string;
    key: string;
    user_id: string | null;
    created_at: Date;
  }) {
    return {
      uuid: dbApiKey.uuid,
      name: dbApiKey.name,
      key: dbApiKey.key,
      created_at: dbApiKey.created_at,
    };
  }
}
