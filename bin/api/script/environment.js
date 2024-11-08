"use strict";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTempDirectory = void 0;
function getTempDirectory() {
    return process.env.TEMP || process.env.TMPDIR;
}
exports.getTempDirectory = getTempDirectory;
