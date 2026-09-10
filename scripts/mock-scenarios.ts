import { MockDispatchLab } from "@drama/provider";
for (const scenario of ["accepted", "rejected", "lost_reply"] as const) {
  const lab = new MockDispatchLab(scenario);
  lab.dispatch();
  lab.dispatch();
  console.log(
    JSON.stringify({
      scenario,
      ...lab.snapshot(),
      persistent: false,
      paidCalls: 0,
    }),
  );
}
