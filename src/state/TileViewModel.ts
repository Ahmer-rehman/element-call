/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type Observable } from "rxjs";

import { ViewModel } from "./ViewModel";
import { type MediaViewModel, type UserMediaViewModel } from "./MediaViewModel";

let nextId = 0;
function createId(): string {
  return (nextId++).toString();
}

export class GridTileViewModel extends ViewModel {
  public readonly id = createId();

  public constructor(public readonly media$: Observable<UserMediaViewModel>) {
    super();
  }
}

export class SpotlightTileViewModel extends ViewModel {
  public constructor(
    public readonly media$: Observable<MediaViewModel[]>,
    public readonly maximised$: Observable<boolean>,
  ) {
    super();
  }
}

export type TileViewModel = GridTileViewModel | SpotlightTileViewModel;
