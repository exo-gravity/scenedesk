import { useState, type KeyboardEvent, type MouseEvent } from "react";

/**
 * Controlled state for a Mantine Popover whose trigger keeps keyboard focus.
 * Mantine only closes on Escape from inside the dropdown; when the dropdown has
 * nothing focusable (all fields disabled) focus stays on the trigger, and the
 * key would otherwise fall through to whatever owns the trigger, such as the
 * canvas creation panel, which would close itself instead. This closes the
 * popover first and stops the key there.
 */
export function useEscapablePopover() {
  const [opened, setOpened] = useState(false);
  return {
    opened,
    onChange: setOpened,
    targetProps: {
      onClick: (_event: MouseEvent) => setOpened((value) => !value),
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "Escape" && opened) {
          event.preventDefault();
          event.stopPropagation();
          setOpened(false);
        }
      },
    },
  };
}
