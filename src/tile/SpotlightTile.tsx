/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type ComponentProps,
  type RefAttributes,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ExpandIcon,
  CollapseIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";
import { animated } from "@react-spring/web";
import { type Observable, map } from "rxjs";
import { useObservableEagerState, useObservableRef } from "observable-hooks";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import { type TrackReferenceOrPlaceholder } from "@livekit/components-core";
import { type RoomMember } from "matrix-js-sdk";

import { MediaView } from "./MediaView";
import styles from "./SpotlightTile.module.css";
import {
  type EncryptionStatus,
  LocalUserMediaViewModel,
  type MediaViewModel,
  ScreenShareViewModel,
  type UserMediaViewModel,
} from "../state/MediaViewModel";
import { useInitial } from "../useInitial";
import { useMergedRefs } from "../useMergedRefs";
import { useReactiveState } from "../useReactiveState";
import { useLatest } from "../useLatest";
import { type SpotlightTileViewModel } from "../state/TileViewModel";

interface SpotlightItemBaseProps {
  className?: string;
  "data-id": string;
  targetWidth: number;
  targetHeight: number;
  video: TrackReferenceOrPlaceholder | undefined;
  member: RoomMember | undefined;
  unencryptedWarning: boolean;
  encryptionStatus: EncryptionStatus;
  displayName: string;
  "aria-hidden"?: boolean;
  localParticipant: boolean;
}

interface SpotlightUserMediaItemBaseProps extends SpotlightItemBaseProps {
  videoEnabled: boolean;
  videoFit: "contain" | "cover";
}

interface SpotlightLocalUserMediaItemProps
  extends SpotlightUserMediaItemBaseProps {
  vm: LocalUserMediaViewModel;
}

const SpotlightLocalUserMediaItem = forwardRef<
  HTMLDivElement,
  SpotlightLocalUserMediaItemProps
>(({ vm, ...props }, ref) => {
  const mirror = useObservableEagerState(vm.mirror$);
  return <MediaView ref={ref} mirror={mirror} {...props} />;
});

SpotlightLocalUserMediaItem.displayName = "SpotlightLocalUserMediaItem";

interface SpotlightUserMediaItemProps extends SpotlightItemBaseProps {
  vm: UserMediaViewModel;
}

const SpotlightUserMediaItem = forwardRef<
  HTMLDivElement,
  SpotlightUserMediaItemProps
>(({ vm, ...props }, ref) => {
  const videoEnabled = useObservableEagerState(vm.videoEnabled$);
  const cropVideo = useObservableEagerState(vm.cropVideo$);

  const baseProps: SpotlightUserMediaItemBaseProps &
    RefAttributes<HTMLDivElement> = {
    ref,
    videoEnabled,
    videoFit: cropVideo ? "cover" : "contain",
    ...props,
  };

  return vm instanceof LocalUserMediaViewModel ? (
    <SpotlightLocalUserMediaItem vm={vm} {...baseProps} />
  ) : (
    <MediaView mirror={false} {...baseProps} />
  );
});

SpotlightUserMediaItem.displayName = "SpotlightUserMediaItem";

interface SpotlightItemProps {
  vm: MediaViewModel;
  targetWidth: number;
  targetHeight: number;
  intersectionObserver$: Observable<IntersectionObserver>;
  /**
   * Whether this item should act as a scroll snapping point.
   */
  snap: boolean;
  "aria-hidden"?: boolean;
}

const SpotlightItem = forwardRef<HTMLDivElement, SpotlightItemProps>(
  (
    {
      vm,
      targetWidth,
      targetHeight,
      intersectionObserver$,
      snap,
      "aria-hidden": ariaHidden,
    },
    theirRef,
  ) => {
    const ourRef = useRef<HTMLDivElement | null>(null);
    const ref = useMergedRefs(ourRef, theirRef);
    const displayName = useObservableEagerState(vm.displayname$);
    const video = useObservableEagerState(vm.video$);
    const unencryptedWarning = useObservableEagerState(vm.unencryptedWarning$);
    const encryptionStatus = useObservableEagerState(vm.encryptionStatus$);

    // Hook this item up to the intersection observer
    useEffect(() => {
      const element = ourRef.current!;
      let prevIo: IntersectionObserver | null = null;
      const subscription = intersectionObserver$.subscribe((io) => {
        prevIo?.unobserve(element);
        io.observe(element);
        prevIo = io;
      });
      return (): void => {
        subscription.unsubscribe();
        prevIo?.unobserve(element);
      };
    }, [intersectionObserver$]);

    const baseProps: SpotlightItemBaseProps & RefAttributes<HTMLDivElement> = {
      ref,
      "data-id": vm.id,
      className: classNames(styles.item, { [styles.snap]: snap }),
      targetWidth,
      targetHeight,
      video,
      member: vm.member,
      unencryptedWarning,
      displayName,
      encryptionStatus,
      "aria-hidden": ariaHidden,
      localParticipant: vm.local,
    };

    return vm instanceof ScreenShareViewModel ? (
      <MediaView
        videoEnabled
        videoFit="contain"
        mirror={false}
        {...baseProps}
      />
    ) : (
      <SpotlightUserMediaItem vm={vm} {...baseProps} />
    );
  },
);

