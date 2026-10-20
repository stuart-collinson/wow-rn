import { expect, test } from '@jest/globals'
import { isVersionBelow } from '@/lib/version'

test('returns true when the current version is older than the minimum', () => {
  const result = isVersionBelow('1.2.3', '1.3.0')

  expect(result).toBe(true)
})

test('returns false when the current version equals the minimum', () => {
  const result = isVersionBelow('1.3.0', '1.3.0')

  expect(result).toBe(false)
})

test('returns false when the current version is newer than the minimum', () => {
  const result = isVersionBelow('2.0.0', '1.9.9')

  expect(result).toBe(false)
})

test('treats a missing patch segment as zero', () => {
  const result = isVersionBelow('1.3', '1.3.0')

  expect(result).toBe(false)
})
