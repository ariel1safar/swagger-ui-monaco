/**
 * @prettier
 */

import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { lstat, readFile } from "node:fs/promises"
import { gunzipSync } from "node:zlib"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositorySlug = "ariel1safar/swagger-ui-monaco"
const repositoryUrl = `https://github.com/${repositorySlug}`
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

const packageDefinitions = [
  { name: "swagger-ui-monaco", directory: "plugin" },
  { name: "swagger-ui-monaco-dist", directory: "dist" },
  { name: "swagger-ui-monaco-express", directory: "express" },
] as const

type JsonObject = Record<string, unknown>

export interface RegistryMetadata {
  versions: Record<string, { dist?: { integrity?: unknown } }>
}

export interface ReleasePackage {
  name: string
  filename: string
  integrity: string
  path: string
}

export interface ValidatedRelease {
  version: string
  packages: ReleasePackage[]
}

type PublicationStatus = "already-published" | "published" | "would-publish"

interface PublishReleaseOptions {
  artifactDirectory: string
  dryRun?: boolean
  readRegistryMetadata?: (name: string) => Promise<RegistryMetadata | null>
  publishTarball?: (path: string, tag: "latest" | "next") => Promise<void>
  log?: (message: string) => void
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function assertReleaseVersion(version: unknown): asserts version is string {
  if (typeof version !== "string" || !semverPattern.test(version)) {
    throw new Error("version must be a valid SemVer release without a v prefix")
  }
}

function expectedFilename(name: string, version: string) {
  return `${name}-${version}.tgz`
}

function normalizeRepository(value: unknown) {
  const url =
    typeof value === "string" ? value : isObject(value) ? value.url : undefined
  return typeof url === "string"
    ? url
        .replace(/^git\+/, "")
        .replace(/\.git$/, "")
        .replace(/\/$/, "")
    : undefined
}

async function readJson(path: string): Promise<JsonObject> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    throw new Error(`Cannot read valid JSON from ${path}`, { cause: error })
  }
  if (!isObject(value)) throw new Error(`${path} must contain a JSON object`)
  return value
}

export function validateNpmVersion(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) throw new Error(`Cannot parse npm version: ${version}`)
  const [major, minor, patch] = match.slice(1).map(Number)
  if (
    major < 11 ||
    (major === 11 && (minor < 5 || (minor === 5 && patch < 1)))
  ) {
    throw new Error(`npm 11.5.1 or newer is required; found ${version}`)
  }
}

export async function validateReleaseMetadata(root: string, version: string) {
  assertReleaseVersion(version)
  const manifests = [
    {
      path: join(root, "package.json"),
      expectedName: "swagger-ui-monaco-workspace",
    },
    ...packageDefinitions.map((definition) => ({
      path: join(root, "packages", definition.directory, "package.json"),
      expectedName: definition.name,
    })),
  ]

  for (const { path, expectedName } of manifests) {
    const manifest = await readJson(path)
    if (manifest.name !== expectedName)
      throw new Error(`${path} must be named ${expectedName}`)
    if (manifest.version !== version)
      throw new Error(`${path} version must equal ${version}`)
    if (normalizeRepository(manifest.repository) !== repositoryUrl) {
      throw new Error(`${path} repository must be ${repositoryUrl}`)
    }
  }

  const expressManifest = await readJson(
    join(root, "packages", "express", "package.json")
  )
  const dependencies = expressManifest.dependencies
  const distributionVersion = isObject(dependencies)
    ? dependencies["swagger-ui-monaco-dist"]
    : undefined
  if (distributionVersion !== version) {
    throw new Error(
      `swagger-ui-monaco-express must depend on swagger-ui-monaco-dist@${version} exactly`
    )
  }
}

function runGit(root: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

export function validateGitRelease(
  root: string,
  version: string,
  environment: NodeJS.ProcessEnv = process.env
) {
  assertReleaseVersion(version)
  const tag = `monaco-v${version}`
  const head = runGit(root, ["rev-parse", "HEAD"])
  let taggedCommit: string
  try {
    taggedCommit = runGit(root, ["rev-parse", `refs/tags/${tag}^{commit}`])
  } catch (error) {
    throw new Error(`Required tag ${tag} does not exist`, { cause: error })
  }
  if (head !== taggedCommit) throw new Error(`${tag} must point at HEAD`)
  if (environment.GITHUB_ACTIONS === "true") {
    if (environment.GITHUB_REPOSITORY !== repositorySlug) {
      throw new Error(
        `GitHub Actions releases are only allowed from ${repositorySlug}`
      )
    }
    const expectedRef = `refs/tags/${tag}`
    if (environment.GITHUB_REF !== expectedRef) {
      throw new Error(
        `GitHub Actions release ref must be ${expectedRef}; found ${String(environment.GITHUB_REF)}`
      )
    }
    if (environment.GITHUB_SHA !== head) {
      throw new Error(
        `GitHub Actions release SHA must equal tagged HEAD ${head}; found ${String(environment.GITHUB_SHA)}`
      )
    }
  }
  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", taggedCommit, "refs/remotes/origin/main"],
      {
        cwd: root,
        stdio: "ignore",
      }
    )
  } catch (error) {
    throw new Error(`${tag} must be reachable from origin/main`, {
      cause: error,
    })
  }
}

