import { Alert, Button, Group, Text } from "@mantine/core";
import { WarningCircle } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import classes from "./workbench.module.css";

export function ErrorNotice({
  error,
  retry,
}: {
  error: Error | null;
  retry?: () => void;
}) {
  if (!error) return null;
  return (
    <Alert
      role="alert"
      title="操作未完成"
      icon={<WarningCircle size={20} />}
      className={classes.error}
    >
      <Text>{error.message}</Text>
      {retry && (
        <Button mt="sm" onClick={retry}>
          重新读取
        </Button>
      )}
    </Alert>
  );
}
export function SectionHeading({
  title,
  description,
  action,
  level = 1,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <Group justify="space-between" align="flex-start" mb="xl" wrap="wrap">
      <div>
        <Heading className={classes.title}>{title}</Heading>
        {description && (
          <Text c="dimmed" mt="sm">
            {description}
          </Text>
        )}
      </div>
      {action}
    </Group>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className={classes.empty}>{children}</div>;
}
export const roleName = {
  owner: "所有者",
  admin: "管理员",
  member: "成员",
  lead: "项目负责人",
  collaborator: "协作者",
};
export const tenantPath = (id: string) => `/v1/tenants/${id}`;
export const projectPath = (tenantId: string, projectId: string) =>
  `${tenantPath(tenantId)}/projects/${projectId}`;
