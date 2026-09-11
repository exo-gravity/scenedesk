/** MinIO also matches GetObjectVersion to GetObject; require an explicit version on that grant. */
function fixedVersionRead(Resource: string[]) {
  return {
    Effect: "Allow",
    Action: ["s3:GetObjectVersion"],
    Resource,
    Condition: {
      Null: { "s3:versionid": "false" },
      // The pinned MinIO server supplies an empty value even when the query key is absent.
      StringNotEquals: { "s3:versionid": ["", "null"] },
    },
  };
}

/** Explicit private-bucket policies, shared by the local provisioner and permission tests. */
export function mediaStoragePolicy(
  bucketName: string,
  role: "api" | "worker",
  productionBucket?: string,
) {
  if (productionBucket === bucketName)
    throw new Error("Production artifacts require a separate private bucket");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName))
    throw new Error("Invalid media bucket");
  const bucket = `arn:aws:s3:::${bucketName}`;
  const allow = (Action: string[], Resource: string[]) => ({
    Effect: "Allow",
    Action,
    Resource,
  });
  return {
    Version: "2012-10-17",
    Statement: [
      allow(["s3:GetBucketVersioning"], [bucket]),
      ...(role === "api"
        ? [
            allow(["s3:PutObject"], [`${bucket}/staging/*`]),
            fixedVersionRead([
              `${bucket}/originals/*`,
              `${bucket}/derivatives/*`,
            ]),
          ]
        : [
            allow(["s3:GetObject"], [`${bucket}/staging/*`]),
            fixedVersionRead([
              `${bucket}/staging/*`,
              `${bucket}/originals/*`,
              `${bucket}/derivatives/*`,
            ]),
            allow(
              ["s3:PutObject"],
              [`${bucket}/originals/*`, `${bucket}/derivatives/*`],
            ),
          ]),
      ...(role === "worker" && productionBucket
        ? productionStoragePolicy(productionBucket).Statement
        : []),
    ],
  };
}

/** Multipart enumeration cannot be prefix-restricted by AWS IAM; isolate it in the internal bucket. */
export function productionStoragePolicy(bucketName: string) {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName))
    throw new Error("Invalid production bucket");
  const bucket = `arn:aws:s3:::${bucketName}`;
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["s3:GetBucketVersioning", "s3:ListBucketMultipartUploads"],
        Resource: [bucket],
      },
      {
        Effect: "Allow",
        Action: ["s3:ListBucketVersions"],
        Resource: [bucket],
        Condition: { StringLike: { "s3:prefix": "productions/*" } },
      },
      fixedVersionRead([`${bucket}/productions/*`]),
      {
        Effect: "Allow",
        Action: [
          "s3:PutObject",
          "s3:ListMultipartUploadParts",
          "s3:AbortMultipartUpload",
        ],
        Resource: [`${bucket}/productions/*`],
      },
    ],
  };
}
