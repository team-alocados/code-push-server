"use strict";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
exports.S3Storage = void 0;
// TODO aws sdk를 통해서 s3 업로드 하기
const express = require("express");
const fs = require("fs");
const q = require("q");
const storage = require("./storage");
var clone = storage.clone;
const storage_1 = require("./storage");
function merge(original, updates) {
    for (const property in updates) {
        original[property] = updates[property];
    }
}
class S3Storage {
    static NextIdNumber = 0;
    accounts = {};
    apps = {};
    deployments = {};
    packages = {};
    blobs = {};
    accessKeys = {};
    accountToAppsMap = {};
    appToAccountMap = {};
    emailToAccountMap = {};
    appToDeploymentsMap = {};
    deploymentToAppMap = {};
    deploymentKeyToDeploymentMap = {};
    accountToAccessKeysMap = {};
    accessKeyToAccountMap = {};
    accessKeyNameToAccountIdMap = {};
    static AccountNotFound = "The specified e-mail address doesn't represent a registered user";
    _blobServerPromise;
    constructor() {
        this.loadStateAsync(); // Attempts to load real data if any exists
    }
    /**
     * 최초 정보 불러오기
     *
     * // TODO config.json을 DB에서 읽어오는 것으로 대체해야함
     * // TODO 번들 파일은 S3에서 가져와야함
     */
    loadStateAsync() {
        fs.exists("config.json", function (exists) {
            if (exists) {
                fs.readFile("config.json", function (err, data) {
                    if (err)
                        throw err;
                    const obj = JSON.parse(data);
                    S3Storage.NextIdNumber = obj.NextIdNumber || 0;
                    this.blobs = obj.blobs || {};
                    this.accounts = obj.accounts || {};
                    this.apps = obj.apps || {};
                    this.deployments = obj.deployments || {};
                    this.deploymentKeys = obj.deploymentKeys || {};
                    this.accountToAppsMap = obj.accountToAppsMap || {};
                    this.appToAccountMap = obj.appToAccountMap || {};
                    this.emailToAccountMap = obj.emailToAccountMap || {};
                    this.appToDeploymentsMap = obj.appToDeploymentsMap || {};
                    this.deploymentToAppMap = obj.appToDeploymentsMap || {};
                    this.deploymentKeyToDeploymentMap = obj.deploymentKeyToDeploymentMap || {};
                    this.accessKeys = obj.accessKeys || {};
                    this.accessKeyToAccountMap = obj.accessKeyToAccountMap || {};
                    this.accountToAccessKeysMap = obj.accountToAccessKeysMap || {};
                    this.accessKeyNameToAccountIdMap = obj.accessKeyNameToAccountIdMap || {};
                }.bind(this));
            }
        }.bind(this));
    }
    /**
     * 모든 정보에 대한 저장 함수
     *
     * 모든 메소드 호출 시 마지막에 해당 함수를 통해 저장
     *
     */
    // TODO DB에 작성하자
    saveStateAsync() {
        const obj = {
            NextIdNumber: S3Storage.NextIdNumber,
            accounts: this.accounts,
            apps: this.apps,
            deployments: this.deployments,
            blobs: this.blobs,
            accountToAppsMap: this.accountToAppsMap,
            appToAccountMap: this.appToAccountMap,
            appToDeploymentsMap: this.appToDeploymentsMap,
            deploymentToAppMap: this.deploymentToAppMap,
            deploymentKeyToDeploymentMap: this.deploymentKeyToDeploymentMap,
            accessKeys: this.accessKeys,
            accessKeyToAccountMap: this.accessKeyToAccountMap,
            accountToAccessKeysMap: this.accountToAccessKeysMap,
            accessKeyNameToAccountIdMap: this.accessKeyNameToAccountIdMap,
        };
        const str = JSON.stringify(obj);
        fs.writeFile("config.json", str, function (err) {
            if (err)
                throw err;
        });
    }
    // TODO 배포 시 blob 저장하는 작성 필요함
    saveBlob() {
        //
    }
    checkHealth() {
        return q.reject("Should not be running JSON storage in production");
    }
    /**
     * 계정 추가 함수
     */
    addAccount(account) {
        account = clone(account);
        account.id = this.generateNewId();
        const email = account.email.toLowerCase();
        // 이미 계정이 존재하는 경우 reject
        if (this.accounts[account.id] || this.accountToAppsMap[account.id] || this.emailToAccountMap[email]) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.AlreadyExists);
        }
        this.accountToAppsMap[account.id] = [];
        this.emailToAccountMap[email] = account.id;
        this.accounts[account.id] = account;
        this.saveStateAsync();
        return q(account.id);
    }
    /**
     * 계정 정보 반환 함수
     */
    getAccount(accountId) {
        if (!this.accounts[accountId]) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        return q(clone(this.accounts[accountId]));
    }
    /**
     * 이메일을 통해서 계정 정보 반환
     */
    getAccountByEmail(email) {
        for (const id in this.accounts) {
            if (this.accounts[id].email === email) {
                return q(clone(this.accounts[id]));
            }
        }
        return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }
    /**
     * 계정 삭제
     */
    deleteAccount(accountId) {
        // 계정이 존재하지 않는 경우 reject
        if (this.accounts[accountId] === undefined) {
            return q.reject("There is no account");
        }
        delete this.accounts[accountId];
        this.saveStateAsync();
        return q(null);
    }
    /**
     * 계정 정보 업데이트
     */
    updateAccount(email, updates) {
        if (!email)
            throw new Error("No account email");
        return this.getAccountByEmail(email).then((account) => {
            merge(this.accounts[account.id], updates);
            this.saveStateAsync();
        });
    }
    /**
     * 현재 계정에 대한 협업자 추가
     */
    addCollaborator(accountId, appId, email) {
        if ((0, storage_1.isPrototypePollutionKey)(email)) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.Invalid, "Invalid email parameter");
        }
        return this.getApp(accountId, appId).then((app) => {
            if (this.isCollaborator(app.collaborators, email) || this.isOwner(app.collaborators, email)) {
                return S3Storage.getRejectedPromise(storage.ErrorCode.AlreadyExists);
            }
            const targetCollaboratorAccountId = this.emailToAccountMap[email.toLowerCase()];
            if (!targetCollaboratorAccountId) {
                return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound, S3Storage.AccountNotFound);
            }
            // Use the original email stored on the account to ensure casing is consistent
            email = this.accounts[targetCollaboratorAccountId].email;
            app.collaborators[email] = { accountId: targetCollaboratorAccountId, permission: storage.Permissions.Collaborator };
            this.addCollaboratorAccountPointer(targetCollaboratorAccountId, app.id);
            return this.updateApp(accountId, app);
        });
    }
    /**
     * 현재 앱에 대한 협업자(기여자) 정보 반환
     */
    getCollaborators(accountId, appId) {
        return this.getApp(accountId, appId).then((app) => {
            return q(app.collaborators);
        });
    }
    /**
     * 현재 앱에 대한 협업자(기여자) 삭제
     */
    removeCollaborator(accountId, appId, email) {
        return this.getApp(accountId, appId).then((app) => {
            if (this.isOwner(app.collaborators, email)) {
                return S3Storage.getRejectedPromise(storage.ErrorCode.AlreadyExists);
            }
            const targetCollaboratorAccountId = this.emailToAccountMap[email.toLowerCase()];
            if (!this.isCollaborator(app.collaborators, email) || !targetCollaboratorAccountId) {
                return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
            }
            this.removeCollaboratorAccountPointer(targetCollaboratorAccountId, appId);
            delete app.collaborators[email];
            return this.updateApp(accountId, app);
        });
    }
    /**
     * 액세스 키를 통한 계정 정보 반환
     */
    getAccountIdFromAccessKey(accessKey) {
        if (!this.accessKeyNameToAccountIdMap[accessKey]) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        if (new Date().getTime() >= this.accessKeyNameToAccountIdMap[accessKey].expires) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.Expired, "The access key has expired.");
        }
        return q(this.accessKeyNameToAccountIdMap[accessKey].accountId);
    }
    /**
     * 앱 추가
     *
     * // TODO s3로 수정 필요
     */
    addApp(accountId, app) {
        app = clone(app); // pass by value
        const account = this.accounts[accountId];
        if (!account) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        app.id = this.generateNewId();
        const accountApps = this.accountToAppsMap[accountId];
        if (accountApps.indexOf(app.id) === -1) {
            accountApps.push(app.id);
        }
        if (!this.appToDeploymentsMap[app.id]) {
            this.appToDeploymentsMap[app.id] = [];
        }
        this.appToAccountMap[app.id] = accountId;
        this.apps[app.id] = app;
        this.saveStateAsync();
        return q(clone(app));
    }
    /**
     * 현재 해당 계정으로 배포된 앱 정보들 반환
     *
     * // TODO s3로 수정 필요
     */
    getApps(accountId) {
        const appIds = this.accountToAppsMap[accountId];
        if (appIds) {
            const storageApps = appIds.map((id) => {
                return this.apps[id];
            });
            const apps = clone(storageApps);
            return q(apps);
        }
        return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }
    /**
     * 특정 App 정보 반환
     *
     * // TODO s3로 수정 필요
     */
    getApp(accountId, appId) {
        if (!this.accounts[accountId] || !this.apps[appId]) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        const app = clone(this.apps[appId]);
        return q(app);
    }
    /**
     * 앱 삭제
     *
     * // TODO s3로 수정 필요
     */
    removeApp(accountId, appId) {
        if (!this.accounts[accountId] || !this.apps[appId]) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        if (accountId !== this.appToAccountMap[appId]) {
            throw new Error("Wrong accountId");
        }
        const deployments = this.appToDeploymentsMap[appId].slice();
        const promises = [];
        deployments.forEach((deploymentId) => {
            promises.push(this.removeDeployment(accountId, appId, deploymentId));
        });
        return q.all(promises).then(() => {
            delete this.appToDeploymentsMap[appId];
            delete this.apps[appId];
            delete this.appToAccountMap[appId];
            const accountApps = this.accountToAppsMap[accountId];
            accountApps.splice(accountApps.indexOf(appId), 1);
            this.saveStateAsync();
            return q(null);
        });
    }
    /**
     * 앱 정보 업데이트
     *
     * // TODO s3로 수정 필요
     */
    updateApp(accountId, app) {
        app = clone(app); // pass by value
        if (!this.accounts[accountId] || !this.apps[app.id]) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        merge(this.apps[app.id], app);
        this.saveStateAsync();
        return q(null);
    }
    /**
     * 권한 이전 함수
     *
     * @deprecated
     */
    transferApp(accountId, appId, email) {
        if ((0, storage_1.isPrototypePollutionKey)(email)) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.Invalid, "Invalid email parameter");
        }
        return this.getApp(accountId, appId).then((app) => {
            const targetOwnerAccountId = this.emailToAccountMap[email.toLowerCase()];
            if (!targetOwnerAccountId) {
                return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound, S3Storage.AccountNotFound);
            }
            // Use the original email stored on the account to ensure casing is consistent
            email = this.accounts[targetOwnerAccountId].email;
            return this.updateApp(accountId, app);
        });
    }
    /**
     * 특정 스테이지(production, staging)에 앱 배포
     */
    addDeployment(accountId, appId, deployment) {
        deployment = clone(deployment);
        const app = this.apps[appId];
        if (!this.accounts[accountId] || !app) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        deployment.id = this.generateNewId();
        deployment.packageHistory = [];
        const appDeployments = this.appToDeploymentsMap[appId];
        if (appDeployments.indexOf(deployment.id) === -1) {
            appDeployments.push(deployment.id);
        }
        this.deploymentToAppMap[deployment.id] = appId;
        this.deployments[deployment.id] = deployment;
        this.deploymentKeyToDeploymentMap[deployment.key] = deployment.id;
        this.saveStateAsync();
        return q(deployment.id);
    }
    /**
     * 특정 배포 ID를 통해 앱 ID, 배포 ID 반환
     */
    getDeploymentInfo(deploymentKey) {
        const deploymentId = this.deploymentKeyToDeploymentMap[deploymentKey];
        const deployment = this.deployments[deploymentId];
        if (!deploymentId || !deployment) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        const appId = this.deploymentToAppMap[deployment.id];
        if (!appId) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        return q({ appId: appId, deploymentId: deploymentId });
    }
    /**
     * 앱 스테이지의 키에 따른 패키지 히스토리 반환
     */
    getPackageHistoryFromDeploymentKey(deploymentKey) {
        const deploymentId = this.deploymentKeyToDeploymentMap[deploymentKey];
        if (!deploymentId || !this.deployments[deploymentId]) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        return q(clone(this.deployments[deploymentId].packageHistory));
    }
    /**
     * 계정, 앱, 배포 정보를 통해 특정 스테이지의 배포 정보 반환
     */
    getDeployment(accountId, appId, deploymentId) {
        if (!this.accounts[accountId] || !this.apps[appId] || !this.deployments[deploymentId]) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        return q(clone(this.deployments[deploymentId]));
    }
    /**
     * 특정 계정과 앱에 대한 모든 배포 정보 반환
     */
    getDeployments(accountId, appId) {
        const deploymentIds = this.appToDeploymentsMap[appId];
        if (this.accounts[accountId] && deploymentIds) {
            const deployments = deploymentIds.map((id) => {
                return this.deployments[id];
            });
            return q(clone(deployments));
        }
        return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }
    /**
     * 특정 스테이지 배포 삭제
     */
    removeDeployment(accountId, appId, deploymentId) {
        if (!this.accounts[accountId] || !this.apps[appId] || !this.deployments[deploymentId]) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        if (appId !== this.deploymentToAppMap[deploymentId]) {
            throw new Error("Please Check App Id");
        }
        const deployment = this.deployments[deploymentId];
        delete this.deploymentKeyToDeploymentMap[deployment.key];
        delete this.deployments[deploymentId];
        delete this.deploymentToAppMap[deploymentId];
        const appDeployments = this.appToDeploymentsMap[appId];
        appDeployments.splice(appDeployments.indexOf(deploymentId), 1);
        this.saveStateAsync();
        return q(null);
    }
    /**
     * 특정 스테이지 배포 업데이트
     */
    updateDeployment(accountId, appId, deployment) {
        deployment = clone(deployment); // pass by value
        if (!this.accounts[accountId] || !this.apps[appId] || !this.deployments[deployment.id]) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        delete deployment.package; // No-op if a package update is attempted through this method
        merge(this.deployments[deployment.id], deployment);
        this.saveStateAsync();
        return q(null);
    }
    /**
     * 특정 앱의 스테이지 내 배포 히스토리 추가
     */
    commitPackage(accountId, appId, deploymentId, appPackage) {
        appPackage = clone(appPackage); // pass by value
        if (!appPackage)
            throw new Error("No package specified");
        if (!this.accounts[accountId] || !this.apps[appId] || !this.deployments[deploymentId]) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        const deployment = this.deployments[deploymentId];
        deployment.package = appPackage;
        const history = deployment.packageHistory;
        // Unset rollout value for last package for rollback.
        const lastPackage = history.length ? history[history.length - 1] : null;
        if (lastPackage) {
            lastPackage.rollout = null;
        }
        deployment.packageHistory.push(appPackage);
        appPackage.label = "v" + deployment.packageHistory.length;
        this.saveStateAsync();
        return q(clone(appPackage));
    }
    /**
     * 특정 앱의 스테이지 내 배포 히스토리 초기화
     */
    clearPackageHistory(deploymentId) {
        const deployment = this.deployments[deploymentId];
        if (!deployment) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        delete deployment.package;
        deployment.packageHistory = [];
        this.saveStateAsync();
        return q(null);
    }
    /**
     * 특정 앱의 스테이지 내 배포 히스토리 반환
     */
    getPackageHistory(deploymentId) {
        const deployment = this.deployments[deploymentId];
        if (!deployment) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        return q(clone(deployment.packageHistory));
    }
    /**
     * 특정 앱의 스테이지 내 배포 히스토리 업데이트
     */
    updatePackageHistory(deploymentId, history) {
        if (!history || !history.length) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.Invalid, "Cannot clear package history from an update operation");
        }
        const deployment = this.deployments[deploymentId];
        if (!deployment) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        deployment.package = history[history.length - 1];
        deployment.packageHistory = history;
        this.saveStateAsync();
        return q(null);
    }
    /**
     * Blob 파일 추가
     */
    addBlob(blobId, stream) {
        this.blobs[blobId] = "";
        // eslint-disable-next-line no-unused-vars
        return q.Promise((resolve) => {
            stream
                .on("data", (data) => {
                this.blobs[blobId] += data;
            })
                .on("end", () => {
                resolve(blobId);
            });
            this.saveStateAsync();
        });
    }
    /**
     * Blob 파일 URL 반환
     */
    getBlobUrl(blobId) {
        return this.getBlobServer().then((server) => {
            const addr = server.address();
            if (typeof addr === "string") {
                return addr + "/" + blobId;
            }
            // addr가 객체인 경우 적절한 URL 형식으로 변환
            return `http://172.30.1.86:${addr.port}/${blobId}`;
        });
    }
    /**
     * Blob 파일 제거
     */
    removeBlob(blobId) {
        delete this.blobs[blobId];
        this.saveStateAsync();
        return q(null);
    }
    /**
     * 액세스 키 추가
     */
    addAccessKey(accountId, accessKey) {
        accessKey = clone(accessKey);
        const account = this.accounts[accountId];
        if (!account) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        accessKey.id = this.generateNewId();
        let accountAccessKeys = this.accountToAccessKeysMap[accountId];
        if (!accountAccessKeys) {
            accountAccessKeys = this.accountToAccessKeysMap[accountId] = [];
        }
        else if (accountAccessKeys.indexOf(accessKey.id) !== -1) {
            return q("");
        }
        accountAccessKeys.push(accessKey.id);
        this.accessKeyToAccountMap[accessKey.id] = accountId;
        this.accessKeys[accessKey.id] = accessKey;
        this.accessKeyNameToAccountIdMap[accessKey.name] = { accountId, expires: accessKey.expires };
        this.saveStateAsync();
        return q(accessKey.id);
    }
    /**
     * 액세스 키 정보 반환
     */
    getAccessKey(accountId, accessKeyId) {
        const expectedAccountId = this.accessKeyToAccountMap[accessKeyId];
        if (!expectedAccountId || expectedAccountId !== accountId) {
            return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
        }
        return q(clone(this.accessKeys[accessKeyId]));
    }
    /**
     * 계정에 대한 모든 액세스 키 정보 반환
     */
    getAccessKeys(accountId) {
        const accessKeyIds = this.accountToAccessKeysMap[accountId];
        if (accessKeyIds) {
            const accessKeys = accessKeyIds.map((id) => {
                return this.accessKeys[id];
            });
            return q(clone(accessKeys));
        }
        return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }
    /**
     * 액세스 키 삭제
     */
    removeAccessKey(accountId, accessKeyId) {
        const expectedAccountId = this.accessKeyToAccountMap[accessKeyId];
        if (expectedAccountId && expectedAccountId === accountId) {
            const accessKey = this.accessKeys[accessKeyId];
            delete this.accessKeyNameToAccountIdMap[accessKey.name];
            delete this.accessKeys[accessKeyId];
            delete this.accessKeyToAccountMap[accessKeyId];
            const accessKeyIds = this.accountToAccessKeysMap[accountId];
            const index = accessKeyIds.indexOf(accessKeyId);
            if (index >= 0) {
                accessKeyIds.splice(index, /*deleteCount*/ 1);
            }
            this.saveStateAsync();
            return q(null);
        }
        return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }
    /**
     * 액세스 키 업데이트
     */
    updateAccessKey(accountId, accessKey) {
        accessKey = clone(accessKey); // pass by value
        if (accessKey && accessKey.id) {
            const expectedAccountId = this.accessKeyToAccountMap[accessKey.id];
            if (expectedAccountId && expectedAccountId === accountId) {
                merge(this.accessKeys[accessKey.id], accessKey);
                this.accessKeyNameToAccountIdMap[accessKey.name].expires = accessKey.expires;
                this.saveStateAsync();
                return q(null);
            }
        }
        return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }
    /**
     * Blob Server 종료
     */
    dropAll() {
        if (this._blobServerPromise) {
            return this._blobServerPromise.then((server) => {
                const deferred = q.defer();
                server.close((err) => {
                    if (err) {
                        deferred.reject(err);
                    }
                    else {
                        deferred.resolve();
                    }
                });
                return deferred.promise;
            });
        }
        return q(null);
    }
    /**
     * Blob Server 반환
     */
    getBlobServer() {
        if (!this._blobServerPromise) {
            const app = express();
            app.get("/:blobId", (req, res) => {
                const blobId = req.params.blobId;
                if (this.blobs[blobId]) {
                    res.send(this.blobs[blobId]);
                }
                else {
                    res.sendStatus(404);
                }
            });
            const deferred = q.defer();
            const server = app.listen(0, () => {
                deferred.resolve(server);
            });
            this._blobServerPromise = deferred.promise;
        }
        return this._blobServerPromise;
    }
    /**
     * 새로운 ObjectId 생성
     */
    generateNewId() {
        const id = "id_" + S3Storage.NextIdNumber;
        S3Storage.NextIdNumber += 1;
        return id;
    }
    /**
     * Error Response 반환
     */
    static getRejectedPromise(errorCode, message) {
        return q.reject(storage.storageError(errorCode, message));
    }
    /**
     * 현재 앱 소유자 여부 확인
     */
    isOwner(list, email) {
        return list && list[email] && list[email].permission === storage.Permissions.Owner;
    }
    /**
     * 현재 앱 기여자 여부 확인
     */
    isCollaborator(list, email) {
        return list && list[email] && list[email].permission === storage.Permissions.Collaborator;
    }
    /**
     * 현재 계정에 대한 앱 포인터 삭제
     */
    removeCollaboratorAccountPointer(accountId, appId) {
        const accountApps = this.accountToAppsMap[accountId];
        const index = accountApps.indexOf(appId);
        if (index > -1) {
            accountApps.splice(index, 1);
        }
    }
    /**
     * 현재 계정에 대한 앱 포인터 추가
     */
    addCollaboratorAccountPointer(accountId, appId) {
        const accountApps = this.accountToAppsMap[accountId];
        if (accountApps.indexOf(appId) === -1) {
            accountApps.push(appId);
        }
    }
}
exports.S3Storage = S3Storage;
