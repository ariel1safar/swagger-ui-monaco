/**
 * @prettier
 */

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"

import * as releaseModule from "../../../scripts/release.ts"
import {
  publishRelease,
  validateArtifactDirectory,
  validateGitRelease,
  validateNpmVersion,
  validateReleaseMetadata,
  type RegistryMetadata,
} from "../../../scripts/release.ts"

const version = "0.1.0-beta.1"
const packageDefinitions = [
  {
    name: "swagger-ui-monaco",
  },
  {
    name: "swagger-ui-monaco-dist",
  },
  {
    name: "swagger-ui-monaco-express",
  },
]

type Fixture = (typeof packageDefinitions)[number] & {
  filename: string
  integrity: string
}

const temporaryDirectories: string[] = []

async function temporaryDirectory(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

async function createArtifacts(releaseVersion = version) {
  const directory = await temporaryDirectory("swagger-ui-monaco-release-")
  const fixtures: Fixture[] = []
  for (const definition of packageDefinitions) {
    const packageDirectory = join(directory, "sources", definition.name)
    await mkdir(packageDirectory, { recursive: true })
    await writeFile(
      join(packageDirectory, "package.json"),
      JSON.stringify({
        name: definition.name,
        version: releaseVersion,
        files: ["index.js"],
      })
    )
    await writeFile(
      join(packageDirectory, "index.js"),
      `export const packageName = "${definition.name}"\n`
    )
    execFileSync(
      "npm",
      ["pack", "--pack-destination", directory, packageDirectory],
      { stdio: "ignore" }
    )
    const filename = `${definition.name}-${releaseVersion}.tgz`
    const integrity = `sha512-${createHash("sha512")
      .update(await readFile(join(directory, filename)))
      .digest("base64")}`
    fixtures.push({ ...definition, filename, integrity })
  }
  await writeFile(
    join(directory, "release-manifest.json"),
    JSON.stringify({
      version: releaseVersion,
      packages: fixtures.map(({ name, filename, integrity }) => ({
        name,
        filename,
        integrity,
      })),
    })
  )
  return { directory, fixtures }
}

async function createTaggedRepository() {
  const root = await temporaryDirectory("swagger-ui-monaco-git-")
  execFileSync("git", ["init", "--initial-branch=main"], {
    cwd: root,
    stdio: "ignore",
  })
  execFileSync("git", ["config", "user.email", "release-test@example.com"], {
    cwd: root,
  })
  execFileSync("git", ["config", "user.name", "Release Test"], { cwd: root })
  await writeFile(join(root, "tracked.txt"), "release")
  execFileSync("git", ["add", "tracked.txt"], { cwd: root })
  execFileSync("git", ["commit", "-m", "release"], {
    cwd: root,
    stdio: "ignore",
  })
  execFileSync("git", ["tag", `monaco-v${version}`], { cwd: root })
  execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], {
    cwd: root,
  })
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim()
  return { root, head }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe("release artifact validation", () => {
  test("accepts the three tested tarballs in dependency order", async () => {
    const { directory, fixtures } = await createArtifacts()

    const release = await validateArtifactDirectory(directory)

    expect(release).toMatchObject({
      version,
      packages: fixtures.map(({ name, filename, integrity }) => ({
        name,
        filename,
        integrity,
      })),
    })
  })

  test("rejects a tarball whose bytes do not match the test manifest", async () => {
    const { directory, fixtures } = await createArtifacts()
    await writeFile(
      join(directory, fixtures[1].filename),
      "changed after tests"
    )

    await expect(validateArtifactDirectory(directory)).rejects.toThrow(
      "swagger-ui-monaco-dist integrity does not match release-manifest.json"
    )
  })

  test("rejects a tarball whose embedded package identity does not match the manifest", async () => {
    const { directory, fixtures } = await createArtifacts()
    const source = join(directory, "wrong-package")
    await mkdir(source)
    await writeFile(
      join(source, "package.json"),
      JSON.stringify({
        name: "unexpected-package",
        version,
      })
    )
    execFileSync("npm", ["pack", "--pack-destination", directory, source], {
      stdio: "ignore",
    })
    await copyFile(
      join(directory, `unexpected-package-${version}.tgz`),
      join(directory, fixtures[0].filename)
    )
    fixtures[0].integrity = `sha512-${createHash("sha512")
      .update(await readFile(join(directory, fixtures[0].filename)))
      .digest("base64")}`
    await writeFile(
      join(directory, "release-manifest.json"),
      JSON.stringify({ version, packages: fixtures })
    )

    await expect(validateArtifactDirectory(directory)).rejects.toThrow(
      `${fixtures[0].filename} contains unexpected-package@${version}, expected swagger-ui-monaco@${version}`
    )
  })
})

