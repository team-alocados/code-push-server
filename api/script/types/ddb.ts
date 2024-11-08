import type { PackageHashToBlobInfoMap } from "../storage/storage";

export interface User {
  email: string;
  name: string;
  github: string;
}

export interface App {
  name: string;
  created_time: string;
}

export interface Deployment {
  key: string;
  name: string;
}

export interface Package {
  appVersion: string;
  blobUrl: string;
  description: string;
  diffPackageMap?: PackageHashToBlobInfoMap;
  isDisabled: boolean;
  isMandatory: boolean;
  label?: string;
  manifestBlobUrl: string;
  originalDeployment?: string;
  originalLabel?: string;
  packageHash: string;
  releasedBy?: string;
  releaseMethod?: string;
  rollout?: number;
  size: number;
  uploadTime: number;
}
