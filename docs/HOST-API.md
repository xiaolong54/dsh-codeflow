# DSH Host-side Plugin API — Verified Reference

All paths are relative to the DSH installation's `node_modules/@deepseek-ai/`.
`file:line` citations refer to the TypeScript sources in `src/` (the `lib/` trees are the compiled equivalents).

---

## 1. Tool definition

### 1.1 `defineTool` — exact signature and option field list

`dsh-tools/src/schema.ts:555-557`

```ts
export function defineTool<const S extends ParameterSchemaSpec, const O extends ValueSchemaSpec>(
  options: DefineToolOptions<S, O>,
): ToolDefinition {
```

`dsh-tools/src/schema.ts:484-546` — the complete option surface:

```ts
export interface DefineToolOptions<S extends ParameterSchemaSpec, O extends ValueSchemaSpec> {
  readonly name: string
  readonly description: string
  readonly parameters: S
  readonly output: {
    readonly schema: O
    render(args: InferArgs<S>, value: InferValue<NoInfer<O>>): ContentBlock[]
    presentationMeta?(args: InferArgs<S>, value: InferValue<NoInfer<O>>): JsonValue
  }
  readonly deferLoading?: true
  readonly timeoutMs?: number
  isConcurrencySafe?(args: InferArgs<S>): boolean
  execute(args: InferArgs<S>, exec: ToolRunContext): Promise<InferValue<NoInfer<O>>>
  projectContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined
  finalizeContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined
  presentCall?(args: InferArgs<S>): ToolCallView | undefined
  presentResult?(args: InferArgs<S>, result: ToolResult): ToolResultView | undefined
}
```

### 1.2 Raw `ToolDefinition` accepted by `ctx.tools.register()`

`dsh-tools/src/contracts.ts:27-103` — `ToolDefinition extends ToolSchema` plus:

```ts
export interface ToolDefinition extends ToolSchema {
  readonly output: ToolOutputDefinition
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  projectContent?(exec, result): ContentBlock[] | undefined
  finalizeContent?(exec, result): ContentBlock[] | undefined
  timeoutMs?: number
  isConcurrencySafe?(args: unknown): boolean
  presentCall?(args: unknown): ToolCallView | undefined
  presentResult?(args: unknown, result: ToolResult): ToolResultView | undefined
}
```

`ToolSchema` — `dsh-llm/src/types.ts:517`:

```ts
export interface ToolSchema {
  deferLoading?: true
  name: string
  description: string
  /** JSON Schema object for the arguments. */
  parameters: Record<string, unknown>
}
```

`ToolOutputDefinition` — `dsh-tools/src/contracts.ts:17-24`:

```ts
export interface ToolOutputDefinition {
  readonly schema: JsonSchemaNode
  render(args: unknown, value: JsonValue): ContentBlock[]
  presentationMeta?(args: unknown, value: JsonValue): JsonValue
}
```

**Full field list of a tool definition (union of both forms):**
`name`, `description`, `parameters`, `deferLoading?`, `output { schema, render, presentationMeta? }`,
`execute`, `projectContent?`, `finalizeContent?`, `timeoutMs?`, `isConcurrencySafe?`, `presentCall?`, `presentResult?`.

**There is NO `annotations` field and NO `run_in_background` field on a tool definition.**
`run_in_background` is a *producer-config* concept, not a tool field — `dsh/docs/cookbook/adding-a-tool.md:54`:
> "Gate `run_in_background` with producer config, then register through `ctx.jobs.start({ kind, label, owner: exec.agent, run })`."

### 1.3 How `parameters` are declared

`dsh-tools/src/schema.ts:104-107`:

```ts
export type ParameterSchemaSpec = {
  [key: string]: ParameterPropertySpec
  [key: symbol]: never
}
```

`dsh-tools/src/schema.ts:98`:

```ts
export type ParameterPropertySpec = ValueSchemaSpec & { required?: true }
```

So `parameters` is a **flat map of property name → value-schema node**. It is *not* a JSON-Schema object; it compiles to one.

- **Required** is expressed per property as `required: true` (`schema.ts:293-296`: `required` must be `true` when present, otherwise `authorError`).
- **Optional** = simply omit `required`. There is no `optional: true`.
- **Description** = the `description` annotation on the node (`schema.ts:13-22` `ValueSchemaAnnotations`: `description?`, `title?`, `default?`, `examples?`).
- Node kinds (`schema.ts:25-96`): `type: 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'array' | 'object' | 'json'`, plus `oneOf` (≥2 branches). Scalars accept `enum` / `const`.
- An **explicit** `object` node must declare `additionalProperties: true | false` explicitly (`schema.ts:368-370`). The **implicit parameter root stays open** (`schema.ts:100-103`, `:450-459` — the compiled root is `{ type:'object', properties, required? }` with no `additionalProperties`).

