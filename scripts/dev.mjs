import { spawn } from "node:child_process";

const commands = [
  { name: "backend", args: ["run", "dev", "--workspace", "backend"] },
  { name: "frontend", args: ["run", "dev", "--workspace", "frontend"] }
];

const children = commands.map(({ name, args }) => {
  const child = spawn("npm", args, { stdio: ["inherit", "pipe", "pipe"], shell: false });
  child.stdout.on("data", (chunk) => process.stdout.write(prefix(name, chunk)));
  child.stderr.on("data", (chunk) => process.stderr.write(prefix(name, chunk)));
  child.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`[${name}] exited with code ${code}`);
    shutdown(code ?? 1);
  });
  return child;
});

let shuttingDown = false;

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function shutdown(code) {
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 250);
}

function prefix(name, chunk) {
  return String(chunk)
    .split("\n")
    .map((line) => line ? `[${name}] ${line}` : line)
    .join("\n");
}
