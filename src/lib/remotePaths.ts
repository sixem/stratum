export function remoteParent(path: string) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return "/" + parts.join("/");
}

export function remoteCrumbs(path: string) {
  const crumbs = [{ path: "/", name: "/" }];
  for (const name of path.split("/").filter(Boolean)) {
    const parent = crumbs[crumbs.length - 1].path;
    crumbs.push({ path: parent === "/" ? parent + name : parent + "/" + name, name });
  }
  return crumbs;
}