Canonical example — `dsh-tools/src/schema.ts:22-24` (the docs' minimal shape) and the real built-in tool `dsh-tool-fs/src/read.ts:80-84`:

```ts
parameters: {
  file_path: { type: 'string', required: true, description: 'Path to read, resolved by the filesystem backend.' },
  offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
  limit: { type: 'number', description: 'Maximum number of lines to return. Defaults to 2000.' },
},
```

Output schema uses the same DSL (`ValueSchemaSpec`), e.g. `dsh-tool-fs/src/read.ts:86-106` (object root with `additionalProperties: false`).

Validation is automatic for `defineTool` — `dsh-tools/src/schema.ts:598-602`:

```ts
async execute(args: unknown, exec: ToolRunContext): Promise<JsonValue> {
  const violations = validate(args)
  if (violations.length > 0) throw new ToolArgsError(violations)
  return userExecute(args as InferArgs<S>, exec) as Promise<JsonValue>
}
```

`ToolArgsError` — `dsh-tools/src/schema.ts:462-471` (code `INVALID_ARGS`).
Raw JSON-Schema tools registered directly "own their input validation" — `dsh/docs/cookbook/adding-a-tool.md:43`.

### 1.4 `execute` — exact signature and what it receives

`dsh-tools/src/schema.ts:516` (typed) and `dsh-tools/src/contracts.ts:40` (raw):

```ts
execute(args: unknown, exec: ToolRunContext): Promise<unknown>
```

**Yes — `execute` receives the full tool-call context.** `ToolRunContext` — `dsh-tools/src/contracts.ts:245-262`:

```ts
export interface ToolRunContext extends ToolExecution {
  deferContext(context: UserMessage): void
  concludeTurn(): void
}
```

`ToolExecution extends ToolExecutionInput` — `dsh-tools/src/contracts.ts:175-225`:

```ts
export interface ToolExecutionInput {
  readonly callId: ToolCallId
  readonly rootCallId?: ToolCallId
  readonly name: string
  readonly schema?: ToolSchema
  readonly arguments: unknown
  /** The agent on whose behalf the call runs (set by the agent loop). */
  readonly agent?: Agent
  readonly toolSet?: ResolvedToolSet
  readonly parent?: ToolExecutionToken
  /** Required caller-owned cancellation for this invocation. */
  readonly signal: AbortSignal
}
export interface ToolExecution extends ToolExecutionInput {
  readonly rootCallId: ToolCallId
  readonly token: ToolExecutionToken
}
```

So inside `execute` you have: `exec.callId`, `exec.rootCallId`, `exec.name`, `exec.arguments`, **`exec.agent`** (the calling `Agent`), `exec.token`, `exec.parent` (identity only), `exec.signal` (required), `exec.toolSet`, `exec.deferContext(...)`, `exec.concludeTurn()`.

`args` is a lossless-JSON snapshot, deep-frozen before policy — `dsh/docs/cookbook/adding-a-tool.md:45`.
"Async work must observe or forward `exec.signal`" — `dsh-tools/src/contracts.ts:32-35`.

### 1.5 What `execute` may return, and how it becomes the model-visible result

`execute` returns **only the canonical JSON value** declared by `output.schema` — `dsh-tools/src/contracts.ts:31-38`:

```
 * @returns the canonical value declared by `output.schema`.
```

The registry snapshots it as lossless JSON, validates it against `output.schema`, freezes it, then calls `output.render(args, value)`.

`dsh-tools/src/pipeline.ts:545-575`:

```ts
private createSuccessResult(exec, tool, candidate): ToolExecutionSuccess {
  const detached = snapshotToolValue(tool.name, candidate)
  const violations = validateJsonSchemaValue(tool.output.schema, detached, 'value')
  if (violations.length > 0) throw new ToolOutputError(tool.name, violations)
  const value = deepFreeze(detached)
  let rendered: ContentBlock[]
  try { rendered = tool.output.render(exec.arguments, value) }
  catch (error) { throw projectionError(tool.name, 'render', error) }
  const content = snapshotProjection(tool.name, 'render', rendered)
  ...
  return { isError: false, value, content, ...meta !== undefined ? { meta } : {}, ... }
}
```

**The model sees `ContentBlock[]` produced by `output.render` — typically `[{ type: 'text', text: ... }]`** (e.g. `dsh-tool-fs/src/read.ts:111-119`). The canonical `value` is execution-local and deliberately *not* on the durable event (`dsh-tools/src/contracts.ts:342-343`).

`output.presentationMeta(args, value)` produces durable `meta` persisted on `tool/result` for UI replay (`dsh-tools/src/contracts.ts:22-23`, `pipeline.ts:557-566`).

Throw ⇒ `isError: true`; the model-facing content is the rendered error text. Only a thrown `HarnessError` subclass keeps `error.name`/`error.code` — `dsh/docs/cookbook/adding-a-tool.md:47`.

### 1.6 Does `ctx.tools.register()` attach its disposer to the calling plugin automatically?

**Yes.** `dsh-tools/src/index.ts:128-153`:

```ts
register(definition: ToolDefinition, options: ToolRegistrationOptions = {}): () => void {
  ...
  return this.layers.effect(
    this.ctx,
    layer => layer.tools.insert(name, { definition, when: options.when }),
    { label: 'tools.register()' },
  )
}
```

`ScopedLayers.effect` — `dsh-scope/src/store.ts:226-266` — calls `ctx.effect(...)`, so the registration is owned by the **calling** fiber. `this.ctx` inside the service is the *use site* (the calling plugin), because Cordis binds a service's `ctx` to the accessing context via the traceable proxy (`cordis/src/utils.ts:170-225`, `createTraceable` → `if (prop === tracker.property) return useSite`).

Confirmed by the docs — `dsh/docs/cookbook/adding-a-tool.md:39`:
> "Registration is effect-based: disposing the plugin fiber unregisters the tool."

The disposer is **also returned**, so `ctx.tools.register(def)` yields the exact unregister function (`dsh-tools/src/index.ts:126`).

### 1.7 Scoping / restricting tools to certain agents

`ToolRegistrationOptions` — `dsh-tools/src/contracts.ts:116-125` — has **only one** field:

```ts
export interface ToolRegistrationOptions {
  readonly when?: (context: ToolActivationContext) => boolean | Promise<boolean>
}
```

`ToolActivationContext` — `dsh-tools/src/contracts.ts:106-113`: `{ agent: Agent, modelSelection: Readonly<ModelSelection>, signal: AbortSignal }`.
`when` is a *step-time activation condition*, not a scope.

**Scoping is achieved by the Cordis scope of the context you register through:**

- Register on a global plugin context ⇒ tool is global (visible to every agent).
- Register through an agent's scoped context (`agent.ctx`) ⇒ the registration lands in that agent's scope layer and shadows globals for that agent.

`dsh-tools/src/index.ts:66-71`:

```ts
this.tools = new NamedEntries(name => new Error(scope === undefined
  ? `tool "${name}" is already registered (for a per-agent variant, register through that agent's \`agent.ctx\` instead)`
  : `tool "${name}" is already registered in this scope`))
