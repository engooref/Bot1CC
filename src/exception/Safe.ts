import { botLogger } from "../logger.js";

export function SafeMethod(
  _target: object,
  propertyKey: string,
  descriptor: PropertyDescriptor
) {
  const original = descriptor.value as (...args: unknown[]) => Promise<unknown>;
  descriptor.value = async function (...args: unknown[]) {
    try {
      return await original.apply(this, args);
    } catch (err: unknown) {
      await botLogger.error({ op: "SafeMethod", method: propertyKey, err });
    }
  };
}