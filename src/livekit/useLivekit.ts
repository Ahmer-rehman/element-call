/*
Copyright 2023, 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  ConnectionState,
  type E2EEManagerOptions,
  ExternalE2EEKeyProvider,
  LocalVideoTrack,
  Room,
  type RoomOptions,
  Track,
} from "livekit-client";
import { useEffect, useMemo, useRef } from "react";
import E2EEWorker from "livekit-client/e2ee-worker?worker";
import { logger } from "matrix-js-sdk/lib/logger";
import { type MatrixRTCSession } from "matrix-js-sdk/lib/matrixrtc";
import { useObservable, useObservableEagerState } from "observable-hooks";
import { map } from "rxjs";

import { defaultLiveKitOptions } from "./options";
import { type SFUConfig } from "./openIDSFU";
import { type MuteStates } from "../room/MuteStates";
import {
  type MediaDeviceHandle,
  type MediaDevices,
  useMediaDevices,
} from "./MediaDevicesContext";
import {
  type ECConnectionState,
  useECConnectionState,
} from "./useECConnectionState";
import { MatrixKeyProvider } from "../e2ee/matrixKeyProvider";
import { E2eeType } from "../e2ee/e2eeType";
import { type EncryptionSystem } from "../e2ee/sharedKeyManagement";
import {
  useTrackProcessor,
  useTrackProcessorSync,
} from "./TrackProcessorContext";
import { useInitial } from "../useInitial";
import { observeTrackReference$ } from "../state/MediaViewModel";
import { useUrlParams } from "../UrlParams";

interface UseLivekitResult {
  livekitRoom?: Room;
  connState: ECConnectionState;
}

export function useLivekit(
  rtcSession: MatrixRTCSession,
  muteStates: MuteStates,
  sfuConfig: SFUConfig | undefined,
  e2eeSystem: EncryptionSystem,
): UseLivekitResult {
  const { controlledAudioDevices } = useUrlParams();

  const e2eeOptions = useMemo((): E2EEManagerOptions | undefined => {
    if (e2eeSystem.kind === E2eeType.NONE) return undefined;

    if (e2eeSystem.kind === E2eeType.PER_PARTICIPANT) {
      logger.info("Created MatrixKeyProvider (per participant)");
      return {
        keyProvider: new MatrixKeyProvider(),
        worker: new E2EEWorker(),
      };
    } else if (e2eeSystem.kind === E2eeType.SHARED_KEY && e2eeSystem.secret) {
      logger.info("Created ExternalE2EEKeyProvider (shared key)");

      return {
        keyProvider: new ExternalE2EEKeyProvider(),
        worker: new E2EEWorker(),
      };
    }
  }, [e2eeSystem]);

  useEffect(() => {
    if (e2eeSystem.kind === E2eeType.NONE || !e2eeOptions) return;

    if (e2eeSystem.kind === E2eeType.PER_PARTICIPANT) {
      (e2eeOptions.keyProvider as MatrixKeyProvider).setRTCSession(rtcSession);
    } else if (e2eeSystem.kind === E2eeType.SHARED_KEY && e2eeSystem.secret) {
      (e2eeOptions.keyProvider as ExternalE2EEKeyProvider)
        .setKey(e2eeSystem.secret)
        .catch((e) => {
          logger.error("Failed to set shared key for E2EE", e);
        });
    }
  }, [e2eeOptions, e2eeSystem, rtcSession]);

  const initialMuteStates = useRef<MuteStates>(muteStates);
  const devices = useMediaDevices();
  const initialDevices = useRef<MediaDevices>(devices);

  const { processor } = useTrackProcessor();
  const initialProcessor = useInitial(() => processor);
  const roomOptions = useMemo(
    (): RoomOptions => ({
      ...defaultLiveKitOptions,
      videoCaptureDefaults: {
        ...defaultLiveKitOptions.videoCaptureDefaults,
        deviceId: initialDevices.current.videoInput.selectedId,
        processor: initialProcessor,
      },
      audioCaptureDefaults: {
        ...defaultLiveKitOptions.audioCaptureDefaults,
        deviceId: initialDevices.current.audioInput.selectedId,
      },
      audioOutput: {
        deviceId: initialDevices.current.audioOutput.selectedId,
      },
      e2ee: e2eeOptions,
    }),
    [e2eeOptions, initialProcessor],
  );

  // Store if audio/video are currently updating. If to prohibit unnecessary calls
  // to setMicrophoneEnabled/setCameraEnabled
  const audioMuteUpdating = useRef(false);
  const videoMuteUpdating = useRef(false);
  // Store the current button mute state that gets passed to this hook via props.
  // We need to store it for awaited code that relies on the current value.
  const buttonEnabled = useRef({
    audio: initialMuteStates.current.audio.enabled,
    video: initialMuteStates.current.video.enabled,
  });

  // We have to create the room manually here due to a bug inside
  // @livekit/components-react. JSON.stringify() is used in deps of a
  // useEffect() with an argument that references itself, if E2EE is enabled
  const room = useMemo(() => {
    logger.info("[LivekitRooms] Create LiveKit room with options", roomOptions);
    const r = new Room(roomOptions);
    r.setE2EEEnabled(e2eeSystem.kind !== E2eeType.NONE).catch((e) => {
      logger.error("Failed to set E2EE enabled on room", e);
    });
    return r;
  }, [roomOptions, e2eeSystem]);

  // Sync the requested track processors with LiveKit
  useTrackProcessorSync(
    useObservableEagerState(
      useObservable(
        (room$) =>
          observeTrackReference$(
            room$.pipe(map(([room]) => room.localParticipant)),
            Track.Source.Camera,
          ).pipe(
            map((trackRef) => {
              const track = trackRef?.publication?.track;
              return track instanceof LocalVideoTrack ? track : null;
            }),
          ),
        [room],
      ),
    ),
  );

  const connectionState = useECConnectionState(
    initialDevices.current.audioInput.selectedId,
    initialMuteStates.current.audio.enabled,
    room,
    sfuConfig,
  );

  useEffect(() => {
    // Sync the requested mute states with LiveKit's mute states. We do it this
    // way around rather than using LiveKit as the source of truth, so that the
    // states can be consistent throughout the lobby and loading screens.
    // It's important that we only do this in the connected state, because
    // LiveKit's internal mute states aren't consistent during connection setup,
    // and setting tracks to be enabled during this time causes errors.
    if (room !== undefined && connectionState === ConnectionState.Connected) {
      const participant = room.localParticipant;
      // Always update the muteButtonState Ref so that we can read the current
      // state in awaited blocks.
      buttonEnabled.current = {
        audio: muteStates.audio.enabled,
        video: muteStates.video.enabled,
      };

      enum MuteDevice {
        Microphone,
        Camera,
      }

      const syncMuteState = async (
        iterCount: number,
        type: MuteDevice,
      ): Promise<void> => {
        // The approach for muting is to always bring the actual livekit state in sync with the button
        // This allows for a very predictable and reactive behavior for the user.
        // (the new state is the old state when pressing the button n times (where n is even))
        // (the new state is different to the old state when pressing the button n times (where n is uneven))
        // In case there are issues with the device there might be situations where setMicrophoneEnabled/setCameraEnabled
        // return immediately. This should be caught with the Error("track with new mute state could not be published").
        // For now we are still using an iterCount to limit the recursion loop to 10.
        // This could happen if the device just really does not want to turn on (hardware based issue)
        // but the mute button is in unmute state.
        // For now our fail mode is to just stay in this state.
        // TODO: decide for a UX on how that fail mode should be treated (disable button, hide button, sync button back to muted without user input)

        if (iterCount > 10) {
          logger.error(
            "Stop trying to sync the input device with current mute state after 10 failed tries",
          );
          return;
        }
        let devEnabled;
        let btnEnabled;
        let updating;
        switch (type) {
          case MuteDevice.Microphone:
            devEnabled = participant.isMicrophoneEnabled;
            btnEnabled = buttonEnabled.current.audio;
            updating = audioMuteUpdating.current;
            break;
          case MuteDevice.Camera:
            devEnabled = participant.isCameraEnabled;
            btnEnabled = buttonEnabled.current.video;
            updating = videoMuteUpdating.current;
            break;
        }
        if (devEnabled !== btnEnabled && !updating) {
          try {
            let trackPublication;
            switch (type) {
              case MuteDevice.Microphone:
                audioMuteUpdating.current = true;
                trackPublication = await participant.setMicrophoneEnabled(
                  buttonEnabled.current.audio,
                  room.options.audioCaptureDefaults,
                );
                audioMuteUpdating.current = false;
                break;
              case MuteDevice.Camera:
                videoMuteUpdating.current = true;
                trackPublication = await participant.setCameraEnabled(
                  buttonEnabled.current.video,
                  room.options.videoCaptureDefaults,
                );
                videoMuteUpdating.current = false;
                break;
            }

            if (trackPublication) {
              // await participant.setMicrophoneEnabled can return immediately in some instances,
              // so that participant.isMicrophoneEnabled !== buttonEnabled.current.audio still holds true.
              // This happens if the device is still in a pending state
              // "sleeping" here makes sure we let react do its thing so that participant.isMicrophoneEnabled is updated,
              // so we do not end up in a recursion loop.
              await new Promise((r) => setTimeout(r, 100));

              // track got successfully changed to mute/unmute
              // Run the check again after the change is done. Because the user
              // can update the state (presses mute button) while the device is enabling
              // itself we need might need to update the mute state right away.
              // This async recursion makes sure that setCamera/MicrophoneEnabled is
              // called as little times as possible.
              await syncMuteState(iterCount + 1, type);
            } else {
              throw new Error(
                "track with new mute state could not be published",
              );
            }
          } catch (e) {
            if ((e as DOMException).name === "NotAllowedError") {
              logger.error(
                "Fatal error while syncing mute state: resetting",
                e,
              );
              if (type === MuteDevice.Microphone) {
                audioMuteUpdating.current = false;
                muteStates.audio.setEnabled?.(false);
              } else {
                videoMuteUpdating.current = false;
                muteStates.video.setEnabled?.(false);
              }
            } else {
              logger.error(
                "Failed to sync audio mute state with LiveKit (will retry to sync in 1s):",
                e,
              );
              setTimeout(() => {
                syncMuteState(iterCount + 1, type).catch((e) => {
                  logger.error(
                    `Failed to sync ${MuteDevice[type]} mute state with LiveKit iterCount=${iterCount + 1}`,
                    e,
                  );
                });
              }, 1000);
            }
          }
        }
      };

      syncMuteState(0, MuteDevice.Microphone).catch((e) => {
        logger.error("Failed to sync audio mute state with LiveKit", e);
      });
      syncMuteState(0, MuteDevice.Camera).catch((e) => {
        logger.error("Failed to sync video mute state with LiveKit", e);
      });
    }
  }, [room, muteStates, connectionState]);

  useEffect(() => {
    // Sync the requested devices with LiveKit's devices
    if (
      room !== undefined &&
      connectionState === ConnectionState.Connected &&
      !controlledAudioDevices
    ) {
      const syncDevice = (
        kind: MediaDeviceKind,
        device: MediaDeviceHandle,
      ): void => {
        const id = device.selectedId;

        // Detect if we're trying to use chrome's default device, in which case
        // we need to to see if the default device has changed to a different device
        // by comparing the group ID of the device we're using against the group ID
        // of what the default device is *now*.
        // This is special-cased for only audio inputs because we need to dig around
        // in the LocalParticipant object for the track object and there's not a nice
        // way to do that generically. There is usually no OS-level default video capture
        // device anyway, and audio outputs work differently.
        if (
          id === "default" &&
          kind === "audioinput" &&
          room.options.audioCaptureDefaults?.deviceId === "default"
        ) {
          const activeMicTrack = Array.from(
            room.localParticipant.audioTrackPublications.values(),
          ).find((d) => d.source === Track.Source.Microphone)?.track;

          if (
            activeMicTrack &&
            // only restart if the stream is still running: LiveKit will detect
            // when a track stops & restart appropriately, so this is not our job.
            // Plus, we need to avoid restarting again if the track is already in
            // the process of being restarted.
            activeMicTrack.mediaStreamTrack.readyState !== "ended" &&
            device.selectedGroupId !==
              activeMicTrack.mediaStreamTrack.getSettings().groupId
          ) {
            // It's different, so restart the track, ie. cause Livekit to do another
            // getUserMedia() call with deviceId: default to get the *new* default device.
            // Note that room.switchActiveDevice() won't work: Livekit will ignore it because
            // the deviceId hasn't changed (was & still is default).
            room.localParticipant
              .getTrackPublication(Track.Source.Microphone)
              ?.audioTrack?.restartTrack()
              .catch((e) => {
                logger.error(`Failed to restart audio device track`, e);
              });
          }
        } else {
          if (id !== undefined && room.getActiveDevice(kind) !== id) {
            room
              .switchActiveDevice(kind, id)
              .catch((e) =>
                logger.error(`Failed to sync ${kind} device with LiveKit`, e),
              );
          }
        }
      };

      syncDevice("audioinput", devices.audioInput);
      syncDevice("audiooutput", devices.audioOutput);
      syncDevice("videoinput", devices.videoInput);
    }
  }, [room, devices, connectionState, controlledAudioDevices]);

  return {
    connState: connectionState,
    livekitRoom: room,
  };
}
