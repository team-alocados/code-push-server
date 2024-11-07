// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// TODO aws sdk를 통해서 s3 업로드 하기

import * as express from "express";
import * as fs from "fs";
import * as http from "http";
import * as stream from "stream";
import * as q from "q";

import * as storage from "./storage";

import clone = storage.clone;
import Promise = q.Promise;

import { isPrototypePollutionKey } from "./storage";

function merge(original: any, updates: any): void {
  for (const property in updates) {
    original[property] = updates[property];
  }
}

// TODO 각 메소드 별 파라미터 type 점검하기
export class S3Storage implements storage.Storage {
  public static NextIdNumber: number = 0;

  public accounts: { [id: string]: storage.Account } = {};
  public apps: { [id: string]: storage.App } = {};
  public deployments: { [id: string]: storage.Deployment } = {};
  public packages: { [id: string]: storage.Package } = {};
  public blobs: { [id: string]: string } = {};
  public accessKeys: { [id: string]: storage.AccessKey } = {};

  public accountToAppsMap: { [id: string]: string[] } = {};
  public appToAccountMap: { [id: string]: string } = {};
  public emailToAccountMap: { [email: string]: string } = {};

  public appToDeploymentsMap: { [id: string]: string[] } = {};
  public deploymentToAppMap: { [id: string]: string } = {};

  public deploymentKeyToDeploymentMap: { [id: string]: string } = {};

  public accountToAccessKeysMap: { [id: string]: string[] } = {};
  public accessKeyToAccountMap: { [id: string]: string } = {};

  public accessKeyNameToAccountIdMap: { [accessKeyName: string]: { accountId: string; expires: number } } = {};

  private static CollaboratorNotFound: string = "The specified e-mail address doesn't represent a registered user";
  private _blobServerPromise: Promise<http.Server>;

  constructor() {
    this.loadStateAsync(); // Attempts to load real data if any exists
  }

  /**
   * 최초 정보 불러오기
   *
   * // TODO config.json을 DB에서 읽어오는 것으로 대체해야함
   * // TODO 번들 파일은 S3에서 가져와야함
   */
  private loadStateAsync(): void {
    fs.exists(
      "config.json",
      function (exists: boolean) {
        if (exists) {
          fs.readFile(
            "config.json",
            function (err: any, data: string) {
              if (err) throw err;

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
            }.bind(this)
          );
        }
      }.bind(this)
    );
  }

