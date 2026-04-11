import { botLogger } from "../logger.js";

export function SafeMethod(
  _target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
) {
  const original = descriptor.value as (...args: any[]) => Promise<any>;
  descriptor.value = async function (...args: any[]) {
    try {
      return await original.apply(this, args);
    } catch (err: Error | any) {
      await botLogger.error({ op: "SafeMethod", method: propertyKey, err });

    }
  };
}