/**
 * The shot list's selection model. It exists so "what does a click do" is answered
 * once instead of once per list.
 *
 * Focus is the single shot whose detail pane is on screen. There is no batch set:
 * the product has no batch action over shots, so a click only moves focus, and a
 * selection nobody can act on would be state without a purpose.
 */
export type ListSelection = {
  /** The shot whose detail is on screen. Absent when the list is untouched. */
  focused?: string | undefined;
};

/** A list that has not been touched yet: nothing focused. */
export const emptySelection: ListSelection = {};

/** The single entry point a list row uses, so every list behaves the same. */
export function applyClick(state: ListSelection, id: string): ListSelection {
  return { ...state, focused: id };
}

export function isFocused(state: ListSelection, id: string) {
  return state.focused === id;
}
