# skill-cli

## 文档

按任务阅读，不在这里重复规范：

- [PRODUCT.md](PRODUCT.md)：已确认的用户、用途与产品约束。
- [CONTEXT.md](CONTEXT.md)：产品与领域模型。
- [TECH.md](TECH.md)：技术架构、模块边界与安全保证。
- [DESIGN.md](DESIGN.md)：TUI 组件与交互规范（Impeccable / CDD）。
- [README.md](README.md)：命令与开发入口。

## 工作原则

- 只做授权范围内的工作；保留无关改动，未经允许不提交、推送或部署。
- 主体由主 agent 完成；委派需明确授权或适用指令要求，不嵌套委派。
- 复用现有能力，重设计先明确用户任务与状态；如实报告验证结果，不把方案当实现。
- 每轮 CLI/TUI 代码迭代验证后，rebuild 对应 `dist` 产物供用户测试；遵守下述 Docker 限制，失败须报告，不能把源码验证当成已重建。

## 资源安全

- 所有构建、renderer 测试及重型验证必须通过 `scripts/resource-run.sh` 在 Docker 中运行，包含 focused tests；禁止 host 执行。
- 固定上限：1 CPU、2 GiB 内存、2 GiB 内存＋swap 总量（无额外 swap）、128 PIDs；未经批准不得提高或绕过限制。
- 一次一个任务，不绕过 runner 锁。超时默认120秒、最多300秒；退出／超时须停止自有容器及子进程，确认停止后再继续。
- Docker 不可用或超限时停止并报告，不回退 host、不原样重试；验证中不安装程序、不改真实安装、不杀无关进程。
- 细节见 [resource-run.md](scripts/resource-run.md)；`--check` 仅探测资源配置，不代表获准运行测试或构建。
