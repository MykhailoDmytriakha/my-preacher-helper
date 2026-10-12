/** Put `make(original)` in place of an object's own or inherited method, where the object allows it. */
export function replaceMethod<T extends object, K extends keyof T>(target: T, name: K, make: (original: T[K]) => T[K]): void {
  const original = target[name];
  if (typeof original !== 'function' || !Object.isExtensible(target)
    || Object.getOwnPropertyDescriptor(target, name)?.configurable === false) return;
  Object.defineProperty(target, name, { configurable: true, value: make((original as (...args: unknown[]) => unknown).bind(target) as T[K]) });
}
