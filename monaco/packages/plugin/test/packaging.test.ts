/**
 * @prettier
 */

import { spawnSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"

import { checkPackage } from "../../../scripts/check-package.ts"

const temporaryDirectories: string[] = []

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "swagger-ui-monaco-packaging-")
  )
  temporaryDirectories.push(directory)
  return directory
}

async function createValidDistributionFixture() {
  const workspace = await makeTemporaryDirectory()
  const packageDirectory = join(workspace, "packages", "dist")
  const assetsDirectory = join(packageDirectory, "dist", "assets")
  const monacoAssetsDirectory = join(assetsDirectory, "monaco")
  const upstreamDirectory = join(workspace, "node_modules", "swagger-ui-dist")
  await Promise.all([
    mkdir(monacoAssetsDirectory, { recursive: true }),
    mkdir(upstreamDirectory, { recursive: true }),
  ])
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({
      name: "swagger-ui-monaco-workspace",
      version: "0.1.0-beta.1",
      private: true,
      workspaces: ["packages/*"],
    })
  )
  await writeFile(
    join(packageDirectory, "package.json"),
    JSON.stringify({
      name: "swagger-ui-monaco-dist",
      version: "0.1.0-beta.1",
      type: "module",
      main: "./dist/index.cjs",
      types: "./dist/index.d.ts",
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
          require: "./dist/index.cjs",
        },
        "./absolute-path": {
          import: {
            types: "./dist/absolute-path.d.ts",
            default: "./dist/absolute-path.js",
          },
          require: {
            types: "./dist/absolute-path.d.cts",
            default: "./dist/absolute-path.cjs",
          },
        },
        "./assets/*": "./dist/assets/*",
      },
      files: ["dist", "README.md", "LICENSE", "NOTICE"],
      license: "Apache-2.0",
      repository: {
        type: "git",
        url: "git+https://github.com/ariel1safar/swagger-ui-monaco.git",
        directory: "monaco/packages/dist",
      },
      publishConfig: {
        access: "public",
        registry: "https://registry.npmjs.org",
      },
    })
  )

  const packageFiles = [
    "README.md",
    "LICENSE",
    "NOTICE",
    "dist/index.js",
    "dist/index.cjs",
    "dist/index.d.ts",
    "dist/absolute-path.js",
    "dist/absolute-path.cjs",
    "dist/absolute-path.d.ts",
    "dist/absolute-path.d.cts",
    "dist/THIRD_PARTY_NOTICES.txt",
    "dist/assets/swagger-ui.css",
    "dist/assets/swagger-ui-standalone-preset.js",
    "dist/assets/favicon-16x16.png",
    "dist/assets/favicon-32x32.png",
    "dist/assets/index.html",
    "dist/assets/oauth2-redirect.html",
    "dist/assets/oauth2-redirect.js",
    "dist/assets/swagger-initializer.js",
    "dist/assets/monaco/monaco-runtime.js",
    "dist/assets/monaco/monaco-runtime.css",
    "dist/assets/monaco/json.worker.js",
    "dist/assets/monaco/editor.worker.js",
    "dist/assets/monaco/chunk-FIXTURE.js",
  ]
  await Promise.all(
    packageFiles.map(async (file) => {
      const path = join(packageDirectory, file)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `fixture:${file}`)
    })
  )

  const upstreamBundle = "upstream bundle"
  const bundleLicense = "bundle license"
  const standaloneLicense = "standalone license"
  await Promise.all([
    writeFile(join(upstreamDirectory, "swagger-ui-bundle.js"), upstreamBundle),
    writeFile(
      join(upstreamDirectory, "swagger-ui-bundle.js.LICENSE.txt"),
      bundleLicense
    ),
    writeFile(
      join(upstreamDirectory, "swagger-ui-standalone-preset.js.LICENSE.txt"),
      standaloneLicense
    ),
    writeFile(
      join(assetsDirectory, "swagger-ui-bundle.js"),
      `${upstreamBundle}\n/* MODIFIED BY swagger-ui-monaco: fixture */`
    ),
    writeFile(
      join(assetsDirectory, "swagger-ui-bundle.js.LICENSE.txt"),
      bundleLicense
    ),
    writeFile(
      join(assetsDirectory, "swagger-ui-standalone-preset.js.LICENSE.txt"),
      standaloneLicense
    ),
  ])
  return { workspace, packageDirectory }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe("Swagger distribution assets", () => {
  test("copies upstream license companions exactly and preserves bundle bytes before the modification", async () => {
    const temporaryDirectory = await makeTemporaryDirectory()
    const upstream = join(temporaryDirectory, "upstream")
    const output = join(temporaryDirectory, "output")
    await mkdir(upstream)

    const copiedAssets = [
      "swagger-ui.css",
      "swagger-ui-standalone-preset.js",
      "oauth2-redirect.html",
      "oauth2-redirect.js",
      "favicon-16x16.png",
      "favicon-32x32.png",
    ]
    await Promise.all(
      copiedAssets.map((file) =>
        writeFile(join(upstream, file), `upstream:${file}`)
      )
    )

    const bundle = Buffer.from([0x2f, 0x2a, 0x21, 0x20, 0xff, 0x20, 0x2a, 0x2f])
    const bundleLicense = "bundle license\n"
    const standaloneLicense = "standalone license\n"
    await Promise.all([
      writeFile(join(upstream, "swagger-ui-bundle.js"), bundle),
      writeFile(
        join(upstream, "swagger-ui-bundle.js.LICENSE.txt"),
        bundleLicense
      ),
      writeFile(
        join(upstream, "swagger-ui-standalone-preset.js.LICENSE.txt"),
        standaloneLicense
      ),
    ])

    const buildModuleUrl = new URL(
      "../../../scripts/build.mjs",
      import.meta.url
    ).href
    const buildModule = (await import(buildModuleUrl)) as {
      copySwaggerAssets(options: {
        upstream: string
        output: string
        bootstrap: string
      }): Promise<void>
    }
    await buildModule.copySwaggerAssets({
      upstream,
      output,
      bootstrap: "window.monacoBootstrap = true;\n",
    })

    expect(
      await readFile(join(output, "swagger-ui-bundle.js.LICENSE.txt"), "utf8")
    ).toBe(bundleLicense)
    expect(
      await readFile(
        join(output, "swagger-ui-standalone-preset.js.LICENSE.txt"),
        "utf8"
      )
    ).toBe(standaloneLicense)
    const builtBundle = await readFile(join(output, "swagger-ui-bundle.js"))
    expect(builtBundle.subarray(0, bundle.length)).toEqual(bundle)
    expect(builtBundle.subarray(bundle.length).toString("utf8")).toMatch(
      /^\n\/\* MODIFIED BY swagger-ui-monaco:/
    )
  })
})

