// jsdom does not implement Web Locks; browser behavior requires separate E2E coverage.
const queues = new Map<string, Promise<void>>()
Object.defineProperty(navigator, 'locks', { configurable: true, value: {
  request<T>(name: string, _options: object, callback: (lock: object) => Promise<T>) {
    const next = (queues.get(name) ?? Promise.resolve()).then(() => callback({}))
    queues.set(name, next.then(() => {}, () => {}))
    return next
  },
} })
