import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const ENABLE_VARIABLE = 'RUN_DATABASE_INTEGRATION'
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/
const LINKED_PROJECT_REF_PATH = resolve(process.cwd(), 'supabase/.temp/project-ref')

const REQUIRED_VARIABLES = [
  'SUPABASE_TEST_PROJECT_REF',
  'SUPABASE_TEST_PROJECT_REF_ALLOWLIST',
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'SUPABASE_TEST_SERVICE_ROLE_KEY',
  'SUPABASE_TEST_USER_EMAIL',
  'SUPABASE_TEST_USER_PASSWORD',
] as const

type EnvironmentVariables = Record<string, string | undefined>

type RequiredVariable = (typeof REQUIRED_VARIABLES)[number]

export class DatabaseIntegrationConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseIntegrationConfigurationError'
  }
}

export interface DisabledDatabaseTestEnvironment {
  enabled: false
  reason: `Set ${typeof ENABLE_VARIABLE}=1 to enable database integration tests.`
}

export interface EnabledDatabaseTestEnvironment {
  enabled: true
  projectRef: string
  url: string
  anonKey: string
  serviceRoleKey: string
  testUserEmail: string
  testUserPassword: string
  runId: string
}

export type DatabaseTestEnvironment =
  | DisabledDatabaseTestEnvironment
  | EnabledDatabaseTestEnvironment

interface ResolveEnvironmentOptions {
  env?: EnvironmentVariables
  linkedProjectRef?: string
  runIdFactory?: () => string
}

export interface DatabaseTestClients {
  /** Administrative access. Use only to create fixtures and clean up this run's fixtures. */
  fixtureAdminClient: SupabaseClient
  /** Sign in through this anon-key client and use it for all RLS assertions. */
  rlsAuthenticatedClient: SupabaseClient
  signInForRls(): Promise<void>
}

export function readCurrentLinkedProjectRef(): string | undefined {
  if (!existsSync(LINKED_PROJECT_REF_PATH)) {
    return undefined
  }

  const linkedRef = readFileSync(LINKED_PROJECT_REF_PATH, 'utf8').trim()
  return linkedRef || undefined
}

export function resolveDatabaseTestEnvironment({
  env = process.env,
  linkedProjectRef,
  runIdFactory = createRunId,
}: ResolveEnvironmentOptions = {}): DatabaseTestEnvironment {
  const enableValue = env[ENABLE_VARIABLE]?.trim()

  if (!enableValue || enableValue === '0') {
    return {
      enabled: false,
      reason: 'Set RUN_DATABASE_INTEGRATION=1 to enable database integration tests.',
    }
  }

  if (enableValue !== '1') {
    throw configurationError(
      `${ENABLE_VARIABLE} must be exactly "1" when enabled; received ${JSON.stringify(enableValue)}.`
    )
  }

  const required = readRequiredVariables(env)
  const projectRef = required.SUPABASE_TEST_PROJECT_REF

  if (!PROJECT_REF_PATTERN.test(projectRef)) {
    throw configurationError('SUPABASE_TEST_PROJECT_REF must be a 20-character lowercase Supabase project ref.')
  }

  const normalizedLinkedRef = linkedProjectRef?.trim()
  if (normalizedLinkedRef && projectRef === normalizedLinkedRef) {
    throw configurationError(
      `Refusing linked Supabase project ${projectRef}; the currently linked project must be treated as production.`
    )
  }

  const allowedRefs = new Set(
    required.SUPABASE_TEST_PROJECT_REF_ALLOWLIST
      .split(',')
      .map((ref) => ref.trim())
      .filter(Boolean)
  )

  if (!allowedRefs.has(projectRef)) {
    throw configurationError(
      `SUPABASE_TEST_PROJECT_REF ${projectRef} is not present in SUPABASE_TEST_PROJECT_REF_ALLOWLIST.`
    )
  }

  const url = validateProjectUrl(required.SUPABASE_TEST_URL, projectRef)
  validateKeyRole(required.SUPABASE_TEST_ANON_KEY, 'anon')
  validateKeyRole(required.SUPABASE_TEST_SERVICE_ROLE_KEY, 'service_role')

  return {
    enabled: true,
    projectRef,
    url,
    anonKey: required.SUPABASE_TEST_ANON_KEY,
    serviceRoleKey: required.SUPABASE_TEST_SERVICE_ROLE_KEY,
    testUserEmail: required.SUPABASE_TEST_USER_EMAIL,
    testUserPassword: required.SUPABASE_TEST_USER_PASSWORD,
    runId: runIdFactory(),
  }
}

