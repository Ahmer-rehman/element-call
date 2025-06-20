/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

export class AbortHandle {
  public constructor(private aborted = false) {}

  public abort(): void {
    this.aborted = true;
  }

  public isAborted(): boolean {
    return this.aborted;
  }
}