function parseTarPackageManifest(tarball: Buffer, filename: string) {
  let archive: Buffer
  try {
    archive = gunzipSync(tarball, { maxOutputLength: 1024 * 1024 * 1024 })
  } catch (error) {
    throw new Error(`${filename} is not a valid gzip archive`, { cause: error })
  }

  for (let offset = 0; offset + 512 <= archive.length; ) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "")
    const prefix = header
      .subarray(345, 500)
      .toString("utf8")
      .replace(/\0.*$/, "")
    const path = prefix ? `${prefix}/${name}` : name
    const sizeText = header
      .subarray(124, 136)
      .toString("ascii")
      .replace(/\0.*$/, "")
      .trim()
    if (!/^[0-7]+$/.test(sizeText))
      throw new Error(`${filename} contains an invalid tar entry size`)
    const size = Number.parseInt(sizeText, 8)
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (!Number.isSafeInteger(size) || dataEnd > archive.length) {
      throw new Error(`${filename} contains a truncated tar entry`)
    }
    const type = header[156]
    if (path === "package/package.json") {
      if (type !== 0 && type !== 48)
        throw new Error(`${filename} package.json must be a regular file`)
      let manifest: unknown
      try {
        manifest = JSON.parse(
          archive.subarray(dataStart, dataEnd).toString("utf8")
        )
      } catch (error) {
        throw new Error(`${filename} contains an invalid package.json`, {
          cause: error,
        })
      }
      if (!isObject(manifest))
        throw new Error(`${filename} package.json must contain an object`)
      return manifest
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  throw new Error(`${filename} does not contain package/package.json`)
}

function validateIntegrity(value: unknown, name: string) {
  if (typeof value !== "string" || !value.startsWith("sha512-")) {
    throw new Error(
      `${name} integrity must be a SHA-512 Subresource Integrity value`
    )
  }
  const digest = Buffer.from(value.slice("sha512-".length), "base64")
  if (
    digest.length !== 64 ||
    digest.toString("base64") !== value.slice("sha512-".length)
  ) {
    throw new Error(
      `${name} integrity must be a SHA-512 Subresource Integrity value`
    )
  }
  return value
}

