// src/logger.ts
import { createLogger, format, transports } from 'winston';
import WinstonGraylog2 from 'winston-graylog2';
const isProd = process.env.NODE_ENV === 'prod';
const graylogTransport = new WinstonGraylog2({
    name: 'Graylog',
    level: isProd ? 'info' : 'debug',
    graylog: {
        servers: [{ host: '127.0.0.1', port: 12201 }],
        facility: 'discord-bot',
    },
    staticMeta: {
        service: 'my-discord-bot',
        env: process.env.NODE_ENV || 'dev',
    },
}); // ← on cast ici
const logger = createLogger({
    level: isProd ? 'info' : 'debug',
    format: format.combine(format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), format.errors({ stack: true }), format.splat(), format.printf(({ timestamp, level, message, stack }) => stack
        ? `${timestamp} [${level}] ${message}\n${stack}`
        : `${timestamp} [${level}] ${message}`)),
    transports: [
        new transports.Console(),
        graylogTransport,
    ],
});
export default logger;
//# sourceMappingURL=logger.js.map