```

`dsh-tools/src/index.ts:122-126`:
> "Register globally or in the calling agent scope. Scoped tools shadow globals; duplicates within one layer and the reserved `run_code` name fail."

`ScopeKey` — `dsh-scope/src/index.ts:15`: `export type ScopeKey = object` (opaque, identity-compared).
Scope minting — `dsh-scope/src/index.ts:137-147` (`createScope(ctx, key, options)`), read back with `scopeOf(ctx)` (`dsh-scope/src/index.ts:154-156`).

Restricting *global* tools for an agent — `dsh-tools/src/index.ts:162-189`:

```ts
restrict(filter: ToolRestriction): () => void {
  const scope = scopeOf(this.ctx)
  if (scope === undefined) throw new Error('tools.restrict() requires a scoped context (agent.ctx): ...')
  ...
}
```

`ToolRestriction` — `dsh-tools/src/contracts.ts:395-400`: `{ allow?: readonly string[]; deny?: readonly string[] }`.

Other registry members: `get(name, scope?, toolSet?)` (`:239-241`), `executable(...)` (`:251-255`), `definitions(scope?, toolSet?)` (`:305-307`), `schemas(scope?, toolSet?)` (`:316-318`), `guard(guard)` (`:384-386`), `setExecutor(executor)` (`:325-350`).

---

## 2. Reading project files from the Host

### 2.1 The `workspaceFiles` service

`dsh-api-workspace-files/src/index.ts:51-56` declares `ctx.workspaceFiles: WorkspaceFiles`.
`dsh-api-workspace-files/src/index.ts:189-190`: `export class WorkspaceFiles extends TypertRemoteService` — Host-side service registered as `super(ctx, 'workspaceFiles')` (`:213`), with `static inject = ['fs', 'sandboxPolicy', 'sessions', 'typert']` (`:190`).

`WorkspaceFileScope` — `dsh-api-workspace-files/src/index.ts:59-64`:

```ts
export interface WorkspaceFileScope {
  /** Session identity received on the wire. */
  readonly sessionId: SessionId
  /** Session workspace root, or the deployment fallback when its header has no cwd. */
  readonly workspaceRoot: string
}
```

`WorkspaceFileRange` — `dsh-api-workspace-files/src/types.ts:44-49`:

```ts
export interface WorkspaceFileRange {
  /** First line of the page. Defaults to 1. */
  readonly offset?: number
  /** Largest number of lines on the page. Defaults to, and may not exceed, the configured `maxLines`. */
  readonly limit?: number
}
```

Method signatures — `dsh-api-workspace-files/src/index.ts:246-260`, `:303-307`, `:316-342`, `:270-294`, `:358-388`, `:399-402`:

```ts
@Remote
async read(workspaceFileScope: WorkspaceFileScope, path: string, range: WorkspaceFileRange, signal: AbortSignal): Promise<WorkspaceFileText>

@Remote
async stat(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): Promise<WorkspaceFileStat>

@Remote
async list(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): Promise<WorkspaceDirectoryListing>

@Remote
async readBytes(workspaceFileScope: WorkspaceFileScope, path: string, options: WorkspaceByteReadOptions, signal: AbortSignal): Promise<WorkspaceFileBytes>

@Remote
async search(workspaceFileScope: WorkspaceFileScope, request: WorkspaceFileSearchRequest, signal: AbortSignal): Promise<WorkspaceFileSearchResult>

