import { cpus, totalmem, freemem, loadavg } from "node:os";
import { exec } from "node:child_process";

// ─── Types ────────────────────────────────────────────────────

export interface GpuInfo {
  name: string;
  vramTotalMB: number;
  vramFreeMB: number;
}

export interface OllamaModelInfo {
  name: string;
  sizeGB: number;
}

export interface InfraContext {
  cpuCores: number;
  loadAvg: number; // 1-minute load average (0 on Windows)
  ramTotalGB: number;
  ramFreeGB: number;
  gpus: GpuInfo[];
  ollamaModels: OllamaModelInfo[];
  probedAt: number;
}

export interface ResourceLimits {
  maxParallelWorkers: number;
  recommendedModel: string | null;
  canParallelize: boolean;
}

// ─── Probing ──────────────────────────────────────────────────

/** Run a shell command and return stdout, or null on error/timeout. */
function runCommand(cmd: string, timeoutMs = 5_000): Promise<string | null> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(typeof stdout === "string" ? stdout.trim() : null);
    });
  });
}

/** Query nvidia-smi for GPU info. Returns empty array if not available. */
async function probeGpus(): Promise<GpuInfo[]> {
  const out = await runCommand(
    "nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits"
  );
  if (!out) return [];

  const gpus: GpuInfo[] = [];
  for (const line of out.split("\n")) {
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 3) continue;
    const name = parts[0];
    const totalMB = parseInt(parts[1], 10);
    const freeMB = parseInt(parts[2], 10);
    if (!name || isNaN(totalMB) || isNaN(freeMB)) continue;
    gpus.push({ name, vramTotalMB: totalMB, vramFreeMB: freeMB });
  }
  return gpus;
}

/** Query Ollama's /api/tags for available models. */
async function probeOllamaModels(ollamaUrl: string): Promise<OllamaModelInfo[]> {
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      models?: Array<{ name: string; size?: number }>;
    };
    if (!data.models) return [];
    return data.models.map((m) => ({
      name: m.name,
      sizeGB: m.size ? m.size / 1e9 : 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Probe system resources: CPU, RAM, GPU, Ollama models.
 * All probes are best-effort — failures result in empty/zero values, never throw.
 */
export async function probeInfra(ollamaUrl = "http://localhost:11434"): Promise<InfraContext> {
  const [gpus, ollamaModels] = await Promise.all([probeGpus(), probeOllamaModels(ollamaUrl)]);

  // Node.js os.loadavg() returns [1, 5, 15] minute averages; returns [0, 0, 0] on Windows
  const loadAvg1m = loadavg()[0] ?? 0;

  return {
    cpuCores: cpus().length,
    loadAvg: loadAvg1m,
    ramTotalGB: totalmem() / 1e9,
    ramFreeGB: freemem() / 1e9,
    gpus,
    ollamaModels,
    probedAt: Date.now(),
  };
}

// ─── Derived limits ───────────────────────────────────────────

/**
 * Compute resource limits from probed infra.
 * Used by the orchestrator to decide how many workers to spin up.
 */
export function getResourceLimits(infra: InfraContext): ResourceLimits {
  const hasGpu = infra.gpus.length > 0;
  const freeGB = infra.ramFreeGB;

  let maxParallelWorkers: number;
  if (freeGB < 4 && !hasGpu) {
    maxParallelWorkers = 1;
  } else if (freeGB < 8 && !hasGpu) {
    maxParallelWorkers = 2;
  } else {
    maxParallelWorkers = 4;
  }

  // Recommend the largest Ollama model that plausibly fits in free resources
  let recommendedModel: string | null = null;
  if (infra.ollamaModels.length > 0) {
    const sorted = [...infra.ollamaModels].sort((a, b) => b.sizeGB - a.sizeGB);
    // Use free VRAM if GPU present, otherwise use free RAM (with 20% headroom)
    const budget = hasGpu
      ? Math.max(...infra.gpus.map((g) => g.vramFreeMB / 1024))
      : freeGB * 0.8;

    for (const model of sorted) {
      if (model.sizeGB <= budget) {
        recommendedModel = model.name;
        break;
      }
    }
    // Fallback: use the smallest model if nothing fits
    if (!recommendedModel) {
      recommendedModel = sorted[sorted.length - 1]?.name ?? null;
    }
  }

  return {
    maxParallelWorkers,
    recommendedModel,
    canParallelize: maxParallelWorkers > 1,
  };
}

/** Format InfraContext as a human-readable summary. */
export function formatInfraContext(infra: InfraContext): string {
  const lines = [
    `CPU: ${infra.cpuCores} cores, load avg: ${infra.loadAvg.toFixed(2)}`,
    `RAM: ${infra.ramFreeGB.toFixed(1)} GB free / ${infra.ramTotalGB.toFixed(1)} GB total`,
  ];

  if (infra.gpus.length > 0) {
    for (const gpu of infra.gpus) {
      lines.push(
        `GPU: ${gpu.name} — ${(gpu.vramFreeMB / 1024).toFixed(1)} GB VRAM free / ${(gpu.vramTotalMB / 1024).toFixed(1)} GB total`
      );
    }
  } else {
    lines.push("GPU: none detected");
  }

  if (infra.ollamaModels.length > 0) {
    lines.push(
      `Ollama models: ${infra.ollamaModels.map((m) => `${m.name} (${m.sizeGB.toFixed(1)}GB)`).join(", ")}`
    );
  } else {
    lines.push("Ollama: no models found (or not running)");
  }

  return lines.join("\n");
}
