declare module "@earendil-works/pi-coding-agent" {
  export type ToolHandler = (
    toolCallId: string,
    params: any,
    signal: AbortSignal,
    onUpdate: any,
    ctx: any
  ) => Promise<any> | any;

  export type CommandHandler = (
    args: any,
    ctx: any
  ) => Promise<any> | any;

  export type EventHandler = (
    event: any,
    ctx: any
  ) => Promise<any> | any;

  export interface ToolContext {
    ui?: {
      confirm?: (message: string) => Promise<boolean> | boolean;
      log?: (message: string) => void;
      notify?: (message: string, level: "info" | "error" | "warn") => void;
    };
    [key: string]: unknown;
  }

  export interface PiExtension {
    registerTool(definition: any): void;
    registerCommand(name: string, definition: any): void;
    on(eventName: string, handler: EventHandler): void;
    [key: string]: unknown;
  }

  export type ExtensionAPI = PiExtension;

  export function defineExtension(
    factory: (pi: PiExtension) => void | Promise<void>
  ): unknown;
}
