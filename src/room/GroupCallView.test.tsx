/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  beforeEach,
  expect,
  type MockedFunction,
  onTestFinished,
  test,
  vi,
} from "vitest";
import { render, waitFor, screen } from "@testing-library/react";
import { type MatrixClient, JoinRule, type RoomState } from "matrix-js-sdk";
import { type MatrixRTCSession } from "matrix-js-sdk/lib/matrixrtc";
import { of } from "rxjs";
import { BrowserRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { type RelationsContainer } from "matrix-js-sdk/lib/models/relations-container";
import { useState } from "react";
import { TooltipProvider } from "@vector-im/compound-web";

import { type MuteStates } from "./MuteStates";
import { prefetchSounds } from "../soundUtils";
import { useAudioContext } from "../useAudioContext";
import { ActiveCall } from "./InCallView";
import {
  flushPromises,
  mockMatrixRoom,
  mockMatrixRoomMember,
  mockRtcMembership,
  MockRTCSession,
} from "../utils/test";
import { GroupCallView } from "./GroupCallView";
import { type WidgetHelpers } from "../widget";
import { LazyEventEmitter } from "../LazyEventEmitter";
import { MatrixRTCFocusMissingError } from "../utils/errors";
import { ProcessorProvider } from "../livekit/TrackProcessorContext";

vi.mock("../soundUtils");
vi.mock("../useAudioContext");
vi.mock("./InCallView");
vi.mock("react-use-measure", () => ({
  default: (): [() => void, object] => [(): void => {}, {}],
}));

vi.hoisted(
  () =>
    (global.ImageData = class MockImageData {
      public data: number[] = [];
    } as unknown as typeof ImageData),
);

const enterRTCSession = vi.hoisted(() => vi.fn(async () => Promise.resolve()));
const leaveRTCSession = vi.hoisted(() =>
  vi.fn(
    async (
      rtcSession: unknown,
      cause: unknown,
      promiseBeforeHangup = Promise.resolve(),
    ) => await promiseBeforeHangup,
  ),
);

vi.mock("../rtcSessionHelpers", async (importOriginal) => {
  // TODO: perhaps there is a more elegant way to manage the type import here?
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const orig = await importOriginal<typeof import("../rtcSessionHelpers")>();
  return { ...orig, enterRTCSession, leaveRTCSession };
});

let playSound: MockedFunction<
  NonNullable<ReturnType<typeof useAudioContext>>["playSound"]
>;

const localRtcMember = mockRtcMembership("@carol:example.org", "CCCC");
const carol = mockMatrixRoomMember(localRtcMember);
const roomMembers = new Map([carol].map((p) => [p.userId, p]));

const roomId = "!foo:bar";

beforeEach(() => {
  vi.clearAllMocks();
  (prefetchSounds as MockedFunction<typeof prefetchSounds>).mockResolvedValue({
    sound: new ArrayBuffer(0),
  });
  playSound = vi.fn();
  (useAudioContext as MockedFunction<typeof useAudioContext>).mockReturnValue({
    playSound,
  });
  // A trivial implementation of Active call to ensure we are testing GroupCallView exclusively here.
  (ActiveCall as MockedFunction<typeof ActiveCall>).mockImplementation(
    ({ onLeave }) => {
      return (
        <div>
          <button onClick={() => onLeave()}>Leave</button>
        </div>
      );
    },
  );
});

function createGroupCallView(
  widget: WidgetHelpers | null,
  joined = true,
): {
  rtcSession: MockRTCSession;
  getByText: ReturnType<typeof render>["getByText"];
} {
  const client = {
    getUser: () => null,
    getUserId: () => localRtcMember.sender,
    getDeviceId: () => localRtcMember.deviceId,
    getRoom: (rId) => (rId === roomId ? room : null),
  } as Partial<MatrixClient> as MatrixClient;
  const room = mockMatrixRoom({
    relations: {
      getChildEventsForEvent: () =>
        vi.mocked({
          getRelations: () => [],
        }),
    } as unknown as RelationsContainer,
    client,
    roomId,
    getMember: (userId) => roomMembers.get(userId) ?? null,
    getMxcAvatarUrl: () => null,
    getCanonicalAlias: () => null,
    currentState: {
      getJoinRule: () => JoinRule.Invite,
    } as Partial<RoomState> as RoomState,
  });
  const rtcSession = new MockRTCSession(
    room,
    localRtcMember,
    [],
  ).withMemberships(of([]));
  rtcSession.joined = joined;
  const muteState = {
    audio: { enabled: false },
    video: { enabled: false },
  } as MuteStates;
  const { getByText } = render(
    <BrowserRouter>
      <TooltipProvider>
        <ProcessorProvider>
          <GroupCallView
            client={client}
            isPasswordlessUser={false}
            confineToRoom={false}
            preload={false}
            skipLobby={false}
            hideHeader={true}
            rtcSession={rtcSession as unknown as MatrixRTCSession}
            isJoined={joined}
            muteStates={muteState}
            widget={widget}
          />
        </ProcessorProvider>
      </TooltipProvider>
    </BrowserRouter>,
  );
  return {
    getByText,
    rtcSession,
  };
}

test("GroupCallView plays a leave sound asynchronously in SPA mode", async () => {
  const user = userEvent.setup();
  const { getByText, rtcSession } = createGroupCallView(null);
  const leaveButton = getByText("Leave");
  await user.click(leaveButton);
  expect(playSound).toHaveBeenCalledWith("left");
  expect(leaveRTCSession).toHaveBeenCalledWith(
    rtcSession,
    "user",
    expect.any(Promise),
  );
  expect(leaveRTCSession).toHaveBeenCalledOnce();
  // Ensure that the playSound promise resolves within this test to avoid
  // impacting the results of other tests
  await waitFor(() => expect(leaveRTCSession).toHaveResolved());
});

test("GroupCallView plays a leave sound synchronously in widget mode", async () => {
  const user = userEvent.setup();
  const widget = {
    api: {
      setAlwaysOnScreen: async () => Promise.resolve(true),
    } as Partial<WidgetHelpers["api"]>,
    lazyActions: new LazyEventEmitter(),
  };
  let resolvePlaySound: () => void;
  playSound = vi
    .fn()
    .mockReturnValue(
      new Promise<void>((resolve) => (resolvePlaySound = resolve)),
    );
  (useAudioContext as MockedFunction<typeof useAudioContext>).mockReturnValue({
    playSound,
  });

  const { getByText, rtcSession } = createGroupCallView(
    widget as WidgetHelpers,
  );
  const leaveButton = getByText("Leave");
  await user.click(leaveButton);
  await flushPromises();
  expect(leaveRTCSession).not.toHaveResolved();
  resolvePlaySound!();
  await flushPromises();

  expect(playSound).toHaveBeenCalledWith("left");
  expect(leaveRTCSession).toHaveBeenCalledWith(
    rtcSession,
    "user",
    expect.any(Promise),
  );
  expect(leaveRTCSession).toHaveBeenCalledOnce();
});

test("GroupCallView leaves the session when an error occurs", async () => {
  (ActiveCall as MockedFunction<typeof ActiveCall>).mockImplementation(() => {
    const [error, setError] = useState<Error | null>(null);
    if (error !== null) throw error;
    return (
      <div>
        <button onClick={() => setError(new Error())}>Panic!</button>
      </div>
    );
  });
  const user = userEvent.setup();
  const { rtcSession } = createGroupCallView(null);
  await user.click(screen.getByRole("button", { name: "Panic!" }));
  screen.getByText("Something went wrong");
  expect(leaveRTCSession).toHaveBeenCalledWith(
    rtcSession,
    "error",
    expect.any(Promise),
  );
});

test("GroupCallView shows errors that occur during joining", async () => {
  const user = userEvent.setup();
  enterRTCSession.mockRejectedValue(new MatrixRTCFocusMissingError(""));
  onTestFinished(() => {
    enterRTCSession.mockReset();
  });
  createGroupCallView(null, false);
  await user.click(screen.getByRole("button", { name: "Join call" }));
  screen.getByText("Call is not supported");
});
