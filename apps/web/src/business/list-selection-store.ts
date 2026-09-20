import { emptySelection, type ListSelection } from "./list-selection.js";

/**
 * A batch selection has to outlive the view it was made in. Opening a candidate
 * navigates to that candidate's own URL, so the surface is re-rendered and can be
 * replaced; holding the selection in a component would tie the set the user is
 * building to the lifetime of one render tree.
 *
 * This store is therefore the state itself rather than a mirror of it: components
 * subscribe with `useSyncExternalStore`, so a write is visible immediately and
 * there is no second copy to fall out of step.
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
