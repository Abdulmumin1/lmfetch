import { resolve } from "path";
import { createSource } from "../sources";

export async function resolveSearchRoot(userPath: string): Promise<string> {
  const source = createSource(userPath);

  if ("prepare" in source && typeof source.prepare === "function") {
    await source.prepare();
  }

  return resolve(source.rootPath);
}
