import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { TextDecoder } from 'node:util'

const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
const entries = await readdir(migrationsDir, { withFileTypes: true })
const migrationFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort()

const invalidNames = []
const invalidEncodings = []
const versions = new Map()
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

for (const file of migrationFiles) {
  try {
    utf8Decoder.decode(await readFile(path.join(migrationsDir, file)))
  } catch {
    invalidEncodings.push(file)
  }

  const match = /^(\d{14})_[a-z0-9][a-z0-9_]*\.sql$/.exec(file)
  if (!match) {
    invalidNames.push(file)
    continue
  }

  const version = match[1]
  const files = versions.get(version) ?? []
  files.push(file)
  versions.set(version, files)
}

const duplicateVersions = [...versions.entries()].filter(([, files]) => files.length > 1)

if (invalidNames.length > 0 || invalidEncodings.length > 0 || duplicateVersions.length > 0) {
  if (invalidNames.length > 0) {
    console.error('迁移文件名必须使用 YYYYMMDDHHMMSS_description.sql：')
    invalidNames.forEach((file) => console.error(`  - ${file}`))
  }

  if (invalidEncodings.length > 0) {
    console.error('迁移文件必须使用有效的 UTF-8 编码：')
    invalidEncodings.forEach((file) => console.error(`  - ${file}`))
  }

  if (duplicateVersions.length > 0) {
    console.error('迁移版本号必须唯一：')
    duplicateVersions.forEach(([version, files]) => {
      console.error(`  - ${version}: ${files.join(', ')}`)
    })
  }

  process.exit(1)
}

console.log(`迁移命名检查通过：${migrationFiles.length} 个唯一版本`)