describe("publication recovery", () => {
  test("reads all registry metadata before publishing and skips an identical existing version", async () => {
    const { directory, fixtures } = await createArtifacts()
    const events: string[] = []
    const metadata = new Map<string, RegistryMetadata | null>([
      [
        fixtures[0].name,
        {
          versions: {
            [version]: { dist: { integrity: fixtures[0].integrity } },
          },
        },
      ],
      [fixtures[1].name, null],
      [fixtures[2].name, { versions: {} }],
    ])

    const result = await publishRelease({
      artifactDirectory: directory,
      readRegistryMetadata: async (name) => {
        events.push(`read:${name}`)
        return metadata.get(name) ?? null
      },
      publishTarball: async (path, tag) => {
        events.push(`publish:${path.split("/").at(-1)}:${tag}`)
      },
      log: () => undefined,
    })

    expect(events).toEqual([
      "read:swagger-ui-monaco",
      "read:swagger-ui-monaco-dist",
      "read:swagger-ui-monaco-express",
      `publish:${fixtures[1].filename}:next`,
      `publish:${fixtures[2].filename}:next`,
    ])
    expect(result.packages.map((item) => item.status)).toEqual([
      "already-published",
      "published",
      "published",
    ])
  })

  test("stops before publishing when an existing version has different bytes", async () => {
    const { directory, fixtures } = await createArtifacts()
    let publishCount = 0

    await expect(
      publishRelease({
        artifactDirectory: directory,
        readRegistryMetadata: async (name): Promise<RegistryMetadata> => {
          if (name === fixtures[2].name) {
            return {
              versions: {
                [version]: { dist: { integrity: "sha512-different" } },
              },
            }
          }
          return { versions: {} }
        },
        publishTarball: async () => {
          publishCount += 1
        },
        log: () => undefined,
      })
    ).rejects.toThrow(
      "swagger-ui-monaco-express@0.1.0-beta.1 already exists with different integrity"
    )
    expect(publishCount).toBe(0)
  })

  test("dry-run validates locally without reading or mutating the registry", async () => {
    const { directory } = await createArtifacts()
    let registryCalls = 0

    const result = await publishRelease({
      artifactDirectory: directory,
      dryRun: true,
      readRegistryMetadata: async () => {
        registryCalls += 1
        throw new Error("registry must not be used")
      },
      publishTarball: async () => {
        throw new Error("publish must not be used")
      },
      log: () => undefined,
    })

    expect(registryCalls).toBe(0)
    expect(result.packages.map((item) => item.status)).toEqual([
      "would-publish",
      "would-publish",
      "would-publish",
    ])
  })

  test("uses the latest tag for a stable version with build metadata", async () => {
    const { directory } = await createArtifacts("1.2.3+build-label")
    const tags: string[] = []

    await publishRelease({
      artifactDirectory: directory,
      readRegistryMetadata: async () => ({ versions: {} }),
      publishTarball: async (_path, tag) => {
        tags.push(tag)
      },
      log: () => undefined,
    })

    expect(tags).toEqual(["latest", "latest", "latest"])
  })

  test("runs npm publish with inherited process streams and waits for completion", async () => {
    const root = await temporaryDirectory("swagger-ui-monaco-publish-process-")
    const fakeNpm = join(root, "fake-npm.mjs")
    const driver = join(root, "driver.mjs")
    const capture = join(root, "publish-call.json")
    await writeFile(
      fakeNpm,
      `import { writeFileSync } from "node:fs"
writeFileSync(process.env.CAPTURE_PATH, JSON.stringify(process.argv.slice(2)))
console.log("interactive npm output")
`
    )
    const publishTarball = (
      releaseModule as unknown as {
        publishTarball: (
          path: string,
          tag: "next",
          options: {
            command: string
            commandArguments: string[]
            cwd: string
          }
        ) => Promise<void>
      }
    ).publishTarball
    expect(typeof publishTarball).toBe("function")
    await writeFile(
      driver,
      `import { publishTarball } from ${JSON.stringify(new URL("../../../scripts/release.ts", import.meta.url).href)}
await publishTarball("tested-package.tgz", "next", {
  command: process.execPath,
  commandArguments: [${JSON.stringify(fakeNpm)}],
  cwd: ${JSON.stringify(root)},
})
`
    )

    const output = execFileSync(
      process.execPath,
      ["--experimental-strip-types", driver],
      {
        encoding: "utf8",
        env: { ...process.env, CAPTURE_PATH: capture },
      }
    )

    expect(output).toContain("interactive npm output")
    expect(JSON.parse(await readFile(capture, "utf8"))).toEqual([
      "publish",
      "tested-package.tgz",
      "--access",
      "public",
      "--tag",
      "next",
    ])
  })
})

