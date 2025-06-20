/*
Copyright 2022-2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type ComponentProps,
  type ReactNode,
  forwardRef,
  useCallback,
  useRef,
  useState,
} from "react";
import { type animated } from "@react-spring/web";
import classNames from "classnames";
import { useTranslation } from "react-i18next";
import {
  MicOnSolidIcon,
  MicOffSolidIcon,
  MicOffIcon,
  OverflowHorizontalIcon,
  VolumeOnIcon,
  VolumeOffIcon,
  VisibilityOnIcon,
  UserProfileIcon,
  ExpandIcon,
  VolumeOffSolidIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";
import {
  ContextMenu,
  MenuItem,
  ToggleMenuItem,
  Menu,
} from "@vector-im/compound-web";
import { useObservableEagerState, useObservableState } from "observable-hooks";

import styles from "./GridTile.module.css";
import {
  type UserMediaViewModel,
  LocalUserMediaViewModel,
  type RemoteUserMediaViewModel,
} from "../state/MediaViewModel";
import { Slider } from "../Slider";
import { MediaView } from "./MediaView";
import { useLatest } from "../useLatest";
import { type GridTileViewModel } from "../state/TileViewModel";
import { useMergedRefs } from "../useMergedRefs";
import { useReactionsSender } from "../reactions/useReactionsSender";

interface TileProps {
  className?: string;
  style?: ComponentProps<typeof animated.div>["style"];
  targetWidth: number;
  targetHeight: number;
  displayName: string;
  showSpeakingIndicators: boolean;
}

interface UserMediaTileProps extends TileProps {
  vm: UserMediaViewModel;
  mirror: boolean;
  locallyMuted: boolean;
  menuStart?: ReactNode;
  menuEnd?: ReactNode;
}

const UserMediaTile = forwardRef<HTMLDivElement, UserMediaTileProps>(
  (
    {
      vm,
      showSpeakingIndicators,
      locallyMuted,
      menuStart,
      menuEnd,
      className,
      displayName,
      ...props
    },
    ref,
  ) => {
    const { toggleRaisedHand } = useReactionsSender();
    const { t } = useTranslation();
    const video = useObservableEagerState(vm.video$);
    const unencryptedWarning = useObservableEagerState(vm.unencryptedWarning$);
    const encryptionStatus = useObservableEagerState(vm.encryptionStatus$);
    const audioStreamStats = useObservableEagerState<
      RTCInboundRtpStreamStats | RTCOutboundRtpStreamStats | undefined
    >(vm.audioStreamStats$);
    const videoStreamStats = useObservableEagerState<
      RTCInboundRtpStreamStats | RTCOutboundRtpStreamStats | undefined
    >(vm.videoStreamStats$);
    const audioEnabled = useObservableEagerState(vm.audioEnabled$);
    const videoEnabled = useObservableEagerState(vm.videoEnabled$);
    const speaking = useObservableEagerState(vm.speaking$);
    const cropVideo = useObservableEagerState(vm.cropVideo$);
    const onSelectFitContain = useCallback(
      (e: Event) => {
        e.preventDefault();
        vm.toggleFitContain();
      },
      [vm],
    );
    const handRaised = useObservableState(vm.handRaised$);
    const reaction = useObservableState(vm.reaction$);

    const AudioIcon = locallyMuted
      ? VolumeOffSolidIcon
      : audioEnabled
        ? MicOnSolidIcon
        : MicOffSolidIcon;
    const audioIconLabel = locallyMuted
      ? t("video_tile.muted_for_me")
      : audioEnabled
        ? t("microphone_on")
        : t("microphone_off");

    const [menuOpen, setMenuOpen] = useState(false);
    const menu = (
      <>
        {menuStart}
        <ToggleMenuItem
          Icon={ExpandIcon}
          label={t("video_tile.change_fit_contain")}
          checked={cropVideo}
          onSelect={onSelectFitContain}
        />
        {menuEnd}
      </>
    );

    const raisedHandOnClick = vm.local
      ? (): void => void toggleRaisedHand()
      : undefined;

    const showSpeaking = showSpeakingIndicators && speaking;

    const tile = (
      <MediaView
        ref={ref}
        video={video}
        member={vm.member}
        unencryptedWarning={unencryptedWarning}
        encryptionStatus={encryptionStatus}
        videoEnabled={videoEnabled}
        videoFit={cropVideo ? "cover" : "contain"}
        className={classNames(className, styles.tile, {
          [styles.speaking]: showSpeaking,
          [styles.handRaised]: !showSpeaking && handRaised,
        })}
        nameTagLeadingIcon={
          <AudioIcon
            width={20}
            height={20}
            aria-label={audioIconLabel}
            data-muted={locallyMuted || !audioEnabled}
            className={styles.muteIcon}
          />
        }
        displayName={displayName}
        primaryButton={
          <Menu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            title={displayName}
            trigger={
              <button aria-label={t("common.options")}>
                <OverflowHorizontalIcon aria-hidden width={20} height={20} />
              </button>
            }
            side="left"
            align="start"
          >
            {menu}
          </Menu>
        }
        raisedHandTime={handRaised ?? undefined}
        currentReaction={reaction ?? undefined}
        raisedHandOnClick={raisedHandOnClick}
        localParticipant={vm.local}
        audioStreamStats={audioStreamStats}
        videoStreamStats={videoStreamStats}
        {...props}
      />
    );

    return (
      <ContextMenu title={displayName} trigger={tile} hasAccessibleAlternative>
        {menu}
      </ContextMenu>
    );
  },
);

UserMediaTile.displayName = "UserMediaTile";

interface LocalUserMediaTileProps extends TileProps {
  vm: LocalUserMediaViewModel;
  onOpenProfile: (() => void) | null;
}

const LocalUserMediaTile = forwardRef<HTMLDivElement, LocalUserMediaTileProps>(
  ({ vm, onOpenProfile, ...props }, ref) => {
    const { t } = useTranslation();
    const mirror = useObservableEagerState(vm.mirror$);
    const alwaysShow = useObservableEagerState(vm.alwaysShow$);
    const latestAlwaysShow = useLatest(alwaysShow);
    const onSelectAlwaysShow = useCallback(
      (e: Event) => {
        e.preventDefault();
        vm.setAlwaysShow(!latestAlwaysShow.current);
      },
      [vm, latestAlwaysShow],
    );

    return (
      <UserMediaTile
        ref={ref}
        vm={vm}
        locallyMuted={false}
        mirror={mirror}
        menuStart={
          <ToggleMenuItem
            Icon={VisibilityOnIcon}
            label={t("video_tile.always_show")}
            checked={alwaysShow}
            onSelect={onSelectAlwaysShow}
          />
        }
        menuEnd={
          onOpenProfile && (
            <MenuItem
              Icon={UserProfileIcon}
              label={t("common.profile")}
              onSelect={onOpenProfile}
            />
          )
        }
        {...props}
      />
    );
  },
);

LocalUserMediaTile.displayName = "LocalUserMediaTile";

interface RemoteUserMediaTileProps extends TileProps {
  vm: RemoteUserMediaViewModel;
}

const RemoteUserMediaTile = forwardRef<
  HTMLDivElement,
  RemoteUserMediaTileProps
>(({ vm, ...props }, ref) => {
  const { t } = useTranslation();
  const locallyMuted = useObservableEagerState(vm.locallyMuted$);
  const localVolume = useObservableEagerState(vm.localVolume$);
  const onSelectMute = useCallback(
    (e: Event) => {
      e.preventDefault();
      vm.toggleLocallyMuted();
    },
    [vm],
  );
  const onChangeLocalVolume = useCallback(
    (v: number) => vm.setLocalVolume(v),
    [vm],
  );
  const onCommitLocalVolume = useCallback(() => vm.commitLocalVolume(), [vm]);

  const VolumeIcon = locallyMuted ? VolumeOffIcon : VolumeOnIcon;

  return (
    <UserMediaTile
      ref={ref}
      vm={vm}
      locallyMuted={locallyMuted}
      mirror={false}
      menuStart={
        <>
          <ToggleMenuItem
            Icon={MicOffIcon}
            label={t("video_tile.mute_for_me")}
            checked={locallyMuted}
            onSelect={onSelectMute}
          />
          {/* TODO: Figure out how to make this slider keyboard accessible */}
          <MenuItem as="div" Icon={VolumeIcon} label={null} onSelect={null}>
            <Slider
              className={styles.volumeSlider}
              label={t("video_tile.volume")}
              value={localVolume}
              onValueChange={onChangeLocalVolume}
              onValueCommit={onCommitLocalVolume}
              min={0}
              max={1}
              step={0.01}
            />
          </MenuItem>
        </>
      }
      {...props}
    />
  );
});

RemoteUserMediaTile.displayName = "RemoteUserMediaTile";

interface GridTileProps {
  vm: GridTileViewModel;
  onOpenProfile: (() => void) | null;
  targetWidth: number;
  targetHeight: number;
  className?: string;
  style?: ComponentProps<typeof animated.div>["style"];
  showSpeakingIndicators: boolean;
}

export const GridTile = forwardRef<HTMLDivElement, GridTileProps>(
  ({ vm, onOpenProfile, ...props }, theirRef) => {
    const ourRef = useRef<HTMLDivElement | null>(null);
    const ref = useMergedRefs(ourRef, theirRef);
    const media = useObservableEagerState(vm.media$);
    const displayName = useObservableEagerState(media.displayname$);

    if (media instanceof LocalUserMediaViewModel) {
      return (
        <LocalUserMediaTile
          ref={ref}
          vm={media}
          onOpenProfile={onOpenProfile}
          displayName={displayName}
          {...props}
        />
      );
    } else {
      return (
        <RemoteUserMediaTile
          ref={ref}
          vm={media}
          displayName={displayName}
          {...props}
        />
      );
    }
  },
);

GridTile.displayName = "GridTile";