SpotlightItem.displayName = "SpotlightItem";

interface Props {
  vm: SpotlightTileViewModel;
  expanded: boolean;
  onToggleExpanded: (() => void) | null;
  targetWidth: number;
  targetHeight: number;
  showIndicators: boolean;
  className?: string;
  style?: ComponentProps<typeof animated.div>["style"];
}

export const SpotlightTile = forwardRef<HTMLDivElement, Props>(
  (
    {
      vm,
      expanded,
      onToggleExpanded,
      targetWidth,
      targetHeight,
      showIndicators,
      className,
      style,
    },
    theirRef,
  ) => {
    const { t } = useTranslation();
    const [ourRef, root$] = useObservableRef<HTMLDivElement | null>(null);
    const ref = useMergedRefs(ourRef, theirRef);
    const maximised = useObservableEagerState(vm.maximised$);
    const media = useObservableEagerState(vm.media$);
    const [visibleId, setVisibleId] = useState<string | undefined>(
      media[0]?.id,
    );
    const latestMedia = useLatest(media);
    const latestVisibleId = useLatest(visibleId);
    const visibleIndex = media.findIndex((vm) => vm.id === visibleId);
    const canGoBack = visibleIndex > 0;
    const canGoToNext = visibleIndex !== -1 && visibleIndex < media.length - 1;

    // To keep track of which item is visible, we need an intersection observer
    // hooked up to the root element and the items. Because the items will run
    // their effects before their parent does, we need to do this dance with an
    // Observable to actually give them the intersection observer.
    const intersectionObserver$ = useInitial<Observable<IntersectionObserver>>(
      () =>
        root$.pipe(
          map(
            (r) =>
              new IntersectionObserver(
                (entries) => {
                  const visible = entries.find((e) => e.isIntersecting);
                  if (visible !== undefined)
                    setVisibleId(visible.target.getAttribute("data-id")!);
                },
                { root: r, threshold: 0.5 },
              ),
          ),
        ),
    );

    const [scrollToId, setScrollToId] = useReactiveState<string | null>(
      (prev) =>
        prev == null ||
        prev === visibleId ||
        media.every((vm) => vm.id !== prev)
          ? null
          : prev,
      [visibleId],
    );

    const onBackClick = useCallback(() => {
      const media = latestMedia.current;
      const visibleIndex = media.findIndex(
        (vm) => vm.id === latestVisibleId.current,
      );
      if (visibleIndex > 0) setScrollToId(media[visibleIndex - 1].id);
    }, [latestVisibleId, latestMedia, setScrollToId]);

    const onNextClick = useCallback(() => {
      const media = latestMedia.current;
      const visibleIndex = media.findIndex(
        (vm) => vm.id === latestVisibleId.current,
      );
      if (visibleIndex !== -1 && visibleIndex !== media.length - 1)
        setScrollToId(media[visibleIndex + 1].id);
    }, [latestVisibleId, latestMedia, setScrollToId]);

    const ToggleExpandIcon = expanded ? CollapseIcon : ExpandIcon;

    return (
      <animated.div
        ref={ref}
        className={classNames(className, styles.tile, {
          [styles.maximised]: maximised,
        })}
        style={style}
      >
        {canGoBack && (
          <button
            className={classNames(styles.advance, styles.back)}
            aria-label={t("common.back")}
            onClick={onBackClick}
          >
            <ChevronLeftIcon aria-hidden width={24} height={24} />
          </button>
        )}
        <div className={styles.contents}>
          {media.map((vm) => (
            <SpotlightItem
              key={vm.id}
              vm={vm}
              targetWidth={targetWidth}
              targetHeight={targetHeight}
              intersectionObserver$={intersectionObserver$}
              // This is how we get the container to scroll to the right media
              // when the previous/next buttons are clicked: we temporarily
              // remove all scroll snap points except for just the one media
              // that we want to bring into view
              snap={scrollToId === null || scrollToId === vm.id}
              aria-hidden={(scrollToId ?? visibleId) !== vm.id}
            />
          ))}
        </div>
        {onToggleExpanded && (
          <button
            className={classNames(styles.expand)}
            aria-label={
              expanded ? t("video_tile.collapse") : t("video_tile.expand")
            }
            onClick={onToggleExpanded}
          >
            <ToggleExpandIcon aria-hidden width={20} height={20} />
          </button>
        )}
        {canGoToNext && (
          <button
            className={classNames(styles.advance, styles.next)}
            aria-label={t("common.next")}
            onClick={onNextClick}
          >
            <ChevronRightIcon aria-hidden width={24} height={24} />
          </button>
        )}
        {!expanded && (
          <div
            className={classNames(styles.indicators, {
              [styles.show]: showIndicators && media.length > 1,
            })}
          >
            {media.map((vm) => (
              <div
                key={vm.id}
                className={styles.item}
                data-visible={vm.id === visibleId}
              />
            ))}
          </div>
        )}
      </animated.div>
    );
  },
);

SpotlightTile.displayName = "SpotlightTile";