describe("release preflight", () => {
  test("requires exact package versions, repository metadata, and Express dependency", async () => {
    const root = await temporaryDirectory("swagger-ui-monaco-metadata-")
    const repository = {
      type: "git",
      url: "https://github.com/ariel1safar/swagger-ui-monaco.git",
    }
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "swagger-ui-monaco-workspace",
        version,
        repository,
      })
    )
    for (const directory of ["plugin", "dist", "express"]) {
      await mkdir(join(root, "packages", directory), { recursive: true })
      await writeFile(
        join(root, "packages", directory, "package.json"),
        JSON.stringify({
          name: `swagger-ui-monaco${directory === "plugin" ? "" : `-${directory}`}`,
          version,
          repository,
          dependencies:
            directory === "express"
              ? { "swagger-ui-monaco-dist": version }
              : undefined,
        })
      )
    }

    await expect(
      validateReleaseMetadata(root, version)
    ).resolves.toBeUndefined()

    await writeFile(
      join(root, "packages", "express", "package.json"),
      JSON.stringify({
        name: "swagger-ui-monaco-express",
        version,
        repository,
        dependencies: { "swagger-ui-monaco-dist": "^0.1.0" },
      })
    )
    await expect(validateReleaseMetadata(root, version)).rejects.toThrow(
      "swagger-ui-monaco-express must depend on swagger-ui-monaco-dist@0.1.0-beta.1 exactly"
    )
  })

  test("requires npm 11.5.1 or newer", () => {
    expect(() => validateNpmVersion("11.5.0")).toThrow(
      "npm 11.5.1 or newer is required"
    )
    expect(() => validateNpmVersion("11.5.1")).not.toThrow()
    expect(() => validateNpmVersion("12.0.0")).not.toThrow()
  })

  test("requires the matching Monaco tag at HEAD and reachable from origin/main", async () => {
    const { root } = await createTaggedRepository()

    expect(() => validateGitRelease(root, version, {})).not.toThrow()

    await writeFile(join(root, "tracked.txt"), "after tag")
    execFileSync("git", ["commit", "-am", "after tag"], {
      cwd: root,
      stdio: "ignore",
    })
    expect(() => validateGitRelease(root, version, {})).toThrow(
      `monaco-v${version} must point at HEAD`
    )
  })

  test("accepts a GitHub Actions dispatch from the exact release tag and SHA", async () => {
    const { root, head } = await createTaggedRepository()

    expect(() =>
      validateGitRelease(root, version, {
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "ariel1safar/swagger-ui-monaco",
        GITHUB_REF: `refs/tags/monaco-v${version}`,
        GITHUB_SHA: head,
      })
    ).not.toThrow()
  })

  test("rejects GitHub Actions dispatch ref and SHA mismatches", async () => {
    const { root, head } = await createTaggedRepository()
    const context = {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "ariel1safar/swagger-ui-monaco",
      GITHUB_REF: `refs/tags/monaco-v${version}`,
      GITHUB_SHA: head,
    }

    expect(() =>
      validateGitRelease(root, version, {
        ...context,
        GITHUB_REF: "refs/heads/main",
      })
    ).toThrow(
      `GitHub Actions release ref must be refs/tags/monaco-v${version}; found refs/heads/main`
    )
    expect(() =>
      validateGitRelease(root, version, {
        ...context,
        GITHUB_SHA: "0000000000000000000000000000000000000000",
      })
    ).toThrow(`GitHub Actions release SHA must equal tagged HEAD ${head}`)
  })
})
