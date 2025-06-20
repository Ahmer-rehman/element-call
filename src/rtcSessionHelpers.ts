/*
Copyright 2023, 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type MatrixRTCSession } from "matrix-js-sdk/lib/matrixrtc";
import { logger } from "matrix-js-sdk/lib/logger";
import {
  isLivekitFocus,
  isLivekitFocusConfig,
  type LivekitFocus,
  type LivekitFocusActive,
} from "matrix-js-sdk/lib/matrixrtc";
import { AutoDiscovery } from "matrix-js-sdk/lib/autodiscovery";

import { PosthogAnalytics } from "./analytics/PosthogAnalytics";
import { Config } from "./config/Config";
import { ElementWidgetActions, widget, type WidgetHelpers } from "./widget";
import { MatrixRTCFocusMissingError } from "./utils/errors.ts";
import { getUrlParams } from "./UrlParams.ts";

const FOCI_WK_KEY = "org.matrix.msc4143.rtc_foci";

export function makeActiveFocus(): LivekitFocusActive {
  return {
    type: "livekit",
    focus_selection: "oldest_membership",
  };
}

async function makePreferredLivekitFoci(
  rtcSession: MatrixRTCSession,
  livekitAlias: string,
): Promise<LivekitFocus[]> {
  logger.log("Start building foci_preferred list: ", rtcSession.room.roomId);

  const preferredFoci: LivekitFocus[] = [];

  // Make the Focus from the running rtc session the highest priority one
  // This minimizes how often we need to switch foci during a call.
  const focusInUse = rtcSession.getFocusInUse();
  if (focusInUse && isLivekitFocus(focusInUse)) {
    logger.log("Adding livekit focus from oldest member: ", focusInUse);
    preferredFoci.push(focusInUse);
  }

  // Prioritize the .well-known/matrix/client, if available, over the configured SFU
  const domain = rtcSession.room.client.getDomain();
  if (domain) {
    // we use AutoDiscovery instead of relying on the MatrixClient having already
    // been fully configured and started
    const wellKnownFoci = (await AutoDiscovery.getRawClientConfig(domain))?.[
      FOCI_WK_KEY
    ];
    if (Array.isArray(wellKnownFoci)) {
      preferredFoci.push(
        ...wellKnownFoci
          .filter((f) => !!f)
          .filter(isLivekitFocusConfig)
          .map((wellKnownFocus) => {
            logger.log(
              "Adding livekit focus from well known: ",
              wellKnownFocus,
            );
            return { ...wellKnownFocus, livekit_alias: livekitAlias };
          }),
      );
    }
  }

  const urlFromConf = Config.get().livekit?.livekit_service_url;
  if (urlFromConf) {
    const focusFormConf: LivekitFocus = {
      type: "livekit",
      livekit_service_url: urlFromConf,
      livekit_alias: livekitAlias,
    };
    logger.log("Adding livekit focus from config: ", focusFormConf);
    preferredFoci.push(focusFormConf);
  }

  if (preferredFoci.length === 0)
    throw new MatrixRTCFocusMissingError(domain ?? "");
  return Promise.resolve(preferredFoci);

  // TODO: we want to do something like this:
  //
  // const focusOtherMembers = await focusFromOtherMembers(
  //   rtcSession,
  //   livekitAlias,
  // );
  // if (focusOtherMembers) preferredFoci.push(focusOtherMembers);
}

export async function enterRTCSession(
  rtcSession: MatrixRTCSession,
  encryptMedia: boolean,
  useNewMembershipManager = true,
  useExperimentalToDeviceTransport = false,
): Promise<void> {
  PosthogAnalytics.instance.eventCallEnded.cacheStartCall(new Date());
  PosthogAnalytics.instance.eventCallStarted.track(rtcSession.room.roomId);

  // This must be called before we start trying to join the call, as we need to
  // have started tracking by the time calls start getting created.
  // groupCallOTelMembership?.onJoinCall();

  // right now we assume everything is a room-scoped call
  const livekitAlias = rtcSession.room.roomId;
  const { features, matrix_rtc_session: matrixRtcSessionConfig } = Config.get();
  const useDeviceSessionMemberEvents =
    features?.feature_use_device_session_member_events;
  rtcSession.joinRoomSession(
    await makePreferredLivekitFoci(rtcSession, livekitAlias),
    makeActiveFocus(),
    {
      useNewMembershipManager,
      manageMediaKeys: encryptMedia,
      ...(useDeviceSessionMemberEvents !== undefined && {
        useLegacyMemberEvents: !useDeviceSessionMemberEvents,
      }),
      delayedLeaveEventDelayMs:
        matrixRtcSessionConfig?.membership_server_side_expiry_timeout,
      networkErrorRetryMs: matrixRtcSessionConfig?.membership_keep_alive_period,
      makeKeyDelay: matrixRtcSessionConfig?.key_rotation_on_leave_delay,
      useExperimentalToDeviceTransport,
    },
  );
  if (widget) {
    try {
      await widget.api.transport.send(ElementWidgetActions.JoinCall, {});
    } catch (e) {
      logger.error("Failed to send join action", e);
    }
  }
}

const widgetPostHangupProcedure = async (
  widget: WidgetHelpers,
  cause: "user" | "error",
  promiseBeforeHangup?: Promise<unknown>,
): Promise<void> => {
  try {
    await widget.api.setAlwaysOnScreen(false);
  } catch (e) {
    logger.error("Failed to set call widget `alwaysOnScreen` to false", e);
  }

  // Wait for any last bits before hanging up.
  await promiseBeforeHangup;
  // We send the hangup event after the memberships have been updated
  // calling leaveRTCSession.
  // We need to wait because this makes the client hosting this widget killing the IFrame.
  try {
    await widget.api.transport.send(ElementWidgetActions.HangupCall, {});
  } catch (e) {
    logger.error("Failed to send hangup action", e);
  }
  // On a normal user hangup we can shut down and close the widget. But if an
  // error occurs we should keep the widget open until the user reads it.
  if (cause === "user" && !getUrlParams().returnToLobby) {
    try {
      await widget.api.transport.send(ElementWidgetActions.Close, {});
    } catch (e) {
      logger.error("Failed to send close action", e);
    }
    widget.api.transport.stop();
  }
};

export async function leaveRTCSession(
  rtcSession: MatrixRTCSession,
  cause: "user" | "error",
  promiseBeforeHangup?: Promise<unknown>,
): Promise<void> {
  await rtcSession.leaveRoomSession();
  if (widget) {
    await widgetPostHangupProcedure(widget, cause, promiseBeforeHangup);
  } else {
    await promiseBeforeHangup;
  }
}
