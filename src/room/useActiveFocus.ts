/*
Copyright 2023, 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type MatrixRTCSession,
  MatrixRTCSessionEvent,
} from "matrix-js-sdk/lib/matrixrtc";
import { useCallback, useEffect, useState } from "react";
import { deepCompare } from "matrix-js-sdk/lib/utils";
import { logger } from "matrix-js-sdk/lib/logger";
import { type LivekitFocus, isLivekitFocus } from "matrix-js-sdk/lib/matrixrtc";

/**
 * Gets the currently active (livekit) focus for a MatrixRTC session
 * This logic is specific to livekit foci where the whole call must use one
 * and the same focus.
 */
export function useActiveLivekitFocus(
  rtcSession: MatrixRTCSession,
): LivekitFocus | undefined {
  const [activeFocus, setActiveFocus] = useState(() => {
    const f = rtcSession.getActiveFocus();
    // Only handle foci with type="livekit" for now.
    return !!f && isLivekitFocus(f) ? f : undefined;
  });

  const onMembershipsChanged = useCallback(() => {
    const newActiveFocus = rtcSession.getActiveFocus();
    if (!!newActiveFocus && !isLivekitFocus(newActiveFocus)) return;
    if (!deepCompare(activeFocus, newActiveFocus)) {
      const oldestMembership = rtcSession.getOldestMembership();
      logger.warn(
        `Got new active focus from membership: ${oldestMembership?.sender}/${oldestMembership?.deviceId}.
        Updating focus (focus switch) from ${JSON.stringify(activeFocus)} to ${JSON.stringify(newActiveFocus)}`,
      );
      setActiveFocus(newActiveFocus);
    }
  }, [activeFocus, rtcSession]);

  useEffect(() => {
    rtcSession.on(
      MatrixRTCSessionEvent.MembershipsChanged,
      onMembershipsChanged,
    );

    return (): void => {
      rtcSession.off(
        MatrixRTCSessionEvent.MembershipsChanged,
        onMembershipsChanged,
      );
    };
  });

  return activeFocus;
}
