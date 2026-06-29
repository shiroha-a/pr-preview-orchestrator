import "hono";

declare module "hono" {
  interface ContextVariableMap {
    authUsername: string;
  }
}
