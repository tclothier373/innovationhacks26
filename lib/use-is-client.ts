import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/** True after client hydration; false on the server. */
export function useIsClient(): boolean {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}
