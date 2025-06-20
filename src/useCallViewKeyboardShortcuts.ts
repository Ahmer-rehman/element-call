/*
Copyright 2022-2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type RefObject, useCallback, useMemo, useRef } from "react";

import { useEventTarget } from "./useEvents";
import {
  type ReactionOption,
  ReactionSet,
  ReactionsRowSize,
} from "./reactions";

/**
 * Determines whether focus is in the same part of the tree as the given
 * element (specifically, if the element or an ancestor of it is focused).
 */
const mayReceiveKeyEvents = (e: HTMLElement): boolean => {
  const focusedElement = document.activeElement;
  return focusedElement !== null && focusedElement.contains(e);
};

const KeyToReactionMap: Record<string, ReactionOption> = Object.fromEntries(
  ReactionSet.slice(0, ReactionsRowSize).map((r, i) => [(i + 1).toString(), r]),
);

export function useCallViewKeyboardShortcuts(
  focusElement: RefObject<HTMLElement | null>,
  toggleMicrophoneMuted: () => void,
  toggleLocalVideoMuted: () => void,
  setMicrophoneMuted: (muted: boolean) => void,
  sendReaction: (reaction: ReactionOption) => void,
  toggleHandRaised: () => void,
): void {
  const spacebarHeld = useRef(false);

  // These event handlers are set on the window because we want users to be able
  // to trigger them without going to the trouble of focusing something

  useEventTarget(
    window,
    "keydown",
    useCallback(
      (event: KeyboardEvent) => {
        if (focusElement.current === null) return;
        if (!mayReceiveKeyEvents(focusElement.current)) return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
          return;

        if (event.key === "m") {
          event.preventDefault();
          toggleMicrophoneMuted();
        } else if (event.key == "v") {
          event.preventDefault();
          toggleLocalVideoMuted();
        } else if (event.key === " ") {
          event.preventDefault();
          if (!spacebarHeld.current) {
            spacebarHeld.current = true;
            setMicrophoneMuted(false);
          }
        } else if (event.key === "h") {
          event.preventDefault();
          toggleHandRaised();
        } else if (KeyToReactionMap[event.key]) {
          event.preventDefault();
          sendReaction(KeyToReactionMap[event.key]);
        }
      },
      [
        focusElement,
        toggleLocalVideoMuted,
        toggleMicrophoneMuted,
        setMicrophoneMuted,
        sendReaction,
        toggleHandRaised,
      ],
    ),
    // Because this is set on the window, to prevent shortcuts from activating
    // another event callback at the same time, we need to preventDefault
    // *before* child elements receive the event by using capture mode
    useMemo(() => ({ capture: true }), []),
  );

  useEventTarget(
    window,
    "keyup",
    useCallback(
      (event: KeyboardEvent) => {
        if (focusElement.current === null) return;
        if (!mayReceiveKeyEvents(focusElement.current)) return;

        if (event.key === " ") {
          spacebarHeld.current = false;
          setMicrophoneMuted(true);
        }
      },
      [focusElement, setMicrophoneMuted],
    ),
  );

  useEventTarget(
    window,
    "blur",
    useCallback(() => {
      if (spacebarHeld.current) {
        spacebarHeld.current = false;
        setMicrophoneMuted(true);
      }
    }, [setMicrophoneMuted, spacebarHeld]),
  );
}
