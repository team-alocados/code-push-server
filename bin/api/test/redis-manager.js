"use strict";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const q = require("q");
const shortid = require("shortid");
const redis_manager_1 = require("../script/redis-manager");
class DummyExpressResponse {
    statusCode;
    body;
    locals;
    status(statusCode) {
        assert(!this.statusCode);
        this.statusCode = statusCode;
        return this;
    }
    send(body) {
        assert(!this.body);
        this.body = body;
        return this;
    }
    reset() {
        delete this.statusCode;
        delete this.body;
        this.locals = {};
    }
}
var redisManager = new redis_manager_1.RedisManager();
if (!redisManager.isEnabled) {
    console.log("Redis is not configured... Skipping redis tests");
}
else {
    describe("Redis Cache", redisTests);
}
function redisTests() {
    var dummyExpressResponse = new DummyExpressResponse();
    var expectedResponse = {
        statusCode: 200,
        body: "",
    };
    var responseGenerator = () => {
        return q(expectedResponse);
    };
    after(() => {
        return redisManager.close();
    });
    it("should be healthy by default", () => {
        return redisManager.checkHealth();
    });
    it("first cache request should return null", () => {
        var expiryKey = "test:" + shortid.generate();
        var url = shortid.generate();
        return redisManager.getCachedResponse(expiryKey, url).then((cacheResponse) => {
            assert.strictEqual(cacheResponse, null);
        });
    });
    it("Should get cache request after setting it once", () => {
        var expiryKey = "test:" + shortid.generate();
        var url = shortid.generate();
        expectedResponse.statusCode = 200;
        expectedResponse.body = "I am cached";
        return redisManager
            .getCachedResponse(expiryKey, url)
            .then((cacheResponse) => {
            assert.strictEqual(cacheResponse, null);
            return redisManager.setCachedResponse(expiryKey, url, expectedResponse);
        })
            .then(() => {
            return redisManager.getCachedResponse(expiryKey, url);
        })
            .then((cacheResponse) => {
            assert.equal(cacheResponse.statusCode, expectedResponse.statusCode);
            assert.equal(cacheResponse.body, expectedResponse.body);
            return redisManager.getCachedResponse(expiryKey, url);
        })
            .then((cacheResponse) => {
            assert.equal(cacheResponse.statusCode, expectedResponse.statusCode);
            assert.equal(cacheResponse.body, expectedResponse.body);
            var newUrl = shortid.generate();
            return redisManager.getCachedResponse(expiryKey, newUrl);
        })
            .then((cacheResponse) => {
            assert.strictEqual(cacheResponse, null);
        });
    });
    it("should be able to invalidate cached request", () => {
        var expiryKey = "test:" + shortid.generate();
        var url = shortid.generate();
        expectedResponse.statusCode = 200;
        expectedResponse.body = "I am cached";
        return redisManager
            .getCachedResponse(expiryKey, url)
            .then((cacheResponse) => {
            assert.strictEqual(cacheResponse, null);
            return redisManager.setCachedResponse(expiryKey, url, expectedResponse);
        })
            .then(() => {
            return redisManager.getCachedResponse(expiryKey, url);
        })
            .then((cacheResponse) => {
            assert.equal(cacheResponse.statusCode, expectedResponse.statusCode);
            assert.equal(cacheResponse.body, expectedResponse.body);
            expectedResponse.body = "I am a new body";
            return redisManager.invalidateCache(expiryKey);
        })
            .then(() => {
            return redisManager.getCachedResponse(expiryKey, url);
        })
            .then((cacheResponse) => {
            assert.strictEqual(cacheResponse, null);
        });
    });
}
