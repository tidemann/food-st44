import { DOCUMENT } from '@angular/common';
import { inject, signal, type Signal } from '@angular/core';

/** The MCP server's address on this site (ST-833): what an assistant is pointed at. */
export function mcpAddress(): string {
  return `${inject(DOCUMENT).location.origin}/api/mcp`;
}

/**
 * A copy button's state: `copy(text)` puts the text on the clipboard and `copied()` is true
 * until the next copy, so the button can say «Kopiert». Built in an injection context.
 */
export function copier(): { copied: Signal<boolean>; copy: (text: string) => Promise<void> } {
  const clipboard = inject(DOCUMENT).defaultView?.navigator.clipboard;
  const copied = signal(false);
  return {
    copied: copied.asReadonly(),
    copy: async (text: string) => {
      copied.set(false);
      if (!clipboard) return;
      try {
        await clipboard.writeText(text);
        copied.set(true);
      } catch {
        // No permission: the text is on screen to select by hand.
      }
    },
  };
}
