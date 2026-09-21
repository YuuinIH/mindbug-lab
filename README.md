# mindbug-lab

基于 [turn-kernel](https://github.com/YuuinIH/turn-kernel) 的小型 Mindbug 规则实验。JSON 保存自定义卡牌资料，TS 实现游戏规则，流程状态可以保存和恢复。不是完整 Mindbug 实现，也不是官方产品。

## 运行

需要 Node.js 24+。两个仓库放在同一父目录；本地依赖明确使用 `file:../turn-kernel`，不依赖旧 test_battle 项目，也未发布 npm 包。

```sh
git clone https://github.com/YuuinIH/turn-kernel.git
git clone https://github.com/YuuinIH/mindbug-lab.git
cd turn-kernel
npm ci
npm run check
cd ../mindbug-lab
npm ci
npm run check
npm run demo
npm run demo:pet
```

自动检查固定内核提交，见 `.github/workflows/check.yml`。本地开发可以修改相邻内核，但修改后必须重新构建内核再验证游戏。

终端演示依次执行：出牌、保存并恢复等待选择、双方部署、攻击、Tough 替换败北、Frenzy 再次攻击，以及非法行动者被拒绝。演示用断言验证结果；它不是交互式游戏界面。

## Mindbug 实验范围

- 两位玩家，每人固定顺序的 10 张牌、3 点生命、2 次 Mindbug；立即补手牌至 5 张或牌堆耗尽。
- 出牌与对手夺取选择；夺取成功后原出牌者再行动。
- 攻击、阻挡、可选 Hunter 指定目标、Tough 败北替换、Frenzy 可选第二次攻击。
- 玩家生命归零或轮到自己却无合法行动时结束。
- `action`、`mindbug`、`block`、`frenzy`、`finished` 是可序列化的流程状态。
- 目标同时验证引用类别、会话、所在区域和控制者；指令同时验证行动者、流程与版本号。

当前子集没有治疗或额外抽牌能力，因此验证生命不超过 3、手牌不超过 5；这不是完整 Mindbug 的通用上限，引入对应能力时必须调整规则和校验。

不包含原版卡库、插画、卡牌文字、Poisonous/Sneaky、任意卡牌触发能力、扩展规则、随机发牌、联网和玩家隐藏信息视图。公开 `view()` 是调试用全量视图，不能直接用于对手客户端。

## 规则来源与测试

参考官方 [2023 规则书](https://mindbug.me/wp-content/uploads/2023/08/mindbug-rulebook-ENGLISH-small.pdf)，重点是出牌/夺取、战斗与关键词章节。`data/cards.json` 的名称与数值是自定义实验资料。

实验结果不证明支持全部 Mindbug 内容，更不证明任意回合制游戏都能直接接入。内核现已提供受控操作和显式流程协议；游戏 schema、操作实现和 TS 闭包仍然可信，没有第三方恶意代码沙箱。

内容经过结构和引用检查；快照规则集标识包含内容摘要。调整内容或规则语义后，不应默默加载旧快照。状态 schema 的跨字段检查拒绝无效流程，但不证明一个快照历史上可达，也不提供快照防伪。

API 示例见 `src/demo.ts`，行为测试见 `test/mindbug.test.ts`，编译期反例见 `test/types.ts`。

## v0.2：对象、流程、数值与持久会话

Mindbug 按模型、校验、行动、结算、注册和宿主拆分文件。每条命令直接通过共享操作协议执行，控制关系通过共享关系约束检查；Mindbug 原有等待状态仍保存在游戏自己的 `state.flow`，没有强行迁移成另一套存档结构。

`src/pet-duel/` 是第二个独立领域实验，分别包含对象模型、值、操作、流程和游戏适配器：

- 精灵和印记是不同对象类别。治疗同时检查类型和运行时引用，印记不能成为治疗目标。
- 印记附着精灵，分别为攻击和费用提供修正；删除印记会移除它的贡献。
- 连击先支付派生费用，创建仅本流程有效的攻击倍率，再执行两次伤害。
- 护盾与生命损失作为同次受控操作提交；伤害后反应加印记，第二击重新读取攻击。
- 首击击倒目标后，子流程等待合法替补。快照保存步骤、局部变量、选择 ID、随机状态及修正生命周期；恢复后继续第二击。
- 非法命令或流程故障拒绝整次提交，保留此前检查点；已成功提交的首击不会因为后续非法选择被撤销。

`npm run demo:pet` 演示存储接管：工作进程 A 提交首击并等待，租约到期后 B 恢复，重复首击请求返回原回执，B 完成换人和第二击，A 的后续写入被拒绝。演示使用可控时钟的内存存储；同一存储合约在内核测试中用真实 Redis 验证。

## 自定义内容入口

校验能力由内核提供：统一从 `@yuuinih/turn-kernel` 导入 `z`，游戏包不再单独依赖 Zod。对象直接以 `defineObject(kind, schema)` 定义，字段类型由 schema 推导。

Mindbug 的 JSON 卡牌资料在 `registration.ts` 校验并注册。精灵的对象、关系、派生值、操作和流程在 `pet-duel/game.ts` 组装版本化规则集。

内容作者可以通过内核 `defineBehavior` 声明允许请求的操作，再用 `bindBehavior` 将 JSON/YAML 参数绑定到注册行为，构建时检查依赖并冻结。完整示例和安全边界见 [内核注册说明](https://github.com/YuuinIH/turn-kernel#自定义内容如何注册)。参数保留数据形式供分析；TS 行为实现包含在生成的规则集构建摘要中，不在进行中的对局热替换。

这是最小可执行实验，还不是完整精灵游戏。尚未实现通用胜负循环、全量可配置效果目录、旧 config-value 迁移、玩家隐藏视图和网络服务。数值依赖目前显式追踪并保守重算，未实现增量缓存。旧 `test_battle` 未被替换。

实现复核记录见 [v0.2 审查](docs/review-v2.md)。

## 0.3 执行模型

Mindbug 的普通命令不再包装为单步 Flow，游戏自己的等待状态仍随对局保存。精灵实验的连击与换人继续使用 Flow：每个 Frame 的 `data` 保存自己的局部状态，子流程结果显式返回；一次伤害仍然是 Operation，不是新的 Phase/Context 实体。

回调收到隔离的状态数据；跨等待只保存恢复必需的信息，不保存执行服务或调用栈。两个示例提升规则集修订，旧规则集快照会被拒绝；需要恢复旧存档时保留旧版本或进行显式迁移。详见 [内核执行模型](https://github.com/YuuinIH/turn-kernel/blob/main/docs/flow-execution.md)。

## v0.4 组件实验

精灵由生命、战斗组件及阵营字段组成；防御塔复用生命组件，印记没有生命能力。同一个治疗操作支持精灵和防御塔，并独立校验只修改目标生命组件。攻击力/费用从战斗组件派生，印记和连击通过类型化 modifier 工厂提供修正。附着关系以生命组件限制目标；恢复时统一检查 modifier 来源、目标和流程存活。组件定义集中在 `src/pet-duel/definitions.ts`，存档校验、数值、操作和流程仍分文件维护。

组件组合目前固定；未引入动态组件或 ECS 调度。旧精灵快照不兼容。详见 [内核设计说明](https://github.com/YuuinIH/turn-kernel/blob/main/docs/components-values.md)。

派生值现在必须在组件目标下声明，例如 `petCombat.numericValue<Battle>("attack", (_q, _ref, combat) => combat.attack)`。计算前自动验证战斗组件，数值注册自动依赖其所属组件；modifier 使用组件内的派生值标识。v0.5 不兼容旧的裸 valueId。

## v0.6 结算中途等待

新增 `strike` / `respond` 命令：攻击先固定攻击力和随机结果，等待防守方决定是否格挡，然后用本次结算的修正计算护盾消耗与生命损失。结算定义、流程、操作分别位于 `strike-definition.ts`、`strike-flow.ts`、`strike-operations.ts`；等待数据保存在 Frame，恢复后不重新取样。该示例未接入技能费用，是用于验证中间值的独立攻击路径。`test/strike.test.ts` 覆盖 JSON 恢复、状态变化、非法目标、工作进程接管和回执去重。

运行 `npm run demo:strike` 查看取样、等待、JSON 归档恢复和格挡结算的完整过程。

## v0.7：对象式流程生命周期

`src/pet-duel/damage-hooks.ts` 用对象声明检查攻击参与者和命中后强化；`hit-flow.ts` 与 `strike-flow.ts` 使用引擎的 `defineFlow` 接入这些钩子。没有 setup、组合式注册或隐式当前实例。

连击调用共享的单次命中流程：主体执行伤害后，由引擎完成 after 中的加印记操作，才继续下一击。此前的 `OperationRuntime` 全局受伤反应已从此实验移除；印记去重使用本次流程实例 ID，不再借用随机状态作为身份。格挡仍然是伤害流程内的显式玩家选择，恢复不会重新执行 before 或重复抽取随机数。

内核的生命周期测试额外覆盖了 after 反应子流程等待、恢复和工作进程接管。此游戏示例的 after 当前只返回同步受控操作。流程快照使用格式 3；旧格式不兼容，规则集版本已更新。

## v0.9：自动规则集身份

定义和显式注册不再手写版本。`npm run build` 清理并编译项目，再对游戏与内核的编译产物、内容和两份依赖锁文件生成构建摘要。两个游戏入口都使用生成的 `dist/ruleset-build.js`；跳过构建直接运行源码会拒绝未生成的身份。

相同产物的重复构建得到相同身份；代码、schema 或内容变化会拒绝旧快照。运行时传入的卡牌内容也计入规则集。恢复旧对局需使用原产物，没有自动迁移。流程格式为 3。详细边界见内核的 [构建契约](https://github.com/YuuinIH/turn-kernel/blob/main/docs/ruleset-build.md)。
