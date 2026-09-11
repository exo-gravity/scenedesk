import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { useResource, useSession, type Schema } from "./api";
import { ErrorNotice, tenantPath } from "./common";
import { mediaPost } from "./media-imports";
import classes from "./image-generation.module.css";
export function GeneratedImageResult({
  tenantId,
  projectId,
  jobId,
  mediaId,
}: {
  tenantId: string;
  projectId: string;
  jobId: string;
  mediaId: string;
}) {
  const path = tenantPath(tenantId),
    session = useSession();
  const media = useResource<Schema<"Media">>(`${path}/media/${mediaId}`);
  const valid =
    media.data?.kind === "image" &&
    media.data.sourceJobId === jobId &&
    ["ready", "archived"].includes(media.data.status);
  const variant = media.data?.derivatives.some(
    (d) => d.kind === "poster" && d.status === "ready",
  )
    ? "poster"
    : "original";
  const [failed, setFailed] = useState(false);
  const access = useQuery({
    queryKey: ["image-result-access", session.id, mediaId, variant],
    enabled: !!valid,
    staleTime: 240000,
    retry: false,
    queryFn: ({ signal }) =>
      mediaPost<Schema<"AccessGrant">>(
        session,
        `${path}/media/${mediaId}/access`,
        { variant, disposition: "inline" },
        signal,
      ),
  });
  if (media.error)
    return (
      <ErrorNotice error={media.error} retry={() => void media.refetch()} />
    );
  if (!media.data) return <Loader size="sm" aria-label="正在读取图片结果" />;
  if (!valid)
    return (
      <Alert>图片结果尚不可用。原任务与素材身份已保留，可稍后重新读取。</Alert>
    );
  return (
    <Stack gap="sm" className={classes.result}>
      <Group justify="space-between">
        <Text fw={600}>{media.data.displayName}</Text>
        <Badge variant="light">独立图片结果</Badge>
      </Group>
      {access.error || failed ? (
        <Stack>
          <ErrorNotice error={access.error} />
          <Text size="sm">图片预览暂不可读取，结果仍保留在素材中。</Text>
          <Button
            variant="default"
            onClick={() => {
              setFailed(false);
              void access.refetch();
            }}
          >
            重新读取图片
          </Button>
        </Stack>
      ) : access.data ? (
        <img
          className={classes.preview}
          src={access.data.url}
          alt={media.data.displayName}
          onError={() => setFailed(true)}
        />
      ) : (
        <Loader size="sm" aria-label="正在读取原图" />
      )}
      <Button
        component="a"
        variant="default"
        leftSection={<ArrowSquareOut size={16} />}
        href={`#/app/t/${tenantId}/p/${projectId}/media?media=${mediaId}`}
      >
        在素材中取回原图
      </Button>
    </Stack>
  );
}
