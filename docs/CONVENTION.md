# 代码数据流规范

这份规范不是风格偏好，而是**插件能不能读出数据流**的前提。插件静态解析代码：找到顶层函数（功能块）、找到函数之间的调用与实参传递（数据流）。凡是静态解析无法确定的写法，地图上就会缺边、把目标标成「外部」，或在「结构体检 / 模块化规范」里报出来。

面向 AI 开发时，请把这份规范当成代码结构的约定：**先按块来组织代码，再填实现**。这八条规则插件会逐条检查（`codeflow_map action=convention` 能看到自己项目里的违规清单），所以它们不是建议，是检查项。

## 一、八条核心规则

1. **一个功能 = 一个具名函数。**（`named-block`）顶层函数或类方法都行；业务逻辑不要写在匿名回调/lambda 里，那些只会被算进调用它的块。
2. **每个函数写一行说明。**（`doc-line`）说明放在函数正上方，写这个块做什么。没有说明的块在图上只是一个名字。
3. **参数是输入，返回值是输出。**（`explicit-io`）跨函数传数据用参数和返回值；不要靠全局可变状态、单例字段或事件总线悄悄传递，也不要直接改写不是参数的变量——图上会断成两截。
4. **入口函数只做编排。**（`orchestrator-entry`）它按顺序调用具名块，真正的工作放在具名块里。入口自己写逻辑，图上就看不出每一步。
5. **跨文件只用显式 import/require。**（`static-import`）不做字符串拼接的动态导入；模块对外暴露的函数名要能被静态读到。
6. **一个模块只做一件事。**（`one-responsibility`）一个文件承载系统的一个方面，这个方面的块就是图上看到的那些。
7. **块要小。**（`small-block`）单函数 ≤ 80 行、参数 ≤ 6 个；超了就拆成更小的块，让数据流看得见。
8. **副作用集中。**（`pure-core`）读写文件、网络请求、数据库操作集中到少数几个 IO 函数里，其余函数保持纯计算——这样主链是清晰的数据管道。

再加上不用反射改写调用关系（`eval`、`getattr`、`import()`、`Class.forName`、`Activator.CreateInstance`）：这类写法会让调用目标不可静态确定，插件只能标「不可追踪」。

## 二、各语言能识别的块声明

| 语言 | 识别为功能块 | 不算块（归入调用者） |
|---|---|---|
| TypeScript / JavaScript | `function f() {}`、`const f = () => {}`、`const f = async () => {}`、类方法 | 匿名回调、内联箭头函数、`obj.method()` 的属性调用 |
| Python | `def f():`、`async def f():`、`class A:` 里的 `def m(self):` | `lambda`、嵌套函数（算进外层块） |
| Go | `func f()`、`func (r T) M()` | 匿名 `func`、接口方法 |
| Java | 类内方法声明（含 `public/static/throws`） | 接口/抽象方法、lambda、匿名类 |
| C# | 类内方法声明（含 `=>` 表达式体） | 接口方法、lambda |
| Rust | `fn f()`、`impl T { fn m() }`（含 `pub`） | trait 方法、闭包 |
| Kotlin | `fun f()`、`fun T.f()` | 接口方法、lambda |
| Swift | `func f()`、`struct/class` 内方法 | `protocol` 方法、闭包 |

## 三、推荐的代码形状

```ts
// 一个模块 = 一条数据管道：入口在前，纯函数在后。
export function run(input: string): Report {
  const rows = parseRows(input)      // 数据：string → Row[]
  const scored = scoreRows(rows)     // 数据：Row[] → Scored[]
  return summarize(scored)           // 数据：Scored[] → Report
}

function parseRows(input: string): Row[] { /* ... */ }
function scoreRows(rows: Row[]): Scored[] { /* ... */ }
function summarize(rows: Scored[]): Report { /* ... */ }
```