  /**
   * 모든 정보에 대한 저장 함수
   *
   * 모든 메소드 호출 시 마지막에 해당 함수를 통해 저장
   *
   */
  // TODO DB에 작성하자
  private saveStateAsync(): void {
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
      if (err) throw err;
    });
  }

  // TODO 배포 시 blob 저장하는 작성 필요함
  private saveBlob(): void {
    //
  }

  public checkHealth(): Promise<void> {
    return q.reject<void>("Should not be running JSON storage in production");
  }

  /**
   * 계정 추가 함수
   */
  public addAccount(account: storage.Account): Promise<string> {
    account = clone(account);
    account.id = this.generateNewId();
    const email: string = account.email.toLowerCase();

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
  public getAccount(accountId: string): Promise<storage.Account> {
    if (!this.accounts[accountId]) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return q(clone(this.accounts[accountId]));
  }

  /**
   * 이메일을 통해서 계정 정보 반환
   */
  public getAccountByEmail(email: string): Promise<storage.Account> {
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
  public deleteAccount(accountId: string): Promise<void> {
    // 계정이 존재하지 않는 경우 reject
    if (this.accounts[accountId] === undefined) {
      return q.reject<void>("There is no account");
    }

    delete this.accounts[accountId];

    this.saveStateAsync();

    return q(<void>null);
  }

  /**
   * 계정 정보 업데이트
   */
  public updateAccount(email: string, updates: storage.Account): Promise<void> {
    if (!email) throw new Error("No account email");

    return this.getAccountByEmail(email).then((account: storage.Account) => {
      merge(this.accounts[account.id], updates);
      this.saveStateAsync();
    });
  }

  /**
   * 액세스 키를 통한 계정 정보 반환
   */
  public getAccountIdFromAccessKey(accessKey: string): Promise<string> {
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
  public addApp(accountId: string, app: storage.App): Promise<storage.App> {
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
  public getApps(accountId: string): Promise<storage.App[]> {
    const appIds = this.accountToAppsMap[accountId];

    if (appIds) {
      const storageApps = appIds.map((id: string) => {
        return this.apps[id];
      });
      const apps: storage.App[] = clone(storageApps);

      return q(apps);
    }

    return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  /**
   * 특정 App 정보 반환
   *
   * // TODO s3로 수정 필요
   */
  public getApp(accountId: string, appId: string): Promise<storage.App> {
    if (!this.accounts[accountId] || !this.apps[appId]) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    const app: storage.App = clone(this.apps[appId]);

    return q(app);
  }

  /**
   * 앱 삭제
   *
   * // TODO s3로 수정 필요
   */
  public removeApp(accountId: string, appId: string): Promise<void> {
    if (!this.accounts[accountId] || !this.apps[appId]) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    if (accountId !== this.appToAccountMap[appId]) {
      throw new Error("Wrong accountId");
    }

    const deployments = this.appToDeploymentsMap[appId].slice();
    const promises: any[] = [];
    deployments.forEach((deploymentId: string) => {
      promises.push(this.removeDeployment(accountId, appId, deploymentId));
    });

    return q.all(promises).then(() => {
      delete this.appToDeploymentsMap[appId];
      delete this.apps[appId];
      delete this.appToAccountMap[appId];

      const accountApps = this.accountToAppsMap[accountId];
      accountApps.splice(accountApps.indexOf(appId), 1);

      this.saveStateAsync();

      return q(<void>null);
    });
  }

  /**
   * 앱 정보 업데이트
   *
   * // TODO s3로 수정 필요
   */
  public updateApp(accountId: string, app: storage.App): Promise<void> {
    app = clone(app); // pass by value

    if (!this.accounts[accountId] || !this.apps[app.id]) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    merge(this.apps[app.id], app);

    this.saveStateAsync();
    return q(<void>null);
  }

  /**
   * 권한 이전 함수
   *
   * @deprecated
   */
  public transferApp(accountId: string, appId: string, email: string): Promise<void> {
    if (isPrototypePollutionKey(email)) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.Invalid, "Invalid email parameter");
    }
    return this.getApp(accountId, appId).then((app: storage.App) => {
      const targetOwnerAccountId: string = this.emailToAccountMap[email.toLowerCase()];

      if (!targetOwnerAccountId) {
        return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound, S3Storage.CollaboratorNotFound);
      }

      // Use the original email stored on the account to ensure casing is consistent
      email = this.accounts[targetOwnerAccountId].email;

      return this.updateApp(accountId, app);
    });
  }

  /**
   * 특정 스테이지(production, staging)에 앱 배포
   */
  public addDeployment(accountId: string, appId: string, deployment: storage.Deployment): Promise<string> {
    deployment = clone(deployment);

    const app: storage.App = this.apps[appId];

    if (!this.accounts[accountId] || !app) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    deployment.id = this.generateNewId();

    (<any>deployment).packageHistory = [];

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
  public getDeploymentInfo(deploymentKey: string): Promise<storage.DeploymentInfo> {
    const deploymentId: string = this.deploymentKeyToDeploymentMap[deploymentKey];
    const deployment: storage.Deployment = this.deployments[deploymentId];

    if (!deploymentId || !deployment) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    const appId: string = this.deploymentToAppMap[deployment.id];

    if (!appId) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return q({ appId: appId, deploymentId: deploymentId });
  }

  /**
   * 앱 스테이지의 키에 따른 패키지 히스토리 반환
   */
  public getPackageHistoryFromDeploymentKey(deploymentKey: string): Promise<storage.Package[]> {
    const deploymentId: string = this.deploymentKeyToDeploymentMap[deploymentKey];
    if (!deploymentId || !this.deployments[deploymentId]) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return q(clone((<any>this.deployments[deploymentId]).packageHistory));
  }

  /**
   * 계정, 앱, 배포 정보를 통해 특정 스테이지의 배포 정보 반환
   */
  public getDeployment(accountId: string, appId: string, deploymentId: string): Promise<storage.Deployment> {
    if (!this.accounts[accountId] || !this.apps[appId] || !this.deployments[deploymentId]) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return q(clone(this.deployments[deploymentId]));
  }

  /**
   * 특정 계정과 앱에 대한 모든 배포 정보 반환
   */
  public getDeployments(accountId: string, appId: string): Promise<storage.Deployment[]> {
    const deploymentIds = this.appToDeploymentsMap[appId];
    if (this.accounts[accountId] && deploymentIds) {
      const deployments = deploymentIds.map((id: string) => {
        return this.deployments[id];
      });
      return q(clone(deployments));
    }

    return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  /**
   * 특정 스테이지 배포 삭제
   */
  public removeDeployment(accountId: string, appId: string, deploymentId: string): Promise<void> {
    if (!this.accounts[accountId] || !this.apps[appId] || !this.deployments[deploymentId]) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    if (appId !== this.deploymentToAppMap[deploymentId]) {
      throw new Error("Please Check App Id");
    }

    const deployment: storage.Deployment = this.deployments[deploymentId];

    delete this.deploymentKeyToDeploymentMap[deployment.key];
    delete this.deployments[deploymentId];
    delete this.deploymentToAppMap[deploymentId];

    const appDeployments = this.appToDeploymentsMap[appId];

    appDeployments.splice(appDeployments.indexOf(deploymentId), 1);

    this.saveStateAsync();
    return q(<void>null);
  }

  /**
   * 특정 스테이지 배포 업데이트
   */
  public updateDeployment(accountId: string, appId: string, deployment: storage.Deployment): Promise<void> {
    deployment = clone(deployment); // pass by value

    if (!this.accounts[accountId] || !this.apps[appId] || !this.deployments[deployment.id]) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    delete deployment.package; // No-op if a package update is attempted through this method
    merge(this.deployments[deployment.id], deployment);

    this.saveStateAsync();
    return q(<void>null);
  }

  /**
   * 특정 앱의 스테이지 내 배포 히스토리 추가
   */
  public commitPackage(accountId: string, appId: string, deploymentId: string, appPackage: storage.Package): Promise<storage.Package> {
    appPackage = clone(appPackage); // pass by value

    if (!appPackage) throw new Error("No package specified");

    if (!this.accounts[accountId] || !this.apps[appId] || !this.deployments[deploymentId]) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    const deployment: any = <any>this.deployments[deploymentId];
    deployment.package = appPackage;
    const history: storage.Package[] = deployment.packageHistory;

    // Unset rollout value for last package for rollback.
    const lastPackage: storage.Package = history.length ? history[history.length - 1] : null;
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
  public clearPackageHistory(deploymentId: string): Promise<void> {
    const deployment: storage.Deployment = this.deployments[deploymentId];
    if (!deployment) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    delete deployment.package;
    (<any>deployment).packageHistory = [];

    this.saveStateAsync();
    return q(<void>null);
  }

  /**
   * 특정 앱의 스테이지 내 배포 히스토리 반환
   */
  public getPackageHistory(deploymentId: string): Promise<storage.Package[]> {
    const deployment: any = <any>this.deployments[deploymentId];
    if (!deployment) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return q(clone(deployment.packageHistory));
  }

  /**
   * 특정 앱의 스테이지 내 배포 히스토리 업데이트
   */
  public updatePackageHistory(deploymentId: string, history: storage.Package[]): Promise<void> {
    if (!history || !history.length) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.Invalid, "Cannot clear package history from an update operation");
    }

    const deployment: any = <any>this.deployments[deploymentId];
    if (!deployment) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    deployment.package = history[history.length - 1];
    deployment.packageHistory = history;
    this.saveStateAsync();

    return q(<void>null);
  }

  /**
   * Blob 파일 추가
   */
  public addBlob(blobId: string, stream: stream.Readable): Promise<string> {
    this.blobs[blobId] = "";
    // eslint-disable-next-line no-unused-vars
    return q.Promise<string>((resolve: (blobId: string) => void) => {
      stream
        .on("data", (data: string) => {
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
  public getBlobUrl(blobId: string): Promise<string> {
    return this.getBlobServer().then((server: http.Server) => {
      return server.address() + "/" + blobId;
    });
  }

  /**
   * Blob 파일 제거
   */
  public removeBlob(blobId: string): Promise<void> {
    delete this.blobs[blobId];

    this.saveStateAsync();
    return q(<void>null);
  }

  /**
   * 액세스 키 추가
   */
  public addAccessKey(accountId: string, accessKey: storage.AccessKey): Promise<string> {
    accessKey = clone(accessKey);

    const account: storage.Account = this.accounts[accountId];

    if (!account) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    accessKey.id = this.generateNewId();

    let accountAccessKeys: string[] = this.accountToAccessKeysMap[accountId];

    if (!accountAccessKeys) {
      accountAccessKeys = this.accountToAccessKeysMap[accountId] = [];
    } else if (accountAccessKeys.indexOf(accessKey.id) !== -1) {
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
  public getAccessKey(accountId: string, accessKeyId: string): Promise<storage.AccessKey> {
    const expectedAccountId: string = this.accessKeyToAccountMap[accessKeyId];

    if (!expectedAccountId || expectedAccountId !== accountId) {
      return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return q(clone(this.accessKeys[accessKeyId]));
  }

  /**
   * 계정에 대한 모든 액세스 키 정보 반환
   */
  public getAccessKeys(accountId: string): Promise<storage.AccessKey[]> {
    const accessKeyIds: string[] = this.accountToAccessKeysMap[accountId];

    if (accessKeyIds) {
      const accessKeys: storage.AccessKey[] = accessKeyIds.map((id: string): storage.AccessKey => {
        return this.accessKeys[id];
      });

      return q(clone(accessKeys));
    }

    return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  /**
   * 액세스 키 삭제
   */
  public removeAccessKey(accountId: string, accessKeyId: string): Promise<void> {
    const expectedAccountId: string = this.accessKeyToAccountMap[accessKeyId];

    if (expectedAccountId && expectedAccountId === accountId) {
      const accessKey: storage.AccessKey = this.accessKeys[accessKeyId];

      delete this.accessKeyNameToAccountIdMap[accessKey.name];
      delete this.accessKeys[accessKeyId];
      delete this.accessKeyToAccountMap[accessKeyId];

      const accessKeyIds: string[] = this.accountToAccessKeysMap[accountId];
      const index: number = accessKeyIds.indexOf(accessKeyId);

      if (index >= 0) {
        accessKeyIds.splice(index, /*deleteCount*/ 1);
      }

      this.saveStateAsync();
      return q(<void>null);
    }

    return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  /**
   * 액세스 키 업데이트
   */
  public updateAccessKey(accountId: string, accessKey: storage.AccessKey): Promise<void> {
    accessKey = clone(accessKey); // pass by value

    if (accessKey && accessKey.id) {
      const expectedAccountId: string = this.accessKeyToAccountMap[accessKey.id];

      if (expectedAccountId && expectedAccountId === accountId) {
        merge(this.accessKeys[accessKey.id], accessKey);
        this.accessKeyNameToAccountIdMap[accessKey.name].expires = accessKey.expires;

        this.saveStateAsync();
        return q(<void>null);
      }
    }

    return S3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  /**
   * Blob Server 종료
   */
  public dropAll(): Promise<void> {
    if (this._blobServerPromise) {
      return this._blobServerPromise.then((server: http.Server) => {
        const deferred: q.Deferred<void> = q.defer<void>();
        server.close((err?: Error) => {
          if (err) {
            deferred.reject(err);
          } else {
            deferred.resolve();
          }
        });
        return deferred.promise;
      });
    }

    return q(<void>null);
  }

  private getBlobServer(): Promise<http.Server> {
    if (!this._blobServerPromise) {
      const app: express.Express = express();

      app.get("/:blobId", (req: express.Request, res: express.Response, next: (err?: Error) => void): any => {
        const blobId: string = req.params.blobId;
        if (this.blobs[blobId]) {
          res.send(this.blobs[blobId]);
        } else {
          res.sendStatus(404);
        }
      });

      const deferred: q.Deferred<http.Server> = q.defer<http.Server>();
      const server: http.Server = app.listen(0, () => {
        deferred.resolve(server);
      });

      this._blobServerPromise = deferred.promise;
    }

    return this._blobServerPromise;
  }

  private generateNewId(): string {
    const id = "id_" + S3Storage.NextIdNumber;
    S3Storage.NextIdNumber += 1;

    return id;
  }

  private static getRejectedPromise(errorCode: storage.ErrorCode, message?: string): Promise<any> {
    return q.reject(storage.storageError(errorCode, message));
  }
}
