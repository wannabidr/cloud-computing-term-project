import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import { tenantStore } from "./tenants.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerAdminRoutes } from "./routes/admin.js";

async function main(): Promise<void> {
  tenantStore.load(config.tenantsFile);

  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        process.env.NODE_ENV === "production"
          ? undefined
          : {
              target: "pino-pretty",
              options: { translateTime: "SYS:standard", singleLine: true },
            },
    },
  });

  await app.register(sensible);
  await registerAdminRoutes(app);
  await registerAgentRoutes(app);

  app.log.info(
    { users: tenantStore.listIds(), openclaw: config.openclawBaseUrl },
    "aaas-gateway.boot"
  );

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", err);
  process.exit(1);
});
