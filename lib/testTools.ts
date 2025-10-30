export const removeUndefinedDeep = (obj: Record<string, unknown>) => {
  const ret: Record<string, unknown> = {};
  Object.keys(obj || {}).forEach((key) => {
    const value = obj[key];
    if (value !== undefined) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = removeUndefinedDeep(value as Record<string, unknown>);
        if (Object.keys(nested).length > 0) {
          ret[key] = nested;
        }
      } else {
        ret[key] = value;
      }
    }
  });
  return ret;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const callCount = (mockCalls: any[]) =>
  mockCalls.reduce((acc, c) => {
    const [capabilityId] = c;
    return { ...acc, [capabilityId]: (acc[capabilityId] || 0) + 1 };
  }, {});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const callsWithArgs = (mockCalls: any[]) =>
  mockCalls.reduce((acc, c) => {
    const [capabilityId, ...args] = c;
    return { ...acc, [capabilityId]: [...(acc[capabilityId] || []), args] };
  }, {});
