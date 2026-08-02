import { describe, expect, it } from 'vitest'
import {
  DatabaseIntegrationConfigurationError,
  resolveDatabaseTestEnvironment,
} from './test-environment'

const TEST_REF = 'abcdefghijklmnopqrst'
const OTHER_REF = 'tsrqponmlkjihgfedcba'

function jwtForRole(role: 'anon' | 'service_role'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ role })).toString('base64url')
  return `${header}.${payload}.test-signature`
}

function validEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    RUN_DATABASE_INTEGRATION: '1',
    SUPABASE_TEST_PROJECT_REF: TEST_REF,
    SUPABASE_TEST_PROJECT_REF_ALLOWLIST: TEST_REF,
    SUPABASE_TEST_URL: `https://${TEST_REF}.supabase.co`,
    SUPABASE_TEST_ANON_KEY: jwtForRole('anon'),
    SUPABASE_TEST_SERVICE_ROLE_KEY: jwtForRole('service_role'),
    SUPABASE_TEST_USER_EMAIL: 'database-integration@example.test',
    SUPABASE_TEST_USER_PASSWORD: 'not-a-real-password',
    ...overrides,
  }
}

function expectConfigurationFailure(
  env: Record<string, string | undefined>,
  expectedMessage: string,
  linkedProjectRef = OTHER_REF
) {
  expect(() => resolveDatabaseTestEnvironment({ env, linkedProjectRef })).toThrowError(
    DatabaseIntegrationConfigurationError
  )
  expect(() => resolveDatabaseTestEnvironment({ env, linkedProjectRef })).toThrow(expectedMessage)
}

const disabledEnvironment = resolveDatabaseTestEnvironment({ env: {} })

describe.skipIf(!disabledEnvironment.enabled)(
  'credentialed database suite without explicit opt-in',
  () => {
    it('never executes its database access body', () => {
      throw new Error('A disabled database integration test accessed its body.')
    })
  }
)

describe('database integration environment guard', () => {
  it('safely disables database access when the explicit opt-in is absent', () => {
    expect(resolveDatabaseTestEnvironment({ env: {} })).toEqual({
      enabled: false,
      reason: 'Set RUN_DATABASE_INTEGRATION=1 to enable database integration tests.',
    })
  })

  it('does not validate or access credentials while disabled', () => {
    expect(resolveDatabaseTestEnvironment({
      env: {
        SUPABASE_TEST_PROJECT_REF: 'invalid',
        SUPABASE_TEST_URL: 'not-a-url',
      },
      linkedProjectRef: 'invalid',
    }).enabled).toBe(false)
  })

  it('fails closed for ambiguous enable values', () => {
    expectConfigurationFailure(
      validEnvironment({ RUN_DATABASE_INTEGRATION: 'true' }),
      'RUN_DATABASE_INTEGRATION must be exactly "1"'
    )
  })

  it.each([
    'SUPABASE_TEST_PROJECT_REF',
    'SUPABASE_TEST_PROJECT_REF_ALLOWLIST',
    'SUPABASE_TEST_URL',
    'SUPABASE_TEST_ANON_KEY',
    'SUPABASE_TEST_SERVICE_ROLE_KEY',
    'SUPABASE_TEST_USER_EMAIL',
    'SUPABASE_TEST_USER_PASSWORD',
  ])('fails closed when enabled without %s', (variable) => {
    expectConfigurationFailure(
      validEnvironment({ [variable]: undefined }),
      `${variable} is required`
    )
  })

  it('rejects the currently linked project ref', () => {
    expectConfigurationFailure(
      validEnvironment(),
      'Refusing linked Supabase project',
      TEST_REF
    )
  })

  it('rejects a test ref outside the explicit allowlist', () => {
    expectConfigurationFailure(
      validEnvironment({ SUPABASE_TEST_PROJECT_REF_ALLOWLIST: OTHER_REF }),
      'is not present in SUPABASE_TEST_PROJECT_REF_ALLOWLIST'
    )
  })

  it('rejects a URL whose host does not match the allowed test ref', () => {
    expectConfigurationFailure(
      validEnvironment({ SUPABASE_TEST_URL: `https://${OTHER_REF}.supabase.co` }),
      `SUPABASE_TEST_URL must be exactly https://${TEST_REF}.supabase.co`
    )
  })

  it('rejects swapped anon and service-role credentials before making a client', () => {
    expectConfigurationFailure(
      validEnvironment({ SUPABASE_TEST_SERVICE_ROLE_KEY: jwtForRole('anon') }),
      'SUPABASE_TEST_SERVICE_ROLE_KEY does not identify a service_role key'
    )
    expectConfigurationFailure(
      validEnvironment({ SUPABASE_TEST_ANON_KEY: jwtForRole('service_role') }),
      'SUPABASE_TEST_ANON_KEY does not identify a anon key'
    )
  })

  it('returns a unique run id for each enabled test run', () => {
    const first = resolveDatabaseTestEnvironment({
      env: validEnvironment(),
      linkedProjectRef: OTHER_REF,
      runIdFactory: () => 'db-it-first',
    })
    const second = resolveDatabaseTestEnvironment({
      env: validEnvironment(),
      linkedProjectRef: OTHER_REF,
      runIdFactory: () => 'db-it-second',
    })

    expect(first).toMatchObject({ enabled: true, projectRef: TEST_REF, runId: 'db-it-first' })
    expect(second).toMatchObject({ enabled: true, projectRef: TEST_REF, runId: 'db-it-second' })
  })
})