export async function validateArtifactDirectory(
  artifactDirectory: string
): Promise<ValidatedRelease> {
  const directory = resolve(artifactDirectory)
  const manifestPath = join(directory, "release-manifest.json")
  const manifest = await readJson(manifestPath)
  assertReleaseVersion(manifest.version)
  if (
    !Array.isArray(manifest.packages) ||
    manifest.packages.length !== packageDefinitions.length
  ) {
    throw new Error(
      `release-manifest.json must list exactly ${packageDefinitions.length} packages`
    )
  }

  const packages: ReleasePackage[] = []
  for (const [index, definition] of packageDefinitions.entries()) {
    const entry = manifest.packages[index]
    if (!isObject(entry))
      throw new Error(
        `release-manifest.json package ${index + 1} must be an object`
      )
    const filename = expectedFilename(definition.name, manifest.version)
    if (entry.name !== definition.name) {
      throw new Error(
        `release-manifest.json package ${index + 1} must be ${definition.name}`
      )
    }
    if (entry.filename !== filename)
      throw new Error(`${definition.name} filename must be ${filename}`)
    const integrity = validateIntegrity(entry.integrity, definition.name)
    const path = join(directory, filename)
    const file = await lstat(path)
    if (!file.isFile() || file.isSymbolicLink())
      throw new Error(`${filename} must be a regular file`)
    const tarball = await readFile(path)
    const actualIntegrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`
    if (actualIntegrity !== integrity) {
      throw new Error(
        `${definition.name} integrity does not match release-manifest.json`
      )
    }
    const packageManifest = parseTarPackageManifest(tarball, filename)
    if (
      packageManifest.name !== definition.name ||
      packageManifest.version !== manifest.version
    ) {
      throw new Error(
        `${filename} contains ${String(packageManifest.name)}@${String(packageManifest.version)}, ` +
          `expected ${definition.name}@${manifest.version}`
      )
    }
    packages.push({ name: definition.name, filename, integrity, path })
  }

  return { version: manifest.version, packages }
}

async function readRegistryMetadata(
  name: string
): Promise<RegistryMetadata | null> {
  let response: Response
  try {
    response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
      {
        headers: { accept: "application/vnd.npm.install-v1+json" },
      }
    )
  } catch (error) {
    throw new Error(`Unable to read npm registry metadata for ${name}`, {
      cause: error,
    })
  }
  if (response.status === 404) return null
  if (!response.ok)
    throw new Error(`npm registry returned HTTP ${response.status} for ${name}`)

  let value: unknown
  try {
    value = await response.json()
  } catch (error) {
    throw new Error(`npm registry returned invalid JSON for ${name}`, {
      cause: error,
    })
  }
  if (!isObject(value) || !isObject(value.versions)) {
    throw new Error(`npm registry metadata for ${name} has no versions object`)
  }
  return value as unknown as RegistryMetadata
}

interface PublishTarballOptions {
  command?: string
  commandArguments?: string[]
  cwd?: string
}

export async function publishTarball(
  path: string,
  tag: "latest" | "next",
  options: PublishTarballOptions = {}
) {
  const command = options.command ?? "npm"
  const argumentsList = [
    ...(options.commandArguments ?? []),
    "publish",
    path,
    "--access",
    "public",
    "--tag",
    tag,
  ]
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, argumentsList, {
      cwd: options.cwd ?? workspaceRoot,
      stdio: "inherit",
    })
    child.once("error", rejectPromise)
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      rejectPromise(
        new Error(
          `${command} publish exited with ${signal ? `signal ${signal}` : `status ${String(code)}`}`
        )
      )
    })
  })
}

export async function publishRelease(options: PublishReleaseOptions) {
  const release = await validateArtifactDirectory(options.artifactDirectory)
  const versionWithoutBuildMetadata = release.version.split("+", 1)[0]
  const tag = versionWithoutBuildMetadata.includes("-")
    ? ("next" as const)
    : ("latest" as const)
  const log = options.log ?? console.log
  if (options.dryRun) {
    for (const item of release.packages)
      log(
        `Would publish ${item.name}@${release.version} from ${item.filename} with tag ${tag}`
      )
    log(
      "Dry run complete; npm registry metadata was not read and no publish was attempted."
    )
    return {
      version: release.version,
      tag,
      packages: release.packages.map((item) => ({
        ...item,
        status: "would-publish" as PublicationStatus,
      })),
    }
  }

  const readMetadata = options.readRegistryMetadata ?? readRegistryMetadata
  const registryMetadata: Array<RegistryMetadata | null> = []
  for (const item of release.packages)
    registryMetadata.push(await readMetadata(item.name))

  const alreadyPublished = registryMetadata.map((metadata, index) => {
    const item = release.packages[index]
    const existing = metadata?.versions[release.version]
    if (!existing) return false
    if (existing.dist?.integrity !== item.integrity) {
      throw new Error(
        `${item.name}@${release.version} already exists with different integrity`
      )
    }
    return true
  })

  const publish = options.publishTarball ?? publishTarball
  const results: Array<ReleasePackage & { status: PublicationStatus }> = []
  for (const [index, item] of release.packages.entries()) {
    if (alreadyPublished[index]) {
      log(
        `Skipping ${item.name}@${release.version}; the registry integrity matches.`
      )
      results.push({ ...item, status: "already-published" })
      continue
    }
    await publish(item.path, tag)
    log(`Published ${item.name}@${release.version} with tag ${tag}.`)
    results.push({ ...item, status: "published" })
  }
  return { version: release.version, tag, packages: results }
}

async function verifyRelease(version: string) {
  assertReleaseVersion(version)
  await validateReleaseMetadata(workspaceRoot, version)
  validateNpmVersion(
    execFileSync("npm", ["--version"], { encoding: "utf8" }).trim()
  )
  validateGitRelease(resolve(workspaceRoot, ".."), version)
  console.log(`Release preflight passed for monaco-v${version}.`)
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === "verify" && args.length === 1) {
    await verifyRelease(args[0])
    return
  }
  if (
    command === "publish" &&
    (args.length === 1 || (args.length === 2 && args[1] === "--dry-run"))
  ) {
    validateNpmVersion(
      execFileSync("npm", ["--version"], { encoding: "utf8" }).trim()
    )
    await publishRelease({
      artifactDirectory: args[0],
      dryRun: args[1] === "--dry-run",
    })
    return
  }
  throw new Error(
    "Usage: release.ts verify <version> | release.ts publish <artifact-directory> [--dry-run]"
  )
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
