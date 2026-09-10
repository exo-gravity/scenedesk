import { lazy, Suspense, useSyncExternalStore } from "react";
import { MantineProvider } from "@mantine/core";
import { theme, cssVariablesResolver } from "./theme/theme";
import App from "./App";

const BusinessApp = lazy(() => import("./business/BusinessApp"));
const subscribe = (changed: () => void) => {
  window.addEventListener("hashchange", changed);
  return () => window.removeEventListener("hashchange", changed);
};
export default function Root() {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  const business =
    !hash || hash.startsWith("#/app") || hash.startsWith("#/invitation");
  return (
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      forceColorScheme={business ? "light" : "dark"}
    >
      {business ? (
        <Suspense fallback={<p>正在打开工作室…</p>}>
          <BusinessApp hash={hash} />
        </Suspense>
      ) : (
        <App />
      )}
    </MantineProvider>
  );
}
