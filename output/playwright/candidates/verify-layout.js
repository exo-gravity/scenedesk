async(page)=>{
  const ok=(v,m)=>{if(!v)throw new Error(m);};await page.reload();await page.getByRole('region',{name:'当前镜头制作'}).locator('video').waitFor();
  const results=[];
  for(const size of [{width:1366,height:768},{width:1512,height:982},{width:320,height:740}]){
    await page.setViewportSize(size);
    await page.evaluate(()=>{let el=document.querySelector('main');while(el){el.scrollTop=0;el=el.parentElement;}});
    const measure=await page.evaluate(()=>{const action=document.querySelector('section[aria-label="当前镜头制作"] button'),a=action.getBoundingClientRect();const nav=document.querySelector('nav[aria-label="本场分镜顺序"]'),video=document.querySelector('section[aria-label="当前镜头制作"] video'),r=nav.getBoundingClientRect(),v=video.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,stripVisible:r.top>=0&&r.bottom<=innerHeight+1,adoptionVisible:a.top>=0&&a.bottom<=r.top,videoHeight:v.height,viewportHeight:innerHeight};});
    ok(!measure.overflow,'Horizontal overflow');if(size.width>1000){ok(measure.stripVisible,'Laptop shot strip not visible');ok(measure.adoptionVisible,'Laptop adoption action obscured');}
    await page.screenshot({path:`output/playwright/candidates/layout-${size.width}.png`});results.push({...size,...measure});
  }
  await page.setViewportSize({width:1366,height:768});return {productionBuild:true,viewports:results};
}
