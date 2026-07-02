import { getOSType, isWindows } from "../utils/os.js";
import { WindowsNativeBackend } from "./windows.js";
import { TmuxBackend } from "./tmux.js";
import { ContainerBackend } from "./container.js";
import { LocalShellBackend } from "./shell.js";
import { SessionBackend } from "./base.js";
import { BackendMode } from "../config/loader.js";
import { execSync } from "node:child_process";

export class BackendFactory {
  static async createBackend(mode: BackendMode, config: any): Promise<SessionBackend> {
    if (mode === "auto") {
      if (isWindows()) {
        return new WindowsNativeBackend({ visible: config.visibleWindow ?? false });
      } else {
        if (await this.checkCommand("tmux")) {
          return new TmuxBackend();
        }
        return new LocalShellBackend();
      }
    }

    switch (mode) {
      case "windows-native":
        return new WindowsNativeBackend({ visible: config.visibleWindow ?? false });
      case "tmux":
        return new TmuxBackend();
      case "docker":
        return new ContainerBackend({ binary: "docker", image: config.containerImage });
      case "podman":
        return new ContainerBackend({ binary: "podman", image: config.containerImage });
      case "local-shell":
        return new LocalShellBackend();
      default:
        throw new Error(`Unsupported backend mode: ${mode}`);
    }
  }

  private static async checkCommand(cmd: string): Promise<boolean> {
    try {
      execSync(`${cmd} --version`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}
