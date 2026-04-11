// src/logger.ts
import pino, { Logger, LoggerOptions, DestinationStream } from "pino";
import path from "path";
import fs from "fs";

const isProd = process.env.NODE_ENV === "prod";

function ensureLogsDir(): string {
  const logsDir = path.resolve(process.cwd(), "logs");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  return logsDir;
}

function prettyFileStream(filename: string): DestinationStream {
  const logsDir = ensureLogsDir();

  // pino.transport retourne un stream compatible
  const transport = pino.transport({
    target: "pino-pretty",
    options: {
      colorize: false, // fichier => pas de couleurs
      translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
      ignore: "pid,hostname",
      singleLine: true,
      levelFirst: true,
      errorProps: "stack",
      destination: path.join(logsDir, filename),
      mkdir: true,
      // Message format sympa, et tu gardes les champs en fin de ligne
      messageFormat:
        "{msg} | op={op} reqId={reqId} manager={manager} method={method} url={url} status={status} duration={duration}ms",
    },
  });

  return transport;
}

function prettyConsoleStream(): DestinationStream {
  const transport = pino.transport({
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
      ignore: "pid,hostname",
      singleLine: true,
      levelFirst: true,
      errorProps: "stack",
      messageFormat:
        "{msg} | op={op} reqId={reqId} manager={manager} method={method} url={url} status={status} duration={duration}ms",
    },
  });

  return transport;
}

function baseOptions(): LoggerOptions {
  return {
    level: isProd ? "info" : "debug",
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: pino.stdSerializers.err,
    },
    base: {
      service: "discord-bot",
      env: process.env.NODE_ENV || "dev",
    },
  };
}

function buildLogger(scope: "bot" | "http" | "manager", filename: string): Logger {
  const streams: pino.StreamEntry[] = [];

  // fichier pretty
  streams.push({ level: "info", stream: prettyFileStream(filename) });

  if (!isProd) streams.push({ level: "debug", stream: prettyConsoleStream() });
  else streams.push({ level: "info", stream: prettyConsoleStream() });

  const l = pino(baseOptions(), pino.multistream(streams, { dedupe: true }));

  // scope fixé pour filtrer/repérer
  return l.child({ scope });
}

// =========================
// 3 loggers demandés
// =========================
export const botLogger = buildLogger("bot", "bot.log");
export const httpLogger = buildLogger("http", "http.log");
export const managerLogger = buildLogger("manager", "managers.log");

// =========================
// Helper: manager child logger
// Tu changes juste le param "manager" dans chaque manager
// =========================
export function getManagerLogger(managerName: string): Logger {
  return managerLogger.child({ manager: managerName });
}

// =========================
// Helper: logs HTTP explicites (optionnel)
// =========================
export function logHttpIn(payload: {
  reqId: string;
  method: string;
  url: string;
  contentType?: string;
  signature?: boolean;
  bodySize?: number;
}) {
  httpLogger.info(
    {
      op: "HTTP_IN",
      reqId: payload.reqId,
      method: payload.method,
      url: payload.url,
      contentType: payload.contentType,
      signature: payload.signature,
      bodySize: payload.bodySize,
    },
    "📥 HTTP IN"
  );
}

export function logHttpOut(payload: {
  reqId: string;
  status: number;
  durationMs: number;
  retryable?: boolean;
}) {
  const lvl: "info" | "warn" | "error" =
    payload.status >= 500 ? "error" : payload.status >= 400 ? "warn" : "info";

  httpLogger[lvl](
    {
      op: "HTTP_OUT",
      reqId: payload.reqId,
      status: payload.status,
      duration: payload.durationMs,
      retryable: payload.retryable,
    },
    "⬅️ HTTP OUT"
  );
}
