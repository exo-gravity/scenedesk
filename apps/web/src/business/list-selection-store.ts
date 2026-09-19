import { emptySelection, type ListSelection } from "./list-selection.js";

/**
 * A batch selection has to outlive the view it was made in. Opening a candidate
 * navigates to that candidate's own URL, which unmounts and remounts the surface
 * holding the selection — so keeping it in component state loses everything the
 * user picked the moment they look at one of the things they picked.
 *
 * This store is therefore the state itself rather than a mirror of it: components
 * subscribe with `useSyncExternalStore`, so a write is visible immediately even if
 * the component that wrote it is being replaced.
 *
 * It is deliberately not durable storage: a selection is view state for the
 * current tab, so it lives as long as the document does and no longer.
 */
const selections = new Map<string, ListSelection>();
const listeners = new Set<() => void>();

export function readSelection(key: string): ListSelection {
  return selections.get(key) ?? emptySelection;
}

export function writeSelection(key: string, value: ListSelection): void {
  if (value.selected.length || value.focused)
    selections.set(key, {
      ...(value.focused ? { focused: value.focused } : {}),
      selected: [...value.selected],
    });
  else selections.delete(key);
  for (const listener of listeners) listener();
}

export function subscribeSelections(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Drops every selection a key prefix owns; used when its subject disappears. */
export function forgetSelections(prefix: string): void {
  let changed = false;
  for (const key of [...selections.keys()])
    if (key.startsWith(prefix)) {
      selections.delete(key);
      changed = true;
    }
  if (changed) for (const listener of listeners) listener();
}
