import { createContractCompiler } from "@drama/contracts/compiler";

let compiler: Promise<ReturnType<typeof createContractCompiler>> | undefined;
/** Loading recovery still requires a fresh authorized resource read. The public
 * schema merely validates the shape of locally stored, potentially stale JSON. */
export function browserContractCompiler() {
  if (!compiler) {
    compiler = fetch("/design/openapi.json", {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("编辑规则暂时无法读取，请保留本机内容后重试。");
        return createContractCompiler(await response.json());
      })
      .catch((error) => {
        compiler = undefined;
        throw error;
      });
  }
  return compiler;
}
