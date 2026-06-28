"use client";

import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";

import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

interface EndpointAccessSelectorProps {
  restrict: boolean;
  selected: string[];
  onRestrictChange: (value: boolean) => void;
  onSelectedChange: (uuids: string[]) => void;
}

export function EndpointAccessSelector({
  restrict,
  selected,
  onRestrictChange,
  onSelectedChange,
}: EndpointAccessSelectorProps) {
  const { t } = useTranslations();

  const { data: endpointsResponse, isLoading } =
    trpc.frontend.endpoints.list.useQuery();

  const endpoints = endpointsResponse?.success ? endpointsResponse.data : [];

  const toggleEndpoint = (uuid: string) => {
    if (selected.includes(uuid)) {
      onSelectedChange(selected.filter((id) => id !== uuid));
    } else {
      onSelectedChange([...selected, uuid]);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Switch
          id="restrict-endpoints"
          checked={restrict}
          onCheckedChange={onRestrictChange}
        />
        <Label
          htmlFor="restrict-endpoints"
          className="text-sm font-medium cursor-pointer"
        >
          {t("api-keys:restrictEndpoints")}
        </Label>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("api-keys:restrictEndpointsDescription")}
      </p>

      {restrict && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("api-keys:selectEndpoints")}</p>
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-2">
              {t("common:loading")}
            </div>
          ) : endpoints.length === 0 ? (
            <div className="text-sm text-muted-foreground py-2">
              {t("api-keys:noEndpointsAvailable")}
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto rounded-md border p-2 space-y-1">
              {endpoints.map((endpoint) => (
                <div
                  key={endpoint.uuid}
                  className="flex items-center gap-2 py-1 px-1 rounded hover:bg-muted/50"
                >
                  <Checkbox
                    id={`endpoint-${endpoint.uuid}`}
                    checked={selected.includes(endpoint.uuid)}
                    onCheckedChange={() => toggleEndpoint(endpoint.uuid)}
                  />
                  <label
                    htmlFor={`endpoint-${endpoint.uuid}`}
                    className="flex-1 text-sm cursor-pointer select-none flex items-center gap-2"
                  >
                    <span>{endpoint.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {endpoint.namespace.name}
                    </span>
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
