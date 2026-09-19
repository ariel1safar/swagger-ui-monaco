/**
 * @prettier
 */

import { readdir, readFile, stat } from "node:fs/promises"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"

type JsonObject = Record<string, unknown>

interface PackageDefinition {
  name: string
  requiredFiles: string[]
  requiredPatterns: RegExp[]
}

const repositoryUrl = "git+https://github.com/ariel1safar/swagger-ui-monaco.git"
const packageDefinitions: Record<string, PackageDefinition> = {
  plugin: {
    name: "swagger-ui-monaco",
    requiredFiles: [
      "dist/index.js",
      "dist/index.cjs",
      "dist/index.d.ts",
      "dist/THIRD_PARTY_NOTICES.txt",
      "dist/assets/monaco-runtime.js",
      "dist/assets/monaco-runtime.css",
      "dist/assets/json.worker.js",
      "dist/assets/editor.worker.js",
    ],
    requiredPatterns: [/^dist\/assets\/chunk-.*\.js$/, /^dist\/.*\.d\.ts$/],
  },
  dist: {
    name: "swagger-ui-monaco-dist",
    requiredFiles: [
      "dist/index.js",
      "dist/index.cjs",
      "dist/index.d.ts",
      "dist/absolute-path.js",
      "dist/absolute-path.cjs",
      "dist/absolute-path.d.ts",
      "dist/absolute-path.d.cts",
      "dist/THIRD_PARTY_NOTICES.txt",
      "dist/assets/favicon-16x16.png",
      "dist/assets/favicon-32x32.png",
      "dist/assets/index.html",
      "dist/assets/oauth2-redirect.html",
      "dist/assets/oauth2-redirect.js",
      "dist/assets/swagger-initializer.js",
      "dist/assets/swagger-ui.css",
      "dist/assets/swagger-ui-bundle.js",
      "dist/assets/swagger-ui-bundle.js.LICENSE.txt",
      "dist/assets/swagger-ui-standalone-preset.js",
      "dist/assets/swagger-ui-standalone-preset.js.LICENSE.txt",
      "dist/assets/monaco/monaco-runtime.js",
      "dist/assets/monaco/monaco-runtime.css",
      "dist/assets/monaco/json.worker.js",
      "dist/assets/monaco/editor.worker.js",
    ],
    requiredPatterns: [
      /^dist\/assets\/monaco\/chunk-.*\.js$/,
      /^dist\/.*\.d\.(?:ts|cts)$/,
    ],
  },
  express: {
    name: "swagger-ui-monaco-express",
    requiredFiles: ["dist/index.js", "dist/index.cjs", "dist/index.d.ts"],
    requiredPatterns: [/^dist\/.*\.d\.ts$/],
  },
}

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(path, "utf8")) as JsonObject
}

function collectExportPaths(value: unknown, paths: Set<string>): void {
  if (typeof value === "string") {
    if (value.startsWith("./") && !value.includes("*"))
      paths.add(value.slice(2))
    return
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  for (const nested of Object.values(value)) collectExportPaths(nested, paths)
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(directory, join(entry.parentPath, entry.name))
        .split(sep)
        .join("/")
    )
}

async function isNonemptyFile(path: string): Promise<boolean> {
  try {
    const file = await stat(path)
    return file.isFile() && file.size > 0
  } catch {
    return false
  }
}

function repositoryMatches(repository: unknown, directory: string): boolean {
  if (
    !repository ||
    typeof repository !== "object" ||
    Array.isArray(repository)
  )
    return false
  const value = repository as JsonObject
  return (
    value.type === "git" &&
    value.url === repositoryUrl &&
    value.directory === `monaco/packages/${directory}`
  )
}

function objectValue(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)[key]
    : undefined
}

function verifyExports(
  manifest: JsonObject,
  directory: string,
  errors: string[]
): void {
  const rootExport = objectValue(manifest.exports, ".")
  if (objectValue(rootExport, "types") !== "./dist/index.d.ts") {
    errors.push('exports["."].types must be ./dist/index.d.ts')
  }
  if (objectValue(rootExport, "import") !== "./dist/index.js") {
    errors.push('exports["."].import must be ./dist/index.js')
  }
  if (objectValue(rootExport, "require") !== "./dist/index.cjs") {
    errors.push('exports["."].require must be ./dist/index.cjs')
  }

  if (directory === "plugin" || directory === "dist") {
    if (objectValue(manifest.exports, "./assets/*") !== "./dist/assets/*") {
      errors.push('exports["./assets/*"] must be ./dist/assets/*')
    }
  }
  if (directory === "dist") {
    const absolutePath = objectValue(manifest.exports, "./absolute-path")
    const importExport = objectValue(absolutePath, "import")
    const requireExport = objectValue(absolutePath, "require")
    if (
      objectValue(importExport, "types") !== "./dist/absolute-path.d.ts" ||
      objectValue(importExport, "default") !== "./dist/absolute-path.js" ||
      objectValue(requireExport, "types") !== "./dist/absolute-path.d.cts" ||
      objectValue(requireExport, "default") !== "./dist/absolute-path.cjs"
    ) {
      errors.push(
        'exports["./absolute-path"] must expose the built ESM, CommonJS, and type entry points'
      )
    }
  }
}

