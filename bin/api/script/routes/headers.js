"use strict";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHeadersMiddleware = void 0;
function getHeadersMiddleware(config) {
    return (req, res, next) => {
        const allowedOrigins = config.origin.split(",");
        const origin = req.header("Origin");
        if (origin && allowedOrigins.includes(origin)) {
            res.setHeader("Access-Control-Allow-Origin", origin);
        }
        else {
            res.setHeader("Access-Control-Allow-Origin", allowedOrigins[0]);
        }
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, PUT");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CodePush-Plugin-Name, X-CodePush-Plugin-Version, X-CodePush-SDK-Version");
        res.setHeader("Access-Control-Expose-Headers", "Location");
        res.setHeader("Cache-Control", "no-cache");
        if (req.method === "OPTIONS") {
            // hook the preflight options request and return success: No Content since we aren't returning a body.
            res.sendStatus(204);
            return;
        }
        next();
    };
}
exports.getHeadersMiddleware = getHeadersMiddleware;
