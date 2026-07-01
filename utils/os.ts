import os from "node:os";

export type OSType = "win32" | "darwin" | "linux";

export function getOSType(): OSType {
  const platform = os.platform();
  if (platform === "win32") return "win32";
  if (platform === "darwin") return "darwin";
  if (platform === "linux") return "linux";
  throw new Error(`Unsupported OS platform: ${platform}`);
}

export function isWindows(): boolean {
  return getOSType() === "win32";
}

export function isUnix(): boolean {
  return !isWindows();
}
