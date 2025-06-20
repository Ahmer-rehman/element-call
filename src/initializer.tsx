/*
Copyright 2022-2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import i18n, {
  type BackendModule,
  type ReadCallback,
  type ResourceKey,
} from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import * as Sentry from "@sentry/react";
import { logger } from "matrix-js-sdk/lib/logger";
import { shouldPolyfill as shouldPolyfillSegmenter } from "@formatjs/intl-segmenter/should-polyfill";
import { shouldPolyfill as shouldPolyfillDurationFormat } from "@formatjs/intl-durationformat/should-polyfill";
import {
  useLocation,
  useNavigationType,
  createRoutesFromChildren,
  matchRoutes,
} from "react-router-dom";

import { getUrlParams } from "./UrlParams";
import { Config } from "./config/Config";
import { ElementCallOpenTelemetry } from "./otel/otel";
import { platform } from "./Platform";
import { isFailure } from "./utils/fetch";

// This generates a map of locale names to their URL (based on import.meta.url), which looks like this:
// {
//   "../locales/en/app.json": "/whatever/assets/root/locales/en-aabbcc.json",
//   ...
// }
const locales = import.meta.glob<string>("../locales/*/*.json", {
  query: "?url",
  import: "default",
  eager: true,
});

const getLocaleUrl = (
  language: string,
  namespace: string,
): string | undefined => locales[`../locales/${language}/${namespace}.json`];

const supportedLngs = [
  ...new Set(
    Object.keys(locales).map((url) => {
      // The URLs are of the form ../locales/en/app.json
      // This extracts the language code from the URL
      const lang = url.match(/\/([^/]+)\/[^/]+\.json$/)?.[1];
      if (!lang) {
        throw new Error(`Could not parse locale URL ${url}`);
      }
      return lang;
    }),
  ),
];

// A backend that fetches the locale files from the URLs generated by the glob above
const Backend = {
  type: "backend",
  init(): void {},
  read(language: string, namespace: string, callback: ReadCallback): void {
    (async (): Promise<ResourceKey> => {
      const url = getLocaleUrl(language, namespace);
      if (!url) {
        throw new Error(
          `Namespace ${namespace} for locale ${language} not found`,
        );
      }

      const response = await fetch(url, {
        credentials: "omit",
        headers: {
          Accept: "application/json",
        },
      });

      if (isFailure(response)) {
        throw Error(`Failed to fetch ${url}`);
      }

      return await response.json();
    })().then(
      (data) => callback(null, data),
      (error) => callback(error, null),
    );
  },
} satisfies BackendModule;

enum LoadState {
  None,
  Loading,
  Loaded,
}

class DependencyLoadStates {
  public config: LoadState = LoadState.None;
  public sentry: LoadState = LoadState.None;
  public openTelemetry: LoadState = LoadState.None;

  public allDepsAreLoaded(): boolean {
    return !Object.values(this).some((s) => s !== LoadState.Loaded);
  }
}

export class Initializer {
  private static internalInstance: Initializer | undefined;
  private isInitialized = false;

  public static isInitialized(): boolean {
    return !!Initializer.internalInstance?.isInitialized;
  }

