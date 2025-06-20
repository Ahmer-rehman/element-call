/*
Copyright 2023, 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { type IWidgetApiRequest } from "matrix-widget-api";
import { logger } from "matrix-js-sdk/lib/logger";

import {
  type MediaDeviceHandle,
  useMediaDevices,
} from "../livekit/MediaDevicesContext";
import { useReactiveState } from "../useReactiveState";
import { ElementWidgetActions, widget } from "../widget";
import { Config } from "../config/Config";
import { useUrlParams } from "../UrlParams";

/**
 * If there already are this many participants in the call, we automatically mute
 * the user.
 */
export const MUTE_PARTICIPANT_COUNT = 8;

interface DeviceAvailable {
  enabled: boolean;
  setEnabled: Dispatch<SetStateAction<boolean>>;
}

interface DeviceUnavailable {
  enabled: false;
  setEnabled: null;
}

const deviceUnavailable: DeviceUnavailable = {
  enabled: false,
  setEnabled: null,
};

type MuteState = DeviceAvailable | DeviceUnavailable;

export interface MuteStates {
  audio: MuteState;
  video: MuteState;
}

function useMuteState(
  device: MediaDeviceHandle,
  enabledByDefault: () => boolean,
): MuteState {
  const [enabled, setEnabled] = useReactiveState<boolean | undefined>(
    // Determine the default value once devices are actually connected
    (prev) =>
      prev ?? (device.available.size > 0 ? enabledByDefault() : undefined),
    [device],
  );
  return useMemo(
    () =>
      device.available.size === 0
        ? deviceUnavailable
        : {
            enabled: enabled ?? false,
            setEnabled: setEnabled as Dispatch<SetStateAction<boolean>>,
          },
    [device, enabled, setEnabled],
  );
}

export function useMuteStates(isJoined: boolean): MuteStates {
  const devices = useMediaDevices();

  const { skipLobby } = useUrlParams();

  const audio = useMuteState(devices.audioInput, () => {
    return Config.get().media_devices.enable_audio && !skipLobby && !isJoined;
  });
  const video = useMuteState(
    devices.videoInput,
    () => Config.get().media_devices.enable_video && !skipLobby && !isJoined,
  );

  useEffect(() => {
    widget?.api.transport
      .send(ElementWidgetActions.DeviceMute, {
        audio_enabled: audio.enabled,
        video_enabled: video.enabled,
      })
      .catch((e) =>
        logger.warn("Could not send DeviceMute action to widget", e),
      );
  }, [audio, video]);

  const onMuteStateChangeRequest = useCallback(
    (ev: CustomEvent<IWidgetApiRequest>) => {
      // First copy the current state into our new state.
      const newState = {
        audio_enabled: audio.enabled,
        video_enabled: video.enabled,
      };
      // Update new state if there are any requested changes from the widget action
      // in `ev.detail.data`.
      if (
        ev.detail.data.audio_enabled != null &&
        typeof ev.detail.data.audio_enabled === "boolean"
      ) {
        audio.setEnabled?.(ev.detail.data.audio_enabled);
        newState.audio_enabled = ev.detail.data.audio_enabled;
      }
      if (
        ev.detail.data.video_enabled != null &&
        typeof ev.detail.data.video_enabled === "boolean"
      ) {
        video.setEnabled?.(ev.detail.data.video_enabled);
        newState.video_enabled = ev.detail.data.video_enabled;
      }
      // Always reply with the new (now "current") state.
      // This allows to also use this action to just get the unaltered current state
      // by using a fromWidget request with: `ev.detail.data = {}`
      widget!.api.transport.reply(ev.detail, newState);
    },
    [audio, video],
  );
  useEffect(() => {
    // We setup a event listener for the widget action ElementWidgetActions.DeviceMute.
    if (widget) {
      // only setup the listener in widget mode

      widget.lazyActions.on(
        ElementWidgetActions.DeviceMute,
        onMuteStateChangeRequest,
      );

      return (): void => {
        // return a call to `off` so that we always clean up our listener.
        widget?.lazyActions.off(
          ElementWidgetActions.DeviceMute,
          onMuteStateChangeRequest,
        );
      };
    }
  }, [onMuteStateChangeRequest]);

  return useMemo(() => ({ audio, video }), [audio, video]);
}
