# decision-service

Chinese Decision 的推理服务，跑在 GPU 服务器上。兼容 hmm / System One 接口，并为测试平台补充了批量、提示词编译、训练进度和热更新接口。

## 部署

在本机执行（需要能 SSH 到 GPU 服务器）：

```bash
./decision-service/deploy.sh
```

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `user@gpu-server.example.com` | SSH 目标 |
| `SSH_PORT` | `22` | SSH 端口 |
| `KEY` | `~/.ssh/id_ed25519` | SSH 私钥 |
| `REMOTE` | `/data/decision-service` | 服务器上的部署目录 |
| `CHINESE_DECISION` | `../chinese-decision` | 本地 chinese-decision 仓库，`decision` 包从这里取 |
| `GPU` / `PORT` | `2` / `8003` | 使用的 GPU 和端口 |

`deploy.sh` 做的事：

1. 同步 `decision/{schema,model,api}.py`（与训练、评测共用同一个提示词编译器）和本目录的脚本；
2. 第一次部署时生成 `.admin-token`（热更新用，权限 600）；
3. `snapshot.sh`：把训练目录的 `best/` 复制成 `snapshots/step-N`——训练会原地替换 `best/`，服务只加载不可变快照；
4. `start.sh`：在 tmux 会话 `decision` 里运行 `run.sh`，进程退出后 5 秒自动重启。

服务器上常用命令：

```bash
tmux attach -t decision                 # 看实时日志（Ctrl-b d 退出）
tail -f /data/decision-service/logs/serve.log
GPU=2 PORT=8003 /data/decision-service/start.sh   # 重启
```

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/systemone` | 决策接口；`?debug=1` 附带每个候选的 logits 和每题 token 数 |
| POST | `/api/alpha/decisions` | 同上，兼容 hmm 路由 |
| POST | `/v1/batch` | `{"requests": [...], "debug": bool}`，最多 512 个请求 / 4096 个决策，单个请求出错不影响其他 |
| POST | `/v1/compile` | 只编译提示词并计数 token |
| GET | `/v1/info` | 检查点、验证集指标、GPU、引擎配置、运行统计（延迟分位数、平均批大小、最近的前向） |
| GET | `/v1/training` | 训练目录的进度（只读） |
| POST | `/v1/admin/reload` | 快照最新的 best 并热加载，需要请求头 `X-Admin-Token` |
| GET | `/health` | 健康检查 |

## 动态批处理

所有前向都经过一个后台线程：

- 第一个请求到达后再等 `--max-wait-ms`（默认 4 ms），把这段时间内到达的请求合在一起；
- 按长度排序，按 `--token-budget`（默认 65,536，padding 后的 token 数）和 `--max-batch`（默认 64）切 micro-batch；
- 显存不足时自动退化成逐条前向；空闲 20 秒后释放缓存的显存。

在 A800 上的实测（工单请求，每个 3 个问题）：串行约 37 决策/秒、p50 81 ms；并发 32 时约 190 决策/秒、p50 约 470 ms。并发再升高时，吞吐反而下降——瓶颈是 Python 侧提示词编译与前向线程的 GIL 竞争。
