import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { businessFixture } from "../support/business.js";
import { Database } from "../../apps/api/src/kernel/database.js";
import { resolveTakeFeedback } from "../../apps/api/src/modules/reviews/model.js";

test("Take feedback preserves real fixed opinions, current authority and immutable history", async (t) => {
  const f = await businessFixture(t);
  // Relational fixture only. File decoding is covered by the existing media suite.
  const mediaId = randomUUID(),
    uploadId = randomUUID();
  await f.admin.query(
    `INSERT INTO ${f.schema}.upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,status,expires_at,staging_version_id,epoch) VALUES($1,$2,$3,'project',$4,64,$5,'fixture.mp4','video/mp4','意见关系测试',$6,'accepted',now()+interval '15 minutes','fixture-version',1)`,
    [
      uploadId,
      f.tenant.id,
      f.project.id,
      `staging/${uploadId}`,
      "a".repeat(64),
      f.owner.userId,
    ],
  );
  await f.admin.query(
    `INSERT INTO ${f.schema}.media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio,duration_us,fps_num,fps_den) VALUES($1,$2,$3,'project','video','ready','意见关系测试','fixture.mp4',$4,$5,$6,'fixture-version',$7,64,'video/mp4',32,32,false,4000000,24,1)`,
    [
      mediaId,
      f.tenant.id,
      f.project.id,
      f.owner.userId,
      uploadId,
      `originals/${mediaId}`,
      "a".repeat(64),
    ],
  );
  const episode = await f.ok(
    "POST",
    `${f.path}/episodes`,
    { title: "第一集", position: 0, status: "active" },
    await f.next(),
  );
  const scene = await f.ok(
    "POST",
    `${f.path}/scenes`,
    {
      episodeId: episode.id,
      title: "街道",
      position: 0,
      status: "active",
      summary: "等待",
      state: { characters: [], props: [], spatialNotes: "" },
    },
    await f.next(),
  );
  const shot = await f.ok(
    "POST",
    `${f.path}/shots`,
    {
      sceneId: scene.id,
      label: "01",
      position: 0,
      status: "active",
      spec: { intent: "回头", references: [] },
    },
    await f.next(),
  );
  const takeInput = {
    shotId: shot.id,
    shotRevisionId: shot.specRevisionId,
    mediaId,
    range: { inUs: 1000000, outUs: 3000000 },
  };
  const take = await f.ok("POST", `${f.path}/takes`, takeInput);
  const otherTake = await f.ok("POST", `${f.path}/takes`, {
    ...takeInput,
    range: { inUs: 0, outUs: 1000000 },
  });
  const path = `${f.path}/reviews`,
    key = randomUUID();
  let review: any, comment: any;
  const database = new Database(f.runtime, f.schema);
  const transaction = (
    run: Parameters<Database["transaction"]>[2],
    who = f.owner,
  ) =>
    database.transaction(
      who.token,
      { tenantId: f.tenant.id, projectId: f.project.id, write: true },
      run,
    );
  await t.test(
    "same-key creation recovers one fixed open review; different keys cannot invent another open round",
    async () => {
      const body = { subject: { takeId: take.id } };
      const replies = await Promise.all([
        f.request("POST", path, body, undefined, key),
        f.request("POST", path, body, undefined, key),
      ]);
      for (const reply of replies)
        assert.equal(reply.statusCode, 201, reply.body);
      review = replies[0]!.json();
      assert.deepEqual(replies[1]!.json(), review);
      assert.deepEqual(review.subject, body.subject);
      assert.equal(review.number, 1);
      assert.equal(review.status, "open");
      assert.deepEqual(review.sourceReviewIds, []);
      assert.deepEqual(review.reworkItems, []);
      const duplicate = await f.request("POST", path, body);
      assert.equal(duplicate.statusCode, 409, duplicate.body);
      assert.equal(duplicate.json().code, "REVIEW_ALREADY_OPEN");
      assert.deepEqual((await f.ok("GET", `${path}?takeId=${take.id}`)).items, [
        review,
      ]);
      assert.deepEqual(await f.ok("GET", `${path}/${review.id}`), review);
      await f.admin.query(
        `UPDATE ${f.schema}.idempotency_records SET expires_at=now()-interval '1 second' WHERE key=$1`,
        [key],
      );
      assert.equal(
        (await f.request("POST", path, body, undefined, key)).statusCode,
        409,
      );
      assert.equal((await f.ok("GET", path)).items.length, 1);
    },
  );
  await t.test(
    "unsupported Cut, decisions and nonempty closure fields are rejected",
    async () => {
      for (const body of [
        { subject: { cutRevisionId: randomUUID() } },
        { subject: { takeId: otherTake.id }, sourceReviewIds: [review.id] },
        {
          subject: { takeId: otherTake.id },
          reworkItems: [
            {
              sourceCommentId: randomUUID(),
              outcome: "unresolved",
              note: "pending",
            },
          ],
        },
        { subject: { takeId: otherTake.id }, status: "approved" },
      ]) {
        const reply = await f.request("POST", path, body);
        assert.equal(reply.statusCode, 422, reply.body);
      }
      assert.equal(
        (await f.request("GET", `${path}?cutRevisionId=${randomUUID()}`))
          .statusCode,
        422,
      );
      assert.equal(
        (
          await f.request(
            "POST",
            `${path}/${review.id}/decision`,
            { decision: "approved" },
            1,
          )
        ).statusCode,
        501,
      );
    },
  );
  const otherReview = await f.ok("POST", path, {
    subject: { takeId: otherTake.id },
  });
  await t.test(
    "local point and range comments stay on their review and preserve the original HTTP receipt",
    async () => {
      const body = { body: "回头后停留更久", startUs: 0, endUs: 2000000 },
        commentKey = randomUUID();
      const first = await f.request(
        "POST",
        `${path}/${review.id}/comments`,
        body,
        undefined,
        commentKey,
      );
      assert.equal(first.statusCode, 201, first.body);
      comment = first.json();
      const replay = await f.request(
        "POST",
        `${path}/${review.id}/comments`,
        body,
        undefined,
        commentKey,
      );
      assert.deepEqual(replay.json(), comment);
      assert.equal(comment.authorId, f.owner.userId);
      assert.equal(comment.revision, 1);
      assert.equal(comment.resolved, false);
      await f.ok("POST", `${path}/${review.id}/comments`, {
        body: "最后一微秒",
        startUs: 1999999,
        parentCommentId: comment.id,
      });
      await f.ok("POST", `${path}/${review.id}/comments`, { body: "全段意见" });
      for (const wrong of [
        { startUs: 2000000 },
        { startUs: 1000000, endUs: 1000000 },
        { endUs: 1 },
        { startUs: 0, endUs: 2000001 },
        { startUs: -1 },
        { startUs: 0.5 },
      ])
        assert.equal(
          (
            await f.request("POST", `${path}/${review.id}/comments`, {
              body: "越界",
              ...wrong,
            })
          ).statusCode,
          422,
        );
      for (const body of ["", " \n\t", "x".repeat(5001)])
        assert.equal(
          (await f.request("POST", `${path}/${review.id}/comments`, { body }))
            .statusCode,
          422,
        );
      assert.equal(
        (
          await f.request("POST", `${path}/${otherReview.id}/comments`, {
            body: "错误父级",
            parentCommentId: comment.id,
          })
        ).statusCode,
        404,
      );
      const firstPage = await f.ok(
        "GET",
        `${path}/${review.id}/comments?limit=1`,
      );
      assert.ok(firstPage.nextCursor);
      assert.equal(
        (
          await f.request(
            "GET",
            `${path}/${otherReview.id}/comments?cursor=${encodeURIComponent(firstPage.nextCursor)}`,
          )
        ).statusCode,
        422,
      );
    },
  );
  await t.test(
    "concurrent CAS edits append one immutable version and fixed feedback keeps its old text",
    async () => {
      const target = `${path}/${review.id}/comments/${comment.id}`;
      const replies = await Promise.all([
        f.request("PATCH", target, { body: "停两秒再离开" }, 1),
        f.request("PATCH", target, { body: "另一修改" }, 1),
      ]);
      assert.deepEqual(replies.map((r) => r.statusCode).sort(), [200, 412]);
      comment = replies.find((r) => r.statusCode === 200)!.json();
      assert.equal(comment.revision, 2);
      assert.equal(
        (await f.request("PATCH", target, { body: "丢回包原CAS" }, 1))
          .statusCode,
        412,
      );
      const fixed = (await transaction((tx) =>
        resolveTakeFeedback(tx, {
          kind: "prepare_rework",
          targetCapabilityId: randomUUID(),
          targetCapabilityRevision: 1,
          sourceTakeId: take.id,
          feedback: {
            reviewId: review.id,
            commentId: comment.id,
            commentRevision: 1,
          },
        }),
      )) as Awaited<ReturnType<typeof resolveTakeFeedback>>;
      assert.equal(fixed.feedbackSnapshot.body, "回头后停留更久");
      assert.equal(fixed.feedbackSnapshot.commentRevision, 1);
      assert.equal(fixed.currentCommentRevision, 2);
      assert.deepEqual(fixed.take.range, take.range);
      assert.equal(fixed.feedbackSnapshot.startUs, 0);
      assert.equal(fixed.feedbackSnapshot.endUs, 2000000);
      assert.equal(fixed.dependency.kind, "review_comment");
      assert.equal(fixed.dependency.tracking, "fixed");
      await assert.rejects(
        transaction((tx) =>
          resolveTakeFeedback(tx, {
            kind: "prepare_rework",
            targetCapabilityId: randomUUID(),
            targetCapabilityRevision: 1,
            sourceTakeId: otherTake.id,
            feedback: {
              reviewId: review.id,
              commentId: comment.id,
              commentRevision: 1,
            },
          }),
        ),
        /观看对象/,
      );
      await assert.rejects(
        transaction((tx) =>
          resolveTakeFeedback(tx, {
            kind: "prepare_rework",
            targetCapabilityId: randomUUID(),
            targetCapabilityRevision: 1,
            sourceTakeId: take.id,
            feedback: {
              reviewId: review.id,
              commentId: comment.id,
              commentRevision: 99,
            },
          }),
        ),
        /固定评论版本/,
      );
    },
  );
  const memberUser = await f.identity("feedback-member");
  const invite = await f.ok("POST", `/v1/tenants/${f.tenant.id}/invitations`, {
    email: "feedback-member@example.test",
    role: "member",
  });
  const inviteToken = new URLSearchParams(
    new URL(invite.invitationUrl).hash.split("?")[1],
  ).get("token");
  const accepted = await f.request(
    "POST",
    "/v1/invitations/accept",
    { token: inviteToken },
    undefined,
    randomUUID(),
    memberUser,
  );
  assert.equal(accepted.statusCode, 201, accepted.body);
  const member = accepted.json();
  await f.ok("POST", `${f.path}/members`, { membershipId: member.id });
  const memberKey = randomUUID();
  let memberComment: any;
  await t.test(
    "authors own text while a currently authorized collaborator can resolve and reopen",
    async () => {
      const target = `${path}/${review.id}/comments/${comment.id}`;
      const denied = await f.request(
        "PATCH",
        target,
        { body: "非作者修改" },
        comment.revision,
        randomUUID(),
        memberUser,
      );
      assert.equal(denied.statusCode, 403, denied.body);
      assert.equal(denied.json().code, "COMMENT_AUTHOR_REQUIRED");
      const resolved = await f.request(
        "PATCH",
        target,
        { resolved: true },
        comment.revision,
        randomUUID(),
        memberUser,
      );
      assert.equal(resolved.statusCode, 200, resolved.body);
      comment = resolved.json();
      assert.equal(comment.revision, 3);
      assert.equal(comment.resolved, true);
      const reopened = await f.request(
        "PATCH",
        target,
        { resolved: false },
        comment.revision,
        randomUUID(),
        memberUser,
      );
      assert.equal(reopened.statusCode, 200, reopened.body);
      comment = reopened.json();
      assert.equal(comment.revision, 4);
      const own = await f.request(
        "POST",
        `${path}/${review.id}/comments`,
        { body: "成员原意见" },
        undefined,
        memberKey,
        memberUser,
      );
      assert.equal(own.statusCode, 201, own.body);
      memberComment = own.json();
      const history = (
        await f.admin.query(
          `SELECT number,body,resolved,edited_by FROM ${f.schema}.review_comment_revisions WHERE comment_id=$1 ORDER BY number`,
          [comment.id],
        )
      ).rows;
      assert.equal(history.length, 4);
      assert.equal(history[0].body, "回头后停留更久");
      assert.equal(history[2].resolved, true);
      assert.equal(history[2].edited_by, memberUser.userId);
    },
  );
  await t.test(
    "restricted SQL cannot forge authors, times, parent reviews, root identity or history",
    async () => {
      const flags = (
        await f.admin.query(
          `SELECT bool_and(relrowsecurity AND relforcerowsecurity) AS enforced FROM pg_class WHERE oid=ANY($1::regclass[])`,
          [
            [
              `${f.schema}.reviews`,
              `${f.schema}.review_comments`,
              `${f.schema}.review_comment_revisions`,
            ],
          ],
        )
      ).rows[0];
      assert.equal(flags.enforced, true);
      await assert.rejects(
        f.runtime.query(`UPDATE ${f.schema}.reviews SET status='approved'`),
        /permission denied/,
      );
      await assert.rejects(
        f.runtime.query(`DELETE FROM ${f.schema}.review_comments`),
        /permission denied/,
      );
      await assert.rejects(
        f.runtime.query(`UPDATE ${f.schema}.review_comments SET start_us=0`),
        /permission denied/,
      );
      await assert.rejects(
        f.runtime.query(
          `INSERT INTO ${f.schema}.review_comment_revisions(comment_id) VALUES($1)`,
          [comment.id],
        ),
        /permission denied/,
      );
      await assert.rejects(
        f.admin.query(
          `UPDATE ${f.schema}.review_comment_revisions SET body='overwrite' WHERE comment_id=$1`,
          [comment.id],
        ),
        /immutable/,
      );
      await assert.rejects(
        transaction(
          (tx) =>
            tx.sql.query(
              "UPDATE review_comments SET body='not author',revision=revision+1 WHERE id=$1",
              [comment.id],
            ),
          memberUser,
        ),
        /author/,
      );
      await assert.rejects(
        transaction((tx) =>
          tx.sql.query("UPDATE review_comments SET resolved=true WHERE id=$1", [
            comment.id,
          ]),
        ),
        /append one version/,
      );
      const insert = (
        author: string,
        start: number,
        parent: string | null = null,
        reviewId = review.id,
      ) =>
        transaction((tx) =>
          tx.sql.query(
            "INSERT INTO review_comments(id,tenant_id,project_id,review_id,author_id,body,start_us,parent_comment_id) VALUES($1,$2,$3,$4,$5,'sql attempt',$6,$7)",
            [
              randomUUID(),
              f.tenant.id,
              f.project.id,
              reviewId,
              author,
              start,
              parent,
            ],
          ),
        );
      await assert.rejects(insert(memberUser.userId, 0), /author/);
      await assert.rejects(insert(f.owner.userId, 2000000), /local interval/);
      await assert.rejects(
        insert(f.owner.userId, 0, comment.id, otherReview.id),
        /foreign key/,
      );
      const actor = (
        await f.admin.query(
          `SELECT r.rolcanlogin,r.rolsuper,r.rolbypassrls,p.proconfig FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=$1::regprocedure`,
          [`${f.schema}.snapshot_review_comment()`],
        )
      ).rows[0];
      assert.equal(actor.rolcanlogin, false);
      assert.equal(actor.rolsuper, false);
      assert.equal(actor.rolbypassrls, true);
      assert.match(actor.proconfig.join(","), /pg_temp/);
    },
  );
  await t.test(
    "membership removal precedes cached receipts, history resolution and comment updates",
    async () => {
      const memberReviewKey = randomUUID();
      const thirdTake = await f.ok("POST", `${f.path}/takes`, {
        ...takeInput,
        range: { inUs: 500000, outUs: 1500000 },
      });
      const reviewBody = { subject: { takeId: thirdTake.id } };
      const memberReview = await f.request(
        "POST",
        path,
        reviewBody,
        undefined,
        memberReviewKey,
        memberUser,
      );
      assert.equal(memberReview.statusCode, 201, memberReview.body);
      const projectMembers = await f.ok("GET", `${f.path}/members`);
      const pm = projectMembers.items.find(
        (x: any) => x.membershipId === member.id,
      );
      await f.ok(
        "DELETE",
        `${f.path}/members/${member.id}`,
        undefined,
        pm.revision,
      );
      const reviewReplay = await f.request(
        "POST",
        path,
        reviewBody,
        undefined,
        memberReviewKey,
        memberUser,
      );
      assert.equal(reviewReplay.statusCode, 404, reviewReplay.body);
      assert.equal(reviewReplay.json().id, undefined);
      const replay = await f.request(
        "POST",
        `${path}/${review.id}/comments`,
        { body: "成员原意见" },
        undefined,
        memberKey,
        memberUser,
      );
      assert.equal(replay.statusCode, 404, replay.body);
      assert.equal(replay.json().id, undefined);
      assert.equal(
        (
          await f.request(
            "GET",
            `${path}/${review.id}/comments`,
            undefined,
            undefined,
            randomUUID(),
            memberUser,
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await f.request(
            "PATCH",
            `${path}/${review.id}/comments/${memberComment.id}`,
            { body: "撤权修改" },
            1,
            randomUUID(),
            memberUser,
          )
        ).statusCode,
        404,
      );
      await assert.rejects(
        transaction(
          (tx) =>
            resolveTakeFeedback(tx, {
              kind: "prepare_rework",
              targetCapabilityId: randomUUID(),
              targetCapabilityRevision: 1,
              sourceTakeId: take.id,
              feedback: {
                reviewId: review.id,
                commentId: comment.id,
                commentRevision: 1,
              },
            }),
          memberUser,
        ),
        /无访问权限/,
      );
      const other = await f.createProject("另一项目");
      const otherPath = `/v1/tenants/${f.tenant.id}/projects/${other.id}/reviews`;
      assert.equal(
        (await f.request("GET", `${otherPath}/${review.id}`)).statusCode,
        404,
      );
      assert.equal(
        (await f.request("POST", otherPath, { subject: { takeId: take.id } }))
          .statusCode,
        404,
      );
    },
  );
  await t.test(
    "history insertion failure rolls back the visible comment and its revision",
    async () => {
      const before = await f.ok("GET", `${path}/${review.id}/comments`);
      await f.admin.query(
        `CREATE FUNCTION ${f.schema}.reject_feedback_history_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'history failure fixture' USING ERRCODE='23514'; END $$`,
      );
      await f.admin.query(
        `CREATE TRIGGER reject_feedback_history_test BEFORE INSERT ON ${f.schema}.review_comment_revisions FOR EACH ROW EXECUTE FUNCTION ${f.schema}.reject_feedback_history_test()`,
      );
      try {
        const failed = await f.request(
          "PATCH",
          `${path}/${review.id}/comments/${comment.id}`,
          { resolved: true },
          comment.revision,
        );
        assert.equal(failed.statusCode, 409, failed.body);
        assert.deepEqual(
          await f.ok("GET", `${path}/${review.id}/comments`),
          before,
        );
      } finally {
        await f.admin.query(
          `DROP TRIGGER reject_feedback_history_test ON ${f.schema}.review_comment_revisions`,
        );
        await f.admin.query(
          `DROP FUNCTION ${f.schema}.reject_feedback_history_test()`,
        );
      }
      const history = (
        await f.admin.query(
          `SELECT count(*)::int AS n FROM ${f.schema}.review_comment_revisions WHERE comment_id=$1`,
          [comment.id],
        )
      ).rows[0];
      assert.equal(history.n, comment.revision);
    },
  );
  await t.test(
    "archived source media preserves existing feedback but cannot open a new review",
    async () => {
      const unreviewed = await f.ok("POST", `${f.path}/takes`, {
        ...takeInput,
        range: { inUs: 1000000, outUs: 2000000 },
      });
      // This relation-only fixture has no storage service; set up the existing
      // media archive state through the restricted runtime transaction.
      await transaction((tx) =>
        tx.sql.query(
          "UPDATE media SET status='archived',revision=revision+1 WHERE id=$1",
          [mediaId],
        ),
      );
      const unavailable = await f.request("POST", path, {
        subject: { takeId: unreviewed.id },
      });
      assert.equal(unavailable.statusCode, 422, unavailable.body);
      assert.equal(unavailable.json().code, "REVIEW_MEDIA_UNAVAILABLE");
      assert.equal(
        (await f.request("GET", `${path}/${review.id}/comments`)).statusCode,
        200,
      );
      await assert.rejects(
        transaction((tx) =>
          tx.sql.query(
            "INSERT INTO reviews(id,tenant_id,project_id,take_id,number,opened_by) VALUES($1,$2,$3,$4,1,$5)",
            [
              randomUUID(),
              f.tenant.id,
              f.project.id,
              unreviewed.id,
              f.owner.userId,
            ],
          ),
        ),
        /authorized ready/,
      );
    },
  );
  await t.test(
    "archived project feedback stays readable while new writes are rejected and audit remains attributable",
    async () => {
      const events = (
        await f.admin.query(
          `SELECT operation_id FROM ${f.schema}.audit_events WHERE project_id=$1`,
          [f.project.id],
        )
      ).rows;
      assert.ok(events.some((x) => x.operation_id === "createReview"));
      assert.ok(events.some((x) => x.operation_id === "createComment"));
      assert.ok(events.some((x) => x.operation_id === "changeComment"));
      await f.ok("POST", `${f.path}/archive`, undefined, f.project.revision);
      assert.equal(
        (await f.request("GET", `${path}/${review.id}/comments`)).statusCode,
        200,
      );
      assert.equal(
        (
          await f.request(
            "PATCH",
            `${path}/${review.id}/comments/${comment.id}`,
            { resolved: true },
            comment.revision,
          )
        ).statusCode,
        409,
      );
    },
  );
});
