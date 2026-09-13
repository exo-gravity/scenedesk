async (page) => {
  const p =
    "/v1/tenants/11111111-1111-4111-8111-111111111111/projects/22222222-2222-4222-8222-222222222222/proposals/98723c80-77cd-4a87-a7ab-bd7e7b56c9f8";
  const proposal = await page.evaluate(async (p) => {
    const r = await fetch(p);
    if (!r.ok) throw Error("fixture proposal missing");
    return r.json();
  }, p);
  const tall = JSON.parse(JSON.stringify(proposal));
  tall.operations[0].proposed.spec.notes = Array(80)
    .fill("长提案滚动校验：保留原镜头要求与明确采纳边界。")
    .join("\n");
  const handler = (route) => {
    if (route.request().method() !== "GET")
      throw Error("scroll verification must remain read-only");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(tall),
    });
  };
  const pattern = "**" + p + "*";
  await page.route(pattern, handler);
  try {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto(
      "http://127.0.0.1:4417/#/app/t/11111111-1111-4111-8111-111111111111/p/22222222-2222-4222-8222-222222222222/script?scene=55555555-5555-4555-8555-555555555555",
    );
    await page.reload();
    const dock = page.getByRole("complementary", { name: "剧本提案助手" }),
      doc = page.getByRole("region", { name: "剧本正文与版本" });
    await dock
      .getByRole("button", { name: "编辑并采纳分镜提案", exact: true })
      .click();
    await dock
      .getByText(tall.operations[0].proposed.spec.notes, { exact: true })
      .waitFor();
    const before = await doc.boundingBox(),
      leftTop = await doc.evaluate((el) => el.scrollTop);
    const scroll = await dock.evaluate((el) => {
      const before = el.scrollTop;
      el.scrollTop = el.scrollHeight;
      return {
        before,
        after: el.scrollTop,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
      };
    });
    if (scroll.after <= 0 || scroll.scrollHeight <= scroll.clientHeight)
      throw Error("long proposal did not scroll");
    if (
      Math.abs((await doc.boundingBox()).y - before.y) > 1 ||
      (await doc.evaluate((el) => el.scrollTop)) !== leftTop
    )
      throw Error("proposal scroll moved source");
    return {
      productionBuild: true,
      controlledLongProposalResponse: true,
      realBackendAcceptance: false,
      scroll,
      leftDocumentStayedFixed: true,
      businessWrites: 0,
    };
  } finally {
    await page.unroute(pattern, handler);
  }
};