export function loadDatabaseTestEnvironment(
  env: EnvironmentVariables = process.env
): DatabaseTestEnvironment {
  return resolveDatabaseTestEnvironment({
    env,
    linkedProjectRef: readCurrentLinkedProjectRef(),
  })
}

export function createDatabaseTestClients(
  environment: EnabledDatabaseTestEnvironment
): DatabaseTestClients {
  const authOptions = {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  }

  const fixtureAdminClient = createClient(environment.url, environment.serviceRoleKey, {
    auth: authOptions,
  })
  const rlsAuthenticatedClient = createClient(environment.url, environment.anonKey, {
    auth: authOptions,
  })

  return {
    fixtureAdminClient,
    rlsAuthenticatedClient,
    async signInForRls() {
      const { error } = await rlsAuthenticatedClient.auth.signInWithPassword({
        email: environment.testUserEmail,
        password: environment.testUserPassword,
      })

      if (error) {
        throw new Error(`Could not authenticate the RLS test client: ${error.message}`)
      }
    },
  }
}

function readRequiredVariables(env: EnvironmentVariables): Record<RequiredVariable, string> {
  const values = {} as Record<RequiredVariable, string>

  for (const variable of REQUIRED_VARIABLES) {
    const value = env[variable]?.trim()
    if (!value) {
      throw configurationError(`${variable} is required when ${ENABLE_VARIABLE}=1.`)
    }
    values[variable] = value
  }

  return values
}

function validateProjectUrl(rawUrl: string, projectRef: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw configurationError('SUPABASE_TEST_URL must be a valid URL.')
  }

  const expectedHost = `${projectRef}.supabase.co`
  const hasUnexpectedParts =
    url.protocol !== 'https:' ||
    url.hostname !== expectedHost ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search !== '' ||
    url.hash !== ''

  if (hasUnexpectedParts) {
    throw configurationError(`SUPABASE_TEST_URL must be exactly https://${expectedHost}.`)
  }

  return `https://${expectedHost}`
}

function validateKeyRole(key: string, expectedRole: 'anon' | 'service_role'): void {
  if (expectedRole === 'anon' && key.startsWith('sb_publishable_')) {
    return
  }
  if (expectedRole === 'service_role' && key.startsWith('sb_secret_')) {
    return
  }

  const role = readJwtRole(key)
  if (role !== expectedRole) {
    const variable = expectedRole === 'anon'
      ? 'SUPABASE_TEST_ANON_KEY'
      : 'SUPABASE_TEST_SERVICE_ROLE_KEY'
    throw configurationError(`${variable} does not identify a ${expectedRole} key.`)
  }
}

function readJwtRole(key: string): string | undefined {
  const payload = key.split('.')[1]
  if (!payload) {
    return undefined
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role?: unknown
    }
    return typeof decoded.role === 'string' ? decoded.role : undefined
  } catch {
    return undefined
  }
}

function createRunId(): string {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 17)
  return `db-it-${timestamp}-${randomUUID()}`
}

function configurationError(message: string): DatabaseIntegrationConfigurationError {
  return new DatabaseIntegrationConfigurationError(
    `Database integration tests stopped before database access: ${message}`
  )
}
