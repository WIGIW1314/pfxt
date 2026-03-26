import type { preHandlerHookHandler } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
  }
}
