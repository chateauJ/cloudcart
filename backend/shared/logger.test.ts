import type * as LoggerModule from "./logger";
import { context, logLines } from "../test/helpers";

// LOG_LEVEL and the cold-start flag live at module scope, so each test loads a fresh copy
function loadLogger(logLevel?: string): typeof LoggerModule {
  jest.resetModules();
  if (logLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = logLevel;
  return require("./logger") as typeof LoggerModule;
}

afterEach(() => {
  delete process.env.LOG_LEVEL;
  delete process.env._X_AMZN_TRACE_ID;
});

describe("logger", () => {
  it("writes one JSON object per line with the invocation's base fields", () => {
    process.env._X_AMZN_TRACE_ID = "Root=1-6543-abcdef;Parent=53995c3f42cd8ad8;Sampled=1";
    const log = loadLogger().createLogger(context, { route: "GET /cart" });

    log.info("hello", { count: 2 });

    expect(jest.mocked(process.stdout.write)).toHaveBeenCalledTimes(1);
    expect(logLines()).toEqual([
      {
        level: "INFO",
        message: "hello",
        function: "cloudcart-test",
        requestId: "request-1",
        traceId: "1-6543-abcdef",
        coldStart: true,
        route: "GET /cart",
        count: 2,
      },
    ]);
  });

  it("flags only the first invocation in an execution environment as a cold start", () => {
    const { createLogger } = loadLogger();

    createLogger(context).info("first");
    createLogger(context).info("second");

    expect(logLines().map((line) => line.coldStart)).toEqual([true, false]);
  });

  it("adds a child's fields to every line without changing the parent", () => {
    const parent = loadLogger().createLogger(context);
    const child = parent.child({ userId: "user-1" });

    child.info("from child");
    parent.info("from parent");

    const [childLine, parentLine] = logLines();
    expect(childLine.userId).toBe("user-1");
    expect(parentLine).not.toHaveProperty("userId");
  });

  it("serializes Error values, which JSON.stringify would turn into {}", () => {
    const log = loadLogger().createLogger(context);

    log.error("failed", { error: new TypeError("bad input") });

    expect(logLines()[0].error).toEqual({
      name: "TypeError",
      message: "bad input",
      stack: expect.stringContaining("TypeError: bad input"),
    });
  });

  it("drops lines below LOG_LEVEL", () => {
    const log = loadLogger("warn").createLogger(context);

    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");

    expect(logLines().map((line) => line.level)).toEqual(["WARN", "ERROR"]);
  });

  it("falls back to INFO for an unrecognized LOG_LEVEL", () => {
    const log = loadLogger("VERBOSE").createLogger(context);

    log.debug("d");
    log.info("i");

    expect(logLines().map((line) => line.level)).toEqual(["INFO"]);
  });
});
