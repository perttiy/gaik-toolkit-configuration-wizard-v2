import { spawn } from "node:child_process";
import path from "node:path";
import type { Blueprint } from "@/lib/mock-sessions";

const SCRIPTS_DIR = path.join(process.cwd(), "scripts");

function runPythonScript(
  scriptName: string,
  args: string[],
  stdinPayload: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [path.join(SCRIPTS_DIR, scriptName), ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `python exited ${code}`));
    });
    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}

export async function generateBpmnXmlFromBlueprint(
  blueprint: Blueprint,
  sessionId: string,
): Promise<string> {
  return runPythonScript(
    "generate_bpmn_from_v2.py",
    [sessionId],
    JSON.stringify(blueprint),
  );
}

export async function syncBlueprintFromBpmnXml(
  blueprint: Blueprint,
  xml: string,
): Promise<Blueprint> {
  const out = await runPythonScript(
    "sync_blueprint_from_bpmn.py",
    [],
    JSON.stringify({ blueprint, xml }),
  );
  return JSON.parse(out) as Blueprint;
}
