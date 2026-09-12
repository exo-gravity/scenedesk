import { lazy, Suspense, useSyncExternalStore } from "react";
import { MantineProvider } from "@mantine/core";
import { theme, cssVariablesResolver } from "./theme/theme";
// Design studies stay available for an explicit review build. Normal builds
// never route visitors into in-memory prototype production facts.
const DesignApp =
  import.meta.env.VITE_ENABLE_DESIGN_PREVIEWS === "true"
    ? lazy(() => import("./App"))
    : null;

const BusinessApp = lazy(() => import("./business/BusinessApp"));
const subscribe = (changed: () => void) => {
  window.addEventListener("hashchange", changed);
  return () => window.removeEventListener("hashchange", changed);
};
export default function Root() {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  const businessRoute =
    /^#\/app(?:[/?]|$)/.test(hash) || /^#\/invitation(?:[?]|$)/.test(hash);
  const business = !DesignApp || !hash || businessRoute;
  const businessHash = businessRoute ? hash : "#/app";
  return (
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      defaultColorScheme="light"
      {...(!business ? { forceColorScheme: "dark" as const } : {})}
    >
      {business ? (
        <Suspense fallback={<p>正在打开创作工作台…</p>}>
          <BusinessApp hash={businessHash} />
        </Suspense>
      ) : (
        <Suspense fallback={<p>正在打开设计评审…</p>}>
          {DesignApp && <DesignApp />}
        </Suspense>
      )}
    </MantineProvider>
  );
}
