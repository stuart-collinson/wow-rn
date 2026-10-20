const toParts = (version: string): number[] => version.split('.').map((part) => Number.parseInt(part, 10) || 0)

export const isVersionBelow = (current: string, minimum: string): boolean => {
  const currentParts = toParts(current)
  const minimumParts = toParts(minimum)
  const length = Math.max(currentParts.length, minimumParts.length)

  for (let index = 0; index < length; index += 1) {
    const difference = (currentParts[index] ?? 0) - (minimumParts[index] ?? 0)
    if (difference !== 0) return difference < 0
  }

  return false
}
