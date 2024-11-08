import * as AWS from "@aws-sdk/client-s3";

/**
 * S3 Bucket Class
 */
class S3 {
  private static _s3 = new AWS.S3Client({});

  static async uploadFile() {}

  /**
   * Read file from S3 bucket
   */
  static async readFile(stage: "alpha" | "prod") {
    const params = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: `${stage}/`,
    };

    const { Body } = await this._s3.send(new AWS.GetObjectCommand(params));

    return Body;
  }
}

export default S3;
