import { useState } from "react";
import {
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useCommand, useList, useResource, type Schema } from "./api";
import { ErrorNotice, SectionHeading, tenantPath, roleName } from "./common";
import classes from "./workbench.module.css";

type Member = Schema<"Membership">;
type Invitation = Schema<"Invitation">;
export function Members({
  tenantId,
  own,
  members,
}: {
  tenantId: string;
  own: Member;
  members: Member[];
}) {
  const path = tenantPath(tenantId),
    tenant = useResource<Schema<"Tenant">>(path);
  const manager = own.role === "owner" || own.role === "admin";
  const invitations = useList<Invitation>(`${path}/invitations`, manager);
  const [target, setTarget] = useState<Member | null>(null),
    [role, setRole] = useState("member"),
    [status, setStatus] = useState("active");
  const [transferring, setTransferring] = useState(false),
    [successor, setSuccessor] = useState<string | null>(null);
  const memberCommand = useCommand<Member>(),
    transfer = useCommand<Schema<"Tenant">>(),
    revoke = useCommand<Invitation>();
  return (
    <>
      <SectionHeading
        title="成员与设置"
        description="工作室角色决定管理权限，项目成员决定参与范围。"
      />
      <ErrorNotice error={tenant.error} />
      {manager && tenant.data && (
        <RenameTenant key={tenantId} tenant={tenant.data} path={path} />
      )}
      <hr className={classes.divider} />
      <h2 className={classes.subheading}>工作室成员</h2>
      <div className={classes.rows}>
        {members.map((member) => (
          <article className={classes.row} key={member.id}>
            <div>
              <Text fw={500}>
                {member.email ?? member.userId}
                {member.id === own.id ? "（你）" : ""}
              </Text>
              <Text c="dimmed">
                {roleName[member.role]} ·{" "}
                {member.status === "active" ? "正常" : "已停用"}
              </Text>
            </div>
            {manager &&
              member.role !== "owner" &&
              (own.role === "owner" || member.role === "member") && (
                <Button
                  onClick={() => {
                    memberCommand.reset();
                    setTarget(member);
                    setRole(member.role);
                    setStatus(member.status);
                  }}
                >
                  管理成员
                </Button>
              )}
          </article>
        ))}
      </div>
      {manager && (
        <>
          <hr className={classes.divider} />
          <h2 className={classes.subheading}>邀请成员</h2>
          <InviteForm path={path} owner={own.role === "owner"} />
          <hr className={classes.divider} />
          <h2 className={classes.subheading}>邀请记录</h2>
          <ErrorNotice error={invitations.error} />
          <ErrorNotice error={revoke.error} />
          <div className={classes.rows}>
            {invitations.data?.map((invitation) => (
              <article key={invitation.id} className={classes.row}>
                <div>
                  <Text>{invitation.email}</Text>
                  <Text c="dimmed">
                    {roleName[invitation.role]} · 截止{" "}
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </Text>
                </div>
                <Group>
                  <Badge>
                    {
                      {
                        pending: "待接受",
                        accepted: "已接受",
                        revoked: "已撤销",
                        expired: "已过期",
                      }[invitation.status]
                    }
                  </Badge>
                  {invitation.status === "pending" &&
                    (own.role === "owner" || invitation.role === "member") && (
                      <Button
                        loading={revoke.isPending}
                        onClick={() =>
                          revoke.mutate({
                            path: `${path}/invitations/${invitation.id}/revoke`,
                            version: invitation.revision,
                          })
                        }
                      >
                        撤销邀请
                      </Button>
                    )}
                </Group>
              </article>
            ))}
          </div>
        </>
      )}
      {own.role === "owner" && (
        <>
          <hr className={classes.divider} />
          <h2 className={classes.subheading}>工作室所有权</h2>
          <Text c="dimmed" mb="lg">
            将工作室交给另一位有效成员。交接后你保留管理员身份，项目参与关系继续保留。
          </Text>
          <Button
            onClick={() => {
              transfer.reset();
              setTransferring(true);
            }}
          >
            交接所有权
          </Button>
        </>
      )}
      <Modal
        opened={!!target}
        onClose={() => {
          if (!memberCommand.isPending) setTarget(null);
        }}
        title="管理工作室成员"
      >
        <Stack>
          <Text>{target?.email}</Text>
          <Select
            label="工作室角色"
            value={role}
            onChange={(v) => {
              if (v) setRole(v);
            }}
            data={
              own.role === "owner"
                ? [
                    { value: "admin", label: "管理员" },
                    { value: "member", label: "成员" },
                  ]
                : [{ value: "member", label: "成员" }]
            }
          />
          <Select
            label="访问状态"
            value={status}
            onChange={(v) => {
              if (v) setStatus(v);
            }}
            data={[
              { value: "active", label: "正常" },
              { value: "suspended", label: "停用" },
            ]}
          />
          {status === "suspended" && (
            <Text>
              停用后无法访问工作室及其项目。项目负责人需要先完成负责人交接。
            </Text>
          )}
          <ErrorNotice error={memberCommand.error} />
          <Button
            variant="filled"
            loading={memberCommand.isPending}
            onClick={() => {
              if (target)
                memberCommand.mutate(
                  {
                    path: `${path}/members/${target.id}`,
                    method: "PATCH",
                    version: target.revision,
                    body: { role, status },
                  },
                  { onSuccess: () => setTarget(null) },
                );
            }}
          >
            保存成员设置
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={transferring}
        onClose={() => {
          if (!transfer.isPending) setTransferring(false);
        }}
        title="交接工作室所有权"
      >
        <Stack>
          <Text>
            请选择接任者。交接后只有新的所有者可以再次转移所有权和任免管理员。
          </Text>
          <Select
            label="新的所有者"
            value={successor}
            onChange={setSuccessor}
            data={members
              .filter((m) => m.status === "active" && m.role !== "owner")
              .map((m) => ({ value: m.id, label: m.email ?? m.userId }))}
          />
          <ErrorNotice error={transfer.error} />
          <Button
            variant="filled"
            disabled={!successor || !tenant.data}
            loading={transfer.isPending}
            onClick={() =>
              transfer.mutate(
                {
                  path: `${path}/ownership`,
                  version: tenant.data!.revision,
                  body: { membershipId: successor },
                },
                { onSuccess: () => setTransferring(false) },
              )
            }
          >
            确认交接所有权
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
function InviteForm({ path, owner }: { path: string; owner: boolean }) {
  const command = useCommand<Invitation>(),
    [copyState, setCopyState] = useState("");
  const form = useForm({
    initialValues: { email: "", role: "member" },
    validate: {
      email: (v) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "请输入有效邮箱。",
    },
  });
  return (
    <form
      className={classes.form}
      onSubmit={form.onSubmit((v) =>
        command.mutate(
          { path: `${path}/invitations`, body: v },
          { onSuccess: () => setCopyState("") },
        ),
      )}
    >
      <TextInput
        label="受邀成员邮箱"
        type="email"
        required
        {...form.getInputProps("email")}
      />
      <Select
        label="加入后的角色"
        data={
          owner
            ? [
                { value: "member", label: "成员" },
                { value: "admin", label: "管理员" },
              ]
            : [{ value: "member", label: "成员" }]
        }
        {...form.getInputProps("role")}
      />
      <Text c="dimmed">
        邀请有效期为 7 天。请把链接交给对应成员，对方使用相同邮箱登录后接受。
      </Text>
      <ErrorNotice error={command.error} />
      <Button variant="filled" type="submit" loading={command.isPending}>
        创建邀请链接
      </Button>
      {command.data?.invitationUrl && (
        <Stack>
          <TextInput
            readOnly
            label="本次邀请链接"
            value={command.data.invitationUrl}
          />
          <Button
            onClick={() => {
              void navigator.clipboard
                .writeText(command.data!.invitationUrl!)
                .then(() => setCopyState("邀请链接已复制。"))
                .catch(() =>
                  setCopyState("未能复制，请选中上方链接手动复制。"),
                );
            }}
          >
            复制邀请链接
          </Button>
          <Text role="status">{copyState}</Text>
        </Stack>
      )}
    </form>
  );
}
function RenameTenant({
  tenant,
  path,
}: {
  tenant: Schema<"Tenant">;
  path: string;
}) {
  const command = useCommand<Schema<"Tenant">>(),
    [version, setVersion] = useState(tenant.revision);
  const form = useForm({
    initialValues: { name: tenant.name },
    validate: { name: (v) => (v.trim() ? null : "请输入工作室名称。") },
  });
  return (
    <form
      className={classes.form}
      onSubmit={form.onSubmit((v) =>
        command.mutate(
          { path, method: "PATCH", version, body: v },
          {
            onSuccess: (t) => {
              setVersion(t.revision);
              form.setInitialValues({ name: t.name });
            },
          },
        ),
      )}
    >
      <TextInput
        label="工作室名称"
        maxLength={160}
        {...form.getInputProps("name")}
      />
      <Text c="dimmed">记账币种：{tenant.currency}</Text>
      {tenant.revision !== version && (
        <div>
          <Text>服务器最新名称为「{tenant.name}」。你的输入仍然保留。</Text>
          <Button variant="subtle" onClick={() => setVersion(tenant.revision)}>
            核对后使用最新版本作为保存基线
          </Button>
        </div>
      )}
      <ErrorNotice error={command.error} />
      {command.isSuccess && !form.isDirty() && (
        <Text role="status">工作室设置已保存。</Text>
      )}
      <Button type="submit" variant="filled" loading={command.isPending}>
        保存工作室设置
      </Button>
    </form>
  );
}
