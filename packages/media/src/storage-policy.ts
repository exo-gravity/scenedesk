/** Explicit private-bucket policies, shared by the local provisioner and permission tests. */
export function mediaStoragePolicy(bucketName: string, role: "api" | "worker") {
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
            allow(
              ["s3:GetObjectVersion"],
              [`${bucket}/originals/*`, `${bucket}/derivatives/*`],
            ),
          ]
        : [
            allow(["s3:GetObject"], [`${bucket}/staging/*`]),
            allow(
              ["s3:GetObjectVersion"],
              [
                `${bucket}/staging/*`,
                `${bucket}/originals/*`,
                `${bucket}/derivatives/*`,
              ],
            ),
            allow(
              ["s3:PutObject"],
              [`${bucket}/originals/*`, `${bucket}/derivatives/*`],
            ),
          ]),
    ],
  };
}