@Remote({ mode: 'stream' })
changes(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): AsyncIterable<WorkspaceFileWatchFrame>
```

Return types: `WorkspaceFileStat` (`types.ts:25-38`: `absolutePath`, `version`, `bytes?`), `WorkspaceFileText` (`types.ts:52-65`: stat + `offset`, `text`, `lines`, `eof`), `WorkspaceDirectoryListing` (`types.ts:112-126`: `path`, `entries`, `truncated`).

### 2.2 Are they callable directly from a Host plugin, or only via the Remote wire?

**Both.** `@Remote` is a *decorator that adds wire exposure*; the underlying methods are ordinary async methods on a Cordis service instance. A Host plugin holding the service can call them in-process:

```ts
await ctx.workspaceFiles.read({ sessionId, workspaceRoot }, path, { offset: 1, limit: 200 }, signal)
```

Caveats verified in the sources:
- The scope argument is *not* optional — you must supply `{ sessionId, workspaceRoot }`. The wire lookup resolves it from the Session header — `dsh-api-workspace-files/src/index.ts:216-234`:

```ts
resolve: async (sessionId) => {
  const live = scope.sessions.get(sessionId)?.header
  const stored = live === undefined ? await scope.get('sessionPersistence')?.stat(sessionId) : undefined
  const header = live ?? stored?.header
  if (header === undefined) return undefined
  return { sessionId, workspaceRoot: header.cwd ?? scope.sandboxPolicy.workspaceRoot }
}
```

- `read`/`stat`/`readBytes` **allow paths outside the workspace** (`index.ts:11-13`: "File reads follow the composed filesystem's read access, including paths outside the workspace… this is not a read-containment restriction"). Only `list` (and `changes`) are workspace-confined — `index.ts:462-468`:

```ts
private async confine(root: FsTarget, workspaceRoot: string, path: string, signal: AbortSignal): Promise<FsTarget> {
  const target = await this.ctx.fs.resolve(path, { cwd: workspaceRoot, signal })
  if (!this.ctx.fs.contains(root, target)) {
    throw new RemoteError('workspace-file/outside-workspace', `"${path}" is outside the workspace`, { path })
  }
  return target
}
```

- Deployment caps (defaults) — `index.ts:192-204`: `maxBytes` 2 MiB, `maxFileBytes` 32 MiB, `maxLines` 5000, `maxEntries` 2000.
- `read` refuses non-UTF-8/NUL content — `index.ts:256-258` (`workspace-file/not-text`).

### 2.3 The simpler first-party way to read a file by absolute path in the session's cwd

**Use `ctx.fs` (the `@deepseek-ai/dsh-fs` `FileSystem` service) + `ctx.workingDirectory`.** This is exactly what the built-in `read` tool does.

`dsh-fs/src/index.ts:104-107`:

```ts
export abstract class FileSystem extends Service {
  constructor(ctx: Context) { super(ctx, 'fs') }
```

Relevant methods (`dsh-fs/src/index.ts`):
`resolve(path, opts?: { cwd?, signal? }): Promise<FsTarget>` (`:149`), `processPath(target): string` (`:159`), `fileUrl(target): string` (`:181`), `contains(parent, child): boolean` (`:190`), `stat(target, signal?): Promise<FsInfo | undefined>` (`:198`), `lstat(path, opts?, signal?)` (`:214`), `readText(target, signal?): Promise<string>` (`:222`), `streamText(target, signal?): Promise<AsyncIterable<string>>` (`:233`), `readBytes(target, signal, maxBytes)` (`:245`), `readByteRange(target, range, signal?)` (`:260`), `listDir(target, signal?)` (`:269`).

**The built-in `read` tool implementation** — `dsh-tool-fs/src/read.ts`:

- registration + system prompt — `read.ts:68-75`
- the tool definition — `read.ts:77-209`
- the body — `read.ts:137-165`:

```ts
async execute(args, exec) {
  const input = parseReadArgs(args, caps.limit)
  const { target, info } = await resolveRegularReadTarget(ctx, exec, input.filePath)
  const chunks = info.size === undefined || info.size >= caps.streamMinSize
    ? await ctx.fs.streamText(target, exec.signal)
    : [await ctx.fs.readText(target, exec.signal)]
  const window = await buildWindow(chunks, {...}, target.displayPath)
  const outcome = { path: ctx.fs.processPath(target), offset: input.offset, lines: window.lines, totalLines: window.totalLines }
  ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
  return outcome
}
```

- path resolution + confinement — `dsh-tool-fs/src/read-target.ts:19-34`:

```ts
export async function resolveRegularReadTarget(ctx, exec, requestedPath) {
  const target = await ctx.fs.resolve(requestedPath, await sessionResolveOptions(ctx, exec))
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) { ctx.emit('fs/observed', target, { kind: 'absent' }, exec); throw new FsError(...) }
  if (info.type !== 'file') throw new FsError(..., 'FS_NOT_REGULAR_FILE')
  return { target, info }
}
```

- session cwd resolution — `dsh-tool-fs/src/session-cwd.ts:17-25`:

```ts
export async function sessionResolveOptions(ctx, exec): Promise<{ cwd?: string; signal?: AbortSignal }> {
  const cwd = exec.agent === undefined ? undefined : await ctx.workingDirectory.ensure(exec.agent, exec.signal)
  return { ...cwd !== undefined ? { cwd } : {}, signal: exec.signal }
}
```

**How paths are resolved and confined:**

- Resolution: `ctx.fs.resolve(path, { cwd })` — relative paths resolve against the session's current working directory; absolute paths are used as given.
- **Reads are NOT confined by the local backend.** `dsh-fs-local/src/index.ts:68-73`:

```ts
/**
 * The host-filesystem backend. Reads resolve relative paths from {@link Config.cwd}
 * (a resolution default, NOT a containment boundary — see the filesystem
 * capability-seam Agent Note); enforce
 * containment with a stricter backend or a `tools/execute` permission plugin.
 */
