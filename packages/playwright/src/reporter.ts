import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import chalk from "chalk";
import { readConfig, upload, UploadParameters } from "@argos-ci/core";
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  checkIsArgosScreenshot,
  checkIsArgosScreenshotMetadata,
  checkIsAutomaticScreenshot,
  checkIsTrace,
  getAttachmentFilename,
} from "./attachment";
import { getMetadataFromTestCase } from "./metadata";
import { debug } from "./debug";

async function createTempDirectory() {
  const osTmpDirectory = tmpdir();
  const path = join(osTmpDirectory, "argos." + randomBytes(16).toString("hex"));
  await mkdir(path, { recursive: true });
  return path;
}

export type ArgosReporterOptions = Omit<UploadParameters, "files" | "root"> & {
  /**
   * Upload the report to Argos.
   * @default true
   */
  uploadToArgos?: boolean;
};

async function getParallelFromConfig(
  config: FullConfig,
): Promise<null | UploadParameters["parallel"]> {
  if (!config.shard) return null;
  if (config.shard.total === 1) return null;
  const argosConfig = await readConfig();
  if (!argosConfig.parallelNonce) {
    throw new Error(
      "Playwright shard mode detected. Please specify ARGOS_PARALLEL_NONCE env variable. Read /parallel-testing",
    );
  }
  return {
    total: config.shard.total,
    nonce: argosConfig.parallelNonce,
  };
}

class ArgosReporter implements Reporter {
  uploadDir!: string;
  config: ArgosReporterOptions;
  playwrightConfig!: FullConfig;
  uploadToArgos: boolean;

  constructor(config: ArgosReporterOptions) {
    this.config = config;
    this.uploadToArgos = config.uploadToArgos ?? true;
  }

  async writeFile(path: string, body: Buffer | string) {
    const dir = dirname(path);
    if (dir !== this.uploadDir) {
      await mkdir(dir, { recursive: true });
    }
    debug(`Writing file to ${path}`);
    await writeFile(path, body);
    debug(`File written to ${path}`);
  }

  async copyFile(from: string, to: string) {
    const dir = dirname(to);
    if (dir !== this.uploadDir) {
      await mkdir(dir, { recursive: true });
    }
    debug(`Copying file from ${from} to ${to}`);
    await copyFile(from, to);
    debug(`File copied from ${from} to ${to}`);
  }

  getAutomaticScreenshotName(test: TestCase, result: TestResult) {
    let name = test.titlePath().join(" ");
    name += result.retry > 0 ? ` #${result.retry + 1}` : "";
    name +=
      result.status === "failed" || result.status === "timedOut"
        ? " (failed)"
        : "";
    return name;
  }

  async onBegin(config: FullConfig, _suite: Suite) {
    debug("ArgosReporter:onBegin");
    this.playwrightConfig = config;
    debug(`Creating temporary directory for uploads`);
    this.uploadDir = await createTempDirectory();
    debug(`Temporary directory created for uploads: ${this.uploadDir}`);
  }

  async onTestEnd(test: TestCase, result: TestResult) {
    debug("ArgosReporter:onTestEnd");
    await Promise.all(
      result.attachments.map(async (attachment) => {
        if (
          checkIsArgosScreenshot(attachment) ||
          checkIsArgosScreenshotMetadata(attachment)
        ) {
          const path = join(
            this.uploadDir,
            getAttachmentFilename(attachment.name),
          );
          await this.copyFile(attachment.path, path);
          return;
        }

        // Error screenshots are sent to Argos
        if (checkIsAutomaticScreenshot(attachment)) {
          const trace = result.attachments.find(checkIsTrace) ?? null;
          const metadata = await getMetadataFromTestCase(test, result);
          const name = this.getAutomaticScreenshotName(test, result);
          const path = join(this.uploadDir, `${name}.png`);
          await Promise.all([
            this.writeFile(path + ".argos.json", JSON.stringify(metadata)),
            this.copyFile(attachment.path, path),
            trace ? this.copyFile(trace.path, path + ".pw-trace.zip") : null,
          ]);
          return;
        }
      }),
    );
  }

  async onEnd(_result: FullResult) {
    debug("ArgosReporter:onEnd");
    if (!this.uploadToArgos) {
      debug("Not uploading to Argos because uploadToArgos is false.");
      debug(`Upload directory: ${this.uploadDir}`);
      return;
    }

    debug("Getting parallel from config");
    const parallel = await getParallelFromConfig(this.playwrightConfig);
    if (parallel) {
      debug(
        `Using parallel config — total: ${parallel.total}, nonce: "${parallel.nonce}"`,
      );
    } else {
      debug("Non-parallel mode");
    }

    try {
      debug("Uploading to Argos");
      const res = await upload({
        files: ["**/*.png"],
        root: this.uploadDir,
        parallel: parallel ?? undefined,
        ...this.config,
      });

      console.log(chalk.green(`✅ Argos build created: ${res.build.url}`));
    } catch (error) {
      console.error(error);
      return { status: "failed" as const };
    }
    return;
  }
}

export default ArgosReporter;
