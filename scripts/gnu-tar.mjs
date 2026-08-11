import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";

export const GNU_TAR_OVERRIDE = "BGC_GNU_TAR";
export const MINIMUM_GNU_TAR_VERSION = "1.28";

function environmentEntry(environment, name, platform) {
  if (Object.hasOwn(environment, name)) {
    return { present: true, value: environment[name] };
  }
  if (platform === "win32") {
    const key = Object.keys(environment).find(
      (candidate) => candidate.toUpperCase() === name,
    );
    if (key !== undefined) {
      return { present: true, value: environment[key] };
    }
  }
  return { present: false, value: undefined };
}

function executableNames(command, environment, platform) {
  if (platform !== "win32" || path.win32.extname(command)) {
    return [command];
  }
  const pathExt = environmentEntry(environment, "PATHEXT", platform).value;
  const extensions = (pathExt || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean);
  return [command, ...extensions.map((extension) => `${command}${extension}`)];
}

function resolveExecutable(command, environment, platform) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const hasSeparator = command.includes("/") || command.includes("\\");
  if (hasSeparator && !pathApi.isAbsolute(command)) {
    throw new Error(
      `${GNU_TAR_OVERRIDE} must be an absolute path or an executable name from PATH`,
    );
  }

  const names = executableNames(command, environment, platform);
  const directories = pathApi.isAbsolute(command)
    ? [""]
    : String(environmentEntry(environment, "PATH", platform).value || "")
        .split(pathApi.delimiter)
        .map((directory) => directory.replace(/^"|"$/gu, ""));

  for (const directory of directories) {
    for (const name of names) {
      const candidate = pathApi.isAbsolute(name)
        ? name
        : pathApi.resolve(directory || process.cwd(), name);
      try {
        const stats = statSync(candidate);
        if (!stats.isFile()) {
          continue;
        }
        accessSync(candidate, constants.X_OK);
        return realpathSync(candidate);
      } catch {
        // Continue searching PATH. The final error names every attempted command.
      }
    }
  }
  return null;
}

export function parseSupportedGnuTarVersion(output) {
  const match = output.match(
    /\btar \(GNU tar\) (\d+)\.(\d+)(?:\.(\d+))?/u,
  );
  if (!match) {
    return null;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? 0);
  if (major < 1 || (major === 1 && minor < 28)) {
    return null;
  }
  return { major, minor, patch };
}

function inspectGnuTar(executable, environment) {
  const result = spawnSync(executable, ["--version"], {
    env: { ...environment, LC_ALL: "C", LANG: "C" },
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 5_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (!parseSupportedGnuTarVersion(output)) {
    return null;
  }
  const version = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  return version || "GNU tar";
}

export function resolveGnuTar({
  environment = process.env,
  platform = process.platform,
} = {}) {
  const overrideEntry = environmentEntry(
    environment,
    GNU_TAR_OVERRIDE,
    platform,
  );
  const override = overrideEntry.present
    ? String(overrideEntry.value ?? "").trim()
    : null;
  if (overrideEntry.present && !override) {
    throw new Error(`${GNU_TAR_OVERRIDE} must not be empty`);
  }

  const commands = override ? [override] : ["gtar", "tar"];
  const rejected = [];
  for (const command of commands) {
    const executable = resolveExecutable(command, environment, platform);
    if (!executable) {
      rejected.push(`${command} was not found`);
      continue;
    }
    const version = inspectGnuTar(executable, environment);
    if (version) {
      return { executable, version };
    }
    rejected.push(
      `${executable} is not GNU tar ${MINIMUM_GNU_TAR_VERSION} or newer`,
    );
  }

  const overrideGuidance = overrideEntry.present
    ? `${GNU_TAR_OVERRIDE} must point to GNU tar ${MINIMUM_GNU_TAR_VERSION} or newer`
    : `Install GNU tar ${MINIMUM_GNU_TAR_VERSION} or newer as gtar or tar, or set ${GNU_TAR_OVERRIDE} to its absolute path`;
  throw new Error(
    `GNU tar is required for deterministic source archives. ${overrideGuidance}. ${rejected.join("; ")}`,
  );
}

export const GNU_TAR = Object.freeze(resolveGnuTar());
