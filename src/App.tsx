/*
Copyright 2021-2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, type JSX, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Route, useLocation, Routes } from "react-router-dom";
import * as Sentry from "@sentry/react";
import { TooltipProvider } from "@vector-im/compound-web";
import { logger } from "matrix-js-sdk/lib/logger";

import { HomePage } from "./home/HomePage";
import { LoginPage } from "./auth/LoginPage";
import { RegisterPage } from "./auth/RegisterPage";
import { RoomPage } from "./room/RoomPage";
import { ClientProvider } from "./ClientContext";
import { ErrorPage, LoadingPage } from "./FullScreenView";
import { DisconnectedBanner } from "./DisconnectedBanner";
import { Initializer } from "./initializer";
import { MediaDevicesProvider } from "./livekit/MediaDevicesContext";
import { widget } from "./widget";
import { useTheme } from "./useTheme";
import { ProcessorProvider } from "./livekit/TrackProcessorContext";

const SentryRoute = Sentry.withSentryReactRouterV7Routing(Route);

interface SimpleProviderProps {
  children: JSX.Element;
}

const BackgroundProvider: FC<SimpleProviderProps> = ({ children }) => {
  const { pathname } = useLocation();

  useEffect(() => {
    let backgroundImage = "";
    if (!["/login", "/register"].includes(pathname) && !widget) {
      backgroundImage = "var(--background-gradient)";
    }

    document.getElementsByTagName("body")[0].style.backgroundImage =
      backgroundImage;
  }, [pathname]);

  return <>{children}</>;
};
const ThemeProvider: FC<SimpleProviderProps> = ({ children }) => {
  useTheme();
  return children;
};

export const App: FC = () => {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    Initializer.init()
      ?.then(async () => {
        if (loaded) return;
        setLoaded(true);
        await widget?.api.sendContentLoaded();
      })
      .catch(logger.error);
  });

  return (
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    <BrowserRouter>
      <BackgroundProvider>
        <ThemeProvider>
          <TooltipProvider>
            {loaded ? (
              <Suspense fallback={null}>
                <ClientProvider>
                  <MediaDevicesProvider>
                    <ProcessorProvider>
                      <Sentry.ErrorBoundary
                        fallback={(error) => (
                          <ErrorPage error={error} widget={widget} />
                        )}
                      >
                        <DisconnectedBanner />
                        <Routes>
                          <SentryRoute path="/" element={<HomePage />} />
                          <SentryRoute path="/login" element={<LoginPage />} />
                          <SentryRoute
                            path="/register"
                            element={<RegisterPage />}
                          />
                          <SentryRoute path="*" element={<RoomPage />} />
                        </Routes>
                      </Sentry.ErrorBoundary>
                    </ProcessorProvider>
                  </MediaDevicesProvider>
                </ClientProvider>
              </Suspense>
            ) : (
              <LoadingPage />
            )}
          </TooltipProvider>
        </ThemeProvider>
      </BackgroundProvider>
    </BrowserRouter>
  );
};
