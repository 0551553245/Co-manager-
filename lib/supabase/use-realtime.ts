"use client";

import { useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

// comanager-conventions Real-Time Rules, all enforced here so no page has
// to remember them individually:
// - callback passed to .on() must be a SYNCHRONOUS wrapper, never `async
//   () => await fetchData()` — onChangeRef.current() is sync, the function
//   it points to may be async internally.
// - channel name must include a unique identifier — caller passes it in.
// - cleanup via supabase.removeChannel() on unmount.
// RLS already scopes which rows postgres_changes delivers to this client,
// so subscribing to a whole table (no extra filter) still only surfaces
// changes the caller's role/branch/owner is allowed to see.
export function useRealtimeTable(
  client: SupabaseClient,
  channelName: string,
  table: string,
  onChange: () => void,
) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const channel = client
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table }, () => {
        onChangeRef.current();
      })
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, channelName, table]);
}
