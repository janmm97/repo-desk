import { describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

describe("cli", () => {
  it("prints the version", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(["version"])).toBe(0);
    expect(log).toHaveBeenCalledWith("0.1.0");
    log.mockRestore();
  });

  it("rejects unknown commands with exit code 2", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["nope"])).toBe(2);
    err.mockRestore();
  });
});
