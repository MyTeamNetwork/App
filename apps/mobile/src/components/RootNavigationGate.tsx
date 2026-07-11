import type { ReactNode } from "react";

interface RootNavigationGateProps {
  navigation: ReactNode;
  loading: ReactNode;
  isLoading: boolean;
}

/**
 * Keeps Expo Router's root navigator mounted while launch work finishes.
 * Cold-start intents can therefore resolve immediately; only the visual
 * loading layer is removed once auth and fonts are ready.
 */
export function RootNavigationGate({ navigation, loading, isLoading }: RootNavigationGateProps) {
  return (
    <>
      {navigation}
      {isLoading ? loading : null}
    </>
  );
}
