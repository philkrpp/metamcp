"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EndpointAccessSelector } from "@/components/endpoint-access-selector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";

interface ApiKeyItem {
  uuid: string;
  name: string;
  is_active: boolean;
  restrict_endpoints: boolean;
  endpoint_uuids: string[];
}

interface EditApiKeyProps {
  apiKey: ApiKeyItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditApiKey({
  apiKey,
  isOpen,
  onClose,
  onSuccess,
}: EditApiKeyProps) {
  const { t } = useTranslations();

  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [restrict, setRestrict] = useState(false);
  const [selectedEndpoints, setSelectedEndpoints] = useState<string[]>([]);

  // Pre-populate fields when apiKey or isOpen changes
  useEffect(() => {
    if (apiKey && isOpen) {
      setName(apiKey.name);
      setIsActive(apiKey.is_active);
      setRestrict(apiKey.restrict_endpoints);
      setSelectedEndpoints(apiKey.endpoint_uuids);
    }
  }, [apiKey, isOpen]);

  const updateMutation = trpc.frontend.apiKeys.update.useMutation({
    onSuccess: () => {
      toast.success(t("api-keys:apiKeyUpdated"));
      onSuccess();
      onClose();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey) return;

    updateMutation.mutate({
      uuid: apiKey.uuid,
      name,
      is_active: isActive,
      restrict_endpoints: restrict,
      endpoint_uuids: restrict ? selectedEndpoints : [],
    });
  };

  const handleClose = () => {
    onClose();
  };

  if (!apiKey) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("api-keys:editApiKey")}</DialogTitle>
          <DialogDescription>
            {t("api-keys:editApiKeyDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label
                htmlFor="edit-api-key-name"
                className="text-sm font-medium"
              >
                {t("api-keys:name")}
              </Label>
              <Input
                id="edit-api-key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("api-keys:namePlaceholder")}
                disabled={updateMutation.isPending}
              />
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">
                  {t("common:active")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("api-keys:activeDescription")}
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={updateMutation.isPending}
              />
            </div>

            {/* Endpoint Access Selector */}
            <div>
              <EndpointAccessSelector
                restrict={restrict}
                selected={selectedEndpoints}
                onRestrictChange={(value) => {
                  setRestrict(value);
                  if (!value) setSelectedEndpoints([]);
                }}
                onSelectedChange={setSelectedEndpoints}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={updateMutation.isPending}
            >
              {t("common:cancel")}
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending || !name.trim()}
            >
              {updateMutation.isPending
                ? t("common:updating")
                : t("common:save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
