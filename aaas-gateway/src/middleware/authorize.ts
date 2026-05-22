import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Authorization: checks that the authenticated user is allowed
 * to invoke the requested agent_id.
 */
export function authorizeAgent(
  agentIdGetter: (req: FastifyRequest) => string | undefined
) {
  return async function authorize(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const user = req.tenant;
    if (!user) {
      reply.code(401).send({ error: "not_authenticated" });
      return;
    }
    const agentId = agentIdGetter(req);
    if (!agentId) {
      reply.code(400).send({ error: "agent_id_required" });
      return;
    }
    if (!user.allowed_agents.includes(agentId)) {
      reply.code(403).send({
        error: "agent_not_allowed",
        user_id: user.id,
        agent_id: agentId,
      });
      return;
    }
  };
}
