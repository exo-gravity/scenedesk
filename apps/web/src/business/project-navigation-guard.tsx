import { createContext, useContext, useRef, type ReactNode } from "react";
type Guard = (destination: string) => Promise<void>;
const Context = createContext<{ current: Guard | undefined }>({
  current: undefined,
});
export function ProjectNavigationGuard({ children }: { children: ReactNode }) {
  const guard = useRef<Guard | undefined>(undefined);
  return <Context.Provider value={guard}>{children}</Context.Provider>;
}
export function useProjectNavigationGuard() {
  return useContext(Context);
}
