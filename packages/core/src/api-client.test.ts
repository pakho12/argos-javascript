import { describe, it, expect, beforeAll } from "vitest";

import { setupMockServer } from "../mocks/server";
import {
  ArgosApiClient,
  createArgosLegacyAPIClient,
  getAuthToken,
} from "./api-client";

setupMockServer();

let apiClient: ArgosApiClient;

describe("#createArgosLegacyAPIClient", () => {
  beforeAll(() => {
    apiClient = createArgosLegacyAPIClient({
      baseUrl: "https://api.argos-ci.dev",
      bearerToken: "Bearer 92d832e0d22ab113c8979d73a87a11130eaa24a9",
    });
  });

  describe("#createBuild", () => {
    it("creates build", async () => {
      const result = await apiClient.createBuild({
        commit: "f16f980bd17cccfa93a1ae7766727e67950773d0",
        screenshotKeys: ["123", "456"],
        pwTraceKeys: [],
      });
      expect(result).toEqual({
        build: {
          id: "123",
          url: "https://app.argos-ci.dev/builds/123",
        },
        screenshots: [
          {
            key: "123",
            putUrl: "https://api.s3.dev/upload/123",
          },
          {
            key: "456",
            putUrl: "https://api.s3.dev/upload/456",
          },
        ],
      });
    });
  });

  describe("#updateBuild", () => {
    it("updates build", async () => {
      const result = await apiClient.updateBuild({
        buildId: "123",
        screenshots: [
          {
            key: "123",
            name: "screenshot 1",
            metadata: null,
            pwTraceKey: null,
            threshold: null,
          },
          {
            key: "456",
            name: "screenshot 2",
            metadata: null,
            pwTraceKey: null,
            threshold: null,
          },
        ],
      });
      expect(result).toEqual({
        build: {
          id: "123",
          url: "https://app.argos-ci.dev/builds/123",
        },
      });
    });
  });
});

describe("#getAuthToken", () => {
  describe("without CI", () => {
    describe("without token", () => {
      it("should throw", () => {
        const config = {};
        expect(() => getAuthToken(config)).toThrow(
          "Missing Argos repository token 'ARGOS_TOKEN'",
        );
      });
    });

    describe("with token", () => {
      it("should return bearer token", () => {
        const config = { token: "this-token" };
        expect(getAuthToken(config)).toBe(`this-token`);
      });
    });
  });

  describe("with unknown CI", () => {
    const configProps = { ciProvider: "unknown" };

    describe("without token", () => {
      it("should throw", () => {
        const config = { ...configProps };
        expect(() => getAuthToken(config)).toThrow(
          "Missing Argos repository token 'ARGOS_TOKEN'",
        );
      });
    });

    describe("with token", () => {
      it("should return bearer token", () => {
        const config = { ...configProps, token: "this-token" };
        expect(getAuthToken(config)).toBe(`this-token`);
      });
    });
  });

  describe("with Github Actions CI", () => {
    const configProps = { ciProvider: "github-actions" };

    describe("with token", () => {
      it("should return bearer token", () => {
        const config = { ...configProps, token: "this-token" };
        expect(getAuthToken(config)).toBe(`this-token`);
      });
    });

    describe("without token but with CI env variables", () => {
      it("should return a composite token", () => {
        const config = {
          ...configProps,
          owner: "this-owner",
          repository: "this-repository",
          jobId: "this-jobId",
          runId: "12345",
        };

        const base64 = Buffer.from(
          JSON.stringify({
            owner: config.owner,
            repository: config.repository,
            jobId: config.jobId,
            runId: config.runId,
          }),
          "utf8",
        ).toString("base64");

        const bearerToken = getAuthToken(config);

        expect(bearerToken).toBe(`tokenless-github-${base64}`);
        expect(bearerToken).toBe(
          "tokenless-github-eyJvd25lciI6InRoaXMtb3duZXIiLCJyZXBvc2l0b3J5IjoidGhpcy1yZXBvc2l0b3J5Iiwiam9iSWQiOiJ0aGlzLWpvYklkIiwicnVuSWQiOiIxMjM0NSJ9",
        );
      });
    });

    describe("without token and without CI env variables", () => {
      it("should throw", () => {
        const config = { ...configProps };
        expect(() => getAuthToken(config)).toThrow(
          "Automatic GitHub Actions variables detection failed. Please add the 'ARGOS_TOKEN'",
        );
      });
    });
  });
});