describe("package preparation guard", () => {
  test("rejects an otherwise valid distribution missing a standalone entry asset", async () => {
    const { workspace, packageDirectory } =
      await createValidDistributionFixture()
    await expect(
      checkPackage({ packageDirectory, workspaceRoot: workspace })
    ).resolves.toBeUndefined()

    await rm(join(packageDirectory, "dist", "assets", "index.html"))

    await expect(
      checkPackage({ packageDirectory, workspaceRoot: workspace })
    ).rejects.toThrow("build output is missing: dist/assets/index.html")
  })

  test("rejects npm pack with a clear build error when a required artifact is missing", async () => {
    const workspace = await makeTemporaryDirectory()
    const packageDirectory = join(workspace, "packages", "plugin")
    await mkdir(packageDirectory, { recursive: true })
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({
        name: "swagger-ui-monaco-workspace",
        version: "0.1.0-beta.1",
        private: true,
        workspaces: ["packages/*"],
      })
    )
    await writeFile(
      join(packageDirectory, "package.json"),
      JSON.stringify({
        name: "swagger-ui-monaco",
        version: "0.1.0-beta.1",
        description: "fixture",
        type: "module",
        main: "./dist/index.cjs",
        types: "./dist/index.d.ts",
        exports: {
          ".": {
            types: "./dist/index.d.ts",
            import: "./dist/index.js",
            require: "./dist/index.cjs",
          },
          "./assets/*": "./dist/assets/*",
        },
        files: ["dist", "README.md", "LICENSE", "NOTICE"],
        license: "Apache-2.0",
        repository: {
          type: "git",
          url: "git+https://github.com/ariel1safar/swagger-ui-monaco.git",
          directory: "monaco/packages/plugin",
        },
        scripts: {
          prepack: `node --experimental-strip-types ${new URL("../../../scripts/check-package.ts", import.meta.url).pathname}`,
        },
      })
    )
    await Promise.all(
      ["README.md", "LICENSE", "NOTICE"].map((file) =>
        writeFile(join(packageDirectory, file), file)
      )
    )

    const npm = process.platform === "win32" ? "npm.cmd" : "npm"
    const result = spawnSync(npm, ["pack", "--json"], {
      cwd: packageDirectory,
      encoding: "utf8",
    })
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.status).not.toBe(0)
    expect(output).toContain("build output is missing: dist/index.js")
    expect(output).toContain('Run "npm run build"')
  })
})
