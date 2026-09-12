import { Button, Loader, Stack, Text } from "@mantine/core";
import { ArrowLeft } from "@phosphor-icons/react";
import { useResource, type Schema } from "./api";
import { ErrorNotice } from "./common";
import { ProposalDetail } from "./ProposalWorkspace";
import classes from "./assistant.module.css";
export function AssistantProposal({
  path,
  proposalId,
  sceneTitle,
  active,
  onClose,
}: {
  path: string;
  proposalId: string;
  sceneTitle: string;
  active: boolean;
  onClose: () => void;
}) {
  const tree = useResource<Schema<"ContentTree">>(`${path}/content`);
  return (
    <Stack gap="lg" className={classes.proposal}>
      <Button
        leftSection={<ArrowLeft size={16} />}
        variant="subtle"
        w="fit-content"
        onClick={onClose}
      >
        返回场次制作
      </Button>
      <div>
        <Text fw={600}>分镜提案</Text>
        <Text size="sm" c="dimmed">
          先编辑建议，再选择要新增的镜头。原剧本和已有镜头保留。
        </Text>
      </div>
      <ErrorNotice error={tree.error} retry={() => void tree.refetch()} />
      {tree.data ? (
        <ProposalDetail
          key={proposalId}
          path={path}
          id={proposalId}
          tree={tree.data}
          active={active}
          projectName={sceneTitle}
          onClose={onClose}
        />
      ) : (
        <Loader aria-label="正在读取分镜提案目标" />
      )}
    </Stack>
  );
}
