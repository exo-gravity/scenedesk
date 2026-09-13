async (page) => {
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto(
    "http://127.0.0.1:4317/#/app/t/8bfa2905-6429-4a05-8072-a6fae34df0ac/p/c3adbaae-9c8c-41d9-93a7-172bf491b1bd/media",
  );
  await page.reload();
  const tile = page.getByRole("link", {
    name: "查看素材 视觉验收-旧铜钥匙.png",
    exact: true,
  });
  await tile.waitFor();
  await tile.locator("img").evaluate((img) => img.decode());
  const bounds = await tile.locator("img").evaluate((img) => {
    const r = img.getBoundingClientRect(),
      p = img.parentElement.getBoundingClientRect();
    return {
      image: { width: r.width, height: r.height },
      viewport: { width: p.width, height: p.height },
      fit: getComputedStyle(img).objectFit,
    };
  });
  if (
    bounds.image.height > bounds.viewport.height + 1 ||
    bounds.fit !== "contain"
  )
    throw Error("Thumbnail crops source");
  await page.screenshot({
    path: "output/playwright/2026-09-12-approved-assets-assistant/media-list-complete-frame-1512.png",
  });
  await tile.click();
  await page
    .getByRole("heading", { name: "视觉验收-旧铜钥匙.png", exact: true })
    .waitFor();
  await page
    .getByRole("img", { name: "视觉验收-旧铜钥匙.png", exact: true })
    .evaluate((img) => img.decode());
  await page.screenshot({
    path: "output/playwright/2026-09-12-approved-assets-assistant/media-detail-default-1512.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "output/playwright/2026-09-12-approved-assets-assistant/media-detail-default-390.png",
  });
  return bounds;
};