```go
// 入口只做编排；每一步都是具名函数，参数与返回值就是数据流。
func Run(input string) (Report, error) {
	rows := ParseRows(input)
	scored := ScoreRows(rows)
	return Summarize(scored), nil
}

func ParseRows(input string) ([]Row, error) { /* ... */ }
func ScoreRows(rows []Row) []Scored { /* ... */ }
func Summarize(rows []Scored) Report { /* ... */ }
```

这两段在图上会显示成 `parseRows → scoreRows → summarize` 三个块，`run` 是入口。

## 四、常见坏味道与后果

| 写法 | 图上的后果 | 改法 |
|---|---|---|
| 业务逻辑写在 `array.map(x => { /* 30 行 */ })` | 逻辑块消失，全归到外层（插件报 `inline-callback`） | 抽成具名函数再传引用 |
| 函数上面没有一行说明 | 块在图上只有名字，没有职责（插件报 `missing-doc`） | 加一行说明 |
| 入口函数自己写逻辑 | 每一步都看不清（插件报 `orchestrator-entry`） | 拆成具名块，入口只编排 |
| `let cache = {}` 放模块顶层，多个函数读写 | 数据边断成两截（插件报 `module-mutable-state`） | 改成参数/返回值，或显式的缓存模块函数 |
| 直接改写不是参数的变量 | 值从哪来就看不到了（插件报 `explicit-io`） | 改成参数传入、返回值传出 |
| `const mod = await import(name)` | 调用目标不可追踪 | 改静态 import |
| 一个文件 20 个函数、互相调用成环 | 图变成一团，看不出主链 | 按职责拆文件，明确入口 |
| 函数 200 行、8 个参数 | 块过重，读不出数据流（插件报 `block-too-large` / `too-many-params`） | 拆块、参数改对象 |

## 五、插件给 agent 的九个动作

插件没有界面。它只有一个读者：写代码、改 bug 的那个模型。事实只有一份，就是宿主上那份项目模型；下面的每个动作都是它的读法。

| 动作 | 读到的东西 |
|---|---|
| `file` + `path` | 一个文件的块、跨文件调用、数据流、源码——**改这个文件之前先读它** |
| `block` + `path` + `name` | 一个块的签名、它调的块、谁调它、源码 |
| `flow` + `path` + `name` | 一个块里的值从哪来、传到哪去——查 bug 时用得最多 |
| `area` + `path` | 一个分区里的块与它们之间的数据流 |
| `overview` | 整个项目：功能分区、入口块、问题数量 |
| `contracts` | 对外暴露的块和依赖它们的调用方 |
| `diagnostics` | 结构体检的全部问题（分 `flow` 与 `convention`） |
| `scaffold` + `path` | 这个范围应该怎么搭：模块树、块签名与职责、数据流、新块模板 |
| `convention` | 项目对八条规则的遵守情况，违规清单按文件列出 |

每个回答有两种形态：模型读的文本（`text`），和同一份事实的数据（`facts`）。

## 六、两个通道，一份模型

同一个模型有两个出口，事实只有一份：

| 通道 | 面向谁 | 形态 |
|---|---|---|
| 工具通道 | AI agent | `codeflow_map` 工具：分区、文件、块、调用与实参、数据流、源码、结构问题、框架建议、规范清单 |
| 写作通道 | AI agent | 系统提示词里的八条规则 + 顺着数据查错的读法：模型写代码时按块编排，插件再逐条检查 |

分工是：**AI 先读地图，再动手。**

- AI 改代码前先读图（`file` / `scaffold` / `convention`），照着项目现有的块形状写下一个新块；改完在回复里说清改了哪个块、数据现在怎么流。
- 查 bug 时走 `flow`：从出症状的块出发，沿值往回找到生产它的块，改生产者或边界，而不是改症状出现的地方。
- 地图上标成 `unresolved` 的调用是同名多义，静态解析定不下目标：这时 AI 不该猜，要么问，要么把调用改明确。

提交代码前按这八条对照一遍，地图就会是干净的。
