import { basename, isAbsolute, relative, sep } from "node:path";

export const isWithin = (root: string, candidate: string) => {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
};

export const fileBase = (path: string) => basename(path);