  public static async initBeforeReact(): Promise<void> {
    const polyfills: Promise<unknown>[] = [];
    if (shouldPolyfillSegmenter()) {
      polyfills.push(import("@formatjs/intl-segmenter/polyfill-force"));
    }

    if (shouldPolyfillDurationFormat()) {
      polyfills.push(import("@formatjs/intl-durationformat/polyfill-force"));
    }

    await Promise.all(polyfills);

    //i18n
    const languageDetector = new LanguageDetector();
    languageDetector.addDetector({
      name: "urlFragment",
      // Look for a language code in the URL's fragment
      lookup: () => getUrlParams().lang ?? undefined,
    });

    // Synchronise the HTML lang attribute with the i18next language
    i18n.on("languageChanged", (lng) => {
      document.documentElement.lang = lng;
    });

    await i18n
      .use(Backend)
      .use(languageDetector)
      .use(initReactI18next)
      .init({
        fallbackLng: "en",
        defaultNS: "app",
        keySeparator: ".",
        nsSeparator: false,
        pluralSeparator: "_",
        contextSeparator: "|",
        supportedLngs,
        interpolation: {
          escapeValue: false, // React has built-in XSS protections
        },
        detection: {
          // No localStorage detectors or caching here, since we don't have any way
          // of letting the user manually select a language
          order: ["urlFragment", "navigator"],
          caches: [],
        },
      });

    // Custom Themeing
    if (import.meta.env.VITE_CUSTOM_CSS) {
      const style = document.createElement("style");
      style.textContent = import.meta.env.VITE_CUSTOM_CSS;
      document.head.appendChild(style);
    }

    // Custom fonts
    const { fonts, fontScale } = getUrlParams();
    if (fontScale !== null) {
      document.documentElement.style.setProperty(
        "--font-scale",
        fontScale.toString(),
      );
    }
    if (fonts.length > 0) {
      document.documentElement.style.setProperty(
        "--font-family",
        fonts.map((f) => `"${f}"`).join(", "),
      );
    }

    // Add the platform to the DOM, so CSS can query it
    document.body.setAttribute("data-platform", platform);
  }

  public static init(): Promise<void> | null {
    if (Initializer?.internalInstance?.initPromise) {
      return null;
    }
    Initializer.internalInstance = new Initializer();
    Initializer.internalInstance.initPromise = new Promise<void>((resolve) => {
      // initStep calls itself recursively until everything is initialized in the correct order.
      // Then the promise gets resolved.
      Initializer.internalInstance?.initStep(resolve);
    });
    return Initializer.internalInstance.initPromise;
  }

  /**
   * Resets the initializer. This is used in tests to ensure that the initializer
   * is re-initialized for each test.
   */
  public static reset(): void {
    Initializer.internalInstance = undefined;
  }

  private loadStates = new DependencyLoadStates();

  private initStep(resolve: (value: void | PromiseLike<void>) => void): void {
    // config
    if (this.loadStates.config === LoadState.None) {
      this.loadStates.config = LoadState.Loading;
      Config.init().then(
        () => {
          this.loadStates.config = LoadState.Loaded;
          this.initStep(resolve);
        },
        (e) => {
          logger.error("Failed to load config", e);
        },
      );
    }

    //sentry (only initialize after the config is ready)
    if (
      this.loadStates.sentry === LoadState.None &&
      this.loadStates.config === LoadState.Loaded
    ) {
      let dsn: string | undefined;
      let environment: string | undefined;
      if (import.meta.env.VITE_PACKAGE === "embedded") {
        // for the embedded package we always use the values from the URL as the widget host is responsible for analytics configuration
        dsn = getUrlParams().sentryDsn ?? undefined;
        environment = getUrlParams().sentryEnvironment ?? undefined;
      }
      if (import.meta.env.VITE_PACKAGE === "full") {
        // in full package it is the server responsible for the analytics
        dsn = Config.get().sentry?.DSN;
        environment = Config.get().sentry?.environment;
      }
      if (dsn) {
        Sentry.init({
          dsn,
          environment,
          integrations: [
            Sentry.reactRouterV7BrowserTracingIntegration({
              useEffect: React.useEffect,
              useLocation,
              useNavigationType,
              createRoutesFromChildren,
              matchRoutes,
            }),
          ],
          tracesSampleRate: 1.0,
        });
      }
      // Sentry is now 'loadeed' (even if we actually skipped starting
      // it due to to not being configured)
      this.loadStates.sentry = LoadState.Loaded;
    }

    // OpenTelemetry (also only after config loaded)
    if (
      this.loadStates.openTelemetry === LoadState.None &&
      this.loadStates.config === LoadState.Loaded
    ) {
      ElementCallOpenTelemetry.globalInit();
      this.loadStates.openTelemetry = LoadState.Loaded;
    }

    if (this.loadStates.allDepsAreLoaded()) {
      // resolve if there is no dependency that is not loaded
      resolve();
      this.isInitialized = true;
    }
  }

  private initPromise?: Promise<void>;
}
