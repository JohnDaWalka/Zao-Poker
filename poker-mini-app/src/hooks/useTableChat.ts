"use client";

import { getApiUrl } from "~/lib/env";
import { useCallback, useEffect, useState } from "react";
import type { UniversalUser } from "~/types/universal";

export type TableChatMessage = {
  id: number;
  tableId: string;
  fid: number;
  username: string;
  pfpUrl: string;
  isBot: boolean;
  message: string;
  createdAt: string;
};

type TableChatResponse = {
  success: boolean;
  messages: TableChatMessage[];
  mutedFids?: number[];
};

type TableChatPostResponse = {
  success: boolean;
  message: TableChatMessage;
  error?: string;
};

export function useTableChat(tableId: string | null, viewerFid?: number) {
  const [messages, setMessages] = useState<TableChatMessage[]>([]);
  const [mutedFids, setMutedFids] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [sending, setSending] = useState(false);
  const [moderating, setModerating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInitialized(false);
  }, [tableId]);

  const refresh = useCallback(async (viewerFid?: number, signal?: AbortSignal) => {
    if (!tableId) {
      setMessages([]);
      setMutedFids([]);
      setInitialized(false);
      setLoading(false);
      setError(null);
      return;
    }

    if (!initialized) {
      setLoading(true);
    }
    try {
      const response = await fetch(getApiUrl(`/api/table/chat?table_id=${encodeURIComponent(tableId)}&limit=50${
          Number.isSafeInteger(viewerFid) ? `&fid=${encodeURIComponent(String(viewerFid))}` : ""
        }`),
        { cache: "no-store", signal },
      );
      const data = (await response.json()) as TableChatResponse & { error?: string };

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to load table chat.");
      }

      setMessages(data.messages ?? []);
      setMutedFids((data.mutedFids ?? []).filter(Number.isSafeInteger));
      setInitialized(true);
      setError(null);
    } catch (caughtError) {
      if (signal?.aborted) {
        return;
      }

      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load table chat.",
      );
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [initialized, tableId]);

  useEffect(() => {
    const abortController = new AbortController();
    void refresh(viewerFid, abortController.signal);

    if (!tableId) {
      return () => abortController.abort();
    }

    const interval = setInterval(() => {
      void refresh(viewerFid);
    }, 4000);

    return () => {
      abortController.abort();
      clearInterval(interval);
    };
  }, [refresh, tableId, viewerFid]);

  const sendMessage = useCallback(async (user: UniversalUser, message: string) => {
    if (!tableId) {
      throw new Error("A table is required to send chat.");
    }

    setSending(true);
    try {
      const response = await fetch(getApiUrl("/api/table/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table_id: tableId,
          fid: user.fid,
          message,
        }),
      });
      const data = (await response.json()) as TableChatPostResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to send chat message.");
      }

      setMessages((current) => [...current, data.message]);
      setError(null);
      return data.message;
    } catch (caughtError) {
      const nextError =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to send chat message.";
      setError(nextError);
      throw new Error(nextError);
    } finally {
      setSending(false);
    }
  }, [tableId]);

  const updateModeration = useCallback(async (
    user: UniversalUser,
    payload: {
      action: "mute" | "unmute" | "report";
      targetFid: number;
      messageId?: number;
    },
  ) => {
    if (!tableId) {
      throw new Error("A table is required to moderate chat.");
    }

    setModerating(payload.targetFid);
    try {
      const response = await fetch(getApiUrl("/api/table/chat/moderation"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table_id: tableId,
          fid: user.fid,
          target_fid: payload.targetFid,
          message_id: payload.messageId,
          action: payload.action,
        }),
      });
      const data = (await response.json()) as {
        success: boolean;
        mutedFids?: number[];
        error?: string;
      };

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to update chat moderation.");
      }

      if (payload.action === "mute" || payload.action === "unmute") {
        setMutedFids((data.mutedFids ?? []).filter(Number.isSafeInteger));
      }

      setError(null);
    } catch (caughtError) {
      const nextError =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to update chat moderation.";
      setError(nextError);
      throw new Error(nextError);
    } finally {
      setModerating(null);
    }
  }, [tableId]);

  return {
    messages,
    mutedFids,
    loading,
    sending,
    moderating,
    error,
    refresh,
    sendMessage,
    mutePlayer: (user: UniversalUser, targetFid: number) =>
      updateModeration(user, { action: "mute", targetFid }),
    unmutePlayer: (user: UniversalUser, targetFid: number) =>
      updateModeration(user, { action: "unmute", targetFid }),
    reportMessage: (user: UniversalUser, messageId: number, targetFid: number) =>
      updateModeration(user, { action: "report", targetFid, messageId }),
  };
}
