export function parentDirectoryPath(currentPath: string): string {
  const trimmed = currentPath.trim().replace(/[\\/]+$/, "");
  if (!trimmed || /^[A-Za-z]:$/.test(trimmed)) {
    return trimmed || "/";
  }
  const separator = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
  const normalized = trimmed.replace(/[\\/]+/g, separator);
  const segments = normalized.split(separator);
  if (segments[segments.length - 1] === "..") {
    segments.pop();
    segments.pop();
  } else {
    segments.pop();
  }
  const parent = segments.join(separator);
  if (!parent) {
    return separator;
  }
  if (/^[A-Za-z]:$/.test(parent)) {
    return `${parent}\\`;
  }
  if (separator === "\\" && /^\\\\/.test(normalized)) {
    return `\\\\${parent.replace(/^\\\\+/, "")}`;
  }
  return parent;
}

export function childDirectoryPath(currentPath: string, childName: string): string {
  const separator =
    currentPath.includes("\\") && !currentPath.includes("/") ? "\\" : "/";
  const base = currentPath.replace(/[\\/]+$/, "");
  if (!base) {
    return `${separator}${childName}`;
  }
  return `${base}${separator}${childName}`;
}
