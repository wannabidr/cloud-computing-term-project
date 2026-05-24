import { spawn } from "node:child_process";
import { config } from "../config.js";
import type { ResolvedRequestContext } from "../types.js";

function runDocker(
  args: string[],
  timeoutMs = 60_000
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", args);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("docker timeout"));
    }, timeoutMs);
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function callOpenClawCli(ctx: ResolvedRequestContext): Promise<{
  status: number;
  body: unknown;
}> {
  // OpenClaw chat.send schema (2026.5.21):
  //   - message: string (단수)
  //   - idempotencyKey: string (재시도 안전성)
  //   - sessionKey: string (사용자 격리의 핵심)
  const params = {
    sessionKey: `aaas:user:${ctx.user.id}`,
    message: ctx.input,
    idempotencyKey: ctx.request_id,
  };

  // 명시적 docker 명령: gateway 컨테이너에서 openclaw 컨테이너로 docker exec
  const dockerArgs = [
    "exec",
    "aaas-openclaw",
    "node",
    "openclaw.mjs",
    "gateway",
    "call",
    "chat.send",
    "--params",
    JSON.stringify(params),
    "--token",
    config.openclawToken,
    "--json",
    "--expect-final",
  ];

  try {
    const { stdout, stderr, code } = await runDocker(dockerArgs);
    if (code !== 0) {
      return {
        status: 502,
        body: {
          error: "openclaw_cli_failed",
          code,
          stderr: stderr.slice(0, 500),
        },
      };
    }
    let body: unknown = stdout;
    try {
      body = JSON.parse(stdout);
    } catch {
      /* keep raw stdout if not json */
    }
    return { status: 200, body };
  } catch (e) {
    return {
      status: 502,
      body: {
        error: "openclaw_cli_error",
        detail: e instanceof Error ? e.message : String(e),
      },
    };
  }
}
// import { spawn } from "node:child_process";
// import { config } from "../config.js";
// import type { ResolvedRequestContext } from "../types.js";

// function runDockerExec(args: string[], timeoutMs = 60_000): Promise<{ stdout: string; stderr: string; code: number }> {
//   return new Promise((resolve, reject) => {
//     const proc = spawn("docker", ["exec", "aaas-openclaw", ...args]);
//     let stdout = "";
//     let stderr = "";
//     const timer = setTimeout(() => {
//       proc.kill("SIGKILL");
//       reject(new Error("openclaw CLI timeout"));
//     }, timeoutMs);

//     proc.stdout.on("data", (d) => (stdout += d.toString()));
//     proc.stderr.on("data", (d) => (stderr += d.toString()));
//     proc.on("close", (code) => {
//       clearTimeout(timer);
//       resolve({ stdout, stderr, code: code ?? 1 });
//     });
//     proc.on("error", (err) => {
//       clearTimeout(timer);
//       reject(err);
//     });
//   });
// }

// export async function callOpenClawCli(ctx: ResolvedRequestContext): Promise<{
//   status: number;
//   body: unknown;
// }> {
//   // OpenClaw chat.send schema (2026.5.21 기준):
//   //   - message: string (단수, 사용자 입력)
//   //   - idempotencyKey: string (재시도 안전성)
//   //   - sessionKey: string (세션 식별 — 사용자 격리의 핵심)
//   // 우리 멀티테넌트 컨텍스트(userId, workspace 등)는 sessionKey naming에 인코딩.
//   const params = {
//     sessionKey: `aaas:user:${ctx.user.id}`,
//     message: ctx.input,
//     idempotencyKey: ctx.request_id,
//   };
//   const args = [
//     "exec",
//     "aaas-openclaw",
//     "node",
//     "openclaw.mjs",
//     "gateway",
//     "call",
//     "chat.send",
//     "--params",
//     JSON.stringify(params),
//     "--token",
//     config.openclawToken,
//     "--json",
//     "--expect-final",
//   ];

//   try {
//     const { stdout, stderr, code } = await runDockerExec(args);
//     if (code !== 0) {
//       return {
//         status: 502,
//         body: { error: "openclaw_cli_failed", code, stderr: stderr.slice(0, 500) },
//       };
//     }
//     let body: unknown = stdout;
//     try { body = JSON.parse(stdout); } catch {}
//     return { status: 200, body };
//   } catch (e) {
//     return { status: 502, body: { error: "openclaw_cli_error", detail: String(e) } };
//   }
// }

// Beta version :
//  const params = {
//    model: ctx.agent_id,
//    messages: [{ role: "user", content: ctx.input }],
//    aaas: {
//      userId: ctx.user.id,
//      workspace: ctx.user.workspace_path,
//      authProfileId: ctx.user.auth_profile_id,
//      requestId: ctx.request_id,
//    },
//    sessionKey: `aaas:user:${ctx.user.id}`,
//  };

//  const args = [
//    "node", "openclaw.mjs",
//    "gateway", "call", "chat.send",
//    "--params", JSON.stringify(params),
//    "--token", config.openclawToken,
//    "--json", "--expect-final",
//  ];

//  try {
//    const { stdout, stderr, code } = await runDockerExec(args);
//    if (code !== 0) {
//      return {
//        status: 502,
//        body: { error: "openclaw_cli_failed", code, stderr: stderr.slice(0, 500) },
//      };
//    }
//    let body: unknown = stdout;
//    try { body = JSON.parse(stdout); } catch {}
//    return { status: 200, body };
//  } catch (e) {
//    return { status: 502, body: { error: "openclaw_cli_error", detail: String(e) } };
//  }
//}