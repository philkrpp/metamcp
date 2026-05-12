"use client";

import { format } from "date-fns";
import { History, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";

function displayValue(value: string | null | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

export default function AuditLogsPage() {
  const { t } = useTranslations();
  const auditLogsQuery = trpc.frontend.mcpRequestAuditLogs.list.useQuery({
    limit: 100,
  });

  const logs = auditLogsQuery.data?.logs ?? [];

  const handleRefresh = async () => {
    try {
      await auditLogsQuery.refetch();
      toast.success(t("audit-logs:refreshSuccess"));
    } catch (_error) {
      toast.error(t("audit-logs:refreshError"));
    }
  };

  const formatTimestamp = (timestamp: Date | string) => {
    return format(new Date(timestamp), "yyyy-MM-dd HH:mm:ss");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <History className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {t("audit-logs:title")}
            </h1>
            <p className="text-muted-foreground">{t("audit-logs:subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {t("audit-logs:showing", { count: logs.length })}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={auditLogsQuery.isFetching}
          >
            <RefreshCw
              className={`h-4 w-4 ${auditLogsQuery.isFetching ? "animate-spin" : ""}`}
            />
            {t("common:refresh")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("audit-logs:requestAudit")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("audit-logs:timestamp")}</TableHead>
                  <TableHead>{t("audit-logs:apiKey")}</TableHead>
                  <TableHead>{t("audit-logs:endpoint")}</TableHead>
                  <TableHead>{t("audit-logs:namespace")}</TableHead>
                  <TableHead>{t("audit-logs:mcpServer")}</TableHead>
                  <TableHead>{t("audit-logs:tool")}</TableHead>
                  <TableHead>{t("common:status")}</TableHead>
                  <TableHead>{t("audit-logs:duration")}</TableHead>
                  <TableHead>{t("audit-logs:error")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogsQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12">
                      {t("audit-logs:loading")}
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12">
                      <div className="flex flex-col items-center gap-2">
                        <History className="h-8 w-8 text-muted-foreground" />
                        <p className="text-muted-foreground">
                          {t("audit-logs:empty")}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.uuid}>
                      <TableCell className="font-mono text-xs">
                        {formatTimestamp(log.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">
                            {displayValue(
                              log.api_key_name,
                              log.auth_method === "oauth"
                                ? "OAuth"
                                : t("audit-logs:unknown"),
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {log.auth_method}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        {log.endpoint_name}
                      </TableCell>
                      <TableCell>
                        {displayValue(
                          log.namespace_name,
                          log.namespace_uuid ?? t("audit-logs:unknown"),
                        )}
                      </TableCell>
                      <TableCell>
                        {displayValue(
                          log.mcp_server_name,
                          log.mcp_server_uuid ?? t("audit-logs:unknown"),
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.tool_name}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            log.status === "SUCCESS" ? "default" : "secondary"
                          }
                          className={
                            log.status === "SUCCESS"
                              ? "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-200 border-green-200 dark:border-green-800"
                              : "bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800"
                          }
                        >
                          {log.status === "SUCCESS"
                            ? t("audit-logs:success")
                            : t("audit-logs:failed")}
                        </Badge>
                      </TableCell>
                      <TableCell>{log.duration_ms} ms</TableCell>
                      <TableCell className="max-w-[260px] truncate">
                        {log.error_message ?? t("audit-logs:none")}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
