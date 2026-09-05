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
```

自动检查固定内核提交，见 `.github/workflows/check.yml`。本地开发可以修改相邻内核，但修改后必须重新构建内核再验证游戏。

终端演示依次执行：出牌、保存并恢复等待选择、双方部署、攻击、Tough 替换败北、Frenzy 再次攻击，以及非法行动者被拒绝。演示用断言验证结果；它不是交互式游戏界面。

## 第一版范围

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

实验结果不证明支持全部 Mindbug 内容，更不证明任意回合制游戏都能直接接入。内核目前是可信游戏 reducer 的提交宿主，尚未提供第三方行为沙箱或完整受限操作方言。

内容经过结构和引用检查；快照规则集标识包含内容摘要。调整内容或规则语义后，不应默默加载旧快照。状态 schema 的跨字段检查拒绝无效流程，但不证明一个快照历史上可达，也不提供快照防伪。

API 示例见 `src/demo.ts`，行为测试见 `test/mindbug.test.ts`，编译期反例见 `test/types.ts`。