```

- The sandboxing backend (`dsh-fs-sandbox`) confines only *mutations*: `dsh-fs-sandbox/src/index.ts:5-9` — "Reads pass through untouched: every mode permits reading." Per-call policy at `:20-24`: `read-only` denies every mutation; `workspace-write` allows a mutation only under the policy's workspace root / writable roots / temp; `danger-full-access` delegates unfenced; denial throws `FS_SANDBOX_DENIED`.
- `ctx.fs.contains(parent, child)` (`dsh-fs/src/index.ts:190`) is the canonical containment test you can call yourself if your tool must confine to the workspace root.

**Recommended minimal recipe for a Host plugin:**

```ts
const cwd = exec.agent ? await ctx.workingDirectory.ensure(exec.agent, exec.signal) : undefined
const target = await ctx.fs.resolve(absPath, { cwd, signal: exec.signal })
const info = await ctx.fs.stat(target, exec.signal)
const text = await ctx.fs.readText(target, exec.signal)   // or ctx.fs.streamText(target, exec.signal)
```

(That is exactly `resolveRegularReadTarget` + `readText`, with no extra service.)

---

## 3. Session / agent context from a tool

### 3.1 `ctx.workingDirectory`

`dsh-working-directory/src/index.ts:76` — `export class WorkingDirectoryService extends Service` (`super(ctx, 'workingDirectory')`, `:92`), `static inject = ['fs', 'sessionProjections', 'systemPrompt']` (`:77`).

`dsh-working-directory/src/index.ts:141-143`:

```ts
get(session: Session): string {
  return this.workingDirectoryProjectionHandle.stateOf(session) ?? this.defaultDirectory
}
```

`dsh-working-directory/src/index.ts:154-175`:

```ts
ensure(agent: Agent, signal?: AbortSignal): Promise<string>
```
— validates the current directory exists, restores the original project directory when it disappeared, and commits a `working-directory/change` event if needed.

`dsh-working-directory/src/index.ts:188-195`: `set(agent, path, signal?): Promise<string>`.

The directory is itself a session projection — `dsh-working-directory/src/index.ts:101-108`:

```ts
this.workingDirectoryProjectionHandle = await ctx.sessionProjections.register({
  key: 'workingDirectory',
  stateVersion: 1,
  stateSchema: directorySchema,
  init: header => header.cwd ?? null,
  apply: (state, event) => event.type === 'working-directory/change' ? event.data.cwd : state,
  wire: { viewSchema: directorySchema, view: state => state },
})
```

### 3.2 `ctx.agents`

`dsh-agent/src/index.ts:246` — `export class AgentRegistry extends Service` (`super(ctx, 'agents')`, `:260`), `static inject = ['sessionProjections']` (`:247`).

- `dsh-agent/src/index.ts:580-582` — `get(id: SessionId): Agent | undefined`
- `dsh-agent/src/index.ts:588-590` — `list(): Agent[]` ("All live agents, in registration order")
- `dsh-agent/src/index.ts:314-317` — `currentInitiator(): Agent | undefined`
  > "Read the Agent that initiated the inherited asynchronous driver chain. Use this optional form for logging, tracing, metrics, or host attribution that also supports agentless calls."
- `dsh-agent/src/index.ts:327-331` — `requireInitiator(): Agent` (throws when none active)
- `dsh-agent/src/index.ts:300-302` — `turnBoundaryOf(session): TurnBoundaryProjection`
- `dsh-agent/src/index.ts:410`, `:429` — `create(options)`, `resume(options)`

`currentInitiator()` is **process-local attribution via `AsyncLocalStorage`** (`dsh-agent/src/index.ts:252-253`, `:613-643`) — it is *not* a liveness proof.

### 3.3 `ctx.sessions`

`dsh-session/src/index.ts:1144` — `export class SessionStore extends Service` (`super(ctx, 'sessions')`, `:1172`).

- `dsh-session/src/index.ts:1455-1457` — `get(id: SessionId): Session | undefined`
- `dsh-session/src/index.ts:1463-1465` — `list(): Session[]`
- `dsh-session/src/index.ts:1206` — `create(id?, options?): Session`; `:1238` `prepare`; `:1311` `enter`; `:1367` `announce`; `:1422` `flush(session): Promise<boolean>`; `:1483` `fork(source, boundary?, childSessionId?)`

### 3.4 The `Agent` handle

Full public shape — `dsh/docs/subsystems/core.md:59-144` (mirrors `dsh-agent/src/types.ts:16-19` + `dsh-agent/src/runtime-types.ts:191+`):

```ts
interface Agent {
  readonly id: SessionId
  readonly options: AgentOptions
  readonly session: Session
  readonly model: Model
  readonly inbox: Inbox
  readonly status: AgentStatus
  readonly ctx: Context          // agent-scoped context
  cancel(cause, options?): void
  whenIdle(): Promise<void>
  runMaintenance<T>(task: (signal) => Promise<T>): Promise<T>
  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void
  followup(message: UserMessage): void
  steer(message: UserMessage): void
  inject(message: UserMessage): void
}
```

**How a tool's `execute` reaches the calling agent/session:** `exec.agent` (optional `Agent`, `dsh-tools/src/contracts.ts:188`). Then:

- session id → `exec.agent.id` (== `exec.agent.session.id`; the registry asserts equality — `dsh-agent/src/index.ts:475-478`)
- session → `exec.agent.session`
- scoped context → `exec.agent.ctx`
- cwd → `await ctx.workingDirectory.ensure(exec.agent, exec.signal)` (the pattern in `dsh-tool-fs/src/session-cwd.ts:21-23`)

`exec.agent` is `undefined` for calls with no owning agent (e.g. direct/PTC-initiated calls outside a model step) — hence the `exec.agent === undefined` guard in `session-cwd.ts:21`.

---

## 4. Host → Client / Client → Host data channel

### 4.1 How a Host service method becomes `ctx.remote.<namespace>`

`dsh-typert-protocol/src/index.ts:236-247`:

```ts
export function bindTypertRemote<Service extends object>(
  service: Service,
  serviceKey: string,
  options: TypertGatewayBindingOptions = {},
): TypertGatewayBinding<Service> {
  validateName('service key', serviceKey)
  const namespace = options.namespace ?? serviceKey
  validateName('namespace', namespace)
  ...
}
```

`dsh-typert-protocol/src/index.ts:250-264`:

```ts
export abstract class TypertRemoteService<out T = never> extends Service<T> {
  readonly typertRemote: TypertGatewayBinding<this>
  protected constructor(ctx: Context, serviceKey: string, options: TypertGatewayBindingOptions = {}) {
    super(ctx, serviceKey)
    this.typertRemote = bindTypertRemote(this, this.name, options)
  }
}
```

**Naming rule:** the wire namespace is `options.namespace` when given, otherwise **the Cordis service key**. Verified examples:
- `dsh-commands/src/index.ts:277` — `super(ctx, 'commands')` ⇒ `ctx.remote.commands`
- `dsh-api-workspace-files/src/index.ts:213` — `super(ctx, 'workspaceFiles')` ⇒ `ctx.remote.workspaceFiles`
- `dsh-api-session-controller/src/index.ts:179` — `super(ctx, 'sessionController', { namespace: 'session' })` ⇒ `ctx.remote.session` (key ≠ namespace)

Methods must be marked `@Remote` — `dsh/docs/api-gateway.md:9`:
> "Business services use `@Remote` or `@RemoteScope` to select the methods exposed to the Client. Unmarked methods do not enter the generated Client types or runtime contributions and cannot be called through `ctx.remote`."

`@Remote` forms — `dsh-typert-protocol/src/index.ts:282-317`: `@Remote`, `@Remote(name)`, `@Remote({ name?, mode?, resources? })`; `@RemoteScope(key, option?)` (`dsh/docs/api-gateway.md:15`).

Contract rules (`dsh/docs/api-gateway.md:58`, `:122`):
- the **final** Host parameter must be `signal: AbortSignal`; it is recorded in the descriptor, not in `args`; the generated Client method takes an optional trailing `AbortSignal`.
- parameters must be required, named, simple identifiers (no destructuring/defaults/rest/optional); no generics; public non-static instance method with a concrete implementation.

**Client side:** `ctx.remote.<namespace>` and `agentCtx.remote.<namespace>` — `dsh/docs/api-gateway.md:62`:
> "The Client uses concrete functions on ordinary objects, not a JavaScript Proxy. Direct and scoped calls appear under `ctx.remote.<namespace>` and `agentCtx.remote.<namespace>`. Each namespace is a traced Cordis child Service registered as `remote.<namespace>`; the Client assembly mounts contributions through `ctx.remote.$mount()`…"

Dependency declaration belongs to the caller — `dsh/docs/api-gateway.md:62`, example at `:70-77`:
```ts
export const inject = ['remote', 'remote.goals']
```

### 4.2 The wire call shape

`dsh/docs/api-gateway.md:126`:
> "The Client Remote calls `connection.rpc.call('/api', '<namespace>/<method>', { args }, signal)`; the HTTP carrier maps this to `POST /api/<namespace>/<method>`, with a payload containing only a named `args` object."

### 4.3 Is there a Host → Client call direction?

**Remote *invocations* are Client → Host only.** The Gateway is the Host side of an RPC the Client initiates (`dsh/docs/api-gateway.md:5`, `:124-130`).

The only Host → Client flows are:
1. **Stream items** of a `@Remote({ mode: 'stream' })` method — `dsh/docs/api-gateway.md:60`:
   > "the Gateway delivers each yielded item, a value the Host method produced, over its multiplexed `/api/remote.mux` WebSocket or an in-process carrier, and the generated Client method returns a `RemoteStreamHandle<Out, In>` that iterates the items and exposes `send`, `end`, and `dispose` for the Client-to-Host uplink of the same logical stream."
2. The **Client → Host uplink inside a stream** — `this.ctx.invocation.uplink<In>()` (`dsh/docs/api-gateway.md:60`).
3. **Session event streams** and other incremental protocols — explicitly *outside* the Remote scope (`dsh/docs/api-gateway.md:5`, `:164`).

### 4.4 `ctx.remote.commands.execute()` — yes

`dsh-commands/src/index.ts:263-277`:

```ts
export class CommandRuntime extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'commands') }
```

`dsh-commands/src/index.ts:314-320`:

```ts
@Remote
list(agent: Agent): readonly CommandDescriptor[] {
```

`dsh-commands/src/index.ts:360-366`:

```ts
@Remote
async execute(
  agent: Agent,
  line: string,
  submittedAttachments: readonly CommandSubmitAttachment[],
  signal: AbortSignal,
): Promise<CommandExecution | undefined> {
```

Generated Client contribution exists: `dsh-commands/lib/typert.remote-client.js` (generated by `@deepseek-ai/dsh-typert-generator` — header line 1), with strict Zod schemas for `commands.execute` (3 params + `signal`) and `commands.list` (`:6-57`).

### 4.5 How a Host plugin registers a command

`dsh-commands/src/index.ts:285-292`:

```ts
register(definition: CommandDefinition): () => void {
  const registered = normalizeDefinition(definition)
  return this.layers.effect(
    this.ctx,
    layer => layer.commands.insert(registered.definition.name, registered),
    { label: 'commands.register()' },
  )
}
```

`CommandDefinition` — `dsh-commands/src/index.ts:61-78`:

```ts
export interface CommandDefinition {
  readonly definitionId?: CommandDefinitionId
  readonly name: string          // lowercase, without leading slash
  readonly description: string
  readonly input?: CommandInputDescriptor
  readonly recordInput?: boolean
  readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
}
```

`CommandInvocation` — `dsh-commands/src/index.ts:41-58`: `{ commandId, agent, rawInput, attachments, signal }`.
Name grammar: `/^[a-z][a-z0-9_-]*$/u` (`dsh-commands/src/index.ts:32`), enforced at `:180-182`.

Register globally from a plain plugin context; register scoped by registering through a command-injected child of an agent context (`dsh-commands/src/index.ts:102-104`, `:257-262`).

---

## 5. Per-session state on the Host

### 5.1 `ctx.sessionProjections` — the recommended place

`dsh-session-projection/src/index.ts:282` — `export class SessionProjectionRegistry extends Service` (`super(ctx, 'sessionProjections')`, `:296`).

The unit contract — `dsh-session-projection/src/index.ts:83-133`:

```ts
export interface ProjectionDefinition<K extends string, S> {
  key: K
  stateSchema: ZodType<S>
  init(header: SessionHeader, inheritedEventCount: SessionLogOffset): NoInfer<S>
  apply(state: NoInfer<S>, event: SessionEvent): NoInfer<S>
  wire?: {
    viewSchema: ZodType<SessionProjectionViewValue<SessionProjectionMap[K]>>
    view(state: NoInfer<S>): SessionProjectionViewValue<SessionProjectionMap[K]>
    summary?: boolean
  } : never
  stateVersion: number
}
```

- `apply(state, event)` is a **pure synchronous fold**; an uninterested event MUST return the same state reference (`Object.is`) — `dsh-session-projection/src/index.ts:96-103`.
- `stateVersion` is a non-negative integer used for persisted-cache invalidation — `dsh-session-projection/src/index.ts:126-132`; validated at `:402-404`.

**`stateOf()`** — on the handle returned by `register` — `dsh-session-projection/src/index.ts:51-73`:

```ts
export interface ProjectionHandle<S> {
  stateOf(session: Session): S
  readerFor(session: Session): () => S
  dispose(): Promise<void>
}
```

The **registry-level** `stateOf(session, key)` is **deprecated** — `dsh-session-projection/src/index.ts:456-465`:

```ts
stateOf(session: Session, key: string): unknown {
  if (!this.deprecatedStateOfKeys.has(key)) {
    ...
    this.ctx.logger.warn(`sessionProjections.stateOf(session, ${JSON.stringify(key)}) is deprecated; read handle.stateOf(session) from an awaited registration, or use the owning domain service`)
  }
```

### 5.2 Can a plugin define its own projection unit? — **Yes**

`dsh-session-projection/src/index.ts:322-376` — three overloads of `register`:

```ts
register<K extends keyof SessionProjectionMap, S>(definition: Omit<ProjectionDefinition<K,S>, 'wire'> & { wire: NonNullable<...> }): Promise<ProjectionHandle<S>>   // client-visible unit
register<K extends string, S>(definition: ProjectionDefinition<K, S> & { key: Exclude<K, keyof SessionProjectionMap> }): Promise<ProjectionHandle<S>>  // host-only unit
```

- A **host-only** unit (key not in `SessionProjectionMap`) is allowed — `dsh-session-projection/src/index.ts:327-336`: "Register a host-only unit. Its state is omitted from client snapshots and always checkpointed like every other unit."
- A **client-visible** unit requires merging the key into `SessionProjectionMap` (`dsh-session-projection/src/types.ts:42`) and providing `wire.viewSchema` + `wire.view`.
- Registration is effect-owned; the returned value is an awaitable yielding the ready handle (`:337-376`), and the same disposer is returned (`:375`).
- Registrants sharing a key share one unit and are ref-counted (`:405-429`); a `stateVersion` mismatch on a shared key throws (`:414-416`).

Other registry API:
- `onChanged(listener)` — `dsh-session-projection/src/index.ts:473-481`
- `onEventChanged(listener)` — `:493-501`
- `snapshot(session, keys?)` — `:514-528`
- `cachedSnapshot(...)` (deprecated) — `:540-559`
- `summaryKeys()` — `:570-573`
- `checkpoint(session)` — `:605-619`
- `restoreFloor`, `viewCheckpoint`, `restore`, `hydrate` — `:637-816`

The framework drives units eagerly on `session/event` — `dsh-session-projection/src/index.ts:309-311`, `:887-947`.

### 5.3 `agent.inject()` — exactly what it does and when

`dsh-agent-loop/src/agent.ts:188-190`:

```ts
inject(input: UserMessage): void {
  this.send(input, 'next-step', false)
}
```

`dsh/docs/subsystems/core.md:135-143`:
> "**Queue model-facing context for the next pre-step without waking the driver.** A running driver claims it at the nearest later step boundary; idle drivers leave it pending until follow-up or steering wakes them. It may miss a request whose pre-step already claimed its batch. Cancellation or disposal may discard pending context."

Contrast with `followup` (next-turn, **wakes**) and `steer` (next-step, **wakes**) — `dsh-agent-loop/src/agent.ts:180-186`, `docs/subsystems/core.md:117-133`.

`dsh/docs/cookbook/adding-a-tool.md:50`:
> "**Use `exec.agent` for async notifications.** `agent.inject({ content, source: { kind: 'my-plugin' } })` appends durable context the NEXT model request sees — it is not a wake-up (an idle agent stays idle). Declare that `kind` through `MessageSourceMap` in your plugin: session format V4 rejects the retired `{ kind: 'plugin', plugin: '<name>' }` wrapper at message admission. Guard against disposed agents (try/catch)."

---

## 6. System prompt contribution

### 6.1 `ctx.systemPrompt.section()` — `PromptSection`

`dsh-system-prompt/src/index.ts:53-76`:

```ts
export interface PromptSection {
  readonly name: string          // unique; duplicate registration throws
  readonly order: number         // ascending; equal orders break by code-unit name
  readonly text: string | ((context: AssembleContext) => string)
  readonly interpolate?: boolean // default true
  readonly complete?: boolean    // treat as the COMPLETE system prompt
}
```

`dsh-system-prompt/src/index.ts:485-494`:

```ts
section(section: PromptSection): () => void {
  if (!Number.isFinite(section.order)) throw new TypeError(`prompt section "${section.name}" order must be a finite number`)
  return this.layers.effect(this.ctx, layer => layer.sections.insert(section.name, section), { label: 'systemPrompt.section()' })
}
```

### 6.2 `ctx.systemPrompt.context()` — `PromptContext`

`dsh-system-prompt/src/index.ts:79-90`:

```ts
export interface PromptContext {
  readonly name: string
  readonly order: number
  readonly text: string | ((context: AssembleContext) => string)
  readonly interpolate?: boolean
  readonly required?: boolean   // keep even when optional runtime context is disabled
}
```

`dsh-system-prompt/src/index.ts:520-529` — same shape of registration, `label: 'systemPrompt.context()'`.

### 6.3 `AssembleContext`

`dsh-system-prompt/src/index.ts:42-50`:

```ts
export interface AssembleContext {
  readonly scope?: ScopeKey
  readonly signal?: AbortSignal
}
```

### 6.4 Placement orders

`dsh-system-prompt/src/index.ts:136-173` — `SECTION_ORDERS` (e.g. `TOOL_READ: 1100`, `FILE_REFERENCE: 900`, `HARNESS_IDENTITY: -1000`, `STRUCTURED_OUTPUT: 9900`), resolved via `getSectionOrder(name)` (`:501-503`).
`dsh-system-prompt/src/index.ts:178-186` — `CONTEXT_ORDERS` (e.g. `WORKING_DIRECTORY: 100`, `SANDBOX_POLICY: 110`, `APPROVAL_POLICY: 115`, `SUBAGENT_DELEGATION: 120`, `HARNESS_SOURCE: 200`, `WEB_SURFACE: 210`), resolved via `getContextOrder(name)` (`:510-512`).

### 6.5 When each is included in the assembled prompt

- **Sections** are concatenated into the *system prompt* (ascending `order`, then name). `dsh-system-prompt/src/index.ts:659-674` builds them; `:688` returns them alongside tools; `renderPrompt` (`:297-302`) interpolates `{{variables}}` and joins non-empty sections with blank lines.
  - A section with `complete: true` becomes the **sole** prompt section; more than one effective complete section makes assembly fail (`:660-663`).
  - Tool schemas flow in automatically: `ctx.tools` registers a prompt tool provider — `dsh-tools/src/index.ts:113-117` — so "Schemas flow into the system-prompt assembly automatically" (`dsh/docs/cookbook/adding-a-tool.md:39`).
- **Contexts** are *dynamic runtime context*, not part of the system prompt. They are materialized as a **durable user-role snapshot** — `dsh-system-prompt/src/index.ts:78` ("Dynamic model context materialized as a durable user-role snapshot"). `renderContextSnapshot` / `renderContextSections` (`:309-344`) join them with the header `"Current runtime context. This snapshot supersedes earlier runtime-context snapshots."` (`:324`).
  - Contexts are assembled in ascending `order` — `:678-681`.
  - If runtime context is suppressed (`suppressRuntimeContext()`, `:537-543`), only `required: true` contexts survive (`:679`, `:694`).
  - On request admission, `refreshContext` re-runs *context* providers only — sections/tools/variables keep the accepted assembly (`:589-609`).

Real usage examples:
- section: `dsh-tool-fs/src/read.ts:69-75`

```ts
ctx.systemPrompt.section({
  name: 'tool:read',
  order: ctx.systemPrompt.getSectionOrder('TOOL_READ'),
  text: ({ scope }) => ctx.tools.get('read', scope) === undefined ? '' : 'Use the read tool — not shell commands like cat, sed, head, or tail — ...',
})
```

- context: `dsh-working-directory/src/index.ts:109-115`

```ts
ctx.systemPrompt.context({
  name: 'working-directory:current',
  order: ctx.systemPrompt.getContextOrder('WORKING_DIRECTORY'),
  required: true,
  interpolate: false,
  text: context => context.agent === undefined ? '' : this.contextText(context.agent.session),
})
```

Other prompt registry members: `tools(provider)` (`:552-558`), `variable(name, provider)` (`:568-577`), `suppressRuntimeContext()` (`:537-543`), `assemble(context)` (`:621-696`), and the `'system-prompt/assemble'` waterfall event (`:31`).

---

## Unverified / cautions

1. **Can a runtime-installed Host bundle introduce a brand-new `@Remote` namespace for the Client?**
   Typert is a *build-time* generator over the Host `ts.Program` (`dsh/docs/api-gateway.md:100-120`). The Client "always" uses the most recently generated `lib/typert.remote-client.*` artifacts (`:142`), and the Client "refuses to mount SRC descriptors that lack strict codecs" (`:142`). I found **no** runtime path that generates a Remote contribution for a bundle installed after the build. → Treat "Host plugin exposes a method the Client can call" as **build-time only**; a plain bundle cannot add one without a pre-generated `typert.remote-client.js` contribution.

2. **`@Remote` on a method of a service that is *not* a `TypertRemoteService`** — `bindTypertRemote(this, 'key')` is documented as the alternative (`dsh/docs/api-gateway.md:17`), and I verified the function exists (`dsh-typert-protocol/src/index.ts:236-247`), but I did not verify an end-to-end instance of a non-`TypertRemoteService` host in the installed tree.

3. **`ctx.remote.commands.execute()` client-side parameter shape** — the *generated* Zod schemas are verified (`dsh-commands/lib/typert.remote-client.js:6-43`), but I did not read the generated `typert.remote-client.d.ts` to confirm the exact TS signature (`execute(agentId, line, attachments, signal?)`).

4. **Host→Client beyond Remote stream items / session event streams** — I found no other Host-initiated call mechanism in `dsh-typert-protocol`, `dsh-api-gateway`, or `dsh/docs/api-gateway.md`. If one exists outside the Remote + session-event surfaces, I did not locate it.

5. **`annotations` on a tool** — verified **absent** from `ToolDefinition`/`DefineToolOptions`/`ToolSchema`. If DSH emits `annotations` (e.g. Anthropic-style `readOnlyHint`), it does not come from this API surface.

6. **`ScopeKey` inside `ToolRegistrationOptions`** — verified **absent**; `ToolRegistrationOptions` has only `when`. Agent restriction is via registration scope (`agent.ctx`) and `tools.restrict()`.

7. **Which `fs` backend is actually mounted in the running Host** — I verified that `dsh-fs-local` and `dsh-fs-sandbox` both exist and both register as `ctx.fs` (`dsh-fs-local/src/index.ts:74`, `dsh-fs-sandbox/src/index.ts:55`), but I did not inspect the running profile's bundle list to confirm which one is active. `dsh-fs-sandbox` is the one that adds mutation confinement; reads are unfenced in both.

8. **`ctx.sandboxPolicy`** — referenced by `dsh-fs-sandbox` (`src/index.ts:34`, `:56`) and `dsh-api-workspace-files` (`src/index.ts:190`, `:231`), but I did not read its service definition (its `workspaceRoot` / `defaultMode` accessors).
