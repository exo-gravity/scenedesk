async (page) => {
  const path = "/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f/projects/ff8f70f2-8075-45de-b2bc-c54bd62e2653";
  const reviewId = "8074afa1-96be-42fd-960b-64b6fafea995", commentId = "100d449a-ac63-4a27-8b42-ae302c1192e7", artifactId = "c6313140-4aee-419e-a1ec-701a11fb7420";
  const read = () => page.evaluate(async ({path,reviewId,commentId,artifactId}) => {
    const comments = await (await fetch(`${path}/reviews/${reviewId}/comments`)).json();
    const artifact = await (await fetch(`${path}/assistance-artifacts/${artifactId}`)).json();
    return { comment: comments.items.find(c=>c.id===commentId), artifact };
  }, {path,reviewId,commentId,artifactId});
  const before = await read();
  if (before.comment.resolved || before.comment.revision!==2 || before.artifact.inputOutdated)
    throw Error("Suggestion unexpectedly changed the comment or its freshness");
  await page.setViewportSize({ width:1512,height:982 });
  const feedback=page.locator('[aria-label="候选意见"]');
  await feedback.getByRole("button",{name:"标记已处理…",exact:true}).click();
  await page.getByRole("dialog",{name:"确认意见处理状态",exact:true}).getByRole("button",{name:"确认更新处理状态",exact:true}).click();
  await feedback.getByText("已处理",{exact:true}).waitFor();
  const after=await read();
  if (!after.comment.resolved || after.comment.revision!==3 || !after.artifact.inputOutdated || after.artifact.revision!==2 || JSON.stringify(before.artifact.resolvedInput)!==JSON.stringify(after.artifact.resolvedInput))
    throw Error("Explicit resolution changed fixed artifact provenance or failed to mark it outdated");
  return {commentWasNotAutomaticallyResolved:true,explicitResolution:true,currentCommentRevision:3,
    originalArtifactRevision:2,originalFeedbackRevision:2,historyReadable:true,inputOutdated:true,originalSnapshotUnchanged:true};
}
