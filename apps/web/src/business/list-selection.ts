/**
 * One selection model for the lists that offer batch actions: the shot list and a
 * shot's candidate list. It exists so "what does a click do" is answered once for
 * both instead of once each. The canvas node list keeps its own model, which is
 * also selection-by-default because its nodes are dragged and grouped.
 *
 * Focus and selection are deliberately separate. Focus is the single object a
 * detail pane is showing; selection is the set a batch action would apply to.
 * Collapsing them would either blank the pane as soon as a second object is
 * selected, or make every batch action depend on the pane's contents.
 */
export type ListSelection = {
  /** The object whose detail is on screen. Absent when the list is untouched. */
  focused?: string | undefined;
  /** The objects a batch action applies to, in the order they were added. */
  selected: readonly string[];
};

export type ClickModifiers = {
  /** Shift, Control or Meta: extend or reduce the selection instead of replacing it. */
  extend?: boolean | undefined;
};

/** A list that has not been touched yet: nothing focused, nothing selected. */
export const emptySelection: ListSelection = { selected: [] };

export function focusOnly(id: string): ListSelection {
  return { focused: id, selected: [id] };
}

/**
 * A modifier click toggles membership. Focus is left alone: removing the object
 * you are looking at must not blank its pane, and looking at one object while
 * acting on others is a legitimate state.
 */
export function toggleSelection(
  state: ListSelection,
  id: string,
): ListSelection {
  const selected = state.selected.includes(id)
    ? state.selected.filter((item) => item !== id)
    : [...state.selected, id];
  return { ...state, selected };
}

/**
 * The single entry point a list row uses, so every list behaves the same.
 *
 * A plain click only moves focus. It deliberately leaves the batch set alone:
 * looking at one more object is not a request to act on it, and on a list whose
 * rows navigate, replacing the set on every click would throw away the selection
 * the moment the user checks one of the things they selected.
 */
export function applyClick(
  state: ListSelection,
  id: string,
  modifiers: ClickModifiers = {},
): ListSelection {
  return modifiers.extend
    ? toggleSelection(state, id)
    : { ...state, focused: id };
}

export function selectOnly(state: ListSelection, ids: readonly string[]) {
  return { ...state, selected: [...ids] };
}

export function clearSelection(state: ListSelection): ListSelection {
  return { ...state, selected: [] };
}

export function isFocused(state: ListSelection, id: string) {
  return state.focused === id;
}

export function isSelected(state: ListSelection, id: string) {
  return state.selected.includes(id);
}

/**
 * Batch actions run in list order, not click order, so what a batch does is
 * reproducible from the list the user is looking at. Ids the list no longer
 * contains are dropped rather than acted on.
 */
export function batchTargets(
  state: ListSelection,
  ordered: readonly string[],
): string[] {
  return ordered.filter((id) => state.selected.includes(id));
}

/** Whether a batch action over the current list order has anything to do. */
export function hasBatch(state: ListSelection, ordered: readonly string[]) {
  return batchTargets(state, ordered).length > 1;
}