async function verifyUpstreamSwaggerAssets(
  packageDirectory: string,
  workspaceRoot: string,
  errors: string[]
): Promise<void> {
  const upstreamDirectory = join(
    workspaceRoot,
    "node_modules",
    "swagger-ui-dist"
  )
  const assetsDirectory = join(packageDirectory, "dist", "assets")
  for (const filename of [
    "swagger-ui-bundle.js.LICENSE.txt",
    "swagger-ui-standalone-preset.js.LICENSE.txt",
  ]) {
    try {
      const [actual, upstream] = await Promise.all([
        readFile(join(assetsDirectory, filename)),
        readFile(join(upstreamDirectory, filename)),
      ])
      if (!actual.equals(upstream))
        errors.push(
          `license companion differs from swagger-ui-dist: dist/assets/${filename}`
        )
    } catch {
      // Missing files are reported with the full build artifact list below.
    }
  }

  try {
    const [actual, upstream] = await Promise.all([
      readFile(join(assetsDirectory, "swagger-ui-bundle.js")),
      readFile(join(upstreamDirectory, "swagger-ui-bundle.js")),
    ])
    if (!actual.subarray(0, upstream.length).equals(upstream)) {
      errors.push(
        "Swagger UI bundle does not preserve the upstream bytes before the appended bootstrap"
      )
    } else if (
      !actual
        .subarray(upstream.length)
        .toString("utf8")
        .startsWith("\n/* MODIFIED BY swagger-ui-monaco:")
    ) {
      errors.push(
        "Swagger UI bundle is missing the prominent appended-modification notice"
      )
    }
  } catch {
    // Missing files are reported with the full build artifact list below.
  }
}

export async function checkPackage(
  options: { packageDirectory?: string; workspaceRoot?: string } = {}
): Promise<void> {
  const packageDirectory = resolve(options.packageDirectory ?? process.cwd())
  const workspaceRoot = resolve(
    options.workspaceRoot ?? join(packageDirectory, "..", "..")
  )
  const directory = basename(packageDirectory)
  const definition = packageDefinitions[directory]
  const errors: string[] = []

  if (basename(dirname(packageDirectory)) !== "packages" || !definition) {
    throw new Error(
      `Package preparation must run from a known leaf directory under packages/: ${packageDirectory}`
    )
  }

  const [manifest, workspaceManifest] = await Promise.all([
    readJson(join(packageDirectory, "package.json")),
    readJson(join(workspaceRoot, "package.json")),
  ])

  if (manifest.name !== definition.name)
    errors.push(`package name must be ${definition.name}`)
  if (
    typeof manifest.version !== "string" ||
    manifest.version !== workspaceManifest.version
  ) {
    errors.push(
      `package version must match workspace version ${String(workspaceManifest.version)}`
    )
  }
  if (!repositoryMatches(manifest.repository, directory)) {
    errors.push(
      `repository must identify monaco/packages/${directory} in ${repositoryUrl}`
    )
  }
  if (manifest.license !== "Apache-2.0")
    errors.push("license must be Apache-2.0")
  if ((manifest.publishConfig as JsonObject | undefined)?.access !== "public")
    errors.push("publishConfig.access must be public")
  if (
    (manifest.publishConfig as JsonObject | undefined)?.registry !==
    "https://registry.npmjs.org"
  ) {
    errors.push("publishConfig.registry must be https://registry.npmjs.org")
  }
  if (manifest.main !== "./dist/index.cjs")
    errors.push("main must be ./dist/index.cjs")
  if (manifest.types !== "./dist/index.d.ts")
    errors.push("types must be ./dist/index.d.ts")
  verifyExports(manifest, directory, errors)

  const includedFiles = manifest.files
  if (!Array.isArray(includedFiles)) {
    errors.push(
      "files must include only the built distribution and package documentation"
    )
  } else {
    for (const file of ["dist", "README.md", "LICENSE", "NOTICE"]) {
      if (!includedFiles.includes(file)) errors.push(`files is missing ${file}`)
    }
    if (
      includedFiles.length !== 4 ||
      includedFiles.some(
        (file) =>
          typeof file !== "string" ||
          !["dist", "README.md", "LICENSE", "NOTICE"].includes(file)
      )
    ) {
      errors.push("files must not publish source or packaging guard scripts")
    }
  }

  if (directory === "express") {
    const dependencies = manifest.dependencies as JsonObject | undefined
    if (
      dependencies?.["swagger-ui-monaco-dist"] !== workspaceManifest.version
    ) {
      errors.push(
        `dependencies.swagger-ui-monaco-dist must equal ${String(workspaceManifest.version)}`
      )
    }
  }

  const requiredFiles = new Set([
    "README.md",
    "LICENSE",
    "NOTICE",
    ...definition.requiredFiles,
  ])
  if (typeof manifest.main === "string" && manifest.main.startsWith("./"))
    requiredFiles.add(manifest.main.slice(2))
  if (typeof manifest.types === "string" && manifest.types.startsWith("./"))
    requiredFiles.add(manifest.types.slice(2))
  collectExportPaths(manifest.exports, requiredFiles)

  for (const file of requiredFiles) {
    if (!(await isNonemptyFile(join(packageDirectory, file))))
      errors.push(`build output is missing: ${file}`)
  }

  let builtFiles: string[] = []
  try {
    builtFiles = await listFiles(join(packageDirectory, "dist"))
    builtFiles = builtFiles.map((file) => `dist/${file}`)
  } catch {
    // The missing required files above provide the actionable error.
  }
  for (const pattern of definition.requiredPatterns) {
    if (!builtFiles.some((file) => pattern.test(file)))
      errors.push(`build output has no file matching ${pattern}`)
  }

  if (directory === "dist")
    await verifyUpstreamSwaggerAssets(packageDirectory, workspaceRoot, errors)

  if (errors.length > 0) {
    throw new Error(
      [
        `${definition.name} is not ready to pack:`,
        ...errors.map((error) => `- ${error}`),
        `Run "npm run build" from ${workspaceRoot} before packing.`,
      ].join("\n")
    )
  }
}

async function main(): Promise<void> {
  try {
    await checkPackage()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main()
}
