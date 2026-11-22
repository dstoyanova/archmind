import { Minimatch } from "minimatch";

export function compileRepositoryGlob(pattern: string): (path: string) => boolean {
  const glob = new Minimatch(pattern, { dot: true, nonegate: true, nocomment: true });
  return (path) => glob.match(path);
}
